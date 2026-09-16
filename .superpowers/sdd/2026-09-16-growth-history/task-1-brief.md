# Task 1 Brief: server/history.js 存储层（索引 + 快照序列化/读写 + 一致性校验 + 删除）

项目：d:\Seed\system-c-cleaner（C 盘分析工具，umi/max + antd5 前端 + 原生 Node http 服务 + PowerShell/robocopy 只读扫描引擎）。本任务是「历史快照与增长趋势」子系统的第一个任务，只做后端数据层。后续任务会在此文件追加全树快照捕获与增长分析函数——请严格按本简报的导出清单实现，勿做超出范围的事。

## 环境注意（重要）

- **禁止 git**：本环境 git 不可用，跳过简报中的所有 commit 步骤。不要运行任何 git 命令。
- 运行测试用：`node --test server/tests/history.test.js`（Node 22 内置 test runner，无需安装依赖）。
- 不安装任何新 npm 依赖（zlib/fs/path 均为 Node 内置）。
- 文件编辑用 Write/SearchReplace 工具直接写盘。

## Files

- Create: `server/history.js`
- Create: `server/tests/history.test.js`
- Modify: `package.json`（scripts 加 `"test": "node --test server/tests/"`）
- Modify: `.gitignore`（追加一行 `history/`）

## Interfaces

- Consumes: 无
- Produces（本任务，导出到 module.exports）：
  - `serializeDirMap(dirMap: Map<string, number|null>) → string`（纯函数）
  - `deserializeTsv(text: string) → Map<string, number|null>`（纯函数；空字节数 → null 表示未扫描）
  - `readIndex(historyDir = HISTORY_DIR) → { snapshots: SnapshotMeta[] }`
  - `writeIndex(index, historyDir = HISTORY_DIR)`
  - `listSnapshots(historyDir = HISTORY_DIR) → { snapshots: SnapshotMeta[], totalSizeMB: number }`（一致性校验：文件缺失的条目自动过滤并重写索引）
  - `deleteSnapshots(filter, historyDir = HISTORY_DIR) → { deleted: number }`
  - `SnapshotMeta = { id, scannedAt, disk:{totalGB,usedGB,freeGB}, dirCount, fileCount, fileSizeMB, unscannedDirs, warning: string|null }`
  - 另导出内部工具 `idFromDate(date)`（供后续任务复用；文件名 ID 格式 `YYYY-MM-DDTHH-mm-ss`，Windows 文件名不能含冒号）

## Steps

### Step 1: 写失败测试

创建 `server/tests/history.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const history = require('../history.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hist-')); }

test('serialize/deserialize 往返（含未扫描 null）', () => {
  const map = new Map([
    ['c:\\', 1000],
    ['c:\\users', 600],
    ['c:\\users\\a', 100],
    ['c:\\lock', null],
  ]);
  const back = history.deserializeTsv(history.serializeDirMap(map));
  assert.strictEqual(back.size, 4);
  assert.strictEqual(back.get('c:\\'), 1000);
  assert.strictEqual(back.get('c:\\lock'), null);
});

test('listSnapshots 一致性校验过滤文件缺失项并重写索引', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ snapshots: [
    { id: 'a', scannedAt: '2026-09-01 10:00:00', fileSizeMB: 1 },
    { id: 'b', scannedAt: '2026-09-02 10:00:00', fileSizeMB: 2 },
  ] }));
  fs.writeFileSync(path.join(dir, 'a.tsv.gz'), 'x'); // b 文件缺失
  const r = history.listSnapshots(dir);
  assert.deepStrictEqual(r.snapshots.map((s) => s.id), ['a']);
  assert.strictEqual(r.totalSizeMB, 1);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.snapshots.map((s) => s.id), ['a']);
});

test('deleteSnapshots 按 ids 删除', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ snapshots: [
    { id: 'a', scannedAt: '2026-09-01 10:00:00', fileSizeMB: 1 },
    { id: 'b', scannedAt: '2026-09-10 10:00:00', fileSizeMB: 2 },
  ] }));
  fs.writeFileSync(path.join(dir, 'a.tsv.gz'), 'x');
  fs.writeFileSync(path.join(dir, 'b.tsv.gz'), 'x');
  const r = history.deleteSnapshots({ ids: ['a'] }, dir);
  assert.strictEqual(r.deleted, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'a.tsv.gz')));
  assert.ok(fs.existsSync(path.join(dir, 'b.tsv.gz')));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.snapshots.map((s) => s.id), ['b']);
});

test('deleteSnapshots 按 年/月/日/时 筛选删除', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ snapshots: [
    { id: 'a', scannedAt: '2026-09-01 10:00:00', fileSizeMB: 1 },
    { id: 'b', scannedAt: '2026-09-02 10:00:00', fileSizeMB: 1 },
    { id: 'c', scannedAt: '2025-09-01 10:00:00', fileSizeMB: 1 },
  ] }));
  for (const id of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${id}.tsv.gz`), 'x');
  const r = history.deleteSnapshots({ year: 2026, month: 9 }, dir);
  assert.strictEqual(r.deleted, 2);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.snapshots.map((s) => s.id), ['c']);
});
```

### Step 2: 运行测试确认失败

Run: `node --test server/tests/history.test.js`
Expected: FAIL，报 `Cannot find module '../history.js'`

### Step 3: 实现 server/history.js

```js
/**
 * C 盘分析 - 历史快照与增长趋势数据层
 * 存储：history/<id>.tsv.gz（每行 path<TAB>bytes，gzip 压缩）；索引 history/index.json
 * 纯函数与 I/O 分离，便于 node --test 单测。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT, 'history');

const GB = 1024 ** 3;

/** '2026-09-16 11:44:40' → 快照文件名 ID（Windows 文件名不能含冒号） */
function idFromDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function readIndex(historyDir = HISTORY_DIR) {
  try {
    const raw = fs.readFileSync(path.join(historyDir, 'index.json'), 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.snapshots)) return data;
  } catch {}
  return { snapshots: [] };
}

function writeIndex(index, historyDir = HISTORY_DIR) {
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'index.json'), JSON.stringify(index, null, 2));
}

/** 列表 + 一致性校验：快照文件缺失的条目自动过滤并重写索引 */
function listSnapshots(historyDir = HISTORY_DIR) {
  const index = readIndex(historyDir);
  const snapshots = index.snapshots.filter((s) => {
    const ok = fs.existsSync(path.join(historyDir, `${s.id}.tsv.gz`));
    if (!ok) return false;
    return true;
  });
  if (snapshots.length !== index.snapshots.length) writeIndex({ snapshots }, historyDir);
  const totalSizeMB = +snapshots.reduce((sum, s) => sum + (s.fileSizeMB || 0), 0).toFixed(1);
  return { snapshots, totalSizeMB };
}

function serializeDirMap(dirMap) {
  const lines = [];
  for (const [p, bytes] of dirMap) lines.push(`${p}\t${bytes == null ? '' : bytes}`);
  return lines.join('\n');
}

function deserializeTsv(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    map.set(line.slice(0, tab), line.slice(tab + 1) === '' ? null : Number(line.slice(tab + 1)));
  }
  return map;
}

function writeSnapshotGz(id, text, historyDir = HISTORY_DIR) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(historyDir, { recursive: true });
    const gz = zlib.createGzip();
    const ws = fs.createWriteStream(path.join(historyDir, `${id}.tsv.gz`));
    gz.pipe(ws);
    gz.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    gz.end(text);
  });
}

function loadSnapshotMap(id, historyDir = HISTORY_DIR) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const rs = fs.createReadStream(path.join(historyDir, `${id}.tsv.gz`));
    rs.on('error', reject);
    const gz = zlib.createGunzip();
    gz.on('error', reject);
    gz.on('data', (c) => chunks.push(c));
    gz.on('end', () => resolve(deserializeTsv(Buffer.concat(chunks).toString('utf8'))));
    rs.pipe(gz);
  });
}

/**
 * 按条件删除快照：ids 优先；否则按 year/month/day/hour/before 时间筛选（AND）。
 * 返回 { deleted }
 */
function deleteSnapshots(filter = {}, historyDir = HISTORY_DIR) {
  const index = readIndex(historyDir);
  const { ids, year, month, day, hour, before } = filter;
  const parse = (s) => new Date(s.replace(' ', 'T'));
  let remaining = index.snapshots;
  if (Array.isArray(ids) && ids.length) {
    const idSet = new Set(ids);
    remaining = remaining.filter((s) => !idSet.has(s.id));
  } else {
    const beforeMs = before ? parse(before).getTime() : null;
    remaining = remaining.filter((s) => {
      const t = parse(s.scannedAt);
      if (year != null && t.getFullYear() !== Number(year)) return true;
      if (month != null && t.getMonth() + 1 !== Number(month)) return true;
      if (day != null && t.getDate() !== Number(day)) return true;
      if (hour != null && t.getHours() !== Number(hour)) return true;
      if (beforeMs != null && t.getTime() >= beforeMs) return true;
      return false;
    });
  }
  const deletedIds = index.snapshots
    .filter((s) => !remaining.some((r) => r.id === s.id))
    .map((s) => s.id);
  for (const id of deletedIds) {
    const f = path.join(historyDir, `${id}.tsv.gz`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  writeIndex({ snapshots: remaining }, historyDir);
  return { deleted: deletedIds.length };
}

module.exports = {
  idFromDate,
  readIndex,
  writeIndex,
  listSnapshots,
  serializeDirMap,
  deserializeTsv,
  writeSnapshotGz,
  loadSnapshotMap,
  deleteSnapshots,
};
```

### Step 4: 运行测试确认通过

Run: `node --test server/tests/history.test.js`
Expected: PASS（4 个用例）

### Step 5: 改 package.json 与 .gitignore

`package.json` scripts 加：`"test": "node --test server/tests/"`
`.gitignore` 追加一行：`history/`

### Step 6: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-1-report.md` 写入完整报告（实现说明、测试命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、测试摘要一行、顾虑（如有）。不要派生子代理，不要运行 git。
