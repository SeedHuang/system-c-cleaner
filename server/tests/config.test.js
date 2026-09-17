const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolvePaths } = require('../config.js');

test('默认值：无 CLEANER_* 时全部指向项目根', () => {
  const p = resolvePaths({});
  assert.strictEqual(p.dataDir, path.resolve(__dirname, '..', '..'));
  assert.strictEqual(p.scriptsDir, path.join(path.resolve(__dirname, '..', '..'), 'scripts'));
  assert.strictEqual(p.logDir, path.join(p.dataDir, 'logs'));
  assert.strictEqual(p.resultFile, path.join(p.dataDir, 'scan-result.json'));
  assert.strictEqual(p.historyDir, path.join(p.dataDir, 'history'));
  assert.strictEqual(p.elevateFlag, path.join(p.dataDir, 'history', '.elevated-launch.flag'));
  assert.ok(p.psScript.endsWith(path.join('scripts', 'scan-c.ps1')));
  assert.ok(p.elevateScript.endsWith(path.join('scripts', 'relaunch-admin.ps1')));
});

test('打包注入：CLEANER_DATA_DIR / CLEANER_SCRIPTS_DIR 优先', () => {
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud', CLEANER_SCRIPTS_DIR: 'D:/res/scripts' });
  assert.strictEqual(p.dataDir, 'D:/ud');
  assert.strictEqual(p.historyDir, path.join('D:/ud', 'history'));
  assert.strictEqual(p.resultFile, path.join('D:/ud', 'scan-result.json'));
  assert.strictEqual(p.elevateFlag, path.join('D:/ud', '.elevated-launch.flag'));
  assert.strictEqual(p.psScript, path.join('D:/res/scripts', 'scan-c.ps1'));
  assert.strictEqual(p.elevateScript, path.join('D:/res/scripts', 'relaunch-admin.ps1'));
});
