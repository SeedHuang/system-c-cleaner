const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWidgetState, saveWidgetState } = require('./widget-state');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'widget-state-')), name);
}

test('save 后 load 返回相同位置', () => {
  const f = tmpFile('a.json');
  assert.strictEqual(saveWidgetState(f, { x: 120, y: 80 }), true);
  assert.deepStrictEqual(loadWidgetState(f), { x: 120, y: 80 });
});

test('无文件返回 null', () => {
  const f = tmpFile('missing.json');
  assert.strictEqual(loadWidgetState(f), null);
});

test('损坏 JSON 返回 null', () => {
  const f = tmpFile('bad.json');
  fs.writeFileSync(f, '{not json', 'utf8');
  assert.strictEqual(loadWidgetState(f), null);
});

test('x/y 非数字返回 null', () => {
  const f = tmpFile('badtype.json');
  fs.writeFileSync(f, JSON.stringify({ x: 'abc', y: 80 }), 'utf8');
  assert.strictEqual(loadWidgetState(f), null);
});

test('x/y 非有限数返回 null', () => {
  const f = tmpFile('nan.json');
  fs.writeFileSync(f, JSON.stringify({ x: NaN, y: 80 }), 'utf8');
  assert.strictEqual(loadWidgetState(f), null);
});

test('save 目录不存在时自动创建', () => {
  const dir = path.join(os.tmpdir(), 'widget-state-' + Date.now(), 'nested');
  const f = path.join(dir, 'state.json');
  assert.strictEqual(saveWidgetState(f, { x: 5, y: 6 }), true);
  assert.deepStrictEqual(loadWidgetState(f), { x: 5, y: 6 });
});
