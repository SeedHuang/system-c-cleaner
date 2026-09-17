# Task 8 Brief: electron/main.js — 主进程编排

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务创建 Electron 主进程入口 `electron/main.js`，编排内嵌 http 服务、BrowserWindow、路径注入、全路径日志、提权重扫链路。

前置（全部已完成）：
- `server/config.js` → `resolvePaths()` 返回 { root, dataDir, scriptsDir, logDir, resultFile, historyDir, elevateFlag, psScript, elevateScript }
- `electron/port.js` → `startWithFallback(preferred, tryListen, maxTries=10) → Promise<{port, server}>`（EADDRINUSE 退避）
- `electron/logger.js` → `createLogger({ logDir, name }) → { info, warn, error }`
- `server/index.js` → 导出 `{ startServer, buildElevateCommand, startElevateMonitor }`

## 本任务目标

创建 `electron/main.js`（内容在 Step 1 完整给出，照抄），并做验证：
1. `node --check` 语法验证
2. 所有 require 模块路径存在性检查
3. 短时启动 electron 冒烟（可选，环境允许时）：观察启动日志

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- 前端 `src/` 与 `config/config.ts` 不许改动。
- main.js 代码逐字照抄 Step 1（这是 Task 9 集成验证的基础）。
- 若 electron 冒烟启动弹窗且无法自动关闭，用非阻塞方式启动，观察日志后停止，不要长时间阻塞。

## Step 1: 创建 electron/main.js

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

## Step 2: 语法验证

Run: `node --check electron/main.js`
Expected: 无输出（exit 0）

## Step 3: require 路径存在性检查

Run: `node -e "const fs=require('fs'); ['server/config.js','electron/port.js','electron/logger.js','server/index.js'].forEach(f=>{if(!fs.existsSync(f))throw new Error('missing: '+f)}); console.log('all modules exist')"`
Expected: 输出 `all modules exist`

## Step 4: 冒烟启动（可选，视环境）

用非阻塞方式启动 electron 观察日志：

Run: `npx electron .`（blocking=false，观察 8-15 秒）

Expected（开发模式，isDev=true，未打包）：
- `logs/main-YYYY-MM-DD.log` 生成，含「启动 {isDev:true}」与「路径解析」日志
- 内嵌 server(8090) 尝试启动（若 8090 空闲则「开发模式内嵌服务(8090)已启动」；若被占用则「端口 8090 已有服务，直接复用」）
- 页面加载 http://localhost:8000（若 max dev 未运行，会出现「页面加载失败 did-fail-load」ERROR 日志——**这是预期**，因为 8000 无服务）

观察后停止 electron（用 StopCommand 或关闭窗口）。若环境无法弹窗/超时，记录「待 Task 9 用户手动验证」并完成本任务，不算失败。

## 报告

完成后在报告中写明：
- main.js 创建确认（是否逐字照抄）
- `node --check` 结果
- require 存在性检查结果
- 冒烟启动观察到的日志（若执行）或说明环境限制
- 任何偏差
