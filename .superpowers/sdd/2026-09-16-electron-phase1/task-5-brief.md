# Task 5 Brief: server/index.js — 路径可配置化 + 全路径日志 + 请求日志

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务改造现有 http 服务入口 `server/index.js`：路径可配置化（依赖 `server/config.js`）、全路径日志（依赖 `electron/logger.js`）、请求日志、抽取 `startElevateMonitor`。

前置：Task 2（config.js resolvePaths）、Task 4（logger.js createLogger）已完成，接口如下：

```js
// server/config.js
resolvePaths(env = process.env) → {
  root, dataDir, scriptsDir, logDir,
  resultFile, historyDir, elevateFlag,
  psScript, elevateScript
}
// electron/logger.js
createLogger({ logDir, name }) → { info(module,msg,detail), warn(module,msg,detail), error(module,msg,errOrDetail) }
```

## 本任务目标

- 常量区改用 `resolvePaths()`（默认值=项目根，现有行为不变）
- `runScan` 传 env（`CLEANER_RESULT_PATH`）+ 扫描全链路日志
- `readJson` 空吞 catch 补日志
- `handle()` 增加 `/api/*` 请求日志（响应 finish 时记录状态码）+ catch 补日志
- `scanOnce` / 提权链路 / `startServer` 的 console 改 log.*
- 抽取并导出 `startElevateMonitor()`（原 require.main 分支轮询）
- `api.test.js` 追加 2 个用例

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- **同一文件禁止并行 SearchReplace**；对 server/index.js 的多处修改按顺序单次编辑，或读取全文后用 Write 重写整个文件（重写时必须保留文件全部既有逻辑，只改本任务指定位置）。
- **全路径日志**：改造涉及的每个 catch 分支必须有日志（`log.error` 含 stack，或 `log.warn` 说明边界）；禁止静默失败。
- 前端 `src/` 与 `config/config.ts` 不许改动。
- 模块被 require 时（`require.main !== module`）不得自动启动服务；保持现有行为。

## 现有 server/index.js 关键结构（供对照，务必先 Read 全文再改）

- 第 12-24 行：require 与常量区（ROOT/RESULT_FILE/PS_SCRIPT/DIST_DIR/ELEVATE_SCRIPT/ELEVATE_FLAG/SCAN_ON_START 等）
- 第 33-42 行：`readJson`（catch {} 空吞）
- 第 54-74 行：`runScan`（spawn powershell，cwd: ROOT）
- 第 115-134 行：`scanOnce`（console.log/warn/error）
- 第 142-255 行：`handle`（try/catch，路由）
- 第 226-244 行：`POST /api/elevate-restart`（console.log）
- 第 257-267 行：`startServer`（console.log）
- 第 269-286 行：`require.main` 分支（轮询）+ `module.exports`

## Step 1: 先追加测试（api.test.js 末尾追加 2 个用例）

在 `server/tests/api.test.js` 末尾追加：

```js
test('startElevateMonitor 存在且为函数', () => {
  const { startElevateMonitor } = require('../index.js');
  assert.strictEqual(typeof startElevateMonitor, 'function');
});

test('buildElevateCommand 指向 relaunch-admin 脚本', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(999);
  assert.ok(cmd.includes('relaunch-admin.ps1'));
});
```

Run: `node --test server/tests/api.test.js`
Expected: 新增第 1 个用例 FAIL（startElevateMonitor 未导出）

## Step 2: 改造 server/index.js

### 2a. 常量区（替换第 12-24 行附近）

```js
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
```

删除原 `ROOT`、`RESULT_FILE`、`PS_SCRIPT`、`DIST_DIR`、`ELEVATE_SCRIPT`、`ELEVATE_FLAG` 定义（由 paths 取代）。原 `SCAN_ON_START`、`scanning`、`elevatedScan`、`elevateStartedAt` 保留。

注意：若代码中其他位置使用 `ROOT`，改为 `paths.root`（如 runScan 的 `cwd: ROOT`）。

### 2b. readJson（补日志）

```js
function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    log.warn('json', '读取/解析失败，返回 null', { file, err: err.message });
    return null;
  }
}
```

### 2c. runScan（env + 全链路日志）

```js
function runScan() {
  return new Promise((resolve, reject) => {
    log.info('scan', '扫描开始', { script: PS_SCRIPT });
    const startedAt = Date.now();
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { cwd: paths.root, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
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
```

### 2d. handle()（请求日志 + catch 日志）

把 `const url = new URL(req.url, 'http://x'); const p = url.pathname;` 移到 try 外（handle 开头），并在其后注册请求日志：

```js
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.on('finish', () => {
    if (p.startsWith('/api/')) log.info('api', `${req.method} ${p} -> ${res.statusCode}`);
  });
  try {
    // ...原有路由逻辑不变（删除 try 内重复的 const url / const p 定义）
  } catch (e) {
    log.error('api', `接口异常 ${req.method} ${p}`, e);
    sendJson(res, 500, { error: e.message });
  }
}
```

### 2e. scanOnce（console → log.*）

- `console.log('[server] 管理员模式启动，自动重新扫描…')` → `log.info('scan', '管理员模式启动，自动重新扫描')`
- `console.warn('[history]', snapshotWarning)` → `log.warn('scan', snapshotWarning)`
- `console.error('[server] 自动扫描失败:', err.message)` → `log.error('scan', '自动扫描失败', err)`
- `console.log('[server] 自动扫描完成')` → `log.info('scan', '自动扫描完成')`

### 2f. 提权链路日志

`POST /api/elevate-restart` 分支内 `console.log('[server] 已请求以管理员身份重启，等待 UAC 授权…')` 替换为：

```js
log.info('elevate', '收到提权重启请求，等待 UAC 授权');
```

### 2g. startServer 日志

`console.log(\`[server] C盘分析 API 服务已启动: http://localhost:${port}\`)` 替换为：

```js
log.info('server', 'API 服务已启动', { url: `http://localhost:${port}` });
```

### 2h. startElevateMonitor 抽取 + 导出

原 `if (require.main === module)` 分支的轮询逻辑抽为函数，并改造文件末尾：

```js
function startElevateMonitor() {
  if (SCAN_ON_START) return;
  setInterval(() => {
    if (elevatedScan !== 'running') return;
    if (fs.existsSync(ELEVATE_FLAG)) {
      log.info('elevate', '已确认提权，旧进程 1 秒后退出');
      setTimeout(() => process.exit(0), 1000);
    } else if (Date.now() - elevateStartedAt > 60000) {
      elevatedScan = 'cancelled';
      log.warn('elevate', '提权未确认（UAC 可能被取消），保持当前进程');
    }
  }, 1000);
}

if (require.main === module) {
  startServer(PORT);
  startElevateMonitor();
} else {
  module.exports = { startServer, buildElevateCommand, startElevateMonitor };
}
```

（原 `--scan-on-start` 时 `scanOnce` 由 startServer 的 listen 回调触发，保持不变。）

## Step 3: 运行确认通过

Run: `node --test server/tests/api.test.js`
Expected: PASS（原有 5 个 + 新增 2 个 = 7 个用例）

## Step 4: 回归全部测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败——history/ 残留真实快照，临时改 history.bak/ 重跑后恢复，禁止删除数据）

## Step 5: 冒烟验证（可选但推荐）

Run: `node server/index.js`（阻塞运行，另开终端验证后 Ctrl+C 停止）
Expected: 终端输出启动日志；`logs/server-YYYY-MM-DD.log` 生成；浏览器/curl 访问 `http://localhost:8090/api/status` 返回 200 JSON

## 报告

完成后在报告中写明：
- server/index.js 每处修改的摘要（old → new）
- api.test.js 新增用例的验证结果
- `npm test` 回归结果
- 冒烟验证结果（若执行）
- 任何偏差
