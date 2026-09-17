/**
 * CDriveCleaner 主进程
 * 开发：内嵌 server(8090) 失败则复用现有服务，窗口加载 http://localhost:8000（umi dev + proxy）
 * 生产：内嵌 server(8090 退避) 托管 asar 内 dist/，窗口加载 http://localhost:<实际端口>
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const scanOnStart = process.argv.includes('--scan-on-start');

// 打包后注入路径环境变量（server 与 PowerShell 脚本消费）；开发模式不注入，保持项目根现状
// ⚠ 必须在 require('../server/index') 之前设置：
//   server/index.js 模块加载时即执行 resolvePaths()/createLogger()，
//   若此时 env 未注入，dataDir/logDir 会落到只读的 app.asar 虚拟路径，
//   导致 server 日志写不进、扫描 spawn 的 cwd 不存在（ENOENT）。
if (!isDev) {
  process.env.CLEANER_DATA_DIR = app.getPath('userData');
  process.env.CLEANER_SCRIPTS_DIR = path.join(process.resourcesPath, 'scripts');
  process.env.CLEANER_EXE_PATH = process.execPath;
}

const { resolvePaths } = require('../server/config');
const { startWithFallback } = require('./port');
const { createLogger } = require('./logger');
const { startServer, startElevateMonitor } = require('../server/index');

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
