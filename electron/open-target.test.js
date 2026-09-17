const { test } = require('node:test');
const assert = require('node:assert');

const { resolveOpenAction } = require('./open-target.js');

/** 构造一个假的 statSync：只有 listed 中的路径存在 */
function fakeStat(map) {
  return (p) => {
    if (!(p in map)) {
      const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
      err.code = 'ENOENT';
      throw err;
    }
    const kind = map[p];
    return {
      isDirectory: () => kind === 'dir',
      isFile: () => kind === 'file',
    };
  };
}

test('目录路径 → folder', () => {
  const stat = fakeStat({ 'C:\\Windows\\Temp': 'dir' });
  assert.strictEqual(resolveOpenAction('C:\\Windows\\Temp', stat), 'folder');
});

test('文件路径 → file', () => {
  const stat = fakeStat({ 'C:\\hiberfil.sys': 'file' });
  assert.strictEqual(resolveOpenAction('C:\\hiberfil.sys', stat), 'file');
});

test('路径不存在 → missing', () => {
  const stat = fakeStat({});
  assert.strictEqual(resolveOpenAction('C:\\nope', stat), 'missing');
});

test('权限拒绝也算 missing（不抛异常）', () => {
  const stat = () => {
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    throw err;
  };
  assert.strictEqual(resolveOpenAction('C:\\System Volume Information', stat), 'missing');
});

test('statSync 抛非 Error 对象也不崩', () => {
  const stat = () => { throw 'boom'; };
  assert.strictEqual(resolveOpenAction('C:\\x', stat), 'missing');
});

test('空值 / 非字符串 / 空串 → missing', () => {
  const stat = fakeStat({});
  for (const bad of [null, undefined, '', '   ', 123, {}, []]) {
    assert.strictEqual(resolveOpenAction(bad, stat), 'missing', `输入 ${JSON.stringify(bad)}`);
  }
});

test('首尾空白被裁剪后再判断', () => {
  const stat = fakeStat({ 'C:\\Windows': 'dir' });
  assert.strictEqual(resolveOpenAction('  C:\\Windows \n', stat), 'folder');
});

test('既不是目录也不是文件（如设备/管道）→ missing', () => {
  const stat = () => ({ isDirectory: () => false, isFile: () => false });
  assert.strictEqual(resolveOpenAction('\\\\.\\pipe\\x', stat), 'missing');
});
