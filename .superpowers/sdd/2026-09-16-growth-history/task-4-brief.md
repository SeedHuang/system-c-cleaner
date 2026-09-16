# Task 4 Brief: server/index.js 路由接入（history/growth API + 扫描后自动快照）

项目：d:\Seed\system-c-cleaner（C 盘分析工具）。本任务把 Task 1~3 实现的 `server/history.js` 接入现有 HTTP 服务 `server/index.js`，新增 history/growth 路由、改造 POST /api/scan 自动生成快照，并重构为可被测试 require 的 `startServer` 导出。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 运行测试：`npm test`（注意：现有 `server/tests/history.test.js` 也会跑）。
- 禁止安装 npm 依赖；不运行 npm install / postinstall。
- 文件编辑用 Write/SearchReplace 工具。
- 不要动 `server/tests/history.test.js`。
- 不要派生子代理。
- **不要真实触发扫描**（POST /api/scan 会调用 PowerShell 全盘扫描，耗时 1~3 分钟且沙箱可能拦截）——本任务只做代码接入与 API 只读测试，不实跑扫描。

## Files

- Modify: `server/index.js`
- Create: `server/tests/api.test.js`

## Interfaces

- Consumes: `server/history.js` 的 `listSnapshots/deleteSnapshots/computeGrowthTop/computeGrowthDir/computeGrowthTrend/buildSnapshot`
- Produces: `module.exports = { startServer }`；新路由：
  - `GET /api/history` → `{ snapshots, totalSizeMB }`
  - `DELETE /api/history` → body `{ ids?|year?|month?|day?|hour?|before? }` → `{ deleted }`
  - `GET /api/growth?window=&top=` → GrowthTopResult
  - `GET /api/growth/dir?path=&window=` → GrowthDirResult
  - `GET /api/growth/trend?path=&points=` → GrowthTrendResult
  - `POST /api/scan`（改造）→ 成功后自动 `history.buildSnapshot({ scannedAt, disk })`，失败仅附带 `snapshotWarning` 字段（不影响主结果与 200 返回）

## Steps

### Step 1: 写失败测试

创建 `server/tests/api.test.js`：

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../index.js');

let server;
let base;

before(async () => {
  server = startServer(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /api/status 正常返回', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok('hasResult' in body && 'scanning' in body);
});

test('GET /api/history 空历史返回空列表', async () => {
  const res = await fetch(`${base}/api/history`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.snapshots));
  assert.strictEqual(typeof body.totalSizeMB, 'number');
});

test('GET /api/growth 无历史时 insufficient=true', async () => {
  const res = await fetch(`${base}/api/growth?window=1m`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
});
```

### Step 2: 运行测试确认失败

Run: `node --test server/tests/api.test.js`
Expected: FAIL，`Cannot find module '../index.js'` 或 `startServer is not a function`（当前 index.js 未导出 startServer）

### Step 3: 用完整新文件覆盖 server/index.js

下面是 `server/index.js` 的**完整新内容**（在当前实现基础上：加 `const history = require('./history');`、`readBody`、`handle` 改 async 并包 try/catch、新增路由、POST /api/scan 改造、底部 `startServer` + main guard）。直接整体覆盖写入：

```js
/**
 * C 盘分析 - 本地 API 服务
 * 职责：
 *  - POST /api/scan  触发 PowerShell 只读扫描（防并发），成功后自动记录全树历史快照
 *  - GET  /api/scan  返回缓存结果
 *  - GET  /api/status 是否已有结果
 *  - GET  /api/history / DELETE /api/history  历史快照列表与删除
 *  - GET  /api/growth[/dir|/trend]  增长分析
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

let scanning = false;

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
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`[server] C盘分析 API 服务已启动: http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer(PORT);
} else {
  module.exports = { startServer };
}
```

### Step 4: 运行全部测试确认通过

Run: `node --test server/tests/api.test.js` 然后 `npm test`
Expected: api.test.js 3 用例通过；`npm test` 全部通过（13 + 3 = 16）

### Step 5: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-4-report.md` 写入完整报告（实现说明、测试命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、测试摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，**不要真实触发 POST /api/scan 扫描**。
