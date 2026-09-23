/**
 * 桌面悬浮小组件窗口：无边框 / 透明 / 置顶 / 不进任务栏。
 * 位置记忆（widget-state.js）+ 手写拖拽（dragStart/Move/End 三个 IPC，由渲染端 PointerEvents 触发）
 * + 右键菜单 + 关闭隐藏。
 *
 * 拖拽为何走手写 IPC 而非 `-webkit-app-region: drag`（旧实现）：
 *   Electron 官方文档明确 "draggable areas ignore all pointer events"——
 *   drag 区域会吞掉 click/dblclick/mouseenter 等所有指针事件，导致无法实现
 *   「双击唤出主界面」。手写拖拽 + 3px 死区即可同时支持「可拖拽」与「双击打开」。
 */
const { loadWidgetState, saveWidgetState } = require('./widget-state');

const WIDGET_W = 320;
const WIDGET_H = 176;

function createWidget({ BrowserWindow, Menu, screen, url, stateFile, showMain, onVisibilityChange, isQuitting, log }) {
  let widgetWindow = null;
  let saveTimer = null;
  // 拖拽状态：仅在 pointer 落下的同时按住后启用，结束即清零。
  // 记录起点是为了按「鼠标位移增量」更新窗口（避免「跳到屏幕中心」等典型 bug）。
  let dragState = null; // { startX, startY, winX, winY }

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

  /**
   * IPC 入参是不可信输入：校验为有限数字。
   * typeof === 'number' 会放行 NaN/Infinity（→ setPosition(NaN) 抛异常），必须用 Number.isFinite。
   */
  function readPoint(payload) {
    if (!payload) return null;
    const { screenX, screenY } = payload;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
    return { x: screenX, y: screenY };
  }

  /**
   * 手写拖拽：渲染端 pointerdown 后调一次，记下「鼠标起点 + 窗口当前位置」。
   * 必须保存 winX/winY（不是鼠标在窗口内的局部坐标），后续只更新窗口 setPosition，
   * 否则窗口会"跳到屏幕中心"（典型 IPC 拖拽 bug）。
   */
  function beginDrag(payload) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return { ok: false, error: 'widget-not-ready' };
    const p = readPoint(payload);
    if (!p) return { ok: false, error: 'invalid-args' };
    const bounds = widgetWindow.getBounds();
    dragState = {
      // DPI 缩放下渲染端的 screenX/screenY 是小数 CSS 像素，统一取整（后续 dx/dy 才是整数）
      startX: Math.round(p.x),
      startY: Math.round(p.y),
      winX: bounds.x,
      winY: bounds.y,
    };
    return { ok: true };
  }

  /**
   * 每次 pointermove 上报一次（已超过 3px 死区后），按位移增量更新窗口位置。
   * clamp 到光标所在显示器的 workArea：frame:false + skipTaskbar:true 的窗口
   * 一旦被完全拖出屏幕，用户没有任何手段找回，必须在拖拽时就限制在屏幕内。
   */
  function dragTo(payload) {
    if (!dragState) return { ok: false, error: 'not-dragging' };
    // 拖拽中途窗口可能被销毁（如应用退出）：setPosition 会抛 "Object has been destroyed"，
    // IPC handler 无 try/catch，必须在此拦截并清掉过期状态
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      dragState = null;
      return { ok: false, error: 'widget-not-ready' };
    }
    const p = readPoint(payload);
    if (!p) return { ok: false, error: 'invalid-args' };
    // 取整：Electron 的 getDisplayNearestPoint / setPosition 都要求 Integer，
    // DPI 缩放（125%/150%）下 screenX/screenY 带小数，直接传会抛
    // "Error processing argument ... conversion failure"（主进程 uncaughtException 弹错误框）
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const dx = cx - dragState.startX;
    const dy = cy - dragState.startY;
    const { workArea } = screen.getDisplayNearestPoint({ x: cx, y: cy });
    const x = Math.max(workArea.x, Math.min(dragState.winX + dx, workArea.x + workArea.width - WIDGET_W));
    const y = Math.max(workArea.y, Math.min(dragState.winY + dy, workArea.y + workArea.height - WIDGET_H));
    try {
      widgetWindow.setPosition(x, y);
    } catch (err) {
      // 防御：窗口操作异常绝不逃逸成 uncaughtException（会弹系统错误对话框）
      dragState = null;
      return { ok: false, error: 'set-position-failed' };
    }
    return { ok: true };
  }

  function endDrag() {
    dragState = null;
    return { ok: true };
  }

  return { build, toggle, isVisible, beginDrag, dragTo, endDrag };
}

module.exports = { createWidget, WIDGET_W, WIDGET_H };
