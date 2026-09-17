# Task 2 Brief: server/config.js — 路径解析单一来源（TDD）

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务创建路径解析模块 `server/config.js`（单一来源，server 与 electron 主进程共用），通过环境变量 `CLEANER_*` 实现"开发默认项目根、打包后指向 userData"。

前置：Task 1 已完成（package.json 含 electron 三件套 devDependencies；npm install 成功；`npm run tsc` 零错误；`npm test` 18 用例，其中 1 个环境性失败与 history/ 目录残留真实快照有关）。

## 本任务目标

按 TDD 流程（先写失败测试 → 确认失败 → 实现 → 确认通过）创建：
- `server/config.js`：导出 `resolvePaths(env = process.env)`
- `server/tests/config.test.js`：2 个测试用例

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- TDD 顺序：先写测试 → 跑确认失败 → 实现 → 跑确认通过 → 回归 npm test。
- 新增代码每个 `catch`/失败分支必须有日志或明确降级处理（本任务为纯函数无 I/O，无 catch 需求）。
- 同一文件多处修改合并为一次编辑。

## 环境注意事项

- 跑 `npm test`（全量回归）时，若 api.test.js 的「无历史时 insufficient=true」用例失败，是因为 `history/` 目录残留真实快照（环境性失败，非代码缺陷）。处理：临时把 `history/` 改名为 `history.bak/` 再跑 `npm test`，通过后改回原名。**不要删除任何数据。**
- 本任务单测单独跑：`node --test server/tests/config.test.js`（不受 history/ 影响）。

## Step 1: 写失败测试

创建 `server/tests/config.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolvePaths } = require('../config.js');

test('默认值：无 CLEANER_* 时全部指向项目根', () => {
  const p = resolvePaths({});
  assert.strictEqual(p.dataDir, path.resolve(__dirname, '..'));
  assert.strictEqual(p.scriptsDir, path.join(path.resolve(__dirname, '..'), 'scripts'));
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
```

## Step 2: 运行确认失败

Run: `node --test server/tests/config.test.js`
Expected: FAIL（`Cannot find module '../config.js'`）

## Step 3: 实现

创建 `server/config.js`：

```js
/**
 * C 盘分析 - 路径与配置解析（单一来源，server 与 electron 主进程共用）
 * 开发/独立运行默认写项目根；打包后由 electron/main.js 注入 CLEANER_* 环境变量。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function resolvePaths(env = process.env) {
  const dataDir = env.CLEANER_DATA_DIR || ROOT;
  const scriptsDir = env.CLEANER_SCRIPTS_DIR || path.join(ROOT, 'scripts');
  return {
    root: ROOT,
    dataDir,
    scriptsDir,
    logDir: env.CLEANER_LOG_DIR || path.join(dataDir, 'logs'),
    resultFile: path.join(dataDir, 'scan-result.json'),
    historyDir: path.join(dataDir, 'history'),
    // 与 relaunch-admin.ps1 的 flag 写入位置必须一致：
    // 注入模式 = dataDir 根；默认模式 = root/history（维持现有行为）
    elevateFlag: env.CLEANER_DATA_DIR
      ? path.join(dataDir, '.elevated-launch.flag')
      : path.join(ROOT, 'history', '.elevated-launch.flag'),
    psScript: path.join(scriptsDir, 'scan-c.ps1'),
    elevateScript: path.join(scriptsDir, 'relaunch-admin.ps1'),
  };
}

module.exports = { resolvePaths, ROOT };
```

## Step 4: 运行确认通过

Run: `node --test server/tests/config.test.js`
Expected: PASS（2 个用例）

## Step 5: 回归既有测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败，按上文处理 history/ 后重跑）

## 报告

完成后在报告中写明：
- 测试先失败后通过的证据（各命令输出摘要）
- `npm test` 回归结果
- 任何偏差
