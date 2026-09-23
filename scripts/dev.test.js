const test = require('node:test');
const assert = require('node:assert');
const { parseUmiPort } = require('./dev.js');

test('解析 Umi 输出框线中的 Local 端口', () => {
  const line = '║  >   Local: http://localhost:8001               ║';
  assert.strictEqual(parseUmiPort(line), 8001);
});

test('解析无框线的 Local 端口', () => {
  assert.strictEqual(parseUmiPort('App listening at: Local: http://localhost:8080'), 8080);
});

test('Network 行（非 localhost）不误报', () => {
  assert.strictEqual(parseUmiPort('Network: http://192.168.71.6:8001'), null);
});

test('无端口信息返回 null', () => {
  assert.strictEqual(parseUmiPort('info  - Umi v4.7.17'), null);
  assert.strictEqual(parseUmiPort(''), null);
});

test('端口含高位端口号', () => {
  assert.strictEqual(parseUmiPort('Local: http://localhost:65535'), 65535);
});

test('非字符串输入返回 null', () => {
  assert.strictEqual(parseUmiPort(undefined), null);
  assert.strictEqual(parseUmiPort(null), null);
});
