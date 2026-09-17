/**
 * CDriveCleaner 主进程
 * 开发：内嵌 server(8090) 失败则复用现有服务，窗口加载 http://localhost:8000（umi dev + proxy）
 * 生产：内嵌 server(8090 退避) 托管 asar 内 dist/，窗口加载 http://localhost:<实际端口>
 * Phase 2：系统托盘（关窗最小化、托盘菜单）、开机自启（--hidden 隐藏启动）、托盘立即扫描
 */
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');

const isDev = !app.isPackaged;
const scanOnStart = process.argv.includes('--scan-on-start');
const hidden = process.argv.includes('--hidden');

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
const { createTray } = require('./tray');
const { createAutostart } = require('./autostart');

const paths = resolvePaths();
const log = createLogger({ logDir: paths.logDir, name: 'main' });

let mainWindow = null;
let embeddedPort = null;
let isQuitting = false;

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = startServer(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  log.info('window', '显示主窗口');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !hidden, // --hidden（自启/静默）时不显示窗口，仅进托盘
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
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      log.info('window', '关闭窗口 → 最小化到托盘');
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** 托盘「立即扫描」：主进程直接 POST 内嵌 server，fire-and-forget，不阻塞 */
function triggerScan() {
  if (!embeddedPort) {
    log.warn('tray', '立即扫描：内嵌服务未就绪，已跳过');
    return;
  }
  const req = http.request(
    { host: '127.0.0.1', port: embeddedPort, path: '/api/scan', method: 'POST' },
    (res) => {
      res.resume();
      log.info('tray', '立即扫描已触发', { status: res.statusCode });
      // server 在扫描完成后才响应；完成后刷新可见窗口
      if (mainWindow && mainWindow.isVisible()) {
        setTimeout(() => mainWindow.webContents.reload(), 300);
      }
    },
  );
  req.setTimeout(300000, () => req.destroy()); // 扫描最长约 5 分钟，超时兜底
  req.on('error', (err) => log.warn('tray', '立即扫描请求失败', { err: err.message }));
  req.end();
}

function createSystemTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  const autostart = createAutostart({ app, log });
  const tray = createTray({
    Tray,
    Menu,
    icon,
    getMenuState: () => ({ autostart: autostart.isEnabled() }),
    onShow: showMainWindow,
    onScan: triggerScan,
    onToggleAutostart: () => {
      const next = !autostart.isEnabled();
      autostart.setEnabled(next);
      log.info('tray', '切换开机自启', { enabled: next });
    },
    onQuit: () => {
      isQuitting = true;
      log.info('tray', '用户选择退出应用');
      app.quit();
    },
    log,
  });
  return tray;
}

async function bootstrap() {
  log.info('main', '启动', { isDev, scanOnStart, hidden });
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
  createSystemTray();
  if (hidden) log.info('window', '隐藏启动（自启/静默），仅驻留托盘');
  else log.info('window', '正常显示窗口');
}

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    log.error('main', '启动流程异常', err);
    app.quit();
  });
});

// Phase 2：关窗仅隐藏（close→hide），全部窗口关闭后应用常驻托盘，不退出
app.on('window-all-closed', () => {
  log.info('app', '所有窗口已关闭，应用常驻托盘');
});
