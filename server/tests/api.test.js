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

after(() => server.close());

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
});

test('GET /api/growth 无历史时 insufficient=true', async () => {
  const res = await fetch(`${base}/api/growth?window=1m`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
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
