/**
 * scheduler.js 单测：
 *  - nextDueReason：三种触发（startup/daily/interval）+ 去重（minGap）+ 总开关
 *  - pickPrevUsedGB：从历史快照里取「本次之前最近一条」的已用空间（用于增长量）
 *  - createScheduler：tick 编排（扫描中跳过、触发后通知一次、别处完成的扫描不重复通知、失败不推进状态）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { nextDueReason, dayKey, parseScanTime, pickPrevUsedGB, createScheduler, DEFAULT_TICK_MS } = require('./scheduler');

const CFG = {
  autoScan: true,
  startDelayMin: 3,
  intervalHours: 12,
  dailyAt: '09:00',
  minGapMin: 60,
};
const at = (s) => new Date(s.replace(' ', 'T')).getTime();

function tmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdrive-sched-'));
  return path.join(dir, 'scheduler-state.json');
}

function fakeLog() {
  const lines = [];
  const rec = (level) => (scope, msg, extra) => lines.push({ level, scope, msg, extra });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
}

// ---------- nextDueReason ----------

test('autoScan 关闭 → 恒不触发', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 12:00:00'),
      appStartedAt: at('2026-09-17 11:00:00'),
      startupScanDone: false,
      lastScanAt: null,
      lastDailyKey: null,
      cfg: { ...CFG, autoScan: false },
    }),
    null,
  );
});

test('启动延迟未到且无其他触发 → null', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:01:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: false,
      lastScanAt: null,
      lastDailyKey: '2026-09-17',
      cfg: CFG,
    }),
    null,
  );
});

test('启动延迟已到且本次启动未扫过 → startup', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:05:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: false,
      lastScanAt: null,
      lastDailyKey: '2026-09-17',
      cfg: CFG,
    }),
    'startup',
  );
});

test('本次启动已扫过 → startup 不再触发', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:30:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: true,
      lastScanAt: at('2026-09-17 10:05:00'),
      lastDailyKey: '2026-09-17',
      cfg: CFG,
    }),
    null,
  );
});

test('距上次扫描达间隔（12h）→ interval；未达 → null', () => {
  const base = {
    now: at('2026-09-17 22:00:00'),
    appStartedAt: at('2026-09-17 21:00:00'),
    startupScanDone: true,
    lastDailyKey: '2026-09-17',
    cfg: CFG,
  };
  assert.strictEqual(nextDueReason({ ...base, lastScanAt: at('2026-09-17 09:00:00') }), 'interval');
  assert.strictEqual(nextDueReason({ ...base, lastScanAt: at('2026-09-17 11:00:00') }), null);
});

test('启动延迟未到但已达间隔 → interval（两个触发相互独立）', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 21:01:00'),
      appStartedAt: at('2026-09-17 21:00:00'),
      startupScanDone: true,
      lastScanAt: at('2026-09-17 08:00:00'),
      lastDailyKey: '2026-09-17',
      cfg: CFG,
    }),
    'interval',
  );
});

test('已过 dailyAt 且今日未扫 → daily；今日已扫 → null', () => {
  const base = {
    now: at('2026-09-17 09:30:00'),
    appStartedAt: at('2026-09-17 08:00:00'),
    startupScanDone: true,
    cfg: CFG,
  };
  assert.strictEqual(
    nextDueReason({ ...base, lastScanAt: at('2026-09-16 20:00:00'), lastDailyKey: '2026-09-16' }),
    'daily',
  );
  assert.strictEqual(
    nextDueReason({ ...base, lastScanAt: at('2026-09-17 08:00:00'), lastDailyKey: '2026-09-17' }),
    null,
  );
});

test('dailyAt 边界：08:59 不触发、09:00 触发', () => {
  // lastScanAt 取 2 小时前：满足 minGap 但未达 interval，确保断言只受 dailyAt 影响
  const mk = (nowStr) => nextDueReason({
    now: at(nowStr),
    appStartedAt: at('2026-09-17 08:00:00'),
    startupScanDone: true,
    lastScanAt: at(nowStr) - 2 * 3600 * 1000,
    lastDailyKey: '2026-09-16',
    cfg: CFG,
  });
  assert.strictEqual(mk('2026-09-17 08:59:00'), null);
  assert.strictEqual(mk('2026-09-17 09:00:00'), 'daily');
});

test('minGap 未到 → 三种触发全部被拦截', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:05:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: false,
      lastScanAt: at('2026-09-17 09:35:00'), // 30 分钟前 < 60
      lastDailyKey: '2026-09-16',
      cfg: { ...CFG, intervalHours: 1 },
    }),
    null,
  );
});

test('minGap 恰好到点 → 放行', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:05:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: false,
      lastScanAt: at('2026-09-17 09:05:00'), // 恰好 60 分钟
      lastDailyKey: '2026-09-17',
      cfg: CFG,
    }),
    'startup',
  );
});

test('多触发同时满足 → 优先级 startup > daily > interval', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 10:05:00'),
      appStartedAt: at('2026-09-17 10:00:00'),
      startupScanDone: false,
      lastScanAt: at('2026-09-16 20:00:00'),
      lastDailyKey: '2026-09-16',
      cfg: { ...CFG, intervalHours: 1 },
    }),
    'startup',
  );
});

test('dailyAt 非法格式 → 该触发不生效（不误触发）', () => {
  assert.strictEqual(
    nextDueReason({
      now: at('2026-09-17 23:00:00'),
      appStartedAt: at('2026-09-17 22:59:00'),
      startupScanDone: true,
      lastScanAt: at('2026-09-17 22:00:00'), // 1 小时前：过 minGap 但未达 interval
      lastDailyKey: '2026-09-16',
      cfg: { ...CFG, dailyAt: 'bad' },
    }),
    null,
  );
});

// ---------- 辅助函数 ----------

test('dayKey 用本地日期（跨零点边界）', () => {
  assert.strictEqual(dayKey(at('2026-09-17 23:59:59')), '2026-09-17');
  assert.strictEqual(dayKey(at('2026-09-18 00:00:01')), '2026-09-18');
});

test('parseScanTime 解析 "YYYY-MM-DD HH:mm:ss" 与 ISO，非法返回 null', () => {
  assert.strictEqual(parseScanTime('2026-09-17 09:30:00'), at('2026-09-17 09:30:00'));
  assert.strictEqual(parseScanTime('2026-09-17T09:30:00'), at('2026-09-17 09:30:00'));
  assert.strictEqual(parseScanTime(null), null);
  assert.strictEqual(parseScanTime('乱七八糟'), null);
});

test('pickPrevUsedGB 取「本次之前最近一条」快照的已用空间', () => {
  const snapshots = [
    { scannedAt: '2026-09-17 09:30:00', disk: { usedGB: 100 } },
    { scannedAt: '2026-09-15 09:30:00', disk: { usedGB: 95 } },
    { scannedAt: '2026-09-16 09:30:00', disk: { usedGB: 98 } },
  ];
  assert.strictEqual(pickPrevUsedGB(snapshots, '2026-09-17 09:30:00'), 98);
});

test('pickPrevUsedGB 无更早快照 / disk 缺失 / 入参非法 → null', () => {
  assert.strictEqual(pickPrevUsedGB([{ scannedAt: '2026-09-17 09:30:00', disk: { usedGB: 100 } }], '2026-09-17 09:30:00'), null);
  assert.strictEqual(pickPrevUsedGB([{ scannedAt: '2026-09-16 09:30:00' }], '2026-09-17 09:30:00'), null);
  assert.strictEqual(pickPrevUsedGB(null, '2026-09-17 09:30:00'), null);
  assert.strictEqual(pickPrevUsedGB([{ scannedAt: '2026-09-16 09:30:00', disk: { usedGB: 1 } }], null), null);
});

// ---------- createScheduler 编排 ----------

/** 假调度环境：可控时钟（clock 可推进）+ 假 api/通知器 + 假定时器 */
function makeScheduler({ status, triggerResult, triggerError, history, cfg = CFG, clock = '2026-09-17 11:55:00', stateFile } = {}) {
  const log = fakeLog();
  const calls = { trigger: 0, notified: [], statusQueries: 0 };
  let timerFn = null;
  let nowMs = at(clock);
  const scheduler = createScheduler({
    stateFile: stateFile || tmpState(),
    log,
    loadSettings: () => cfg,
    now: () => nowMs,
    api: {
      getStatus: async () => { calls.statusQueries++; return typeof status === 'function' ? status() : status; },
      triggerScan: async () => {
        calls.trigger++;
        if (triggerError) throw triggerError;
        return triggerResult;
      },
      getHistory: async () => history || { snapshots: [] },
    },
    notifier: {
      notify: async (payload) => calls.notified.push(payload),
      notifyFailed: async (payload) => calls.notified.push({ failed: true, ...payload }),
    },
    setIntervalFn: (fn) => { timerFn = fn; return 1; },
    clearIntervalFn: () => { timerFn = null; },
  });
  return { scheduler, log, calls, advanceTo: (s) => { nowMs = at(s); }, timerAlive: () => !!timerFn };
}

test('DEFAULT_TICK_MS = 5 分钟', () => {
  assert.strictEqual(DEFAULT_TICK_MS, 5 * 60 * 1000);
});

test('tick：扫描进行中 → 跳过，不触发', async () => {
  const { scheduler, log, calls, advanceTo } = makeScheduler({ status: { scanning: true, scannedAt: null } });
  await scheduler.start();
  advanceTo('2026-09-17 12:00:00');
  const r = await scheduler.tick();
  assert.strictEqual(r.triggered, false);
  assert.strictEqual(calls.trigger, 0);
  assert.ok(log.lines.some((l) => l.msg.includes('扫描进行中')));
});

test('tick：命中触发 → 调 POST /api/scan 并通知一次，状态推进', async () => {
  const { scheduler, calls, advanceTo } = makeScheduler({
    status: { scanning: false, scannedAt: null },
    triggerResult: { scannedAt: '2026-09-17 12:00:00', disk: { totalGB: 500, usedGB: 400, freeGB: 100 } },
    history: { snapshots: [{ scannedAt: '2026-09-16 12:00:00', disk: { usedGB: 395 } }] },
  });
  await scheduler.start();
  advanceTo('2026-09-17 12:00:00'); // 启动 5 分钟后
  const r = await scheduler.tick();
  assert.strictEqual(r.reason, 'startup');
  assert.strictEqual(r.triggered, true);
  assert.strictEqual(r.notified, true);
  assert.strictEqual(calls.trigger, 1);
  assert.strictEqual(calls.notified.length, 1);
  assert.strictEqual(calls.notified[0].prevUsedGB, 395);
  assert.strictEqual(scheduler.state().lastScanAt, at('2026-09-17 12:00:00'));
  assert.strictEqual(scheduler.state().lastDailyKey, '2026-09-17');
});

test('tick：别处完成的扫描（scannedAt 变化）→ 通知一次且不重复', async () => {
  let scannedAt = null;
  const { scheduler, calls, advanceTo } = makeScheduler({
    status: () => ({ scanning: false, scannedAt }),
    triggerResult: { scannedAt: '2026-09-17 12:00:00', disk: {} },
  });
  await scheduler.start();
  advanceTo('2026-09-17 12:00:00');
  scannedAt = '2026-09-17 12:00:00'; // 托盘 / 概览按钮 / 提权重启时的扫描完成
  const r1 = await scheduler.tick();
  assert.strictEqual(r1.notified, true);
  assert.strictEqual(calls.notified.length, 1);
  const r2 = await scheduler.tick();
  assert.strictEqual(r2.notified, false);
  assert.strictEqual(calls.notified.length, 1);
  assert.strictEqual(calls.trigger, 0); // minGap 内不再触发
});

test('start：首次同步已有 scannedAt，不回放旧通知', async () => {
  const { scheduler, calls } = makeScheduler({
    status: { scanning: false, scannedAt: '2026-09-17 11:00:00' },
    triggerResult: { scannedAt: '2026-09-17 12:00:00', disk: {} },
  });
  await scheduler.start();
  assert.strictEqual(calls.notified.length, 0);
  assert.strictEqual(scheduler.state().lastScanAt, at('2026-09-17 11:00:00'));
});

test('tick：扫描失败 → 不推进 lastScanAt，发失败通知', async () => {
  const stateFile = tmpState();
  const { scheduler, log, calls, advanceTo } = makeScheduler({
    status: { scanning: false, scannedAt: null },
    triggerError: new Error('扫描脚本超时'),
    stateFile,
  });
  await scheduler.start();
  advanceTo('2026-09-17 12:00:00');
  const r = await scheduler.tick();
  assert.strictEqual(r.triggered, false);
  assert.strictEqual(r.error, '扫描脚本超时');
  assert.strictEqual(scheduler.state().lastScanAt, null);
  assert.ok(log.lines.some((l) => l.level === 'error'));
  assert.strictEqual(calls.notified.length, 1);
  assert.strictEqual(calls.notified[0].failed, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastScanAt, null);
});

test('tick：autoScan 关闭 → 直接返回，不查状态不触发', async () => {
  const { scheduler, calls, advanceTo } = makeScheduler({
    status: { scanning: false, scannedAt: null },
    triggerResult: { scannedAt: '2026-09-17 12:00:00', disk: {} },
    cfg: { ...CFG, autoScan: false },
  });
  await scheduler.start();
  advanceTo('2026-09-17 12:00:00');
  const r = await scheduler.tick();
  assert.strictEqual(r.reason, null);
  assert.strictEqual(calls.trigger, 0);
  assert.strictEqual(calls.notified.length, 0);
});

test('stop：清理定时器；状态跨实例持久化（重启后 minGap 内不重复扫描）', async () => {
  const stateFile = tmpState();
  const first = makeScheduler({
    status: { scanning: false, scannedAt: null },
    triggerResult: { scannedAt: '2026-09-17 12:00:00', disk: {} },
    stateFile,
  });
  await first.scheduler.start();
  assert.strictEqual(first.timerAlive(), true);
  first.advanceTo('2026-09-17 12:00:00');
  await first.scheduler.tick();
  first.scheduler.stop();
  assert.strictEqual(first.timerAlive(), false);

  const second = makeScheduler({
    status: { scanning: false, scannedAt: null },
    triggerResult: { scannedAt: '2026-09-17 12:30:00', disk: {} },
    stateFile,
    clock: '2026-09-17 12:30:00',
  });
  await second.scheduler.start();
  const r = await second.scheduler.tick();
  assert.strictEqual(r.triggered, false);
  assert.strictEqual(second.calls.trigger, 0);
});
