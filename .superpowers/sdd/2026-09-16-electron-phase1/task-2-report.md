# Task 2 Report: server/config.js — 路径解析单一来源（TDD）

日期：2026-09-16
状态：DONE_WITH_CONCERNS（含 1 处简报代码修正，详见「偏差」）

## 交付物

- `server/config.js`：导出 `resolvePaths(env = process.env)` 与 `ROOT`。默认模式（无 `CLEANER_*`）全部指向项目根；注入模式（`CLEANER_DATA_DIR` / `CLEANER_SCRIPTS_DIR`）优先使用注入值。`elevateFlag` 按模式区分位置：注入 = dataDir 根，默认 = root/history（与 relaunch-admin.ps1 及 server/index.js 现有行为一致）。
- `server/tests/config.test.js`：2 个用例（默认值 / 打包注入）。

## TDD 证据

### Step 2 失败证据（实现前）

命令：`node --test server/tests/config.test.js`
结果：退出码 1，**fail 1 / pass 0**。

```
# Error: Cannot find module '../config.js'
# Require stack:
# - D:\\Seed\\system-c-cleaner\\server\\tests\\config.test.js
#   code: 'MODULE_NOT_FOUND'
not ok 1 - server\\tests\\config.test.js
# pass 0
# fail 1
```

### Step 4 通过证据（实现后）

命令：`node --test server/tests/config.test.js`
结果：退出码 0，**pass 2 / fail 0**。

```
ok 1 - 默认值：无 CLEANER_* 时全部指向项目根
ok 2 - 打包注入：CLEANER_DATA_DIR / CLEANER_SCRIPTS_DIR 优先
1..2
# tests 2
# pass 2
# fail 0
```

## 回归结果

命令：`npm test`（`node --test "server/tests/*.test.js"`）

- 首次运行：**20 用例，pass 19 / fail 1**。唯一失败为 api.test.js「GET /api/growth 无历史时 insufficient=true」（`false !== true`），系 `history/` 目录残留 2 条真实快照导致的环境性失败，非本次代码引入。
- 按简报处理：临时 `history/` → `history.bak/` 后重跑，**20 用例全部通过（pass 20 / fail 0）**；随后改回原名。数据完整保留（index.json + 2 个 .tsv.gz 均未删除，已用 Glob 复核）。

## 偏差

1. **测试代码路径计算修正（唯一代码偏差）**：简报给出的测试中，默认值用例用 `path.resolve(__dirname, '..')` 期望 `dataDir` 等于项目根；但测试文件位于 `server/tests/`，`__dirname` 的上一级实际是 `server/` 而非项目根，导致断言值与实现（`ROOT = path.resolve(__dirname, '..')` = 项目根 `D:\Seed\system-c-cleaner`）冲突，首次实现后运行出现 1 处 AssertionError。经核对 `server/index.js`（`ROOT = path.join(__dirname, '..')`，scan-result.json、scripts、history 均位于项目根）与 `server/history.js`（`HISTORY_DIR = path.join(ROOT, 'history')`），确认「数据目录 = 项目根」是实际行为、实现语义正确，属简报测试笔误。按简报第 5 条「以实际为准并记录偏差」，将测试断言改为 `path.resolve(__dirname, '..', '..')`（项目根），测试意图不变。实现代码未改动，与简报逐字一致。

2. 环境性失败处理（按简报预期执行，非偏差，记录在案）：上述 api.test.js 用例的失败与恢复过程。

## 其他

- 未执行任何 git 写命令（无 commit）。
- 实现为纯函数，无 I/O、无 catch 分支，满足约束。
- 未触碰 `history/` 数据内容（仅临时改名并恢复）。
