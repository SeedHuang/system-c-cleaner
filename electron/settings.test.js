/**
 * settings.js 单测：默认值、残缺补齐、非法值回落、往返读写。
 * 配置非法不能让应用崩溃 —— 一律回落默认值。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { loadSettings, saveSettings, DEFAULTS } = require('./settings');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdrive-settings-'));
  return path.join(dir, 'settings.json');
}

function writeCfg(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
}

test('DEFAULTS 含 Phase 4 全部字段与确认过的默认值', () => {
  assert.strictEqual(DEFAULTS.autoScan, true);
  assert.strictEqual(DEFAULTS.autoElevateOnStart, true);
  assert.strictEqual(DEFAULTS.startDelayMin, 3);
  assert.strictEqual(DEFAULTS.intervalHours, 12);
  assert.strictEqual(DEFAULTS.dailyAt, '09:00');
  assert.strictEqual(DEFAULTS.minGapMin, 60);
  assert.strictEqual(DEFAULTS.lowSpacePct, 10);
  assert.strictEqual(DEFAULTS.growthWarnGB, 2);
  assert.strictEqual(DEFAULTS.notifyEveryScan, true);
  assert.strictEqual(DEFAULTS.widgetVisible, true);
});

test('无文件 → 返回默认值（且为副本，不共享引用）', () => {
  const s = loadSettings(tmpFile());
  assert.deepStrictEqual(s, DEFAULTS);
  assert.notStrictEqual(s, DEFAULTS);
});

test('损坏 JSON → 回落到默认值', () => {
  const f = tmpFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{ 这不是 JSON', 'utf8');
  assert.deepStrictEqual(loadSettings(f), DEFAULTS);
});

test('残缺文件 → 缺失字段补默认值，已给字段保留', () => {
  const f = tmpFile();
  writeCfg(f, { intervalHours: 6, autoScan: false });
  const s = loadSettings(f);
  assert.strictEqual(s.intervalHours, 6);
  assert.strictEqual(s.autoScan, false);
  assert.strictEqual(s.startDelayMin, DEFAULTS.startDelayMin);
  assert.strictEqual(s.dailyAt, DEFAULTS.dailyAt);
});

test('非法值 → 逐字段回落默认值', () => {
  const f = tmpFile();
  writeCfg(f, {
    autoScan: 'yes',
    autoElevateOnStart: 1,
    startDelayMin: -5,
    intervalHours: 0,
    dailyAt: '25:00',
    minGapMin: 99999,
    lowSpacePct: 0,
    growthWarnGB: -1,
    notifyEveryScan: null,
  });
  assert.deepStrictEqual(loadSettings(f), DEFAULTS);
});

test('dailyAt 支持合法 HH:mm，非法格式回落', () => {
  const f = tmpFile();
  writeCfg(f, { dailyAt: '23:59' });
  assert.strictEqual(loadSettings(f).dailyAt, '23:59');
  writeCfg(f, { dailyAt: '9:00' });
  assert.strictEqual(loadSettings(f).dailyAt, DEFAULTS.dailyAt);
});

test('未知字段被忽略（不污染配置）', () => {
  const f = tmpFile();
  writeCfg(f, { intervalHours: 8, hacker: 'x' });
  const s = loadSettings(f);
  assert.strictEqual(s.intervalHours, 8);
  assert.ok(!('hacker' in s));
});

test('saveSettings 合并写回并可再读出', () => {
  const f = tmpFile();
  assert.strictEqual(saveSettings(f, { lowSpacePct: 20 }), true);
  const s = loadSettings(f);
  assert.strictEqual(s.lowSpacePct, 20);
  assert.strictEqual(s.intervalHours, DEFAULTS.intervalHours);
  saveSettings(f, { autoScan: false });
  const s2 = loadSettings(f);
  assert.strictEqual(s2.autoScan, false);
  assert.strictEqual(s2.lowSpacePct, 20);
  saveSettings(f, { widgetVisible: false });
  assert.strictEqual(loadSettings(f).widgetVisible, false);
  saveSettings(f, { widgetVisible: true });
  assert.strictEqual(loadSettings(f).widgetVisible, true);
});

test('saveSettings 自动创建目录，写入失败返回 false 不抛错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdrive-settings-'));
  const f = path.join(dir, 'nested', 'deep', 'settings.json');
  assert.strictEqual(saveSettings(f, { autoScan: false }), true);
  assert.strictEqual(fs.existsSync(f), true);
  assert.strictEqual(saveSettings(path.join(dir, 'nested'), { autoScan: true }), false);
});
