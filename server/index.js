/**
 * C 盘分析 - 本地 API 服务
 * 职责：
 *  - POST /api/scan  触发 PowerShell 只读扫描（防并发），成功后自动记录全树历史快照
 *  - GET  /api/scan  返回缓存结果
 *  - GET  /api/status 是否已有结果
 *  - GET  /api/history / DELETE /api/history  历史快照列表与删除
 *  - GET  /api/growth[/dir|/trend]  增长分析（window=1m 或 from=YYYY-MM-DD&to=YYYY-MM-DD 区间）
 *  - POST /api/elevate-restart  一键以管理员身份重启（UAC）并自动重扫
 *  - 生产模式托管 dist/ 静态资源（SPA fallback）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const history = require('./history');
const { resolvePaths } = require('./config');
const { createLogger } = require('../electron/logger');

const paths = resolvePaths();
const PORT = process.env.PORT || 8090;
const RESULT_FILE = paths.resultFile;
const PS_SCRIPT = paths.psScript;
const DIST_DIR = path.join(paths.root, 'dist');
const ELEVATE_SCRIPT = paths.elevateScript;
const ELEVATE_FLAG = paths.elevateFlag;
const log = createLogger({ logDir: paths.logDir, name: 'server' });

// 以管理员身份启动时自动重扫一次
const SCAN_ON_START = process.argv.includes('--scan-on-start');

/** 拼接 PowerShell 完整路径（纯函数，可单测） */
function computePowerShellCandidate(sysRoot) {
  return path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** 打包后 Electron 环境的 PATH 可能不含 powershell.exe，优先用完整路径，回退裸命令 */
function resolvePowerShellPath() {
  const candidate = computePowerShellCandidate(process.env.SystemRoot || 'C:\\Windows');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

// 打包版（Electron GUI 启动）PATH 可能不含 powershell.exe，统一用解析出的完整路径
const PS_EXE = resolvePowerShellPath();

let scanning = false;
let elevatedScan = 'idle'; // idle | running | cancelled
let elevateStartedAt = 0;

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    // PowerShell WriteAllText 可能写出 BOM，JSON.parse 前必须去掉
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    log.warn('json', '读取/解析失败，返回 null', { file, err: err.message });
    return null;
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 调用 PowerShell 扫描脚本，返回 Promise */
function runScan() {
  return new Promise((resolve, reject) => {
    log.info('scan', '扫描开始', { script: PS_SCRIPT });
    const startedAt = Date.now();
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      // cwd 必须为真实目录：打包后 paths.root 是 app.asar 内路径，作工作目录会导致 spawn ENOENT
      { cwd: paths.dataDir, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
    );
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d.toString()));
    ps.stderr.on('data', (d) => (stderr += d.toString()));
    ps.on('error', (err) => {
      log.error('scan', '扫描进程启动失败', err);
      reject(err);
    });
    ps.on('close', (code) => {
      if (code === 0 && fs.existsSync(RESULT_FILE)) {
        const size = fs.statSync(RESULT_FILE).size;
        log.info('scan', '扫描完成', { exit: code, resultSize: size, elapsedMs: Date.now() - startedAt });
        resolve(readJson(RESULT_FILE));
      } else {
        const err = new Error(`扫描失败 (exit ${code}): ${stderr || stdout}`);
        log.error('scan', '扫描失败', err);
        reject(err);
      }
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        log.warn('api', '请求体 JSON 解析失败，按空对象处理', { err: err.message });
        resolve({});
      }
    });
  });
}

// ---- 静态资源 / SPA fallback（生产模式） ----
function serveStatic(req, res) {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(res, 404, { error: '未找到构建产物，开发模式请使用 max dev' });
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // SPA fallback
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(DIST_DIR, 'index.html')).pipe(res);
}

/** 提权成功后自动重扫：--scan-on-start 启动时调用 */
function scanOnce() {
  if (scanning) return;
  scanning = true;
  log.info('scan', '管理员模式启动，自动重新扫描');
  runScan()
    .then(async (data) => {
      let snapshotWarning = null;
      try {
        await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
      } catch (e) {
        snapshotWarning = `历史快照记录失败: ${e.message}`;
        log.warn('scan', snapshotWarning);
      }
      log.info('scan', '自动扫描完成');
    })
    .catch((err) => log.error('scan', '自动扫描失败', err))
    .finally(() => {
      scanning = false;
    });
}

/**
 * 构造触发 UAC 提权的命令（纯函数，可单测）
 * 关键：提权进程由 UAC 重新创建，**不会继承调用者的环境变量**，
 * 因此 flag 路径与 exe 路径必须通过命令行显式传入，
 * 否则 relaunch-admin.ps1 里的 $env:CLEANER_* 全为空，flag 会写到错误位置。
 */
function buildElevateCommand(pid, flagPath, exePath) {
  const parts = [
    "'-NoProfile'",
    "'-ExecutionPolicy'",
    "'Bypass'",
    "'-File'",
    `'${ELEVATE_SCRIPT}'`,
    "'-OldPid'",
    `'${pid}'`,
  ];
  if (flagPath) parts.push("'-FlagPath'", `'${flagPath}'`);
  if (exePath) parts.push("'-ExePath'", `'${exePath}'`);
  const start = `Start-Process -FilePath '${PS_EXE}' -Verb RunAs -WindowStyle Hidden -ArgumentList ${parts.join(',')}`;
  // UAC 被拒绝时 Start-Process 抛错：用非 0 退出码告知调用方，避免白等 60 秒才允许重试
  return `try { ${start} } catch { Write-Output $_.Exception.Message; exit 1 }`;
}

// ---- 路由 ----
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.on('finish', () => {
    if (p.startsWith('/api/')) log.info('api', `${req.method} ${p} -> ${res.statusCode}`);
  });
  try {
    if (req.method === 'GET' && p === '/api/status') {
      const data = readJson(RESULT_FILE);
      sendJson(res, 200, {
        hasResult: !!data,
        scanning,
        scannedAt: data?.scannedAt || null,
        disk: data?.disk || null,
        elevatedScan,
      });
      return;
    }

    if (req.method === 'GET' && p === '/api/scan') {
      const data = readJson(RESULT_FILE);
      if (!data) {
        sendJson(res, 404, { error: '尚无扫描结果，请先触发扫描', scanning });
        return;
      }
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && p === '/api/history') {
      sendJson(res, 200, history.listSnapshots());
      return;
    }

    if (req.method === 'DELETE' && p === '/api/history') {
      const filter = await readBody(req);
      sendJson(res, 200, history.deleteSnapshots(filter));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth') {
      const window = url.searchParams.get('window') || '1m';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const top = Math.min(Math.max(Number(url.searchParams.get('top')) || 20, 1), 100);
      sendJson(res, 200, await history.computeGrowthTop({ window, top, from, to }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/dir') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const window = url.searchParams.get('window') || '1m';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      sendJson(res, 200, await history.computeGrowthDir({ path: path_, window, from, to }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/trend') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const points = Math.min(Math.max(Number(url.searchParams.get('points')) || 60, 5), 120);
      sendJson(res, 200, await history.computeGrowthTrend({ path: path_, points }));
      return;
    }

    if (req.method === 'POST' && p === '/api/scan') {
      if (scanning) {
        sendJson(res, 409, { error: '扫描正在进行中，请稍候' });
        return;
      }
      scanning = true;
      runScan()
        .then(async (data) => {
          let snapshotWarning = null;
          try {
            await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
          } catch (e) {
            snapshotWarning = `历史快照记录失败: ${e.message}`;
            log.warn('scan', snapshotWarning);
          }
          scanning = false;
          sendJson(res, 200, { ok: true, ...data, snapshotWarning });
        })
        .catch((err) => {
          scanning = false;
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    if (req.method === 'POST' && p === '/api/elevate-restart') {
      if (elevatedScan === 'running') {
        log.warn('elevate', '提权请求重复到达，仍在上一次授权等待窗口内', {
          waitMs: Date.now() - elevateStartedAt,
        });
        sendJson(res, 409, { error: '提权请求已在进行中，请先在系统授权窗口完成授权' });
        return;
      }
      if (fs.existsSync(ELEVATE_FLAG)) {
        try { fs.unlinkSync(ELEVATE_FLAG); } catch (err) { log.warn('elevate', '删除提权标志失败（忽略）', { err: err.message }); }
      }
      elevatedScan = 'running';
      elevateStartedAt = Date.now();
      const elevateCmd = buildElevateCommand(process.pid, ELEVATE_FLAG, process.env.CLEANER_EXE_PATH || '');
      log.info('elevate', '收到提权重启请求，等待 UAC 授权', {
        pid: process.pid,
        flagPath: ELEVATE_FLAG,
        exePath: process.env.CLEANER_EXE_PATH || '(未注入，走开发回退)',
      });
      const child = spawn(
        PS_EXE,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', elevateCmd],
        { windowsHide: true },
      );
      // UAC 被用户拒绝时该 powershell 会很快非 0 退出且不会写 flag → 立即判定为取消
      child.on('error', (err) => {
        log.error('elevate', '启动提权命令失败', err);
      });
      child.on('exit', (code) => {
        log.info('elevate', '提权引导进程已退出', { code });
        if (elevatedScan !== 'running') return;
        if (fs.existsSync(ELEVATE_FLAG)) return; // 授权成功，等 monitor 退出旧进程
        if (code !== 0) {
          elevatedScan = 'cancelled';
          log.warn('elevate', 'UAC 授权被拒绝，可重试');
        }
      });
      sendJson(res, 200, { ok: true, elevatedScan });
      return;
    }

    if (p.startsWith('/api/')) {
      sendJson(res, 404, { error: `未知接口: ${p}` });
      return;
    }

    serveStatic(req, res);
  } catch (e) {
    log.error('api', `接口异常 ${req.method} ${p}`, e);
    sendJson(res, 500, { error: e.message });
  }
}

function startServer(port = PORT) {
  if (fs.existsSync(ELEVATE_FLAG)) {
    try { fs.unlinkSync(ELEVATE_FLAG); } catch (err) { log.warn('elevate', '启动时删除提权标志失败（忽略）', { err: err.message }); }
  }
  const server = http.createServer(handle);
  server.listen(port, () => {
    log.info('server', 'API 服务已启动', { url: `http://localhost:${port}` });
    if (SCAN_ON_START) scanOnce();
  });
  return server;
}

/**
 * 监控提权确认标志：确认后旧进程退出，由提权服务接管 8090（仅主进程入口调用）
 * 判定只看 flag 文件本身（不看 elevatedScan）：即使引导进程被误判为取消，
 * 只要 flag 真的出现就仍要退出，否则端口不释放会拖垮提权进程。
 */
function startElevateMonitor() {
  if (SCAN_ON_START) return;
  setInterval(() => {
    if (elevatedScan === 'idle') return;
    if (fs.existsSync(ELEVATE_FLAG)) {
      log.info('elevate', '已确认提权，旧进程 1 秒后退出');
      setTimeout(() => process.exit(0), 1000);
    } else if (elevatedScan === 'running' && Date.now() - elevateStartedAt > 60000) {
      elevatedScan = 'cancelled';
      log.warn('elevate', '提权未确认（UAC 可能被取消），保持当前进程');
    }
  }, 1000);
}

if (require.main === module) {
  startServer(PORT);
  startElevateMonitor();
} else {
  module.exports = { startServer, buildElevateCommand, startElevateMonitor, computePowerShellCandidate, resolvePowerShellPath };
}
