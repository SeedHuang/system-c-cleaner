/**
 * 桌面悬浮小组件窗口：无边框 / 透明 / 置顶 / 不进任务栏。
 * 位置记忆（widget-state.js）+ 拖拽保存 + 右键菜单 + 关闭隐藏。
 */
const { loadWidgetState, saveWidgetState } = require('./widget-state');

const WIDGET_W = 320;
const WIDGET_H = 150;

function createWidget({ BrowserWindow, Menu, screen, url, stateFile, showMain, onVisibilityChange, isQuitting, log }) {
  let widgetWindow = null;
  let saveTimer = null;

  const defaultPosition = () => {
    const { workArea } = screen.getPrimaryDisplay();
    return { x: workArea.x + workArea.width - WIDGET_W - 20, y: workArea.y + 60 };
  };

  const resolvePosition = () => {
    const saved = loadWidgetState(stateFile);
    if (!saved) return defaultPosition();
    const { workArea } = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: WIDGET_W, height: WIDGET_H });
    const inside =
      saved.x >= workArea.x && saved.x + WIDGET_W <= workArea.x + workArea.width &&
      saved.y >= workArea.y && saved.y + WIDGET_H <= workArea.y + workArea.height;
    if (inside) return saved;
    log.warn('widget', '保存位置越界，回退默认右上角', saved);
    return defaultPosition();
  };

  const toggle = (visible) => {
    if (!widgetWindow) return;
    if (visible) {
      widgetWindow.show();
      log.info('widget', '显示小组件');
    } else {
      widgetWindow.hide();
      log.info('widget', '隐藏小组件');
    }
    if (onVisibilityChange) onVisibilityChange(visible);
  };

  const isVisible = () => widgetWindow !== null && !widgetWindow.isDestroyed() && widgetWindow.isVisible();

  function build(visible = true) {
    if (widgetWindow) return widgetWindow;
    const pos = resolvePosition();
    widgetWindow = new BrowserWindow({
      width: WIDGET_W,
      height: WIDGET_H,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: visible, // 启动时按设置决定是否显示（隐藏时不闪现）
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: require('path').join(__dirname, 'widget-preload.js'),
      },
    });

    widgetWindow.loadURL(url);
    widgetWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      log.error('widget', '页面加载失败', { code, desc });
    });

    // 拖拽移动后防抖保存位置
    widgetWindow.on('move', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const b = widgetWindow.getBounds();
        saveWidgetState(stateFile, { x: b.x, y: b.y });
        log.info('widget', '位置已保存', { x: b.x, y: b.y });
      }, 300);
    });

    // 关闭 = 隐藏（不销毁），托盘开关仍可控；真正退出时放行
    widgetWindow.on('close', (e) => {
      if (isQuitting && isQuitting()) return;
      e.preventDefault();
      // 统一走 toggle，确保通知外部同步托盘勾选状态
      toggle(false);
    });

    // 右键菜单（渲染进程右键触发）
    widgetWindow.webContents.on('context-menu', () => {
      Menu.buildFromTemplate([
        { label: '刷新数据', click: () => widgetWindow.webContents.reload() },
        { label: '显示主窗口', click: showMain },
        { label: '隐藏小组件', click: () => toggle(false) },
      ]).popup();
    });

    log.info('widget', '小组件窗口已创建', { x: pos.x, y: pos.y, url });
    return widgetWindow;
  }

  return { build, toggle, isVisible };
}

module.exports = { createWidget, WIDGET_W, WIDGET_H };
