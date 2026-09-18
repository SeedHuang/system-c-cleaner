/**
 * elevate-guard.js 单测：
 *  - parseElevated：PowerShell 输出 → true/false/null（未知）
 *  - shouldAttemptElevate：已提权跳过 / 开关关闭 / 冷却期 / 未知状态降级
 *  - createElevateGuard：编排（探测失败降级、请求提权后写冷却时间戳、异常不抛）
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseElevated,
  shouldAttemptElevate,
  createElevateGuard,
  probeElevation,
  ELEVATE_COOLDOWN_MS,
} = require('./elevate-guard');

// ---------- probeElevation（spawn 注入，验证解析与失败降级） ----------

const { EventEmitter } = require('events');

function fakeChild({ stdout = '', error = null }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (error) { child.emit('error', error); return; }
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', 0);
  });
  return child;
}

test('probeElevation：输出 True → true（记录日志）', async () => {
  const log = fakeLog();
  const r = await probeElevation({ psPath: 'powershell.exe', spawnFn: () => fakeChild({ stdout: 'True\r\n' }), log });
  assert.strictEqual(r, true);
  assert.ok(log.lines.some((l) => l.msg.includes('提权状态探测完成')));
});

test('probeElevation：spawn 报错 → null（未知，降级运行）', async () => {
  const log = fakeLog();
  const r = await probeElevation({ psPath: 'powershell.exe', spawnFn: () => fakeChild({ error: new Error('ENOENT') }), log });
  assert.strictEqual(r, null);
  assert.ok(log.lines.some((l) => l.level === 'error'));
});

test('probeElevation：spawn 抛异常 → null，不向上抛', async () => {
  const log = fakeLog();
  const r = await probeElevation({
    psPath: 'powershell.exe',
    spawnFn: () => { throw new Error('spawn 失败'); },
    log,
  });
  assert.strictEqual(r, null);
});

const CFG = { autoElevateOnStart: true };
const NOW = new Date('2026-09-17 12:00:00'.replace(' ', 'T')).getTime();

function fakeLog() {
  const lines = [];
  const rec = (level) => (scope, msg, extra) => lines.push({ level, scope, msg, extra });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
}

// ---------- parseElevated ----------

test('parseElevated：True/False（含大小写与空白）→ true/false', () => {
  assert.strictEqual(parseElevated('True\r\n'), true);
  assert.strictEqual(parseElevated('False\n'), false);
  assert.strictEqual(parseElevated('  true  '), true);
  assert.strictEqual(parseElevated('FALSE'), false);
});

test('parseElevated：空/异常输出 → null（未知，不弹 UAC）', () => {
  assert.strictEqual(parseElevated(''), null);
  assert.strictEqual(parseElevated(null), null);
  assert.strictEqual(parseElevated('发生错误: 拒绝访问'), null);
});

// ---------- shouldAttemptElevate ----------

test('ELEVATE_COOLDOWN_MS = 10 分钟', () => {
  assert.strictEqual(ELEVATE_COOLDOWN_MS, 10 * 60 * 1000);
});

test('已提权 → 不再尝试（防提权死循环的主保障）', () => {
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: true, lastAttemptAt: null, now: NOW, cfg: CFG }),
    false,
  );
});

test('提权状态未知（探测失败）→ 不尝试，降级运行', () => {
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: null, lastAttemptAt: null, now: NOW, cfg: CFG }),
    false,
  );
});

test('配置关闭启动提权 → 不尝试', () => {
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: false, lastAttemptAt: null, now: NOW, cfg: { autoElevateOnStart: false } }),
    false,
  );
});

test('冷却期内（5 分钟前尝试过）→ 不尝试；恰好 10 分钟 → 允许', () => {
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: false, lastAttemptAt: NOW - 5 * 60 * 1000, now: NOW, cfg: CFG }),
    false,
  );
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: false, lastAttemptAt: NOW - ELEVATE_COOLDOWN_MS, now: NOW, cfg: CFG }),
    true,
  );
});

test('未提权且无历史尝试记录 → 尝试', () => {
  assert.strictEqual(
    shouldAttemptElevate({ isElevated: false, lastAttemptAt: null, now: NOW, cfg: CFG }),
    true,
  );
});

// ---------- createElevateGuard ----------

function makeGuard({ elevated, cfg = CFG, lastAttemptAt = null, throwOnRequest = false } = {}) {
  const log = fakeLog();
  const saved = [];
  let requests = 0;
  const guard = createElevateGuard({
    probe: async () => elevated,
    requestRestart: async () => {
      requests++;
      if (throwOnRequest) throw new Error('UAC 引导进程启动失败');
    },
    log,
    now: () => NOW,
    getState: () => ({ lastElevateAttemptAt: lastAttemptAt }),
    saveState: (patch) => { saved.push(patch); },
  });
  return { guard, log, saved, requests: () => requests, cfg };
}

test('run：已提权 → already-elevated，不请求 UAC', async () => {
  const { guard, requests } = makeGuard({ elevated: true });
  assert.strictEqual(await guard.run(CFG), 'already-elevated');
  assert.strictEqual(requests(), 0);
});

test('run：未提权 → 请求提权重启 + 写入冷却时间戳', async () => {
  const { guard, saved, requests } = makeGuard({ elevated: false });
  assert.strictEqual(await guard.run(CFG), 'requested');
  assert.strictEqual(requests(), 1);
  assert.deepStrictEqual(saved[saved.length - 1], { lastElevateAttemptAt: NOW });
});

test('run：探测失败（null）→ probe-failed，不请求 UAC，降级运行', async () => {
  const { guard, requests, log } = makeGuard({ elevated: null });
  assert.strictEqual(await guard.run(CFG), 'probe-failed');
  assert.strictEqual(requests(), 0);
  assert.ok(log.lines.some((l) => l.level === 'error'));
});

test('run：冷却期内 → skipped-cooldown', async () => {
  const { guard, requests } = makeGuard({ elevated: false, lastAttemptAt: NOW - 60 * 1000 });
  assert.strictEqual(await guard.run(CFG), 'skipped-cooldown');
  assert.strictEqual(requests(), 0);
});

test('run：配置关闭 → skipped-disabled，连探测都不做', async () => {
  let probed = 0;
  const log = fakeLog();
  const guard = createElevateGuard({
    probe: async () => { probed++; return false; },
    requestRestart: async () => {},
    log,
    now: () => NOW,
    getState: () => ({ lastElevateAttemptAt: null }),
    saveState: () => {},
  });
  assert.strictEqual(await guard.run({ autoElevateOnStart: false }), 'skipped-disabled');
  assert.strictEqual(probed, 0);
});

test('run：请求提权抛错 → 记 error 但不抛，返回 request-failed', async () => {
  const { guard, log } = makeGuard({ elevated: false, throwOnRequest: true });
  assert.strictEqual(await guard.run(CFG), 'request-failed');
  assert.ok(log.lines.some((l) => l.level === 'error'));
});
