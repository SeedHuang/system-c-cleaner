/**
 * CDriveCleaner 主进程
 * 开发：内嵌 server(8090) 失败则复用现有服务，窗口加载 http://localhost:8000（umi dev + proxy）
 * 生产：内嵌 server(8090 退避) 托管 asar 内 dist/，窗口加载 http://localhost:<实际端口>
 * Phase 2：系统托盘（关窗最小化、托盘菜单）、开机自启（--hidden 隐藏启动）、托盘立即扫描
 * Phase 3：桌面悬浮小组件（置顶卡片、位置记忆、点击打开主窗口、托盘开关）
 * Phase 4：启动提权（管理员常驻）+ 后台自动扫描调度（启动后/固定间隔/每日定时）+ 合并系统通知
 *
 * ⚠ 无 electron/GUI 环境的沙箱无法运行本文件，仅能静态检查；逻辑分支都在 electron/*.test.js 覆盖。
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, Notification } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const scanOnStart = process.argv.includes('--scan-on-start');
const hidden = process.argv.includes('--hidden');

// 打包后注入路径环境变量（server 与 PowerShell 脚本消费）；开发模式不注入，保持项目根现状
// ⚠ 必须在 require('../server/index') 之前设置：
//   server/index.js 模块加载时即执行 resolvePaths()/createLogger()，
//   若此时 env 未注入，dataDir/logDir 会落到只读的 app.asar 虚拟路径，
//   导致 server 日志写不进、扫描 spawn 的 cwd 不存在（ENOENT）。
if (!isDev) {
  // 默认数据目录改为「用户主目录下的隐藏文件夹」：C:\Users\<你>\.system-c-cleaner
  // 用户仍可用 CLEANER_DATA_DIR 显式覆盖（开发模式 / 多实例 / 自定义安装位置）
  // 旧的 %APPDATA%\c-drive-cleaner 数据由 runMigrate() 自动迁移过来
  process.env.CLEANER_DATA_DIR = process.env.CLEANER_DATA_DIR
    || path.join(app.getPath('home'), '.system-c-cleaner');
  process.env.CLEANER_SCRIPTS_DIR = path.join(process.resourcesPath, 'scripts');
  process.env.CLEANER_EXE_PATH = process.execPath;
}

const { resolvePaths } = require('../server/config');
const { startWithFallback } = require('./port');
const { createLogger } = require('./logger');
const { startServer, startElevateMonitor, resolvePowerShellPath } = require('../server/index');
const { createTray } = require('./tray');
const { createAutostart } = require('./autostart');
const { createWidget } = require('./widget');
const { resolveOpenAction } = require('./open-target');
const { loadSettings, saveSettings } = require('./settings');
const { createScheduler, loadState, saveState } = require('./scheduler');
const { createNotifier } = require('./notify');
const { createElevateGuard, probeElevation } = require('./elevate-guard');
const { runMigrate } = require('./migrate-data');

const paths = resolvePaths();
const log = createLogger({ logDir: paths.logDir, name: 'main' });

let mainWindow = null;
let embeddedPort = null;
let isQuitting = false;
let scheduler = null;

// Phase 3：小组件
let widgetVisible = true;
let widgetHandle = null;
const WIDGET_STATE_FILE = path.join(paths.dataDir, 'widget-state.json');

// Phase 4：配置与调度状态（都在 userData 下）
const SETTINGS_FILE = path.join(paths.dataDir, 'settings.json');
const SCHEDULER_STATE_FILE = path.join(paths.dataDir, 'scheduler-state.json');

/** 读配置（非法值回落默认并有 warn 日志） */
function loadCfg() {
  return loadSettings(SETTINGS_FILE, log);
}

/** 内嵌 API 请求（promise 化）；失败 reject 并带 server 返回的错误原因 */
function apiRequest(method, apiPath, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!embeddedPort) {
      reject(new Error('内嵌服务未就绪'));
      return;
    }
    const req = http.request({ host: '127.0.0.1', port: embeddedPort, path: apiPath, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch (err) { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json || {});
        else reject(new Error((json && json.error) || `HTTP ${res.statusCode}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时(${timeoutMs}ms)`)));
    req.on('error', reject);
    req.end();
  });
}

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
    autoHideMenuBar: true, // 隐藏原生菜单栏（File/Edit/View…），按 Alt 也不显示
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 提供 window.desktopAPI.openPath（打开资源管理器）
      preload: path.join(__dirname, 'main-preload.js'),
    },
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

/** 托盘「立即扫描」：POST 内嵌 server，完成后刷新可见窗口（通知由调度器统一发） */
function triggerScan() {
  apiRequest('POST', '/api/scan')
    .then((data) => {
      log.info('tray', '立即扫描完成', { scannedAt: data && data.scannedAt });
      if (mainWindow && mainWindow.isVisible()) {
        setTimeout(() => mainWindow.webContents.reload(), 300);
      }
    })
    .catch((err) => log.warn('tray', '立即扫描失败', { err: err.message }));
}

function toggleWidget(visible) {
  widgetVisible = visible;
  if (widgetHandle) widgetHandle.toggle(visible);
  log.info('widget', '切换小组件显隐', { visible });
}

function createSystemWidget() {
  widgetHandle = createWidget({
    BrowserWindow,
    Menu,
    screen,
    url: isDev ? 'http://localhost:8000/widget' : `http://localhost:${embeddedPort}/widget`,
    stateFile: WIDGET_STATE_FILE,
    showMain: showMainWindow,
    // 小组件自身（右键菜单 / Alt+F4）隐藏或显示时，同步托盘勾选状态
    onVisibilityChange: (visible) => {
      widgetVisible = visible;
      log.info('widget', '可见性变更，同步托盘状态', { visible });
    },
    isQuitting: () => isQuitting,
    log,
  });
  widgetHandle.build();
  log.info('widget', '小组件初始化完成', { visible: widgetVisible });
}

function createSystemTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  const autostart = createAutostart({ app, log });
  const tray = createTray({
    Tray,
    Menu,
    icon,
    getMenuState: () => ({ autostart: autostart.isEnabled(), widgetVisible, autoScan: loadCfg().autoScan }),
    onShow: showMainWindow,
    onScan: triggerScan,
    onToggleAutostart: () => {
      const next = !autostart.isEnabled();
      autostart.setEnabled(next);
      log.info('tray', '切换开机自启', { enabled: next });
    },
    onToggleWidget: () => toggleWidget(!widgetVisible),
    onToggleAutoScan: () => {
      const next = !loadCfg().autoScan;
      saveSettings(SETTINGS_FILE, { autoScan: next });
      log.info('tray', '切换后台自动扫描', { enabled: next });
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

/**
 * Phase 4 启动提权：未提权则请求 UAC 提权重启。
 * 提权后的新进程 isElevated=true → 直接跳过，不会循环弹窗；被拒/未知则降级为普通权限运行。
 */
async function runStartupElevateGuard() {
  const guard = createElevateGuard({
    probe: () => probeElevation({ psPath: resolvePowerShellPath(), spawnFn: spawn, log }),
    requestRestart: async () => {
      const r = await apiRequest('POST', '/api/elevate-restart', { timeoutMs: 15000 });
      log.info('elevate', '提权请求已提交，等待 UAC 授权', { elevatedScan: r && r.elevatedScan });
    },
    log,
    getState: () => loadState(SCHEDULER_STATE_FILE),
    saveState: (patch) => saveState(SCHEDULER_STATE_FILE, patch),
  });
  const result = await guard.run(loadCfg());
  log.info('elevate', '启动提权判定结束', { result });
  return result;
}

/** Phase 4 后台调度：三种触发统一判定，扫描完成后合并为一条系统通知 */
async function startScheduler() {
  const notifier = createNotifier({ Notification, showMain: showMainWindow, log });
  scheduler = createScheduler({
    stateFile: SCHEDULER_STATE_FILE,
    log,
    loadSettings: loadCfg,
    api: {
      getStatus: () => apiRequest('GET', '/api/status', { timeoutMs: 15000 }),
      triggerScan: () => apiRequest('POST', '/api/scan'),
      getHistory: () => apiRequest('GET', '/api/history', { timeoutMs: 15000 }),
    },
    notifier,
  });
  await scheduler.start();
}

// Phase 3：widget 页面点击 → 打开主窗口（最小 IPC 通道）
ipcMain.on('widget:open-main', () => {
  log.info('widget', '收到 widget 点击，打开主窗口');
  showMainWindow();
});

// 打开资源管理器：目录排行 / 趋势分析 / 大文件 三个页面共用
ipcMain.handle('shell:open-path', async (_e, target) => {
  const p = typeof target === 'string' ? target.trim() : '';
  const action = resolveOpenAction(p);
  log.info('shell', '收到打开请求', { target: p, action });
  if (action === 'missing') {
    log.warn('shell', '打开请求被拒：路径不存在或不可访问', { target: p });
    return { ok: false, error: '路径不存在或不可访问' };
  }
  try {
    if (action === 'folder') {
      const err = await shell.openPath(p); // 成功返回空字符串，失败返回错误描述
      if (err) {
        log.warn('shell', '打开文件夹失败', { target: p, err });
        return { ok: false, error: err };
      }
      log.info('shell', '已打开文件夹', { target: p });
    } else {
      shell.showItemInFolder(p); // 打开所在文件夹并选中该文件（失败无返回值可判）
      log.info('shell', '已打开所在文件夹并选中文件', { target: p });
    }
    return { ok: true };
  } catch (err) {
    log.error('shell', '打开路径异常', { target: p, err: err.message });
    return { ok: false, error: err.message };
  }
});

async function bootstrap() {
  log.info('main', '启动', { isDev, scanOnStart, hidden });
  log.info('main', '路径解析', { dataDir: paths.dataDir, scriptsDir: paths.scriptsDir, logDir: paths.logDir });
  log.info('main', '生效配置', loadCfg());

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
      embeddedPort = 8090;
      log.info('main', '开发模式内嵌服务(8090)已启动');
    } catch (err) {
      // 复用已有服务（仅前端开发时常见）：仍指向 8090，保证调度与托盘扫描可用
      embeddedPort = 8090;
      log.warn('main', '端口 8090 已有服务，直接复用（不重复启动）', { err: err.message });
    }
  }

  if (scanOnStart) log.info('main', '识别到 --scan-on-start（提权重扫）');
  startElevateMonitor();
  createWindow();
  createSystemWidget();
  createSystemTray();
  if (hidden) log.info('window', '隐藏启动（自启/静默），仅驻留托盘');
  else log.info('window', '正常显示窗口');

  await runStartupElevateGuard();
  await startScheduler();
  log.info('main', '启动完成');
}

app.whenReady().then(() => {
  // 移除原生应用菜单栏（File/Edit/View/Window/Help），本应用不需要
  try {
    Menu.setApplicationMenu(null);
    log.info('main', '已移除原生菜单栏');
  } catch (err) {
    log.warn('main', '移除原生菜单栏失败', { err: err.message });
  }

  // T12：从 %APPDATA%\c-drive-cleaner 一次性迁移数据到 %USERPROFILE%\.system-c-cleaner。
  // 失败不阻塞启动（best-effort），所有异常吞掉并记 log。
  if (!isDev) {
    try {
      const oldDir = app.getPath('userData'); // %APPDATA%\c-drive-cleaner
      const newDir = process.env.CLEANER_DATA_DIR; // %USERPROFILE%\.system-c-cleaner（已注入）
      runMigrate({ oldDir, newDir, log }).then((r) => {
        if (r.migrated) log.info('main', '数据已迁移到新位置', { oldDir, newDir });
        else log.info('main', '迁移跳过', { reason: r.reason });
      }).catch((err) => {
        log.warn('main', '数据迁移失败（不影响启动）', { err: err.message });
      });
    } catch (err) {
      log.warn('main', '迁移调度失败', { err: err.message });
    }
  }
  // Windows 通知需要 AppUserModelID，才能显示为「CDriveCleaner」而不是 Electron
  try {
    app.setAppUserModelId('com.seed.cdrivecleaner');
  } catch (err) {
    log.warn('main', '设置 AppUserModelID 失败（通知将显示 Electron 名称）', { err: err.message });
  }
  bootstrap().catch((err) => {
    log.error('main', '启动流程异常', err);
    app.quit();
  });
});

// Phase 2：关窗仅隐藏（close→hide），全部窗口关闭后应用常驻托盘，不退出
app.on('window-all-closed', () => {
  log.info('app', '所有窗口已关闭，应用常驻托盘');
});

// Phase 4：退出前停掉调度器（避免退出过程中触发扫描）
app.on('before-quit', () => {
  isQuitting = true;
  if (scheduler) scheduler.stop();
});
