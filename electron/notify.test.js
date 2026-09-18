/**
 * notify.js 单测：
 *  - buildNotification：阈值判定（剩余空间 / 增长）、合并文案、安静模式、非法入参
 *  - buildFailureNotification：失败通知（受 notifyEveryScan 控制）
 *  - createNotifier：系统不支持 / show 抛错 / 点击回调 均有日志与兜底
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { buildNotification, buildFailureNotification, createNotifier } = require('./notify');

const CFG = { lowSpacePct: 10, growthWarnGB: 2, notifyEveryScan: true };
const DISK = { totalGB: 500, usedGB: 400, freeGB: 100 }; // 剩余 20%

function fakeLog() {
  const lines = [];
  const rec = (level) => (scope, msg, extra) => lines.push({ level, scope, msg, extra });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
}

// ---------- buildNotification ----------

test('disk 缺失或字段非法 → null（不发通知）', () => {
  assert.strictEqual(buildNotification({ disk: null, prevUsedGB: null, cfg: CFG }), null);
  assert.strictEqual(buildNotification({ disk: { totalGB: 0, usedGB: 0, freeGB: 0 }, cfg: CFG }), null);
  assert.strictEqual(buildNotification({ disk: { totalGB: 500, usedGB: '400', freeGB: 100 }, cfg: CFG }), null);
  assert.strictEqual(buildNotification({ disk: { totalGB: 500, usedGB: 400 }, cfg: CFG }), null);
});

test('正常情况：标题「扫描完成」、body 含剩余空间、非告警', () => {
  const n = buildNotification({ disk: DISK, prevUsedGB: null, cfg: CFG });
  assert.strictEqual(n.title, '扫描完成');
  assert.strictEqual(n.urgent, false);
  assert.strictEqual(n.body, '剩余 20.0%（100.0 GB）');
});

test('剩余空间恰好等于阈值 → 告警（≤ 判定）', () => {
  const disk = { totalGB: 500, usedGB: 450, freeGB: 50 }; // 10%
  const n = buildNotification({ disk, prevUsedGB: null, cfg: CFG });
  assert.strictEqual(n.urgent, true);
  assert.strictEqual(n.title, '⚠️ C 盘空间告警');
});

test('剩余空间略高于阈值 → 不告警', () => {
  const disk = { totalGB: 1000, usedGB: 899, freeGB: 101 }; // 10.1%
  assert.strictEqual(buildNotification({ disk, prevUsedGB: null, cfg: CFG }).urgent, false);
});

test('增长恰好等于阈值 → 告警；略低 → 不告警', () => {
  const hit = buildNotification({ disk: DISK, prevUsedGB: 398, cfg: CFG }); // +2.0GB
  assert.strictEqual(hit.urgent, true);
  assert.strictEqual(hit.title, '⚠️ C 盘空间告警');
  const miss = buildNotification({ disk: DISK, prevUsedGB: 398.5, cfg: CFG }); // +1.5GB
  assert.strictEqual(miss.urgent, false);
});

test('body 文案：正增长 / 负增长 / 零增长', () => {
  assert.strictEqual(
    buildNotification({ disk: DISK, prevUsedGB: 397.9, cfg: CFG }).body,
    '剩余 20.0%（100.0 GB），本次 +2.1 GB',
  );
  assert.strictEqual(
    buildNotification({ disk: DISK, prevUsedGB: 401.2, cfg: CFG }).body,
    '剩余 20.0%（100.0 GB），本次 -1.2 GB',
  );
  assert.strictEqual(
    buildNotification({ disk: DISK, prevUsedGB: 400, cfg: CFG }).body,
    '剩余 20.0%（100.0 GB）',
  );
});

test('无上次快照（prevUsedGB=null）→ 不做增长判定，也不提增长', () => {
  const n = buildNotification({ disk: DISK, prevUsedGB: null, cfg: CFG });
  assert.strictEqual(n.urgent, false);
  assert.ok(!n.body.includes('本次'));
});

test('安静模式：notifyEveryScan=false 且无告警 → null；有告警 → 仍发', () => {
  const quiet = { ...CFG, notifyEveryScan: false };
  assert.strictEqual(buildNotification({ disk: DISK, prevUsedGB: null, cfg: quiet }), null);
  const lowDisk = { totalGB: 500, usedGB: 480, freeGB: 20 }; // 4%
  const n = buildNotification({ disk: lowDisk, prevUsedGB: null, cfg: quiet });
  assert.strictEqual(n.urgent, true);
  assert.strictEqual(n.title, '⚠️ C 盘空间告警');
});

test('阈值可配置（lowSpacePct=99 时任何磁盘都告警）', () => {
  const n = buildNotification({ disk: DISK, prevUsedGB: null, cfg: { ...CFG, lowSpacePct: 99 } });
  assert.strictEqual(n.urgent, true);
});

// ---------- buildFailureNotification ----------

test('失败通知：默认发，安静模式不发', () => {
  const n = buildFailureNotification({ error: '扫描脚本超时', cfg: CFG });
  assert.strictEqual(n.title, '⚠️ 扫描失败');
  assert.ok(n.body.includes('扫描脚本超时'));
  assert.strictEqual(n.urgent, true);
  assert.strictEqual(buildFailureNotification({ error: 'x', cfg: { ...CFG, notifyEveryScan: false } }), null);
});

test('失败通知：无错误信息时用兜底文案', () => {
  const n = buildFailureNotification({ error: '', cfg: CFG });
  assert.ok(n.body.includes('未知原因'));
});

// ---------- createNotifier ----------

function makeNotificationClass({ supported = true, throwOnShow = false } = {}) {
  class FakeNotification {
    static isSupported() { return supported; }
    constructor(opts) {
      this.opts = opts;
      this.shown = 0;
      this.handlers = {};
      FakeNotification.last = this;
    }
    show() {
      if (throwOnShow) throw new Error('系统通知服务不可用');
      this.shown++;
    }
    on(evt, cb) { this.handlers[evt] = cb; }
  }
  return FakeNotification;
}

test('createNotifier：正常展示并写日志', () => {
  const Notification = makeNotificationClass();
  const log = fakeLog();
  const notifier = createNotifier({ Notification, showMain: () => {}, log });
  assert.strictEqual(notifier.notify({ disk: DISK, prevUsedGB: null, cfg: CFG }), true);
  const inst = Notification.last;
  assert.strictEqual(inst.shown, 1);
  assert.strictEqual(inst.opts.title, '扫描完成');
  assert.strictEqual(inst.opts.body, '剩余 20.0%（100.0 GB）');
  assert.ok(log.lines.some((l) => l.msg.includes('通知已发送')));
});

test('createNotifier：点击通知 → 打开主窗口', () => {
  const Notification = makeNotificationClass();
  let opened = 0;
  const notifier = createNotifier({ Notification, showMain: () => { opened++; }, log: fakeLog() });
  notifier.notify({ disk: DISK, prevUsedGB: null, cfg: CFG });
  Notification.last.handlers.click();
  assert.strictEqual(opened, 1);
});

test('createNotifier：系统不支持通知 → 记 warn 并跳过，不抛错', () => {
  const Notification = makeNotificationClass({ supported: false });
  const log = fakeLog();
  const notifier = createNotifier({ Notification, showMain: () => {}, log });
  assert.strictEqual(notifier.notify({ disk: DISK, prevUsedGB: null, cfg: CFG }), false);
  assert.ok(log.lines.some((l) => l.level === 'warn'));
});

test('createNotifier：show 抛错 → 记 error，不向上抛', () => {
  const Notification = makeNotificationClass({ throwOnShow: true });
  const log = fakeLog();
  const notifier = createNotifier({ Notification, showMain: () => {}, log });
  assert.strictEqual(notifier.notify({ disk: DISK, prevUsedGB: null, cfg: CFG }), false);
  assert.ok(log.lines.some((l) => l.level === 'error'));
});

test('createNotifier：buildNotification 返回 null 时不构造通知', () => {
  const Notification = makeNotificationClass();
  const log = fakeLog();
  const notifier = createNotifier({ Notification, showMain: () => {}, log });
  assert.strictEqual(notifier.notify({ disk: null, prevUsedGB: null, cfg: CFG }), false);
  assert.strictEqual(Notification.last, undefined);
});

test('createNotifier：notifyFailed 走失败文案', () => {
  const Notification = makeNotificationClass();
  const notifier = createNotifier({ Notification, showMain: () => {}, log: fakeLog() });
  assert.strictEqual(notifier.notifyFailed({ error: 'boom', cfg: CFG }), true);
  assert.strictEqual(Notification.last.opts.title, '⚠️ 扫描失败');
});
