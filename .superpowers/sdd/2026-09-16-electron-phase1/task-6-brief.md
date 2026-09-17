# Task 6 Brief: server/history.js — HISTORY_DIR 可配置化

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务把 `server/history.js` 的历史快照目录改为可配置（跟随 `CLEANER_DATA_DIR`，默认项目根不变）。

前置：Task 2 已完成（`server/config.js` 导出 `resolvePaths`）。当前 `history.js` 顶部硬编码：

```js
const ROOT = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT, 'history');
```

## 本任务目标

- 顶部改用 `resolvePaths()`：`HISTORY_DIR = paths.historyDir`
- 对外函数签名全部不变（仍接受可选 `historyDir` 参数，默认 `HISTORY_DIR`）
- history.test.js 追加 1 个用例验证可配置性

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- **同一文件禁止并行 SearchReplace**；对 history.js 只改顶部常量区，其余逻辑逐字保留。
- 全路径日志：本任务不新增 catch 分支，但若改动涉及现有空吞 catch，需补日志。**注意：history.js 内 `readIndex` 有 `catch {}` 空吞——本任务范围仅限常量区改造，readIndex 的日志化不在本任务（避免扩大范围），但请在报告中确认它当前状态。**

## Step 1: 写失败测试（先锁定契约）

在 `server/tests/history.test.js` 末尾追加：

```js
test('resolvePaths.historyDir 与 HISTORY_DIR 一致（可配置）', () => {
  const { resolvePaths } = require('../config.js');
  const history = require('../history.js');
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud' });
  assert.strictEqual(p.historyDir, 'D:/ud/history');
});
```

Run: `node --test server/tests/history.test.js`
Expected: 本用例通过（它只验证 config 与常量一致——注意：若 HISTORY_DIR 尚未改造，默认模式时 `resolvePaths({CLEANER_DATA_DIR:'D:/ud'}).historyDir === 'D:/ud/history'` 而 `history.HISTORY_DIR`（若导出）可能不同；本用例断言的是 `p.historyDir` 值，与 history.js 是否导出 HISTORY_DIR 无关，因此改造前也会通过。**真正的验证点是改造后默认模式 `history.js` 的 `HISTORY_DIR` 不再依赖 `path.join(__dirname,'..')` 而是 `paths.historyDir`**，通过后续回归 + 手动读文件确认。）

## Step 2: 实现

`server/history.js` 顶部改为：

```js
const { resolvePaths } = require('./config');

const paths = resolvePaths();
const ROOT = paths.root;
const HISTORY_DIR = paths.historyDir;
```

删除原两行 `const ROOT = path.join(__dirname, '..');` 与 `const HISTORY_DIR = path.join(ROOT, 'history');`（由 paths 取代）。文件其余内容逐字保留。

## Step 3: 运行确认通过

Run: `node --test server/tests/history.test.js`
Expected: 全部通过（原有 5 个 + 新增 1 个）

## Step 4: 回归全部测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败——history/ 残留真实快照，临时改 history.bak/ 重跑后恢复，禁止删除数据）

## Step 5: 验证可配置生效（手动）

Run: `node -e "process.env.CLEANER_DATA_DIR='D:/ud'; const h=require('./server/history.js'); console.log(h.HISTORY_DIR)"`（若 HISTORY_DIR 未导出，改为读文件确认）
Expected: 输出 `D:\ud\history` 或 `D:/ud/history`（说明配置生效）

## 报告

完成后在报告中写明：
- history.js 顶部改造的 old → new
- 新增用例 + 全量回归结果
- Step 5 手动验证结果
- readIndex 空吞 catch 的当前状态确认
- 任何偏差
