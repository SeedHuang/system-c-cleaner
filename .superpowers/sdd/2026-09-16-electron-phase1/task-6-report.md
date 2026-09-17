# Task 6 Report: server/history.js — HISTORY_DIR 可配置化

状态：**DONE**

## 1. history.js 顶部改造（old → new）

文件：`d:\Seed\system-c-cleaner\server\history.js`

old（原顶部常量区，第 12-13 行）：
```js
const ROOT = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT, 'history');
```

new（改造后）：
```js
const { resolvePaths } = require('./config');

const paths = resolvePaths();
const ROOT = paths.root;
const HISTORY_DIR = paths.historyDir;
```

其余文件内容逐字保留。对外函数签名全部不变（仍接受可选 `historyDir` 参数，默认 `HISTORY_DIR`）。

关于 `require('path')`：history.js 中 `path.join(historyDir, ...)` 等仍被大量使用（readIndex/writeIndex/listSnapshots/writeSnapshotGz/loadSnapshotMap/deleteSnapshots/buildSnapshot 等），因此 **`require('path')` 保留**，未删除（最小改动，符合简报约束 3）。

关于 `ROOT`：改造后 `ROOT = paths.root`（= config.js 中 `path.resolve(__dirname, '..')` = 项目根），语义与原来完全一致。全文确认 `ROOT` 仅在第 15 行定义、无其他引用，保留无害。

## 2. 新增用例 + 全量回归结果

### 新增用例（server/tests/history.test.js 末尾追加）
```js
test('resolvePaths.historyDir 与 HISTORY_DIR 一致（可配置）', () => {
  const { resolvePaths } = require('../config.js');
  const history = require('../history.js');
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud' });
  // 偏差：简报断言 'D:/ud/history'，但 Windows 上 path.join 会把正斜杠规范化为反斜杠（'D:\\ud\\history'）
  assert.strictEqual(p.historyDir, path.join('D:/ud', 'history'));
});
```

### 结果
- Step 3（单文件）：`node --test server/tests/history.test.js` → **14/14 通过**（原 13 个 + 新增 1 个）
  - 注：简报写「原有 5 个 + 新增 1 个」，实际 history.test.js 原有 **13** 个用例（偏差，见第 5 节）。
- Step 4（全量回归）：`npm test`（= `node --test "server/tests/*.test.js"`）
  - 首跑 29/30 失败 1：`api.test.js`「GET /api/growth 无历史时 insufficient=true」——**环境性失败**，因 history/ 残留 2 个真实快照（2026-09-16T18-34-49.tsv.gz、2026-09-16T18-37-08.tsv.gz + index.json）。
  - 按简报约束 4：临时将 `history/` 改名为 `history.bak/` 后重跑 → **30/30 全部通过**。
  - 通过后恢复原名 `history.bak/` → `history/`，已确认：history/ 下 3 个文件完整恢复，history.bak 已不存在。**未删除任何数据。**

## 3. Step 5 手动验证可配置生效（结果）

`HISTORY_DIR` 未在 module.exports 导出，按简报改为「读文件确认 + 行为级验证」：

```
node -e "process.env.CLEANER_DATA_DIR='D:/ud'; ... h.readIndex() ..."
```

结果：
- history.js 顶部源码确认：`const { resolvePaths } = require('./config'); const paths = resolvePaths(); const ROOT = paths.root; const HISTORY_DIR = paths.historyDir;`
- 行为级验证：设置 `CLEANER_DATA_DIR='D:/ud'` 后，默认 `readIndex()`（不传参，走 `HISTORY_DIR`）读到 **0 个**快照（指向 D:/ud/history，该目录无 index.json）；对照显式传项目根 `./history` 读到 **2 个**真实快照。
- **结论：配置生效**，`HISTORY_DIR` 已跟随 `CLEANER_DATA_DIR`（默认模式仍为项目根 history，维持现有行为）。

## 4. readIndex 空吞 catch 当前状态确认

`server/history.js` 第 23-30 行 `readIndex`：
```js
function readIndex(historyDir = HISTORY_DIR) {
  try {
    const raw = fs.readFileSync(path.join(historyDir, 'index.json'), 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.snapshots)) return data;
  } catch {}
  return { snapshots: [] };
}
```

确认：`catch {}` 仍是**空吞、无任何日志输出**。本任务范围仅限顶部常量区改造，readIndex 的日志化**未做**（简报明确不在本任务，避免扩大范围），保持原状。如需日志化应在后续专门任务处理。

## 5. 偏差记录

1. **简报用例断言与 Windows 实际行为冲突**：简报 Step 1 用例断言 `p.historyDir === 'D:/ud/history'`（正斜杠），但 Windows 上 `path.join('D:/ud', 'history')` 会规范化输出 `D:\ud\history`（反斜杠），首跑该用例失败（expected 'D:/ud/history' vs actual 'D:\\ud\\history'）。按「以实际为准」修正为 `assert.strictEqual(p.historyDir, path.join('D:/ud', 'history'))`（跨平台正确），并在用例内加了注释说明。
2. **简报用例数量描述不准确**：简报 Step 3 写「原有 5 个 + 新增 1 个」，实际 history.test.js 原有 **13** 个用例，新增后共 **14** 个。
3. **简报 Step 5 命令的前提**：简报提供 `console.log(h.HISTORY_DIR)`，但 `HISTORY_DIR` 未导出；按简报注明的回退路径（「若 HISTORY_DIR 未导出，改为读文件确认」）执行，并额外做了行为级验证（见第 3 节）。

## 6. 未执行项确认

- 未执行任何 git 写命令（无 commit、无 push）。✔
- 同一文件未并行 SearchReplace（history.js 与 history.test.js 各只编辑一次/两次串行，无并行冲突）。✔
