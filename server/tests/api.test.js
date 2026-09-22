const os = require('os');
const path = require('path');
const fs = require('fs');

// 隔离数据目录：测试用独立临时目录，避免受真实 history/（验收扫描快照）污染，
// 也避免测试污染真实数据。必须在 require('../index.js') 之前设置（模块加载时解析 paths）。
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cdrive-test-'));
process.env.CLEANER_DATA_DIR = TEST_DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../index.js');

let server;
let base;

before(async () => {
  server = startServer(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ }
});

test('GET /api/status 正常返回', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok('hasResult' in body && 'scanning' in body);
});

test('GET /api/history 空历史返回空列表', async () => {
  const res = await fetch(`${base}/api/history`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.snapshots));
  assert.strictEqual(typeof body.totalSizeMB, 'number');
  assert.strictEqual(typeof body.historyDir, 'string'); // 用于「打开历史快照目录」按钮
});

test('GET /api/growth 无历史时 insufficient=true', async () => {
  const res = await fetch(`${base}/api/growth?window=1m`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
});

test('GET /api/growth 区间参数透传并回显', async () => {
  const res = await fetch(`${base}/api/growth?from=2026-09-01&to=2026-09-15`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
  assert.strictEqual(body.window, null);
  assert.strictEqual(body.rangeFrom, '2026-09-01');
  assert.strictEqual(body.rangeTo, '2026-09-15');
});

test('GET /api/growth/dir 区间参数透传并回显', async () => {
  const res = await fetch(`${base}/api/growth/dir?path=c%3A%5C&from=2026-09-01&to=2026-09-15`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
  assert.strictEqual(body.rangeFrom, '2026-09-01');
  assert.strictEqual(body.rangeTo, '2026-09-15');
});

test('GET /api/status 包含 elevatedScan 字段', async () => {
  const res = await fetch(`${base}/api/status`);
  const body = await res.json();
  assert.strictEqual(body.elevatedScan, 'idle');
});

test('buildElevateCommand 构造 UAC 命令', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345);
  assert.ok(cmd.includes('-Verb RunAs'));
  assert.ok(cmd.includes("'-OldPid','12345'"));
});

test('startElevateMonitor 存在且为函数', () => {
  const { startElevateMonitor } = require('../index.js');
  assert.strictEqual(typeof startElevateMonitor, 'function');
});

test('buildElevateCommand 指向 relaunch-admin 脚本', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(999);
  assert.ok(cmd.includes('relaunch-admin.ps1'));
});

test('buildElevateCommand 显式传入 FlagPath/ExePath（提权进程不继承环境变量）', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345, 'C:\\data\\.elevated-launch.flag', 'C:\\app\\Roberta.exe');
  assert.ok(cmd.includes("'-FlagPath','C:\\data\\.elevated-launch.flag'"));
  assert.ok(cmd.includes("'-ExePath','C:\\app\\Roberta.exe'"));
});

test('buildElevateCommand 未传路径时不追加可选参数', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345, '', '');
  assert.ok(!cmd.includes('-FlagPath'));
  assert.ok(!cmd.includes('-ExePath'));
});

test('buildElevateCommand hidden=true 追加 -Hidden（自启静默提权驻留托盘）', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345, 'C:\\f', 'C:\\e.exe', true);
  assert.ok(cmd.includes("'-Hidden'"));
  const cmd2 = buildElevateCommand(12345, 'C:\\f', 'C:\\e.exe');
  assert.ok(!cmd2.includes('-Hidden'));
});

test('buildElevateCommand 用 try/catch 暴露 UAC 拒绝（非 0 退出码）', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345, 'C:\\f', 'C:\\e.exe');
  assert.ok(cmd.startsWith('try {'));
  assert.ok(cmd.includes('exit 1'));
});

test('computePowerShellCandidate 拼接完整路径', () => {
  const { computePowerShellCandidate } = require('../index.js');
  assert.strictEqual(
    computePowerShellCandidate('C:\\Windows'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
});

test('resolvePowerShellPath 返回非空字符串', () => {
  const { resolvePowerShellPath } = require('../index.js');
  const p = resolvePowerShellPath();
  assert.strictEqual(typeof p, 'string');
  assert.ok(p.length > 0);
});
