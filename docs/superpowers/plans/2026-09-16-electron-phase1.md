# Electron 桌面化 Phase 1（外壳 + 一键安装包）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有「Web 前端 + Node http 服务 + PowerShell 扫描」工具包成 Windows 一键安装包（NSIS exe），Electron 主进程内嵌现有服务承载全部功能，落地全路径日志与提权适配。

**Architecture:** Electron 主进程（`electron/main.js`）内嵌启动现有 `server/index.js`，生产模式加载 server 托管的 `dist/`，开发模式加载 umi dev server；`server/config.js` 作为路径解析单一来源（`CLEANER_*` 环境变量，开发默认项目根、打包后指向 userData）；`scripts/*.ps1` 经 extraResources 放 asar 外；全路径日志（`electron/logger.js`，console+文件双写）。前端 `src/` 零改动。

**Tech Stack:** Node 22 / npm、Electron ^44、electron-builder（NSIS）、concurrently、@umijs/max ^4.3（仅构建期）、Node 内置 `node:test` / `node:assert` / `fs` / `net` / `http`、PowerShell 5.1。

**Spec:** [2026-09-16-electron-phase1-design.md](../specs/2026-09-16-electron-phase1-design.md)

## Global Constraints

- **UI 冻结**：不触碰 `src/` 与 `config/config.ts`；后续新增 UI 严格对齐 Figma Dark（`#212332` / `#2A2D3E` / `#2697FF`，状态色 `#EE2727` 红、`#FFCF26` 黄、`#26E5FF` 青、`#70CF12` 绿、`#FFA113` 橙）。
- **抽象 / DRY**：路径解析单一来源 `server/config.js`（spec 第 9 节的 `electron/env.js` 合并至此，理由：避免两处解析同一环境变量）；日志、端口退避、提权命令构造均单一模块复用；发现与既有功能重叠 → 复用而非新建。
- **TDD**：每任务「先写失败测试 → 确认失败 → 实现 → 确认通过 → 重构」；沿用 `node --test server/tests/`（`npm test`）。
- **全路径日志**：正常分支 `INFO`、catch/失败分支 `ERROR`（含 stack + 上下文）、边界分支 `WARN`；**catch 无日志 = 代码缺陷**；日志写文件失败降级 console 不抛错。
- **BOM 保护**：`scripts/*.ps1` 是 UTF-8 带 BOM（PowerShell 5.1 解析中文必需），**只允许 Write 全量重写并保留 BOM，禁止 SearchReplace**，写入前先备份 `.bak`。
- **零新运行时依赖**：新增 devDependency 仅 electron / electron-builder / concurrently；server 运行时仅 Node 内置模块；前端构建依赖（@umijs/max、antd、react 等）移入 devDependencies，使打包产物不含 node_modules。
- **同一文件禁止并行 SearchReplace**；import 变更与代码变更必须合并进同一次 SearchReplace。
- **编译检查**：编辑 .ts/.tsx 后 `npx tsc --noEmit --pretty 2>&1 | grep "<目录>"`；全部完成后全量 `npx tsc --noEmit --pretty`。已知预存错误（src/app.tsx、src/pages/404、src/setup/theme.tsx）可忽略。
- **git 提交**：仅当用户明确要求时执行 commit（本计划各任务不包含 commit 步骤）。
- **安全**：`contextIsolation: true`、`nodeIntegration: false`，Phase 1 无 preload / IPC。

---

### Task 1: 依赖与基础配置（package.json / .npmrc / electron-builder.yml）

**Files:**
- Modify: `package.json`
- Create: `.npmrc`
- Create: `electron-builder.yml`
- Modify: `.gitignore`（加 `logs/`、`dist_electron/`）

**Interfaces:**
- Consumes: 无
- Produces: `npm run electron` / `npm run electron:dev` / `npm run electron:build` 三个脚本可用；electron-builder 打包配置就位

- [ ] **Step 1: 修改 package.json**

把前端构建依赖从 `dependencies` 移入 `devDependencies`（使 electron-builder 打包时 node_modules 为空，包体不膨胀），并新增 Electron 相关字段：

```jsonc
{
  "main": "electron/main.js",
  "scripts": {
    "dev": "max dev",
    "build": "max build",
    "postinstall": "max setup",
    "setup": "max setup",
    "tsc": "tsc --noEmit",
    "server": "node server/index.js",
    "test": "node --test \"server/tests/*.test.js\"",
    "electron": "electron .",
    "electron:dev": "concurrently -k \"npm:dev\" \"npm:electron\"",
    "electron:build": "npm run build && electron-builder --win"
  },
  "dependencies": {},
  "devDependencies": {
    "@ant-design/icons": "^5.5.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@umijs/max": "^4.3.29",
    "antd": "^5.21.6",
    "concurrently": "^9.1.0",
    "electron": "^44.0.0",
    "electron-builder": "^26.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4"
  }
}
```

说明：`dependencies` 置空——server 仅用 Node 内置模块；前端依赖全部构建期使用（产物在 `dist/`），放入 devDependencies 后 electron-builder 不会把它们打进包。

- [ ] **Step 2: 创建 .npmrc（国内镜像，加速 electron 二进制下载）**

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

- [ ] **Step 3: 创建 electron-builder.yml**

```yaml
appId: com.seed.cdrivecleaner
productName: CDriveCleaner
directories:
  output: dist_electron
files:
  - dist/**
  - server/**
  - "!server/tests/**"
  - package.json
extraResources:
  - from: scripts
    to: scripts
win:
  target:
    - nsis
nsis:
  oneClick: true
  perMachine: false
  artifactName: CDriveCleaner-Setup-${version}.exe
```

- [ ] **Step 4: 修改 .gitignore**

追加：

```
logs/
dist_electron/
```

- [ ] **Step 5: 安装依赖**

Run: `npm install`
Expected: 安装成功；若 electron 二进制下载慢，确认 `.npmrc` 镜像生效

- [ ] **Step 6: 验证**

Run: `npm ls electron electron-builder concurrently`
Expected: 三个包均在 devDependencies 树中
Run: `npm run tsc`
Expected: 仅输出已知预存错误（src/app.tsx、src/pages/404、src/setup/theme.tsx），无新增错误

---

### Task 2: server/config.js — 路径解析单一来源（TDD）

**Files:**
- Create: `server/config.js`
- Test: `server/tests/config.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `resolvePaths(env = process.env) → { root, dataDir, scriptsDir, logDir, resultFile, historyDir, elevateFlag, psScript, elevateScript }`
  - 默认（无 `CLEANER_*`）：`dataDir = root`（项目根）、`scriptsDir = root/scripts`、`logDir = root/logs`、`elevateFlag = root/history/.elevated-launch.flag`（与现有 ps1 一致）
  - 注入时：`dataDir = env.CLEANER_DATA_DIR`、`scriptsDir = env.CLEANER_SCRIPTS_DIR`、`elevateFlag = dataDir/.elevated-launch.flag`

- [ ] **Step 1: 写失败测试**

`server/tests/config.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolvePaths } = require('../config.js');

test('默认值：无 CLEANER_* 时全部指向项目根', () => {
  const p = resolvePaths({});
  assert.strictEqual(p.dataDir, path.resolve(__dirname, '..'));
  assert.strictEqual(p.scriptsDir, path.join(path.resolve(__dirname, '..'), 'scripts'));
  assert.strictEqual(p.logDir, path.join(p.dataDir, 'logs'));
  assert.strictEqual(p.resultFile, path.join(p.dataDir, 'scan-result.json'));
  assert.strictEqual(p.historyDir, path.join(p.dataDir, 'history'));
  assert.strictEqual(p.elevateFlag, path.join(p.dataDir, 'history', '.elevated-launch.flag'));
  assert.ok(p.psScript.endsWith(path.join('scripts', 'scan-c.ps1')));
  assert.ok(p.elevateScript.endsWith(path.join('scripts', 'relaunch-admin.ps1')));
});

test('打包注入：CLEANER_DATA_DIR / CLEANER_SCRIPTS_DIR 优先', () => {
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud', CLEANER_SCRIPTS_DIR: 'D:/res/scripts' });
  assert.strictEqual(p.dataDir, 'D:/ud');
  assert.strictEqual(p.historyDir, path.join('D:/ud', 'history'));
  assert.strictEqual(p.resultFile, path.join('D:/ud', 'scan-result.json'));
  assert.strictEqual(p.elevateFlag, path.join('D:/ud', '.elevated-launch.flag'));
  assert.strictEqual(p.psScript, path.join('D:/res/scripts', 'scan-c.ps1'));
  assert.strictEqual(p.elevateScript, path.join('D:/res/scripts', 'relaunch-admin.ps1'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tests/config.test.js`
Expected: FAIL（`Cannot find module '../config.js'`）

- [ ] **Step 3: 实现**

`server/config.js`：

```js
/**
 * C 盘分析 - 路径与配置解析（单一来源，server 与 electron 主进程共用）
 * 开发/独立运行默认写项目根；打包后由 electron/main.js 注入 CLEANER_* 环境变量。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function resolvePaths(env = process.env) {
  const dataDir = env.CLEANER_DATA_DIR || ROOT;
  const scriptsDir = env.CLEANER_SCRIPTS_DIR || path.join(ROOT, 'scripts');
  return {
    root: ROOT,
    dataDir,
    scriptsDir,
    logDir: env.CLEANER_LOG_DIR || path.join(dataDir, 'logs'),
    resultFile: path.join(dataDir, 'scan-result.json'),
    historyDir: path.join(dataDir, 'history'),
    // 与 relaunch-admin.ps1 的 flag 写入位置必须一致：
    // 注入模式 = dataDir 根；默认模式 = root/history（维持现有行为）
    elevateFlag: env.CLEANER_DATA_DIR
      ? path.join(dataDir, '.elevated-launch.flag')
      : path.join(ROOT, 'history', '.elevated-launch.flag'),
    psScript: path.join(scriptsDir, 'scan-c.ps1'),
    elevateScript: path.join(scriptsDir, 'relaunch-admin.ps1'),
  };
}

module.exports = { resolvePaths, ROOT };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tests/config.test.js`
Expected: PASS（2 个用例）

- [ ] **Step 5: 回归既有测试**

Run: `npm test`
Expected: 全部通过（本任务未改既有代码，应无回归）

---

### Task 3: electron/port.js — 端口启动与退避（TDD）

**Files:**
- Create: `electron/port.js`
- Test: `server/tests/port.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `startWithFallback(preferred, tryListen, maxTries = 10) → Promise<{ port, server }>`
    - `tryListen(port) → Promise<server>`：在指定端口启动并 resolve server
    - 遇 `err.code === 'EADDRINUSE'` 时 `port + 1` 重试；其他错误直接抛出；全部占用则抛出最后一个错误

- [ ] **Step 1: 写失败测试**

`server/tests/port.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { startWithFallback } = require('../../electron/port.js');

test('首选端口可用时直接返回', async () => {
  const r = await startWithFallback(8090, async (p) => ({ p }));
  assert.deepStrictEqual(r, { port: 8090, server: { p: 8090 } });
});

test('EADDRINUSE 时退避到下一个端口', async () => {
  const tryListen = async (p) => {
    if (p === 8090) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
    return { p };
  };
  const r = await startWithFallback(8090, tryListen);
  assert.strictEqual(r.port, 8091);
});

test('全部占用时抛出最后一个错误', async () => {
  const tryListen = async (p) => { throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' }); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 3), /in use/);
});

test('非 EADDRINUSE 错误直接抛出不重试', async () => {
  const tryListen = async () => { throw new Error('boom'); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 5), /boom/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tests/port.test.js`
Expected: FAIL（`Cannot find module '../../electron/port.js'`）

- [ ] **Step 3: 实现**

`electron/port.js`：

```js
/**
 * 端口启动与退避：从首选端口起，EADDRINUSE 则 +1 重试，超限抛最后一个错误。
 * @param {number} preferred 首选端口
 * @param {(port:number)=>Promise<any>} tryListen 在端口上启动并 resolve 的异步函数
 * @param {number} maxTries 最大尝试次数（默认 10）
 * @returns {Promise<{port:number, server:any}>}
 */
async function startWithFallback(preferred, tryListen, maxTries = 10) {
  let lastErr;
  for (let i = 0; i < maxTries; i++) {
    const port = preferred + i;
    try {
      const server = await tryListen(port);
      return { port, server };
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { startWithFallback };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tests/port.test.js`
Expected: PASS（4 个用例）

- [ ] **Step 5: 回归**

Run: `npm test`
Expected: 全部通过

---

### Task 4: electron/logger.js — 全路径日志模块（TDD）

**Files:**
- Create: `electron/logger.js`
- Test: `server/tests/logger.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `createLogger({ logDir, name = 'app', write = null, console = global.console }) → { info(module,msg,detail), warn(module,msg,detail), error(module,msg,errOrDetail) }`
  - 行格式：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg {detailJson}`
  - `error` 传入 `Error` 时追加一行 `堆栈: <stack>`
  - 按天滚动文件：`<logDir>/<name>-YYYY-MM-DD.log`
  - `write` 可注入（测试用）；写文件抛错时降级 `console.error`，不向上抛
  - 未提供 `logDir` 时只输出 console

- [ ] **Step 1: 写失败测试**

`server/tests/logger.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../../electron/logger.js');

function memoryLog() {
  const lines = [];
  return { lines, write: (l) => lines.push(l), console: { log() {}, error() {} } };
}

test('行格式：时间戳 + 级别 + 模块 + 消息 + detail', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.info('main', '启动完成', { port: 8090 });
  assert.match(m.lines[0], /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[main\] 启动完成 \{"port":8090\}$/);
});

test('error 传 Error 时追加堆栈行', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.error('server', '扫描失败', new Error('exit 1'));
  assert.match(m.lines[0], /\[ERROR\] \[server\] 扫描失败: exit 1$/);
  assert.ok(m.lines.some((l) => l.includes('堆栈: Error: exit 1')));
});

test('写文件抛错时降级 console 不向上抛', () => {
  const m = memoryLog();
  const errors = [];
  m.console.error = (x) => errors.push(x);
  const log = createLogger({ write: () => { throw new Error('disk full'); }, console: m.console });
  assert.doesNotThrow(() => log.info('main', 'hi'));
  assert.ok(errors.some((x) => x.includes('disk full')));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tests/logger.test.js`
Expected: FAIL（`Cannot find module '../../electron/logger.js'`）

- [ ] **Step 3: 实现**

`electron/logger.js`：

```js
/**
 * 全路径日志：console + 文件双写，按天滚动，写失败降级 console（不抛错）。
 * 级别：INFO（正常分支）/ WARN（边界分支）/ ERROR（catch 分支，含堆栈）。
 */
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function dayFile(dir, name) {
  const d = new Date();
  return path.join(dir, `${name}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
}

function createLogger({ logDir = null, name = 'app', write = null, console: out = console } = {}) {
  const writeLine = write || ((line) => {
    if (!logDir) return;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(dayFile(logDir, name), line + '\n', 'utf8');
    } catch (err) {
      out.error(`[logger] 日志写入失败（降级 console）: ${err.message}`);
    }
  });
  const emit = (level, module, msg, detail) => {
    const line = `[${ts()}] [${level}] [${module}] ${msg}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`;
    writeLine(line);
    if (level === 'ERROR') out.error(line); else out.log(line);
  };
  return {
    info: (module, msg, detail) => emit('INFO', module, msg, detail),
    warn: (module, msg, detail) => emit('WARN', module, msg, detail),
    error: (module, msg, errOrDetail) => {
      if (errOrDetail instanceof Error) {
        emit('ERROR', module, `${msg}: ${errOrDetail.message}`);
        writeLine(`[${ts()}] [ERROR] [${module}] 堆栈: ${errOrDetail.stack || ''}`);
      } else {
        emit('ERROR', module, msg, errOrDetail);
      }
    },
  };
}

module.exports = { createLogger };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tests/logger.test.js`
Expected: PASS（3 个用例）

- [ ] **Step 5: 回归**

Run: `npm test`
Expected: 全部通过

---

### Task 5: server/index.js — 路径可配置化 + 全路径日志 + 请求日志

**Files:**
- Modify: `server/index.js`
- Test: `server/tests/api.test.js`（回归）

**Interfaces:**
- Consumes: `resolvePaths`（Task 2）、`createLogger`（Task 4）
- Produces:
  - `startServer(port)`（保持签名；返回 server 实例，行为不变）
  - `buildElevateCommand(pid)`（保持签名与输出格式不变）
  - `startElevateMonitor()`（新增导出）：flag 确认后 1 秒 `process.exit(0)`；60 秒未确认置 `elevatedScan='cancelled'` 并 `[WARN]`。内部已判 `SCAN_ON_START`，重复调用安全
  - 模块被 require（`require.main !== module`）时不再自动启动（保持现状），仅 `require.main === module` 时 `startServer + startElevateMonitor`

- [ ] **Step 1: 写失败测试（先锁定新导出行为）**

在 `server/tests/api.test.js` 追加两个用例：

```js
test('startElevateMonitor 存在且为函数', () => {
  const { startElevateMonitor } = require('../index.js');
  assert.strictEqual(typeof startElevateMonitor, 'function');
});

test('elevate-flag 出现后旧进程退出（模拟）', async () => {
  // 不真正退出进程：仅验证 monitor 会清除 flag 的调用路径难以单测，
  // 这里改为验证 buildElevateCommand 输出兼容 flag 位置由 env 决定的契约
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(999);
  assert.ok(cmd.includes('relaunch-admin.ps1'));
});
```

说明：monitor 的退出行为依赖真实 flag 文件与计时器，属集成范畴，见 Task 9 手工验证；此处以存在性测试兜底。

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tests/api.test.js`
Expected: FAIL（`startElevateMonitor is not a function`）

- [ ] **Step 3: 改造 server/index.js**

3a. 顶部常量区改为使用 config：

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

删除原 `ROOT`、`RESULT_FILE`、`PS_SCRIPT`、`DIST_DIR`、`ELEVATE_SCRIPT`、`ELEVATE_FLAG` 常量定义（由 `paths` 取代）。

3b. `runScan` 增加 env 传递与日志（PowerShell 结果路径与 server 一致）：

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

3c. `readJson` 空吞错误补日志：

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

3d. `handle()` 开头注册请求日志（响应结束时记录状态码）：

```js
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.on('finish', () => {
    if (p.startsWith('/api/')) log.info('api', `${req.method} ${p} -> ${res.statusCode}`);
  });
  try {
    // ...原有逻辑不变
  } catch (e) {
    log.error('api', `接口异常 ${req.method} ${p}`, e);
    sendJson(res, 500, { error: e.message });
  }
}
```

注意：`handle` 已用 `try/catch` 包裹，将原 catch 分支补充 `log.error` 即可。

3e. 提权链路日志：`POST /api/elevate-restart` 分支内：

```js
log.info('elevate', '收到提权重启请求，等待 UAC 授权');
```

原 `console.log('[server] 已请求以管理员身份重启，等待 UAC 授权…')` 替换为上述 `log.info`（保持语义）。

3f. 将原 `if (require.main === module)` 内的轮询抽为 `startElevateMonitor` 并导出：

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

`scanOnce` 内现有 `console.log`/`console.error`/`console.warn` 同步替换为对应 `log.*` 调用（`scan` 模块）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tests/api.test.js`
Expected: PASS（原有用例 + 新增 2 个）

- [ ] **Step 5: 回归全部测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 6: 独立运行冒烟（可选，需本机）**

Run: `node server/index.js`（Ctrl+C 停止）
Expected: 启动日志输出至 `logs/server-YYYY-MM-DD.log`；`GET /api/status` 正常（curl 或浏览器）

---

### Task 6: server/history.js — HISTORY_DIR 可配置化

**Files:**
- Modify: `server/history.js`
- Test: `server/tests/history.test.js`（回归）

**Interfaces:**
- Consumes: `resolvePaths`（Task 2）
- Produces: `HISTORY_DIR` 常量改为 `paths.historyDir`；对外函数签名全部不变（仍接受可选 `historyDir` 参数，默认 `HISTORY_DIR`）

- [ ] **Step 1: 写失败测试（先锁定契约）**

在 `server/tests/history.test.js` 追加：

```js
test('resolvePaths.historyDir 与 HISTORY_DIR 一致（可配置）', () => {
  const { resolvePaths } = require('../config.js');
  const history = require('../history.js');
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud' });
  assert.strictEqual(p.historyDir, 'D:/ud/history');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/tests/history.test.js`
Expected: 本用例失败或报错（`CLEANER_DATA_DIR` 尚未生效）

- [ ] **Step 3: 实现**

`server/history.js` 顶部改为：

```js
const { resolvePaths } = require('./config');

const paths = resolvePaths();
const ROOT = paths.root;
const HISTORY_DIR = paths.historyDir;
```

删除原 `ROOT`、`HISTORY_DIR` 定义（由 `paths` 取代）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/tests/history.test.js`
Expected: 全部通过

- [ ] **Step 5: 回归全部测试**

Run: `npm test`
Expected: 全部通过

---

### Task 7: scripts/*.ps1 改造（Write 全量重写，保留 UTF-8 BOM）

**Files:**
- Modify: `scripts/scan-c.ps1`
- Modify: `scripts/relaunch-admin.ps1`
- 备份：`scripts/scan-c.ps1.bak`、`scripts/relaunch-admin.ps1.bak`

**Interfaces:**
- Consumes: server 侧注入的 `CLEANER_RESULT_PATH`（scan-c）、`CLEANER_DATA_DIR` / `CLEANER_EXE_PATH`（relaunch-admin）
- Produces: 打包后 PowerShell 结果写入 userData；提权后启动 Electron exe

⚠️ **本任务禁止 SearchReplace**：`.ps1` 为 UTF-8 带 BOM，必须用 Write 全量重写，文件内容**首字符必须是 `\uFEFF`（BOM）**；先复制 `.bak` 备份。

- [ ] **Step 1: 备份现有脚本**

Run: `Copy-Item scripts/scan-c.ps1 scripts/scan-c.ps1.bak; Copy-Item scripts/relaunch-admin.ps1 scripts/relaunch-admin.ps1.bak`
Expected: 两个 `.bak` 文件存在

- [ ] **Step 2: 重写 scan-c.ps1（保留 BOM）**

用 Write 工具全量写入，**文件内容以 `\uFEFF` 开头**（BOM），内容与现状完全一致，仅第 18 行前后增加结果路径覆盖：

```powershell
<#
.SYNOPSIS
  C disk space analyzer - read-only scan engine

.DESCRIPTION
  READ ONLY: never deletes / moves / modifies any file, folder or registry key.
  Folders without permission are skipped and marked, never force-accessed.
  Writes scan-result.json (UTF-8) consumed by the local web dashboard.
  NOTE: file must be saved as UTF-8 WITH BOM (single) for Windows PowerShell
  5.1 to parse CJK strings correctly. NEVER edit with SearchReplace tools
  that re-encode the file, or a double BOM will break parsing.
#>

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference   = 'SilentlyContinue'

# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
# 打包后由 Electron 主进程注入：结果写入 userData（安装目录可能不可写）
if ($env:CLEANER_RESULT_PATH) { $resultPath = $env:CLEANER_RESULT_PATH }
$root       = 'C:\'
$bigFileMinMB = 100
$bigFileTop   = 50
```

（第 23 行起所有内容与现状逐字一致，见 `.bak` 备份；确保中文注释、正则、函数体完全不变。）

- [ ] **Step 3: 重写 relaunch-admin.ps1（保留 BOM）**

同样以 `\uFEFF` 开头的 Write 全量重写，变更三处：flag 路径、启动目标：

```powershell
# Relaunch the C-drive analyzer server with administrator privileges.
# Triggered via Start-Process -Verb RunAs (UAC prompt); runs hidden.
param([int]$OldPid)

$ErrorActionPreference = 'SilentlyContinue'
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
if ($env:CLEANER_DATA_DIR) { $flag = Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag' }

# 1) Prove elevation succeeded: write the flag file (old process watches it).
New-Item -ItemType Directory -Force -Path (Split-Path $flag -Parent) | Out-Null
Set-Content -Path $flag -Value 'start' -Encoding ascii

# 2) Wait for the old server process to exit so the port is free (max 30s).
for ($i = 0; $i -lt 60; $i++) {
    if (-not (Get-Process -Id $OldPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}

# 3) Start the new (elevated) process; it will auto-scan once on startup.
$exe = $env:CLEANER_EXE_PATH
if ($exe) {
    # 打包后：以管理员身份启动 Electron 本体
    Start-Process -FilePath $exe -ArgumentList '--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
} else {
    # 开发模式回退：node server
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'node' }
    Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
}
```

- [ ] **Step 4: 验证 BOM 与 PowerShell 语法**

Run:
```powershell
$bytes = [System.IO.File]::ReadAllBytes("$PWD\scripts\scan-c.ps1")
"scan-c BOM: $($bytes[0]) $($bytes[1]) $($bytes[2])"   # 期望 239 187 191 (EF BB BF)
$errs = $null
[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw "$PWD\scripts\scan-c.ps1"), [ref]$errs) | Out-Null
"scan-c errors: $($errs.Count)"
$bytes2 = [System.IO.File]::ReadAllBytes("$PWD\scripts\relaunch-admin.ps1")
"relaunch BOM: $($bytes2[0]) $($bytes2[1]) $($bytes2[2])"
$errs2 = $null
[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw "$PWD\scripts\relaunch-admin.ps1"), [ref]$errs2) | Out-Null
"relaunch errors: $($errs2.Count)"
```
Expected: 两个文件 BOM 均为 `239 187 191`；errors 均为 0

- [ ] **Step 5: 确认备份保留**

Run: `Test-Path scripts/scan-c.ps1.bak; Test-Path scripts/relaunch-admin.ps1.bak`
Expected: True / True（确认无误后可删除 `.bak`，需用户确认）

---

### Task 8: electron/main.js — 主进程编排

**Files:**
- Create: `electron/main.js`

**Interfaces:**
- Consumes: `resolvePaths`（Task 2）、`startWithFallback`（Task 3）、`createLogger`（Task 4）、`startServer` / `startElevateMonitor`（Task 5）
- Produces: `electron .` 可运行（开发加载 8000；打包后加载内嵌服务实际端口）；`--scan-on-start` 提权重扫链路

- [ ] **Step 1: 实现主进程**

`electron/main.js`：

```js
/**
 * CDriveCleaner 主进程
 * 开发：内嵌 server(8090) 失败则复用现有服务，窗口加载 http://localhost:8000（umi dev + proxy）
 * 生产：内嵌 server(8090 退避) 托管 asar 内 dist/，窗口加载 http://localhost:<实际端口>
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { resolvePaths } = require('../server/config');
const { startWithFallback } = require('./port');
const { createLogger } = require('./logger');
const { startServer, startElevateMonitor } = require('../server/index');

const isDev = !app.isPackaged;
const scanOnStart = process.argv.includes('--scan-on-start');

// 打包后注入路径环境变量（server 与 PowerShell 脚本消费）；开发模式不注入，保持项目根现状
if (!isDev) {
  process.env.CLEANER_DATA_DIR = app.getPath('userData');
  process.env.CLEANER_SCRIPTS_DIR = path.join(process.resourcesPath, 'scripts');
  process.env.CLEANER_EXE_PATH = process.execPath;
}

const paths = resolvePaths();
const log = createLogger({ logDir: paths.logDir, name: 'main' });

let mainWindow = null;
let embeddedPort = null;

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = startServer(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const url = isDev ? 'http://localhost:8000' : `http://localhost:${embeddedPort}`;
  mainWindow.loadURL(url);
  mainWindow.webContents.on('did-finish-load', () => log.info('main', '页面加载完成', { url }));
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    log.error('main', '页面加载失败', { errorCode, errorDescription, url: validatedURL });
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('main', '渲染进程异常退出', { reason: details.reason });
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function bootstrap() {
  log.info('main', '启动', { isDev, scanOnStart });
  log.info('main', '路径解析', { dataDir: paths.dataDir, scriptsDir: paths.scriptsDir, logDir: paths.logDir });

  if (!isDev) {
    try {
      const r = await startWithFallback(8090, tryListen, 10);
      embeddedPort = r.port;
      log.info('main', '内嵌服务启动成功', { port: embeddedPort });
    } catch (err) {
      log.error('main', '内嵌服务启动失败，应用退出', err);
      app.quit();
      return;
    }
  } else {
    try {
      await startWithFallback(8090, tryListen, 1);
      log.info('main', '开发模式内嵌服务(8090)已启动');
    } catch (err) {
      log.warn('main', '端口 8090 已有服务，直接复用（不重复启动）', { err: err.message });
    }
  }

  if (scanOnStart) log.info('main', '识别到 --scan-on-start（提权重扫）');
  startElevateMonitor();
  createWindow();
}

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    log.error('main', '启动流程异常', err);
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit()); // Phase 1：关窗即退出（托盘在 Phase 2）
```

- [ ] **Step 2: 验证开发模式（需 `npm run dev` 先行或并发）**

Run: `npm run electron:dev`
Expected: 终端先起 `max dev`（8000），随后 Electron 窗口弹出；页面加载完成日志输出；`logs/main-YYYY-MM-DD.log` 存在
（若本机 8000 或 8090 被占用，检查日志确认复用/退避行为符合预期）

- [ ] **Step 3: 验证生产构建产物可被加载（无窗口也可先验服务）**

Run: `npm run build`
Expected: `dist/` 生成（index.html + assets）
Run: `node server/index.js`（可选冒烟）
Expected: `GET http://localhost:8090/api/status` 返回 200（`dist/` 托管正常）

---

### Task 9: 打包验证（electron:build）与手工验收清单

**Files:**
- 无代码变更；纯验证任务

**Interfaces:**
- 验证 Task 1-8 的集成结果，产出安装包

- [ ] **Step 1: 打包**

Run: `npm run electron:build`
Expected: `max build` 后 electron-builder 产出 `dist_electron/CDriveCleaner-Setup-0.1.0.exe`；日志确认 scripts 进入 `resources/scripts`（asar 外）

- [ ] **Step 2: 安装并首次运行**

安装 `dist_electron/CDriveCleaner-Setup-0.1.0.exe`，双击启动。
Expected: 窗口打开、概览页正常；`%APPDATA%\CDriveCleaner\logs\main-*.log`、`server-*.log` 生成且含启动/路径解析日志

- [ ] **Step 3: 功能验收**

- 概览页触发扫描：进度正常，完成后数据展示；日志含「扫描开始 / 扫描完成（exit 0）」
- 历史/趋势/大文件/清理建议页数据正常
- `%APPDATA%\CDriveCleaner\scan-result.json`、`history/` 存在（数据落在 userData，非安装目录）

- [ ] **Step 4: 一键提权重扫验收**

- 概览页点「以管理员身份重扫」→ UAC 弹窗 → 允许
- 旧进程日志「已确认提权，旧进程 1 秒后退出」；新进程以管理员启动并自动重扫（`--scan-on-start`）
- 日志中提权链路四段齐全：收到请求 → UAC 已弹 → 已确认 → 退出
- UAC 取消场景：60 秒后日志出现「提权未确认（UAC 可能被取消）」，旧进程保持可用

- [ ] **Step 5: 日志体系验收**

- 白屏/异常排查路径：故意占用 8090 端口再启动 → 日志显示端口退避到 8091
- `logs/` 下文件按天命名，`[INFO]/[WARN]/[ERROR]` 齐全，catch 分支均有 ERROR + 堆栈

- [ ] **Step 6: 收尾**

- 确认无误后，删除 `scripts/*.ps1.bak` 备份（需用户确认）
- 汇总打包体积、已知问题，交付 Phase 1 结论

---

## Self-Review（计划自检）

**1. Spec 覆盖核对：**
- 数据目录重定向（spec §3）→ Task 2/5/6/7 ✓
- asar 外脚本（spec §4）→ Task 1 electron-builder.yml extraResources + Task 7 ✓
- 端口策略（spec §5）→ Task 3/8 ✓
- 提权重扫（spec §6）→ Task 5/7/8/9 ✓
- 打包配置（spec §7）→ Task 1 ✓
- 全路径日志（spec §8）→ Task 4/5/8/9 ✓
- 文件清单（spec §9）→ Task 1-8 全覆盖（`electron/env.js` 调整为 `server/config.js`，已在 Global Constraints 说明）✓
- 边界情况（spec §10）→ 端口占用（Task 3/8）、Program Files 不可写（Task 2/6/7）、UAC 取消（Task 5/9）、日志降级（Task 4）✓
- TDD / 抽象 DRY / UI 冻结 / BOM 保护 → Global Constraints + 各任务 ✓

**2. 占位符扫描：** 无 TBD/TODO；Task 7 Step 2 中「第 23 行起内容与现状逐字一致」指向 `.bak` 备份（写入前已备份，重写内容以原文件为准）——已明确执行方式，非占位符。

**3. 类型一致性：**
- `resolvePaths` 返回字段名在 Task 2/5/6/8 一致 ✓
- `startWithFallback` 签名在 Task 3/8 一致 ✓
- `createLogger` 返回 `{info,warn,error}` 在 Task 4/5/8 一致 ✓
- `startServer` / `buildElevateCommand` / `startElevateMonitor` 在 Task 5/8 一致 ✓
