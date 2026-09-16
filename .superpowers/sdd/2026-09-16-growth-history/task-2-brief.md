# Task 2 Brief: buildSnapshot 全树快照捕获

项目：d:\Seed\system-c-cleaner（C 盘分析工具）。本任务在 Task 1 已建的 `server/history.js`（存储层，已实现 `serializeDirMap/writeSnapshotGz/readIndex/writeIndex/idFromDate` 等并导出）之上，追加全树快照捕获能力。

## 环境注意（重要）

- **禁止 git**：本环境 git 不可用，跳过简报中的所有 commit 步骤。
- 运行测试：`npm test`（即 `node --test "server/tests/*.test.js"`）或 `node --test server/tests/history.test.js`。
- 禁止安装 npm 依赖；不运行 npm install / postinstall。
- 文件编辑用 Write/SearchReplace 工具。
- `server/history.js` 顶部目前只有 `const fs = require('fs'); const path = require('path'); const zlib = require('zlib');`——本任务需要在其上方追加两个 require（child_process 的 spawn、readline）。module.exports 里追加 `accumulateLines, buildSnapshot`。

## Files

- Modify: `server/history.js`
- Modify: `server/tests/history.test.js`

## Interfaces

- Consumes: Task 1 已导出的 `serializeDirMap`、`writeSnapshotGz`、`readIndex`、`writeIndex`、`idFromDate`
- Produces:
  - `accumulateLines(lines: string[], state?) → { dirMap: Map<string, number>, fileCount: number, failedCount: number }`（纯函数，可增量传入 state；state 默认 `{ dirMap: new Map(), fileCount: 0, failedCount: 0 }`）
  - `buildSnapshot({ scannedAt, disk }, historyDir = HISTORY_DIR) → Promise<SnapshotMeta>`（跑 robocopy 全树列表、自底向上累加、写 `history/<id>.tsv.gz`、更新索引；同一 id 重复调用幂等返回已有 meta）

## Steps

### Step 1: 写失败测试

在 `server/tests/history.test.js` 末尾追加（注意文件顶部需已有 `const fs = require('fs'); const os = require('os'); const path = require('path');`——Task 1 已具备；若缺则补上）：

```js
test('accumulateLines 自底向上累加 + 小写归一化 + 忽略汇总行', () => {
  const lines = [
    '    1048576  C:\\Users\\A\\AppData\\x.bin',
    '    2048  C:\\Users\\A\\y.txt',
    '    100  C:\\z.txt',
    '    Bytes : 12345',
    '    Failed : 5',
    '    失败 : 5',
  ];
  const { dirMap, fileCount, failedCount } = history.accumulateLines(lines);
  assert.strictEqual(fileCount, 3);
  assert.strictEqual(failedCount, 5);
  assert.strictEqual(dirMap.get('c:\\users\\a\\appdata'), 1048576);
  assert.strictEqual(dirMap.get('c:\\users\\a'), 1048576 + 2048);
  assert.strictEqual(dirMap.get('c:\\users'), 1048576 + 2048);
  assert.strictEqual(dirMap.get('c:\\'), 1048576 + 2048 + 100);
  assert.strictEqual(dirMap.has('c:\\users\\a\\x.bin'), false); // 文件本身不入目录表
});
```

### Step 2: 运行测试确认失败

Run: `node --test server/tests/history.test.js`
Expected: FAIL，报 `history.accumulateLines is not a function`

### Step 3: 实现

在 `server/history.js` 顶部（现有 require 之上）加：

```js
const { spawn } = require('child_process');
const readline = require('readline');
```

在文件内（`deleteSnapshots` 之后、`module.exports` 之前）追加：

```js
/**
 * robocopy /L 文件行 → 自底向上累加目录大小。
 * 行格式与 scripts/scan-c.ps1 的大文件解析一致（实机验证）："<size>   <full path>"。
 * 汇总行（Bytes/Failed/失败）匹配 Failed 计数，其余忽略。
 */
function accumulateLines(lines, state = { dirMap: new Map(), fileCount: 0, failedCount: 0 }) {
  const { dirMap } = state;
  const reFile = /^\s*(\d[\d,]*)\s+(\S.*)$/;
  const reFailed = /^\s*(?:Failed|失败)\s*:\s*(\d+)/;
  for (const line of lines) {
    const fm = line.match(reFailed);
    if (fm) { state.failedCount = Number(fm[1]); continue; }
    const m = line.match(reFile);
    if (!m) continue;
    const size = Number(m[1].replace(/,/g, ''));
    const filePath = m[2].trim().toLowerCase();
    if (!filePath) continue;
    state.fileCount++;
    const parts = filePath.split('\\');
    let acc = parts[0] || '';
    dirMap.set(acc, (dirMap.get(acc) || 0) + size);
    for (let i = 1; i < parts.length - 1; i++) {
      acc += '\\' + parts[i];
      dirMap.set(acc, (dirMap.get(acc) || 0) + size);
    }
  }
  return state;
}

/** 只读列出全盘文件（robocopy /L），流式累加目录大小 */
function runRobocopyTree() {
  return new Promise((resolve, reject) => {
    // chcp 65001：让 robocopy 以 UTF-8 输出，避免中文路径在管道中变 GBK 乱码
    const cmd = 'chcp 65001 >nul & robocopy C:\\ NULL /L /S /XJ /BYTES /FP /NDL /NJH /NP /NC /R:0 /W:0';
    const child = spawn('cmd.exe', ['/d', '/c', cmd], { windowsHide: true });
    const state = { dirMap: new Map(), fileCount: 0, failedCount: 0 };
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => accumulateLines([line], state));
    child.on('error', reject);
    child.on('close', () => resolve(state));
  });
}

/** 扫描完成后生成一次全树快照：写 history/<id>.tsv.gz + 更新索引（幂等） */
async function buildSnapshot({ scannedAt, disk } = {}, historyDir = HISTORY_DIR) {
  const id = idFromDate(new Date(scannedAt.replace(' ', 'T')));
  const idx = readIndex(historyDir);
  const existed = idx.snapshots.find((s) => s.id === id);
  if (existed) return existed; // 同一时刻重复扫描：幂等返回
  const { dirMap, fileCount, failedCount } = await runRobocopyTree();
  await writeSnapshotGz(id, serializeDirMap(dirMap), historyDir);
  const fileSizeMB = +(fs.statSync(path.join(historyDir, `${id}.tsv.gz`)).size / (1024 * 1024)).toFixed(1);
  const meta = {
    id, scannedAt, disk,
    dirCount: dirMap.size,
    fileCount,
    fileSizeMB,
    unscannedDirs: failedCount,
    warning: null,
  };
  idx.snapshots.push(meta);
  idx.snapshots.sort((a, b) => new Date(b.scannedAt.replace(' ', 'T')) - new Date(a.scannedAt.replace(' ', 'T')));
  writeIndex(idx, historyDir);
  return meta;
}
```

在 `module.exports` 对象中追加：`accumulateLines, buildSnapshot`。

### Step 4: 运行测试确认通过

Run: `node --test server/tests/history.test.js`
Expected: PASS（5 个用例）

### Step 5: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-2-report.md` 写入完整报告（实现说明、测试命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、测试摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要运行 robocopy 实扫（buildSnapshot 是集成函数，单测只覆盖 accumulateLines 纯函数）。
