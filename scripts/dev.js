/**
 * electron:dev 编排器：真正"拿到" Umi dev 的实际端口，彻底消除端口错位。
 *
 * 流程：
 *   1. spawn `max dev`（Umi）
 *   2. 从其 stdout 逐行解析真实监听端口（"Local: http://localhost:<port>"，含端口被占后退避的情况）
 *   3. 单一定时器轮询该端口直到 HTTP 可达（webpack 首次编译就绪）
 *   4. spawn Electron（仅一次），注入 UMI_DEV_PORT=<实际端口>
 *   5. 任一子进程退出 → 杀掉全部子进程树（替代 concurrently -k）
 *
 * 已知约束（设计决定，见对话记录 2026-09-22）：
 * - "Local: http://..." 是 Umi 的打印文案而非官方 API，Umi 大版本升级可能需要改 PORT_MATCH；
 *   解析不到时 60s 响亮报错退出，绝不静默回退写死端口（那会回到 Electron 加载错误页面的老路）。
 * - Windows 下 kill 不杀子进程树，统一 taskkill /T /F；Ctrl+C 走 SIGINT 钩子兜底。
 * - 轮询必须单一定时器 + launched 标志：timeout/error 双事件都会触发重试，
 *   递归式 setTimeout 会累积并行等待链，就绪瞬间拉起多个 Electron（v1 实测踩坑）。
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT_MATCH = /Local:\s*http:\/\/localhost:(\d+)/;
const PORT_TIMEOUT_MS = 60_000; // 解析不到端口的总时限
const READY_TIMEOUT_MS = 30_000; // 端口解析成功后、HTTP 就绪的时限
const POLL_INTERVAL_MS = 500;

let umi = null;
let exiting = false;
let port = null;
let launched = false;
const electronPids = []; // 追踪全部 Electron 实例，退出时逐一杀树

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* 进程可能已退出 */
  }
}

function exitAll(code) {
  if (exiting) return;
  exiting = true;
  electronPids.forEach(killTree);
  killTree(umi && umi.pid);
  process.exit(code);
}

process.on('exit', () => {
  electronPids.forEach(killTree);
  killTree(umi && umi.pid);
});
process.on('SIGINT', () => exitAll(130));
process.on('SIGTERM', () => exitAll(143));

/** 逐行转发子进程输出（带前缀），并对每行调用 onLine */
function pipeLines(child, tag, onLine) {
  let rest = '';
  const feed = (d) => {
    rest += d.toString().replace(/\r/g, '');
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) {
      console.log(`[${tag}] ${line}`);
      if (onLine) onLine(line);
    }
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  child.on('exit', () => {
    if (rest) console.log(`[${tag}] ${rest}`);
  });
}

/** 单一定时器轮询 Umi 端口，就绪后恰好拉起一次 Electron */
function waitReady() {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (exiting || launched) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - startedAt > READY_TIMEOUT_MS) {
      clearInterval(timer);
      console.error(`[orch] 端口 ${port} 在 ${READY_TIMEOUT_MS / 1000}s 内未就绪，退出`);
      exitAll(1);
      return;
    }
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
      res.resume();
      clearInterval(timer);
      if (launched || exiting) return;
      launched = true;
      log('orch', `Umi dev 就绪（端口 ${port}），启动 Electron（UMI_DEV_PORT=${port}）`);
      launchElectron();
    });
    // 未就绪/超时都交由下一个轮询周期处理
    req.on('timeout', () => req.destroy());
    req.on('error', () => {});
  }, POLL_INTERVAL_MS);
}

function launchElectron() {
  const child = spawn('npx', ['electron', '.'], {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, UMI_DEV_PORT: String(port) },
  });
  electronPids.push(child.pid);
  pipeLines(child, 'electron');
  child.on('exit', (code) => {
    log('orch', `electron 退出（code=${code ?? 'null'}），关闭 dev server`);
    exitAll(code ?? 0);
  });
}

log('orch', '启动 Umi dev server…');
umi = spawn('npx', ['max', 'dev'], { cwd: ROOT, shell: true });
pipeLines(umi, 'dev', (line) => {
  if (port || launched) return;
  const m = line.match(PORT_MATCH);
  if (!m) return;
  port = Number(m[1]);
  log('orch', `解析到 Umi 实际端口：${port}`);
  waitReady();
});
umi.on('exit', (code) => {
  if (!exiting) {
    log('orch', `umi dev 退出（code=${code ?? 'null'}）`);
    exitAll(code ?? 0);
  }
});

setTimeout(() => {
  if (!port && !exiting) {
    console.error(
      `[orch] ${PORT_TIMEOUT_MS / 1000}s 内未从 Umi 输出解析到端口。` +
        '可能原因：Umi 输出格式变更（应含 "Local: http://localhost:<port>" 文案）或 dev server 启动失败。' +
        '拒绝回退到写死端口（会重现端口错位老问题），退出。'
    );
    exitAll(1);
  }
}, PORT_TIMEOUT_MS);
