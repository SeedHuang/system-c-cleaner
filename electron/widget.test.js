/**
 * widget.js 单测：手写拖拽逻辑（beginDrag / dragTo / endDrag）。
 *
 * 重点验证：
 *  - 位移增量公式（避免「窗口跳到屏幕中心」典型 bug）
 *  - 三个入口的入参校验与失败回执
 *  - endDrag 后 dragTo 应被拒绝（not-dragging），防止松手后继续拖动
 *  - 窗口未就绪时 beginDrag 拒绝（widget-not-ready）
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createWidget } = require('./widget');

function fakeLog() {
  const lines = [];
  const rec = (level) => (scope, msg, extra) => lines.push({ level, scope, msg, extra });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
}

/** 最小化 BrowserWindow fake：覆盖 widget.js 实际用到的所有方法
 *  - 拖拽相关：setPosition / getBounds / isDestroyed
 *  - 生命周期：loadURL / on / isVisible / show / hide / webContents.on
 */
function fakeBrowserWindow() {
  let bounds = { x: 100, y: 200, width: 320, height: 176 };
  let destroyed = false;
  let visible = true;
  const calls = { setPosition: [] };
  const webContents = { on: () => {}, reload: () => {} };
  return {
    bw: {
      setPosition: (x, y) => { calls.setPosition.push({ x, y }); bounds = { ...bounds, x, y }; },
      getBounds: () => bounds,
      isDestroyed: () => destroyed,
      loadURL: () => {},
      on: () => {},
      isVisible: () => visible,
      show: () => { visible = true; },
      hide: () => { visible = false; },
      webContents,
    },
    calls,
    destroy: () => { destroyed = true; },
  };
}

function makeHandle() {
  const log = fakeLog();
  const { bw, calls } = fakeBrowserWindow();
  const handle = createWidget({
    BrowserWindow: class { constructor() { return bw; } },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    url: 'http://localhost/widget',
    stateFile: '/tmp/widget-state-test.json',
    showMain: () => {},
    onVisibilityChange: () => {},
    isQuitting: () => false,
    log,
  });
  handle.build(true);
  return { handle, calls, log };
}

test('beginDrag 在窗口未就绪时拒绝', () => {
  const log = fakeLog();
  const handle = createWidget({
    BrowserWindow: class {},
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    url: 'http://localhost/widget',
    stateFile: '/tmp/w.json',
    showMain: () => {},
    log,
  });
  // 注意：未调用 build()，widgetWindow=null
  assert.deepStrictEqual(handle.beginDrag({ screenX: 0, screenY: 0 }), { ok: false, error: 'widget-not-ready' });
});

test('beginDrag 拒绝非数字参数', () => {
  const { handle } = makeHandle();
  assert.deepStrictEqual(handle.beginDrag({}), { ok: false, error: 'invalid-args' });
  assert.deepStrictEqual(handle.beginDrag({ screenX: 'a', screenY: 0 }), { ok: false, error: 'invalid-args' });
  assert.deepStrictEqual(handle.beginDrag(null), { ok: false, error: 'invalid-args' });
});

test('dragTo 未 beginDrag 时拒绝', () => {
  const { handle } = makeHandle();
  assert.deepStrictEqual(handle.dragTo({ screenX: 10, screenY: 10 }), { ok: false, error: 'not-dragging' });
});

test('正常拖拽：位移 = winX + dx、winY + dy', () => {
  const { handle, calls } = makeHandle();
  // 初始窗口在 (100, 200)
  assert.strictEqual(handle.beginDrag({ screenX: 50, screenY: 50 }).ok, true);
  // 鼠标移动到 (150, 250)：dx=100, dy=200 → 窗口应到 (200, 400)
  assert.strictEqual(handle.dragTo({ screenX: 150, screenY: 250 }).ok, true);
  assert.deepStrictEqual(calls.setPosition[0], { x: 200, y: 400 });
});

test('多次 dragTo 始终基于 beginDrag 时的窗口起点', () => {
  const { handle, calls } = makeHandle();
  handle.beginDrag({ screenX: 50, screenY: 50 });
  handle.dragTo({ screenX: 60, screenY: 60 });   // dx=10, dy=10 → (110, 210)
  handle.dragTo({ screenX: 80, screenY: 80 });   // dx=30, dy=30 → (130, 230)
  handle.dragTo({ screenX: 200, screenY: 100 }); // dx=150, dy=50 → (250, 250)
  assert.deepStrictEqual(calls.setPosition, [
    { x: 110, y: 210 },
    { x: 130, y: 230 },
    { x: 250, y: 250 },
  ]);
});

test('负向位移：窗口向左上移动', () => {
  const { handle, calls } = makeHandle();
  handle.beginDrag({ screenX: 200, screenY: 200 });
  handle.dragTo({ screenX: 100, screenY: 100 }); // dx=-100, dy=-100 → (0, 100)
  assert.deepStrictEqual(calls.setPosition[0], { x: 0, y: 100 });
});

test('endDrag 后 dragTo 必须拒绝（防止松手后继续拖动）', () => {
  const { handle, calls } = makeHandle();
  handle.beginDrag({ screenX: 0, screenY: 0 });
  handle.dragTo({ screenX: 10, screenY: 10 });
  handle.endDrag();
  assert.strictEqual(handle.dragTo({ screenX: 20, screenY: 20 }).ok, false);
  // 拒绝后不应再调用 setPosition
  assert.strictEqual(calls.setPosition.length, 1);
});

test('beginDrag 校验失败时 dragTo 仍处于 not-dragging', () => {
  const { handle } = makeHandle();
  // 故意传入非法参数，先让 beginDrag 失败
  assert.strictEqual(handle.beginDrag({ screenX: 'x', screenY: 0 }).ok, false);
  // dragTo 应被拒绝
  assert.deepStrictEqual(handle.dragTo({ screenX: 1, screenY: 1 }), { ok: false, error: 'not-dragging' });
});

test('NaN / Infinity 参数被拒绝（typeof number 会放行，必须 Number.isFinite）', () => {
  const { handle } = makeHandle();
  assert.deepStrictEqual(handle.beginDrag({ screenX: NaN, screenY: 0 }), { ok: false, error: 'invalid-args' });
  assert.deepStrictEqual(handle.beginDrag({ screenX: 0, screenY: Infinity }), { ok: false, error: 'invalid-args' });
  handle.beginDrag({ screenX: 0, screenY: 0 });
  assert.deepStrictEqual(handle.dragTo({ screenX: NaN, screenY: 0 }), { ok: false, error: 'invalid-args' });
});

test('小数坐标取整：DPI 缩放下 screenX/screenY 带小数，Electron API 要求 Integer', () => {
  const { handle, calls } = makeHandle();
  // 起点 (100.6, 100.4) → 取整 (101, 100)
  handle.beginDrag({ screenX: 100.6, screenY: 100.4 });
  // 光标移到 (150.7, 120.2) → 取整 (151, 120) → dx=50, dy=20 → 窗口 (150, 220)
  assert.strictEqual(handle.dragTo({ screenX: 150.7, screenY: 120.2 }).ok, true);
  const last = calls.setPosition[calls.setPosition.length - 1];
  assert.deepStrictEqual(last, { x: 150, y: 220 });
  // 关键断言：传给 setPosition 的必须是整数（否则 Electron 抛 conversion failure）
  assert.strictEqual(Number.isInteger(last.x), true);
  assert.strictEqual(Number.isInteger(last.y), true);
});

test('拖拽位置 clamp 到 workArea：不会被拖出屏幕（frame:false + skipTaskbar 无法找回）', () => {
  const { handle, calls } = makeHandle();
  // workArea = (0,0,1920,1080)，窗口 320x176 → x∈[0,1600]，y∈[0,904]
  handle.beginDrag({ screenX: 100, screenY: 100 });
  // 猛拖到左上远处：dx=-1200, dy=-1300 → 原始 (-1100, -1200) → clamp 到 (0, 0)
  handle.dragTo({ screenX: -1100, screenY: -1200 });
  assert.deepStrictEqual(calls.setPosition[calls.setPosition.length - 1], { x: 0, y: 0 });
  // 猛拖到右下远处：dx=3000, dy=3000 → 原始 (3100, 3100) → clamp 到 (1600, 904)
  handle.dragTo({ screenX: 3100, screenY: 3100 });
  assert.deepStrictEqual(calls.setPosition[calls.setPosition.length - 1], { x: 1600, y: 904 });
});

test('拖拽中途窗口销毁 → dragTo 拒绝并清空状态（避免 setPosition on destroyed 抛异常）', () => {
  const log = fakeLog();
  const { bw, calls } = fakeBrowserWindow();
  const handle = createWidget({
    BrowserWindow: class { constructor() { return bw; } },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    url: 'http://localhost/widget',
    stateFile: '/tmp/w.json',
    showMain: () => {},
    log,
  });
  handle.build(true);
  assert.strictEqual(handle.beginDrag({ screenX: 0, screenY: 0 }).ok, true);
  bw.isDestroyed = () => true; // 模拟拖拽中窗口被销毁
  assert.deepStrictEqual(handle.dragTo({ screenX: 50, screenY: 50 }), { ok: false, error: 'widget-not-ready' });
  assert.strictEqual(calls.setPosition.length, 0); // 未对已销毁窗口调 setPosition
  // 状态已清空：即使窗口"复活"也不会继续按旧起点拖动
  bw.isDestroyed = () => false;
  assert.deepStrictEqual(handle.dragTo({ screenX: 50, screenY: 50 }), { ok: false, error: 'not-dragging' });
});
