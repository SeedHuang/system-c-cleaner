const { test } = require('node:test');
const assert = require('node:assert');
const { createAutostart } = require('./autostart');

function makeApp({ isPackaged = true, openAtLogin = false } = {}) {
  const calls = [];
  return {
    isPackaged,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (opts) => calls.push(opts),
    __calls: calls,
  };
}

function makeLog() {
  const lines = [];
  return {
    info: (...args) => lines.push(['info', ...args]),
    warn: (...args) => lines.push(['warn', ...args]),
    error: (...args) => lines.push(['error', ...args]),
    __lines: lines,
  };
}

test('开发模式 isEnabled 返回 false', () => {
  const app = makeApp({ isPackaged: false, openAtLogin: true });
  const a = createAutostart({ app, log: makeLog() });
  assert.strictEqual(a.isEnabled(), false);
});

test('开发模式 setEnabled 不调用 setLoginItemSettings 且记 warn 日志', () => {
  const app = makeApp({ isPackaged: false });
  const log = makeLog();
  const a = createAutostart({ app, log });
  assert.strictEqual(a.setEnabled(true), false);
  assert.strictEqual(app.__calls.length, 0);
  assert.ok(log.__lines.some((l) => l[0] === 'warn' && l[1] === 'autostart'));
});

test('打包模式 isEnabled 透传 getLoginItemSettings().openAtLogin', () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true });
  const a = createAutostart({ app, log: makeLog() });
  assert.strictEqual(a.isEnabled(), true);
});

test('打包模式 setEnabled(true) 调用 setLoginItemSettings 且带 --hidden', () => {
  const app = makeApp({ isPackaged: true });
  const a = createAutostart({ app, log: makeLog() });
  assert.strictEqual(a.setEnabled(true), true);
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: true, args: ['--hidden'] }]);
});

test('打包模式 setEnabled(false) 调用 setLoginItemSettings', () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true });
  const a = createAutostart({ app, log: makeLog() });
  assert.strictEqual(a.setEnabled(false), true);
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }]);
});
