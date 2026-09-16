# Task 2 Report: buildSnapshot 全树快照捕获

状态：**DONE_WITH_CONCERNS**（见下方「偏差与顾虑」）

## 实现说明

在 `server/history.js`（Task 1 存储层）之上追加全树快照捕获能力：

1. **顶部 require**（现有 `fs/path/zlib` 之上）：
   - `const { spawn } = require('child_process');`
   - `const readline = require('readline');`

2. **新增三个函数**（位于 `deleteSnapshots` 之后、`module.exports` 之前）：
   - `accumulateLines(lines, state?)` —— 纯函数，流式解析 robocopy `/L` 文件行，自底向上累加目录大小，小写归一化，忽略 Bytes/Failed/失败 汇总行（仅匹配 Failed 计数）。
   - `runRobocopyTree()` —— 通过 `cmd.exe` 运行 `chcp 65001 & robocopy C:\ NULL /L /S /XJ /BYTES /FP /NDL /NJH /NP /NC /R:0 /W:0`（只读列表，UTF-8 输出），按行流式喂给 `accumulateLines`，返回 `{ dirMap, fileCount, failedCount }`。
   - `buildSnapshot({ scannedAt, disk }, historyDir)` —— 幂等生成全树快照：`idFromDate` → 查索引幂等 → `runRobocopyTree` → `writeSnapshotGz(id, serializeDirMap(dirMap))` → 计算 `fileSizeMB` → 组装 meta 写入索引并倒序排序。

3. **module.exports 追加**：`accumulateLines, buildSnapshot`（`runRobocopyTree` 为内部实现，未导出，与简报一致）。

4. **测试**：`server/tests/history.test.js` 末尾追加 `accumulateLines 自底向上累加 + 小写归一化 + 忽略汇总行` 用例（简报代码逐字）；已有 4 个用例未改动。

## 测试命令与输出

### TDD Step 2：确认失败（符合预期）

`node --test server/tests/history.test.js` → exit 1，`4 pass / 1 fail`，报 `history.accumulateLines is not a function`（`TypeError`）。

### TDD Step 4：实现后确认通过

`node --test server/tests/history.test.js` → exit 0：

```
# tests 5
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

5 个用例全部通过：
1. serialize/deserialize 往返（含未扫描 null）✓
2. listSnapshots 一致性校验过滤文件缺失项并重写索引 ✓
3. deleteSnapshots 按 ids 删除 ✓
4. deleteSnapshots 按 年/月/日/时 筛选删除 ✓
5. accumulateLines 自底向上累加 + 小写归一化 + 忽略汇总行 ✓

### 类型检查

`npx tsc --noEmit --pretty` → exit 0，无输出（无新增错误）。
注意：`tsconfig.json` 仅 include `src`/`config`/`typings.d.ts`，**不覆盖 `server/` 目录**，故 tsc 无法静态校验本任务改动的 JS 文件；本任务以 `node --test` 作为权威验证。

## 偏差与顾虑（重要）

### 唯一偏差：`accumulateLines` 根目录键的 1 行修正

简报 Step 3 的实现代码与简报 Step 1 的测试存在**内部不一致**：

- 简报实现（逐字）：`dirMap.set(acc, ...)`，其中 `acc = parts[0]`（即 `c:`，**无尾随反斜杠**）。
- 简报测试断言：`dirMap.get('c:\\')`（即 `c:\`，**带尾随反斜杠**）。

实际运行证明：按简报原样实现时第 5 个用例在 `c:\` 断言处失败（`undefined`，其余 3 个目录键断言均通过），即简报提供的实现代码无法通过简报提供的测试。

**处理**：完成标准明确要求「5 个用例全部通过」，且测试文件为简报契约不可改动，故对实现做最小修正——根目录键改为 `dirMap.set(acc + '\\', ...)`（仅 1 行）。修正后所有目录键统一为**尾随反斜杠**格式（`c:\`、`c:\users`、`c:\users\a`……），与下游趋势分析按 `c:\...` 前缀查询的约定一致，也与 `runRobocopyTree` 中 `/FP` 全路径输出一致。其余代码保持简报逐字。

**顾虑**：若简报作者本意是根目录键为 `c:`（无尾随反斜杠），则需同步修正测试断言；本任务按「完成标准优先」处理为 `c:\`。此差异会影响 Task 3（增长趋势）读取快照时根目录键的匹配方式，建议控制器确认。

### 其他

- 按简报要求：未运行 git（跳过 commit）、未安装 npm 依赖、未运行 robocopy 实扫（`buildSnapshot`/`runRobocopyTree` 为集成函数，本次仅由单测覆盖 `accumulateLines` 纯函数）。
- 未修改简报范围外文件；`history.test.js` 已有 4 个用例未动。
- `buildSnapshot`/`runRobocopyTree` 依赖 Windows `cmd.exe` + robocopy，跨平台（Linux/macOS）不可用——与简报设计一致（本工具为 C 盘分析）。
