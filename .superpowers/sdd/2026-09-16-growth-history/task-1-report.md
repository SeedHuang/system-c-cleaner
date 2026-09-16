# Task 1 Report: server/history.js 存储层

- 状态：DONE
- 日期：2026-09-16

## 实现内容

按简报 task-1-brief.md 逐字实现，共涉及 4 个文件：

### 1. 新建 `server/history.js`（数据层）

实现内容（module.exports 导出清单与简报一致）：

- `idFromDate(date)` — Date → 快照文件名 ID（格式 `YYYY-MM-DDTHH-mm-ss`，Windows 文件名不能含冒号）
- `readIndex(historyDir)` / `writeIndex(index, historyDir)` — 索引 `index.json` 的读取（含 BOM 容错、损坏时回退空索引）与写入
- `listSnapshots(historyDir)` — 列表 + 一致性校验：`.tsv.gz` 文件缺失的索引条目自动过滤并重写索引；返回 `{ snapshots, totalSizeMB }`
- `serializeDirMap(dirMap)` / `deserializeTsv(text)` — 目录 Map ↔ TSV 文本的纯函数互转（空字节数 → `null` 表示未扫描）
- `writeSnapshotGz(id, text, historyDir)` / `loadSnapshotMap(id, historyDir)` — gzip 快照文件写入/读取（Promise 封装，后续任务复用）
- `deleteSnapshots(filter, historyDir)` — 按 `ids` 优先，否则按 `year/month/day/hour/before` AND 筛选删除；返回 `{ deleted }`

导出的 9 个符号：`idFromDate, readIndex, writeIndex, listSnapshots, serializeDirMap, deserializeTsv, writeSnapshotGz, loadSnapshotMap, deleteSnapshots`。

### 2. 新建 `server/tests/history.test.js`（测试）

4 个用例（node:test 内置 runner，零依赖）：

1. `serialize/deserialize 往返（含未扫描 null）`
2. `listSnapshots 一致性校验过滤文件缺失项并重写索引`
3. `deleteSnapshots 按 ids 删除`
4. `deleteSnapshots 按 年/月/日/时 筛选删除`

### 3. 修改 `package.json`

scripts 新增：`"test": "node --test server/tests/"`

### 4. 修改 `.gitignore`

追加一行：`history/`

## 测试命令与输出

### TDD 第一步：写测试后运行（确认失败）

```
$ node --test server/tests/history.test.js
# Error: Cannot find module '../history.js'
# Require stack:
# - D:\Seed\system-c-cleaner\server\tests\history.test.js
# tests 1
# pass 0
# fail 1
```
符合预期（MODULE_NOT_FOUND）。

### TDD 第二步：实现后运行（确认通过）

```
$ node --test server/tests/history.test.js
TAP version 13
ok 1 - serialize/deserialize 往返（含未扫描 null）
ok 2 - listSnapshots 一致性校验过滤文件缺失项并重写索引
ok 3 - deleteSnapshots 按 ids 删除
ok 4 - deleteSnapshots 按 年/月/日/时 筛选删除
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 60.3265
```

结果：**4 个用例全部通过（pass 4 / fail 0），退出码 0**。

## 偏差与顾虑

- **无偏差**：两个新建文件均按简报逐字照抄；package.json / .gitignore 按简报要求追加，未改动其他内容。
- 未运行任何 git 命令（按简报要求跳过 commit 步骤）。
- 未安装任何 npm 依赖（zlib/fs/path 均为 Node 内置）；未运行 npm install / postinstall。
- 顾虑：无。`history/` 目录（快照存储目录）尚未创建——由后续任务（全树快照捕获）在首次写入时通过 `fs.mkdirSync({ recursive: true })` 自动创建，符合设计。
