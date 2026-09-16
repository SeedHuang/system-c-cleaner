/**
 * C 盘分析 - 本地 API 服务
 * 职责：
 *  - POST /api/scan  触发 PowerShell 只读扫描（防并发），成功后自动记录全树历史快照
 *  - GET  /api/scan  返回缓存结果
 *  - GET  /api/status 是否已有结果
 *  - GET  /api/history / DELETE /api/history  历史快照列表与删除
 *  - GET  /api/growth[/dir|/trend]  增长分析
 *  - POST /api/elevate-restart  一键以管理员身份重启（UAC）并自动重扫
 *  - 生产模式托管 dist/ 静态资源（SPA fallback）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const history = require('./history');

const PORT = process.env.PORT || 8090;
const ROOT = path.join(__dirname, '..');
const RESULT_FILE = path.join(ROOT, 'scan-result.json');
const PS_SCRIPT = path.join(ROOT, 'scripts', 'scan-c.ps1');
const DIST_DIR = path.join(ROOT, 'dist');
const ELEVATE_SCRIPT = path.join(ROOT, 'scripts', 'relaunch-admin.ps1');
const ELEVATE_FLAG = path.join(ROOT, 'history', '.elevated-launch.flag');

// 以管理员身份启动时自动重扫一次
const SCAN_ON_START = process.argv.includes('--scan-on-start');

let scanning = false;
let elevatedScan = 'idle'; // idle | running | cancelled
let elevateStartedAt = 0;

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    // PowerShell WriteAllText 可能写出 BOM，JSON.parse 前必须去掉
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
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
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { cwd: ROOT, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d.toString()));
    ps.stderr.on('data', (d) => (stderr += d.toString()));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0 && fs.existsSync(RESULT_FILE)) {
        resolve(readJson(RESULT_FILE));
      } else {
        reject(new Error(`扫描失败 (exit ${code}): ${stderr || stdout}`));
      }
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
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
  console.log('[server] 管理员模式启动，自动重新扫描…');
  runScan()
    .then(async (data) => {
      let snapshotWarning = null;
      try {
        await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
      } catch (e) {
        snapshotWarning = `历史快照记录失败: ${e.message}`;
        console.warn('[history]', snapshotWarning);
      }
      console.log('[server] 自动扫描完成');
    })
    .catch((err) => console.error('[server] 自动扫描失败:', err.message))
    .finally(() => {
      scanning = false;
    });
}

/** 构造触发 UAC 提权的命令（纯函数，可单测） */
function buildElevateCommand(pid) {
  return `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ELEVATE_SCRIPT}','-OldPid','${pid}'`;
}

// ---- 路由 ----
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

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
      const top = Math.min(Math.max(Number(url.searchParams.get('top')) || 20, 1), 100);
      sendJson(res, 200, await history.computeGrowthTop({ window, top }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/dir') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const window = url.searchParams.get('window') || '1m';
      sendJson(res, 200, await history.computeGrowthDir({ path: path_, window }));
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
            console.warn('[history]', snapshotWarning);
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
        sendJson(res, 409, { error: '提权重启正在进行中，请稍候' });
        return;
      }
      if (fs.existsSync(ELEVATE_FLAG)) {
        try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
      }
      elevatedScan = 'running';
      elevateStartedAt = Date.now();
      spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildElevateCommand(process.pid)],
        { windowsHide: true },
      );
      console.log('[server] 已请求以管理员身份重启，等待 UAC 授权…');
      sendJson(res, 200, { ok: true, elevatedScan });
      return;
    }

    if (p.startsWith('/api/')) {
      sendJson(res, 404, { error: `未知接口: ${p}` });
      return;
    }

    serveStatic(req, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function startServer(port = PORT) {
  if (fs.existsSync(ELEVATE_FLAG)) {
    try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
  }
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`[server] C盘分析 API 服务已启动: http://localhost:${port}`);
    if (SCAN_ON_START) scanOnce();
  });
  return server;
}

if (require.main === module) {
  startServer(PORT);
  // 非提权模式下监控提权确认标志：确认后本服务退出，由提权服务接管 8090
  if (!SCAN_ON_START) {
    setInterval(() => {
      if (elevatedScan !== 'running') return;
      if (fs.existsSync(ELEVATE_FLAG)) {
        console.log('[server] 已确认提权，旧服务 1 秒后退出，由管理员服务接管');
        setTimeout(() => process.exit(0), 1000);
      } else if (Date.now() - elevateStartedAt > 60000) {
        elevatedScan = 'cancelled';
        console.log('[server] 提权未确认（UAC 可能被取消），保持当前服务');
      }
    }, 1000);
  }
} else {
  module.exports = { startServer, buildElevateCommand };
}
