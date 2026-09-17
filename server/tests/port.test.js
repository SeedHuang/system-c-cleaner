const { test } = require('node:test');
const assert = require('node:assert');
const { startWithFallback } = require('../../electron/port.js');

test('首选端口可用时直接返回', async () => {
  const r = await startWithFallback(8090, async (p) => ({ p }));
  assert.deepStrictEqual(r, { port: 8090, server: { p: 8090 } });
});

test('EADDRINUSE 时退避到下一个端口', async () => {
  const tryListen = async (p) => {
    if (p === 8090) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
    return { p };
  };
  const r = await startWithFallback(8090, tryListen);
  assert.strictEqual(r.port, 8091);
});

test('全部占用时抛出最后一个错误', async () => {
  const tryListen = async (p) => { throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' }); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 3), /in use/);
});

test('非 EADDRINUSE 错误直接抛出不重试', async () => {
  const tryListen = async () => { throw new Error('boom'); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 5), /boom/);
});
