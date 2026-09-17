const { test } = require('node:test');
const assert = require('node:assert');
const { createTray } = require('./tray');

function makeHarness({ autostart = false, trayThrows = false } = {}) {
  let lastMenuTemplate = null;
  let lastTray = null;
  class FakeTray {
    constructor(icon) {
      if (trayThrows) throw new Error('boom');
      this.icon = icon;
      this.handlers = {};
      this.tooltip = null;
      this.menu = null;
      lastTray = this;
    }
    setToolTip(t) { this.tooltip = t; }
    setContextMenu(m) { this.menu = m; }
    on(evt, fn) { this.handlers[evt] = fn; }
  }
  const calls = { onShow: 0, onScan: 0, onToggle: 0, onQuit: 0 };
  const log = { info: () => {}, warn: () => {}, error: () => {}, __error: [] };
  log.error = (...a) => log.__error.push(a);

  const tray = createTray({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (tpl) => { lastMenuTemplate = tpl; return { __tpl: tpl }; } },
    icon: 'tray.png',
    getMenuState: () => ({ autostart }),
    onShow: () => { calls.onShow++; },
    onScan: () => { calls.onScan++; },
    onToggleAutostart: () => { calls.onToggle++; },
    onQuit: () => { calls.onQuit++; },
    log,
  });
  return { tray, getLastTray: () => lastTray, getTemplate: () => lastMenuTemplate, calls, log };
}

test('创建 Tray 并设置 tooltip', () => {
  const h = makeHarness();
  assert.ok(h.tray instanceof h.constructor.constructor ? true : h.tray !== null);
  assert.strictEqual(h.getLastTray().tooltip, 'CDriveCleaner - C 盘空间分析');
  assert.strictEqual(h.getLastTray().icon, 'tray.png');
});

test('单击托盘触发 onShow', () => {
  const h = makeHarness();
  h.getLastTray().handlers.click();
  assert.strictEqual(h.calls.onShow, 1);
});

test('菜单含 4 个功能项（排除分隔线）', () => {
  const h = makeHarness();
  const tpl = h.getTemplate();
  const items = tpl.filter((it) => it.type !== 'separator');
  assert.strictEqual(items.length, 4);
  assert.deepStrictEqual(items.map((i) => i.label), ['打开主界面', '立即扫描', '开机自启', '退出']);
});

test('开机自启 checkbox 状态与 getMenuState 一致', () => {
  const h = makeHarness({ autostart: true });
  const tpl = h.getTemplate();
  const item = tpl.find((i) => i.label === '开机自启');
  assert.strictEqual(item.type, 'checkbox');
  assert.strictEqual(item.checked, true);
});

test('菜单点击回调正确绑定', () => {
  const h = makeHarness();
  const tpl = h.getTemplate();
  tpl.find((i) => i.label === '打开主界面').click();
  tpl.find((i) => i.label === '立即扫描').click();
  tpl.find((i) => i.label === '开机自启').click();
  tpl.find((i) => i.label === '退出').click();
  assert.strictEqual(h.calls.onShow, 1);
  assert.strictEqual(h.calls.onScan, 1);
  assert.strictEqual(h.calls.onToggle, 1);
  assert.strictEqual(h.calls.onQuit, 1);
});

test('托盘创建失败返回 null 并记 error 日志', () => {
  const h = makeHarness({ trayThrows: true });
  assert.strictEqual(h.tray, null);
  assert.ok(h.log.__error.length > 0);
});
