const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../../electron/logger.js');

function memoryLog() {
  const lines = [];
  return { lines, write: (l) => lines.push(l), console: { log() {}, error() {} } };
}

test('行格式：时间戳 + 级别 + 模块 + 消息 + detail', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.info('main', '启动完成', { port: 8090 });
  assert.match(m.lines[0], /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[main\] 启动完成 \{"port":8090\}$/);
});

test('error 传 Error 时追加堆栈行', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.error('server', '扫描失败', new Error('exit 1'));
  assert.match(m.lines[0], /\[ERROR\] \[server\] 扫描失败: exit 1$/);
  assert.ok(m.lines.some((l) => l.includes('堆栈: Error: exit 1')));
});

test('写文件抛错时降级 console 不向上抛', () => {
  const m = memoryLog();
  const errors = [];
  m.console.error = (x) => errors.push(x);
  const log = createLogger({ write: () => { throw new Error('disk full'); }, console: m.console });
  assert.doesNotThrow(() => log.info('main', 'hi'));
  assert.ok(errors.some((x) => x.includes('disk full')));
});
