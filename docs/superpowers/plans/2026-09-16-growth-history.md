# 历史快照与增长趋势 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每次扫描后记录 C 盘全目录树大小快照（`history/*.tsv.gz`），通过对比历史快照计算各时间窗口的增长量，前端提供增长排行、持续膨胀双标记、逐层下钻、趋势图，以及按年/月/日/时手动删除快照的管理页。

**Architecture:** Node 本地服务新增 `server/history.js` 数据层（纯函数与 I/O 分离，`node --test` 可测）；`server/index.js` 只负责路由。快照捕获用 `cmd /c chcp 65001 & robocopy C:\ NULL /L ...` 流式列出全盘文件，Node 自底向上累加目录大小，写 gzip TSV。增长分析 = 最新快照与目标窗口快照做差值。前端新增 `Trends`、`History` 两页与 `services/growth.ts`、`services/history.ts`，视觉沿用 Figma 深色主题，趋势图用自绘 SVG（零新依赖）。

**Tech Stack:** Node 22 / npm、@umijs/max ^4.3、antd ^5.21、TypeScript ^5.5、PowerShell 5.1（只读扫描引擎不变）、robocopy `/L` 只读模式、原生 Node http、Node 内置 `node:test` + `node:assert`（无测试框架依赖）、zlib/readline（Node 内置）。

**Spec:** [2026-09-16-growth-history-design.md](../specs/2026-09-16-growth-history-design.md)

## Global Constraints

- 全链路只读：快照捕获用 robocopy `/L`，绝不删除/移动/修改任何用户文件；唯一写操作是 `history/` 目录下自己的快照文件与索引。
- 权限不足目录：不参与增长排行，`size` 为 null；只在明细中标注；绝不提权、不夺所有权。
- 「以管理员身份运行」仅为 UI 引导提示，不自动提权。
- 快照失败不阻塞主扫描：`POST /api/scan` 照常返回，`snapshotWarning` 附带警告。
- 视觉对齐 Figma Dark（`#212332` 背景 / `#2A2D3E` 卡片 / `#2697FF` 主色 / 状态色 `#EE2727` 红、`#FFCF26` 黄、`#26E5FF` 青、`#70CF12` 绿、`#FFA113` 橙）。
- 零新 npm 依赖（gzip、readline、test、assert 均 Node 内置；图标用 @ant-design/icons；趋势图自绘 SVG）。
- 每次编辑 .ts/.tsx 后运行 `npx tsc --noEmit --pretty 2>&1 | grep "<目录>"` 检查；所有编辑完成后跑一次全量 `npx tsc --noEmit --pretty`。已知预存错误（src/app.tsx、src/pages/404、src/setup/theme.tsx）可忽略。
- 同一文件禁止并行 SearchReplace；import 变更与代码变更必须在同一次 SearchReplace 内完成。
- `scan-c.ps1` 不得用 SearchReplace 编辑（UTF-8 BOM 会被破坏）——本次计划不触碰该文件。
- git 提交：仅当用户明确要求时执行 commit（用户约定）；计划中标注的 commit 步骤执行前需用户确认。
- 每次编辑 Node 文件后运行 `node server/tests/`（`npm test`）验证；前端编辑后跑 tsc。

---

### Task 1: server/history.js 存储层（索引 + 快照序列化/读写 + 一致性校验 + 删除）

**Files:**
- Create: `server/history.js`
- Create: `server/tests/history.test.js`
- Modify: `package.json`（加 `"test": "node --test server/tests/"`）
- Modify: `.gitignore`（加 `history/`）

**Interfaces:**
- Consumes: 无
- Produces（本任务）：
  - `serializeDirMap(dirMap: Map<string, number|null>) → string`（纯函数）
  - `deserializeTsv(text: string) → Map<string, number|null>`（纯函数；空字节数 → null 表示未扫描）
  - `readIndex(historyDir = HISTORY_DIR) → { snapshots: SnapshotMeta[] }`
  - `writeIndex(index, historyDir = HISTORY_DIR)`
  - `listSnapshots(historyDir = HISTORY_DIR) → { snapshots: SnapshotMeta[], totalSizeMB: number }`（一致性校验：文件缺失的条目自动过滤并重写索引）
  - `deleteSnapshots(filter, historyDir = HISTORY_DIR) → { deleted: number }`
  - `SnapshotMeta = { id, scannedAt, disk:{totalGB,usedGB,freeGB}, dirCount, fileCount, fileSizeMB, unscannedDirs, warning: string|null }`

- [ ] **Step 1: 写失败测试**

`server/tests/history.test.js`：

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

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/tests/history.test.js`
Expected: FAIL，报 `Cannot find module '../history.js'`

- [ ] **Step 3: 实现 server/history.js（存储层部分）**

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

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/tests/history.test.js`
Expected: PASS（4 个用例）

- [ ] **Step 5: 改 package.json 与 .gitignore**

`package.json` scripts 加：
```json
"test": "node --test server/tests/"
```
`.gitignore` 追加一行：`history/`

- [ ] **Step 6: 提交（需用户确认）**

```bash
git add server/history.js server/tests/history.test.js package.json .gitignore
git commit -m "feat: add history snapshot storage layer with tests"
```

---

### Task 2: buildSnapshot 全树快照捕获

**Files:**
- Modify: `server/history.js`（加 `accumulateLines`、`runRobocopyTree`、`buildSnapshot`）
- Modify: `server/tests/history.test.js`（加 2 个用例）

**Interfaces:**
- Consumes: Task 1 的 `serializeDirMap`、`writeSnapshotGz`、`readIndex`、`writeIndex`、`idFromDate`
- Produces:
  - `accumulateLines(lines: string[], state?) → { dirMap: Map<string, number>, fileCount: number, failedCount: number }`（纯函数，可增量传入 state）
  - `buildSnapshot({ scannedAt, disk }, historyDir = HISTORY_DIR) → Promise<SnapshotMeta>`（跑 robocopy、写快照、更新索引；重复时间戳幂等返回已有 meta）

- [ ] **Step 1: 写失败测试**

在 `server/tests/history.test.js` 追加：

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

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/tests/history.test.js`
Expected: FAIL，`history.accumulateLines is not a function`

- [ ] **Step 3: 实现 accumulateLines + buildSnapshot**

在 `server/history.js` 顶部加 `const { spawn } = require('child_process');` 与 `const readline = require('readline');`，追加：

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

并在 `module.exports` 中追加 `accumulateLines, buildSnapshot`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/tests/history.test.js`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交（需用户确认）**

```bash
git add server/history.js server/tests/history.test.js
git commit -m "feat: capture full directory-tree snapshot via robocopy"
```

---

### Task 3: 增长分析（窗口差值 + 排行 + 双标记 + 下钻 + 趋势）

**Files:**
- Modify: `server/history.js`（加 `parseWindowLabel`、`pickCompareId`、`diffMaps`、`tierOf`、`isSustained`、`loadAnchorGrowth`、`computeGrowthTop`、`computeGrowthDir`、`computeGrowthTrend`）
- Modify: `server/tests/history.test.js`（加 6 个用例）

**Interfaces:**
- Consumes: Task 1 的 `readIndex`、`loadSnapshotMap`
- Produces（供 Task 4 路由使用）：
  - `parseWindowLabel(label) → { ms, label } | null`（`1y/6m/1m/15d/10d/5d/2d/1d/<N>h`；1y=365天、1m=30天）
  - `pickCompareId(index, nowMs, windowMs) → { id, actualWindowDays } | { id: null }`（最近但不晚于 now-window；不足则用最早快照；仅 1 条时 id=null）
  - `diffMaps(latest, compare) → Map<string, { size, growth }>`（三态：新增=全额、删除=负、未扫描=跳过）
  - `tierOf(growthBytes) → 'extreme'|'high'|'medium'|'low'`
  - `isSustained(day, week, month, thresholdBytes = 1GB) → boolean`
  - `computeGrowthTop({ window, top }, historyDir, nowMs = Date.now()) → Promise<GrowthTopResult>`
  - `computeGrowthDir({ path, window }, historyDir, nowMs = Date.now()) → Promise<GrowthDirResult>`
  - `computeGrowthTrend({ path, points }, historyDir) → Promise<GrowthTrendResult>`
  - `GrowthTopResult = { window, scannedAt, compareAt, actualWindowDays, insufficient, unscannedDirs, entries: GrowthEntry[] }`
  - `GrowthEntry = { path, size, growth, tier, sustained }`
  - `GrowthDirEntry = GrowthEntry & { name, hasChildren }`
  - `GrowthDirResult = { path, window, actualWindowDays, insufficient, entries: GrowthDirEntry[] }`
  - `GrowthTrendResult = { path, points: { t, size }[] }`

- [ ] **Step 1: 写失败测试**

在 `server/tests/history.test.js` 追加（注意 `const zlib = require('zlib');` 补在文件顶部）：

```js
test('parseWindowLabel 预置窗口与自定义小时', () => {
  assert.strictEqual(history.parseWindowLabel('30d').ms, 30 * 24 * 3600 * 1000);
  assert.strictEqual(history.parseWindowLabel('1y').ms, 365 * 24 * 3600 * 1000);
  assert.strictEqual(history.parseWindowLabel('6m').ms, 6 * 30 * 24 * 3600 * 1000);
  assert.strictEqual(history.parseWindowLabel('48h').ms, 48 * 3600 * 1000);
  assert.strictEqual(history.parseWindowLabel('bad'), null);
});

test('pickCompareId 窗口选择、回退与单条不足', () => {
  const now = Date.parse('2026-09-16T12:00:00');
  const mk = (arr) => ({ snapshots: arr.map(([id, s]) => ({ id, scannedAt: s })) });
  const index = mk([
    ['a', '2026-08-01 10:00:00'],
    ['b', '2026-09-01 10:00:00'],
    ['c', '2026-09-16 11:00:00'],
  ]);
  assert.strictEqual(history.pickCompareId(index, now, 15 * 24 * 3600 * 1000).id, 'b');
  assert.strictEqual(history.pickCompareId(index, now, 30 * 24 * 3600 * 1000).id, 'a');
  assert.strictEqual(history.pickCompareId(index, now, 400 * 24 * 3600 * 1000).id, 'a'); // 回退最早
  const single = mk([['a', '2026-09-16 11:00:00']]);
  assert.strictEqual(history.pickCompareId(single, now, 24 * 3600 * 1000).id, null);
});

test('diffMaps 三态（不变/新增/删除/未扫描）', () => {
  const latest = new Map([['c:\\a', 100], ['c:\\b', 50], ['c:\\lock', null]]);
  const compare = new Map([['c:\\a', 30], ['c:\\c', 20]]);
  const diff = history.diffMaps(latest, compare);
  assert.deepStrictEqual(diff.get('c:\\a'), { size: 100, growth: 70 });
  assert.deepStrictEqual(diff.get('c:\\b'), { size: 50, growth: 50 });
  assert.deepStrictEqual(diff.get('c:\\c'), { size: null, growth: -20 });
  assert.strictEqual(diff.has('c:\\lock'), false); // 未扫描不参与
});

test('tierOf 分档边界', () => {
  assert.strictEqual(history.tierOf(6 * 1024 ** 3), 'extreme');
  assert.strictEqual(history.tierOf(2 * 1024 ** 3), 'high');
  assert.strictEqual(history.tierOf(200 * 1024 ** 2), 'medium');
  assert.strictEqual(history.tierOf(10 * 1024 ** 2), 'low');
});

test('isSustained 持续膨胀判定', () => {
  assert.strictEqual(history.isSustained(10, 100, 2 * 1024 ** 3), true);
  assert.strictEqual(history.isSustained(0, 100, 2 * 1024 ** 3), false);
  assert.strictEqual(history.isSustained(10, 100, 500 * 1024 ** 2), false);
  assert.strictEqual(history.isSustained(null, 100, 2 * 1024 ** 3), false);
});

async function writeFakeSnapshots(dir, latestMap, oldMap) {
  fs.writeFileSync(path.join(dir, 'old.tsv.gz'), zlib.gzipSync(history.serializeDirMap(oldMap)));
  fs.writeFileSync(path.join(dir, 'new.tsv.gz'), zlib.gzipSync(history.serializeDirMap(latestMap)));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ snapshots: [
    { id: 'old', scannedAt: '2026-08-01 10:00:00', disk: {}, dirCount: 0, fileCount: 0, fileSizeMB: 0.1, unscannedDirs: 0, warning: null },
    { id: 'new', scannedAt: '2026-09-16 11:00:00', disk: {}, dirCount: 0, fileCount: 0, fileSizeMB: 0.1, unscannedDirs: 0, warning: null },
  ] }));
}

test('computeGrowthTop 排行 + 分档', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir,
    new Map([['c:\\', 1000], ['c:\\users', 800], ['c:\\users\\a', 300]]),
    new Map([['c:\\', 500], ['c:\\users', 200], ['c:\\users\\a', 50]]),
  );
  const r = await history.computeGrowthTop({ window: '1m', top: 10 }, dir, nowMs);
  assert.strictEqual(r.insufficient, false);
  assert.strictEqual(r.entries[0].path, 'c:\\users'); // 增长 600 最大
  const users = r.entries.find((e) => e.path === 'c:\\users');
  assert.strictEqual(users.growth, 600);
  assert.strictEqual(users.tier, 'medium');
});

test('computeGrowthDir 直接子目录 + hasChildren', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir,
    new Map([
      ['c:\\', 1000], ['c:\\users', 800], ['c:\\users\\a', 300], ['c:\\users\\a\\sub', 100],
      ['c:\\windows', 200], ['c:\\windows\\system32', 150],
    ]),
    new Map([
      ['c:\\', 500], ['c:\\users', 200], ['c:\\users\\a', 50], ['c:\\users\\a\\sub', 10],
      ['c:\\windows', 180], ['c:\\windows\\system32', 140],
    ]),
  );
  const r = await history.computeGrowthDir({ path: 'c:\\users', window: '1m' }, dir, nowMs);
  assert.strictEqual(r.insufficient, false);
  assert.deepStrictEqual(r.entries.map((e) => e.name), ['a']); // 直接子目录只有 a
  assert.strictEqual(r.entries[0].hasChildren, true);
});

test('computeGrowthTrend 历史序列', async () => {
  const dir = tmpDir();
  await writeFakeSnapshots(dir,
    new Map([['c:\\users', 800], ['c:\\', 1000]]),
    new Map([['c:\\users', 200], ['c:\\', 500]]),
  );
  const r = await history.computeGrowthTrend({ path: 'c:\\users', points: 60 }, dir);
  assert.strictEqual(r.points.length, 2);
  assert.strictEqual(r.points[1].size, 800);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/tests/history.test.js`
Expected: FAIL，`history.parseWindowLabel is not a function`

- [ ] **Step 3: 实现增长分析**

在 `server/history.js` 追加：

```js
function parseWindowLabel(label) {
  const unitMs = { y: 365 * 24 * 3600 * 1000, m: 30 * 24 * 3600 * 1000, d: 24 * 3600 * 1000, h: 3600 * 1000 };
  const m = /^(\d+)(y|m|d|h)$/.exec(String(label || '').toLowerCase());
  if (!m) return null;
  return { ms: Number(m[1]) * unitMs[m[2]], label: `${Number(m[1])}${m[2]}` };
}

/** 找距离 now-windowMs 最近但不晚于它的快照；数据不足回退最早；仅 1 条返回 id=null */
function pickCompareId(index, nowMs, windowMs) {
  const sorted = [...index.snapshots].sort((a, b) => new Date(a.scannedAt.replace(' ', 'T')) - new Date(b.scannedAt.replace(' ', 'T')));
  if (sorted.length < 2) return { id: null, actualWindowDays: null };
  const latest = sorted[sorted.length - 1];
  const target = nowMs - windowMs;
  let chosen = null;
  for (const s of sorted) {
    const t = new Date(s.scannedAt.replace(' ', 'T')).getTime();
    if (t > target) break;
    chosen = s;
  }
  if (!chosen) chosen = sorted[0];
  if (chosen.id === latest.id) return { id: null, actualWindowDays: null };
  const actualDays = (nowMs - new Date(chosen.scannedAt.replace(' ', 'T')).getTime()) / (24 * 3600 * 1000);
  return { id: chosen.id, actualWindowDays: Math.round(actualDays * 10) / 10 };
}

function diffMaps(latest, compare) {
  const out = new Map();
  for (const [p, size] of latest) {
    if (size == null) continue;
    const base = compare.get(p);
    out.set(p, { size, growth: size - (base == null ? 0 : base) });
  }
  for (const [p, size] of compare) {
    if (size == null || out.has(p)) continue;
    out.set(p, { size: null, growth: -size });
  }
  return out;
}

function tierOf(growthBytes) {
  if (growthBytes > 5 * GB) return 'extreme';
  if (growthBytes >= GB) return 'high';
  if (growthBytes >= 100 * 1024 * 1024) return 'medium';
  return 'low';
}

function isSustained(dayGrowth, weekGrowth, monthGrowth, thresholdBytes = GB) {
  return dayGrowth != null && weekGrowth != null && monthGrowth != null &&
    dayGrowth > 0 && weekGrowth > 0 && monthGrowth > 0 && monthGrowth > thresholdBytes;
}

/** 某目录相对一个对比快照的增长量；任一缺失返回 null */
function growthFor(latest, compare, p) {
  if (!compare) return null;
  const size = latest.get(p);
  const base = compare.get(p);
  if (size == null || base == null) return null;
  return size - base;
}

/** 为给定路径集合计算 1d/7d/30d 持续膨胀标记（锚点快照各加载一次） */
async function loadAnchorGrowth(index, latestId, paths, historyDir, nowMs) {
  const anchors = [1, 7, 30];
  const maps = [];
  for (const days of anchors) {
    const { id } = pickCompareId(index, nowMs, days * 24 * 3600 * 1000);
    maps.push(id ? await loadSnapshotMap(id, historyDir) : null);
  }
  const latest = await loadSnapshotMap(latestId, historyDir);
  const flags = new Map();
  for (const p of paths) {
    flags.set(p, isSustained(
      growthFor(latest, maps[0], p),
      growthFor(latest, maps[1], p),
      growthFor(latest, maps[2], p),
    ));
  }
  return flags;
}

async function computeGrowthTop({ window = '1m', top = 20 } = {}, historyDir = HISTORY_DIR, nowMs = Date.now()) {
  const w = parseWindowLabel(window);
  const index = readIndex(historyDir);
  const sorted = [...index.snapshots].sort((a, b) => new Date(b.scannedAt.replace(' ', 'T')) - new Date(a.scannedAt.replace(' ', 'T')));
  const latest = sorted[0];
  if (!w || !latest) return { window, insufficient: true, entries: [] };
  const compare = pickCompareId(index, nowMs, w.ms);
  if (!compare.id) {
    return { window, scannedAt: latest.scannedAt, compareAt: null, actualWindowDays: null, insufficient: true, unscannedDirs: latest.unscannedDirs || 0, entries: [] };
  }
  const [latestMap, compareMap] = await Promise.all([
    loadSnapshotMap(latest.id, historyDir),
    loadSnapshotMap(compare.id, historyDir),
  ]);
  const entries = [...diffMaps(latestMap, compareMap).entries()]
    .map(([path, v]) => ({ path, ...v, tier: tierOf(v.growth), sustained: false }))
    .sort((a, b) => b.growth - a.growth)
    .slice(0, top);
  const flags = await loadAnchorGrowth(index, latest.id, entries.map((e) => e.path), historyDir, nowMs);
  for (const e of entries) e.sustained = flags.get(e.path) || false;
  const compareMeta = index.snapshots.find((s) => s.id === compare.id);
  return {
    window, scannedAt: latest.scannedAt, compareAt: compareMeta ? compareMeta.scannedAt : null,
    actualWindowDays: compare.actualWindowDays, insufficient: false,
    unscannedDirs: latest.unscannedDirs || 0, entries,
  };
}

async function computeGrowthDir({ path: p = 'c:\\', window = '1m' } = {}, historyDir = HISTORY_DIR, nowMs = Date.now()) {
  const w = parseWindowLabel(window);
  const index = readIndex(historyDir);
  const sorted = [...index.snapshots].sort((a, b) => new Date(b.scannedAt.replace(' ', 'T')) - new Date(a.scannedAt.replace(' ', 'T')));
  const latest = sorted[0];
  if (!w || !latest) return { path: p, window, insufficient: true, entries: [] };
  const compare = pickCompareId(index, nowMs, w.ms);
  if (!compare.id) return { path: p, window, insufficient: true, entries: [] };
  const norm = (p.toLowerCase().replace(/[\\/]+$/, '') || 'c:');
  const prefix = norm + '\\';
  const [latestMap, compareMap] = await Promise.all([
    loadSnapshotMap(latest.id, historyDir),
    loadSnapshotMap(compare.id, historyDir),
  ]);
  const diff = diffMaps(latestMap, compareMap);
  // parentSet：所有「作为某目录祖先」的路径 → 判断 hasChildren
  const parentSet = new Set();
  for (const k of latestMap.keys()) {
    let idx = k.indexOf('\\');
    while (idx !== -1) {
      idx = k.indexOf('\\', idx + 1);
      if (idx !== -1) parentSet.add(k.slice(0, idx));
    }
  }
  const children = [];
  for (const [pathKey, v] of diff) {
    if (!pathKey.startsWith(prefix)) continue;
    const rest = pathKey.slice(prefix.length);
    if (!rest || rest.includes('\\')) continue;
    children.push({ path: pathKey, name: rest, size: v.size, growth: v.growth, tier: tierOf(v.growth), hasChildren: parentSet.has(pathKey), sustained: false });
  }
  children.sort((a, b) => b.growth - a.growth);
  const flags = await loadAnchorGrowth(index, latest.id, children.map((c) => c.path), historyDir, nowMs);
  for (const c of children) c.sustained = flags.get(c.path) || false;
  return { path: norm, window, actualWindowDays: compare.actualWindowDays, insufficient: false, entries: children };
}

async function computeGrowthTrend({ path: p = 'c:\\', points = 60 } = {}, historyDir = HISTORY_DIR) {
  const index = readIndex(historyDir);
  const sorted = [...index.snapshots].sort((a, b) => new Date(a.scannedAt.replace(' ', 'T')) - new Date(b.scannedAt.replace(' ', 'T')));
  const norm = (p.toLowerCase().replace(/[\\/]+$/, '') || 'c:');
  const use = sorted.slice(-Math.min(Math.max(points, 5), 120), sorted.length);
  const out = [];
  for (const s of use) {
    const m = await loadSnapshotMap(s.id, historyDir);
    const size = m.get(norm);
    out.push({ t: s.scannedAt, size: size == null ? null : size });
  }
  return { path: norm, points: out };
}
```

在 `module.exports` 中追加：`parseWindowLabel, pickCompareId, diffMaps, tierOf, isSustained, computeGrowthTop, computeGrowthDir, computeGrowthTrend`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/tests/history.test.js`
Expected: PASS（11 个用例）

- [ ] **Step 5: 提交（需用户确认）**

```bash
git add server/history.js server/tests/history.test.js
git commit -m "feat: growth analysis (windows, ranking, sustained flag, drill-down, trend)"
```

---

### Task 4: server/index.js 路由接入（history/growth API + 扫描后自动快照）

**Files:**
- Modify: `server/index.js`
- Create: `server/tests/api.test.js`

**Interfaces:**
- Consumes: Task 3 的 `history.*` 全部导出
- Produces: `module.exports = { startServer }`（供测试与 `npm run server`）；新路由：
  - `GET /api/history` → `{ snapshots, totalSizeMB }`
  - `DELETE /api/history` → body `{ ids?|year?|month?|day?|hour?|before? }` → `{ deleted }`
  - `GET /api/growth?window=&top=` → GrowthTopResult
  - `GET /api/growth/dir?path=&window=` → GrowthDirResult
  - `GET /api/growth/trend?path=&points=` → GrowthTrendResult
  - `POST /api/scan`（改造）→ 成功后自动 `buildSnapshot({scannedAt, disk})`，失败仅附带 `snapshotWarning`

- [ ] **Step 1: 写失败测试**

`server/tests/api.test.js`：

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../index.js');

let server;
let base;

before(async () => {
  server = startServer(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /api/status 正常返回', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok('hasResult' in body && 'scanning' in body);
});

test('GET /api/history 空历史返回空列表', async () => {
  const res = await fetch(`${base}/api/history`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.snapshots));
  assert.strictEqual(typeof body.totalSizeMB, 'number');
});

test('GET /api/growth 无历史时 insufficient=true', async () => {
  const res = await fetch(`${base}/api/growth?window=1m`);
  const body = await res.json();
  assert.strictEqual(body.insufficient, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/tests/api.test.js`
Expected: FAIL，`Cannot find module '../index.js'`（或 startServer is not a function）

- [ ] **Step 3: 改造 server/index.js**

顶部加 `const history = require('./history');`，新增 `readBody`，`handle` 改为 async 并包 try/catch：

```js
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}
```

`handle` 中新增路由（在 `GET /api/status` 之后、`serveStatic` 之前插入；`POST /api/scan` 改为）：

```js
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/status') { /* 原逻辑不变 */ }

    if (req.method === 'GET' && p === '/api/history') {
      sendJson(res, 200, history.listSnapshots());
      return;
    }

    if (req.method === 'DELETE' && p === '/api/history') {
      const filter = await readBody(req);
      sendJson(res, 200, history.deleteSnapshots(filter));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth') {
      const window = url.searchParams.get('window') || '1m';
      const top = Math.min(Math.max(Number(url.searchParams.get('top')) || 20, 1), 100);
      sendJson(res, 200, await history.computeGrowthTop({ window, top }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/dir') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const window = url.searchParams.get('window') || '1m';
      sendJson(res, 200, await history.computeGrowthDir({ path: path_, window }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/trend') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const points = Math.min(Math.max(Number(url.searchParams.get('points')) || 60, 5), 120);
      sendJson(res, 200, await history.computeGrowthTrend({ path: path_, points }));
      return;
    }

    if (req.method === 'POST' && p === '/api/scan') {
      if (scanning) { sendJson(res, 409, { error: '扫描正在进行中，请稍候' }); return; }
      scanning = true;
      runScan()
        .then(async (data) => {
          let snapshotWarning = null;
          try {
            await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
          } catch (e) {
            snapshotWarning = `历史快照记录失败: ${e.message}`;
            console.warn('[history]', snapshotWarning);
          }
          scanning = false;
          sendJson(res, 200, { ok: true, ...data, snapshotWarning });
        })
        .catch((err) => {
          scanning = false;
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    if (p.startsWith('/api/')) { sendJson(res, 404, { error: `未知接口: ${p}` }); return; }
    serveStatic(req, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}
```

底部改为（保持 `npm run server` 行为不变）：

```js
function startServer(port = PORT) {
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`[server] C盘分析 API 服务已启动: http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer(PORT);
} else {
  module.exports = { startServer };
}
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `node --test server/tests/`
Expected: PASS（11 + 3 = 14 个用例）

- [ ] **Step 5: 手动验证 POST /api/scan 自动快照**

Run（真实扫描，约 1~3 分钟 + 快照数十秒）：
```bash
npm run server
curl -X POST http://localhost:8090/api/scan
curl http://localhost:8090/api/history
```
Expected：`/api/history` 出现 1 条快照；`dirCount` 为几十万量级；`GET /api/growth?window=1d` 返回 `insufficient: true`（只有 1 条）。验证后删除该测试快照：`curl -X DELETE http://localhost:8090/api/history -H "Content-Type: application/json" -d "{\"ids\":[\"<id>\"]}"`，并删除 `history/` 下测试产物。

- [ ] **Step 6: 提交（需用户确认）**

```bash
git add server/index.js server/tests/api.test.js
git commit -m "feat: wire history/growth APIs and auto snapshot after scan"
```

---

### Task 5: 前端数据层（services/growth.ts + services/history.ts）

**Files:**
- Create: `src/services/growth.ts`
- Create: `src/services/history.ts`
- Modify: `src/services/scan.ts`（`ScanResult` 加可选 `snapshotWarning?: string`）

**Interfaces:**
- Consumes: Task 4 的 API（经 umi proxy `/api`）
- Produces: `getGrowth/getGrowthDir/getGrowthTrend`、`getHistory/deleteHistory` 及全部类型（供 Task 6/7 页面使用）

- [ ] **Step 1: 创建 src/services/growth.ts**

```ts
export type GrowthTier = 'extreme' | 'high' | 'medium' | 'low';

export interface GrowthEntry {
  path: string;
  size: number | null;
  growth: number;
  tier: GrowthTier;
  sustained: boolean;
}

export interface GrowthTopResult {
  window: string;
  scannedAt: string;
  compareAt: string | null;
  actualWindowDays: number | null;
  insufficient: boolean;
  unscannedDirs: number;
  entries: GrowthEntry[];
}

export interface GrowthDirEntry extends GrowthEntry {
  name: string;
  hasChildren: boolean;
}

export interface GrowthDirResult {
  path: string;
  window: string;
  actualWindowDays: number | null;
  insufficient: boolean;
  entries: GrowthDirEntry[];
}

export interface GrowthTrendPoint {
  t: string;
  size: number | null;
}

export interface GrowthTrendResult {
  path: string;
  points: GrowthTrendPoint[];
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export function getGrowth(params: { window: string; top?: number }): Promise<GrowthTopResult> {
  const q = new URLSearchParams({ window: params.window, top: String(params.top ?? 20) });
  return request<GrowthTopResult>(`/api/growth?${q}`);
}

export function getGrowthDir(params: { path: string; window: string }): Promise<GrowthDirResult> {
  const q = new URLSearchParams({ path: params.path, window: params.window });
  return request<GrowthDirResult>(`/api/growth/dir?${q}`);
}

export function getGrowthTrend(params: { path: string; points?: number }): Promise<GrowthTrendResult> {
  const q = new URLSearchParams({ path: params.path, points: String(params.points ?? 60) });
  return request<GrowthTrendResult>(`/api/growth/trend?${q}`);
}
```

- [ ] **Step 2: 创建 src/services/history.ts**

```ts
export interface HistorySnapshot {
  id: string;
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  dirCount: number;
  fileCount: number;
  fileSizeMB: number;
  unscannedDirs: number;
  warning: string | null;
}

export interface HistoryList {
  snapshots: HistorySnapshot[];
  totalSizeMB: number;
}

export interface DeleteHistoryFilter {
  ids?: string[];
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  before?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export function getHistory(): Promise<HistoryList> {
  return request<HistoryList>('/api/history');
}

export function deleteHistory(filter: DeleteHistoryFilter): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
}
```

- [ ] **Step 3: 修改 src/services/scan.ts（同一次 SearchReplace）**

`ScanResult` 接口追加一行（import 不变）：
```ts
export interface ScanResult {
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  topFolders: TopFolder[];
  items: ScanItem[];
  largeFiles: LargeFile[];
  snapshotWarning?: string;
}
```

- [ ] **Step 4: tsc 验证**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "src/services"`
Expected: 无输出（零错误）

- [ ] **Step 5: 提交（需用户确认）**

```bash
git add src/services/growth.ts src/services/history.ts src/services/scan.ts
git commit -m "feat: add growth and history frontend services"
```

---

### Task 6: 趋势分析页（Trends + TrendChart + 路由导航）

**Files:**
- Create: `src/components/TrendChart.tsx`
- Create: `src/pages/Trends/index.tsx`
- Modify: `config/config.ts`（加 `/trends` 路由）
- Modify: `src/layouts/index.tsx`（menuItems 加「趋势分析」，import 加 `LineChartOutlined`）

**Interfaces:**
- Consumes: Task 5 的 `getGrowth/getGrowthDir/getGrowthTrend` 与类型、`figmaColors`、`formatSize`
- Produces: `/trends` 页面：窗口切换（Segmented + 自定义小时）、增长排行 Top 20、逐层下钻表格 + 面包屑、右侧趋势折线图、数据不足与提权引导提示

- [ ] **Step 1: 创建 src/components/TrendChart.tsx**

```tsx
import { useMemo } from 'react';
import { formatSize } from '@/utils/format';

export interface TrendPoint {
  t: string;
  size: number | null;
}

/** 自绘 SVG 折线趋势图（零依赖，离线可用） */
export default function TrendChart({ points, height = 160 }: { points: TrendPoint[]; height?: number }) {
  const view = useMemo(() => {
    const W = 600;
    const H = height;
    const pad = 8;
    const data = points.filter((p): p is { t: string; size: number } => p.size != null);
    if (data.length < 2) return { valid: false, poly: '', minLabel: '', maxLabel: '' };
    const sizes = data.map((d) => d.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const span = max - min || 1;
    const poly = data
      .map((d, i) => {
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        const y = H - pad - ((d.size - min) / span) * (H - pad * 2);
        return `${x},${y}`;
      })
      .join(' ');
    return { valid: true, poly, minLabel: formatSize(min), maxLabel: formatSize(max) };
  }, [points, height]);

  if (!view.valid) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: 12 }}>数据点不足，无法绘制趋势</div>;
  }
  return (
    <svg viewBox={`0 0 600 ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <polyline points={view.poly} fill="none" stroke="#2697FF" strokeWidth={2} />
      <text x={8} y={height - 4} fontSize={10} fill="rgba(255,255,255,0.5)">{view.minLabel}</text>
      <text x={8} y={12} fontSize={10} fill="rgba(255,255,255,0.5)">{view.maxLabel}</text>
    </svg>
  );
}
```

- [ ] **Step 2: 创建 src/pages/Trends/index.tsx**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, Empty, InputNumber, Row, Segmented, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FolderOutlined } from '@ant-design/icons';
import TrendChart from '@/components/TrendChart';
import type { GrowthDirEntry, GrowthDirResult, GrowthTopResult, GrowthTier } from '@/services/growth';
import { getGrowth, getGrowthDir, getGrowthTrend } from '@/services/growth';
import { figmaColors } from '@/setup/theme';
import { formatSize } from '@/utils/format';

const WINDOW_OPTIONS = [
  { label: '1天', value: '1d' },
  { label: '2天', value: '2d' },
  { label: '5天', value: '5d' },
  { label: '10天', value: '10d' },
  { label: '15天', value: '15d' },
  { label: '1月', value: '1m' },
  { label: '6月', value: '6m' },
  { label: '1年', value: '1y' },
];

const tierColor: Record<GrowthTier, string> = {
  extreme: figmaColors.red,
  high: figmaColors.orange,
  medium: figmaColors.yellow,
  low: figmaColors.green,
};
const tierLabel: Record<GrowthTier, string> = {
  extreme: '极高',
  high: '高',
  medium: '中',
  low: '低',
};

export default function TrendsPage() {
  const [windowLabel, setWindowLabel] = useState('1m');
  const [customHours, setCustomHours] = useState<number | null>(24);
  const [topData, setTopData] = useState<GrowthTopResult | null>(null);
  const [loadingTop, setLoadingTop] = useState(false);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [dirData, setDirData] = useState<GrowthDirResult | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [trend, setTrend] = useState<{ t: string; size: number | null }[]>([]);

  const loadTop = useCallback(async (window: string) => {
    setLoadingTop(true);
    try {
      setTopData(await getGrowth({ window, top: 20 }));
    } catch {
      setTopData(null);
    } finally {
      setLoadingTop(false);
    }
  }, []);

  useEffect(() => {
    loadTop(windowLabel);
  }, [windowLabel, loadTop]);

  const openDir = useCallback(
    async (path: string) => {
      setDrillPath(path);
      setLoadingDir(true);
      try {
        setDirData(await getGrowthDir({ path, window: windowLabel }));
      } catch {
        setDirData(null);
      } finally {
        setLoadingDir(false);
      }
      try {
        const t = await getGrowthTrend({ path, points: 60 });
        setTrend(t.points);
      } catch {
        setTrend([]);
      }
    },
    [windowLabel],
  );

  const crumbs = useMemo(() => (drillPath ? drillPath.split('\\').filter(Boolean) : []), [drillPath]);

  const columns: ColumnsType<GrowthDirEntry> = [
    { title: '目录', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '当前大小',
      dataIndex: 'size',
      key: 'size',
      width: 110,
      align: 'right',
      render: (v: number | null) => (v == null ? '未扫描' : formatSize(v)),
    },
    {
      title: '增长量',
      dataIndex: 'growth',
      key: 'growth',
      width: 110,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: v >= 0 ? figmaColors.green : figmaColors.red, fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{formatSize(v)}
        </span>
      ),
    },
    {
      title: '活跃程度',
      dataIndex: 'tier',
      key: 'tier',
      width: 90,
      render: (t: GrowthTier) => <span style={{ color: tierColor[t] }}>{tierLabel[t]}</span>,
    },
    {
      title: '标记',
      dataIndex: 'sustained',
      key: 'sustained',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="gold">持续膨胀</Tag> : null),
    },
    {
      title: '下钻',
      key: 'drill',
      width: 80,
      render: (_, r) =>
        r.hasChildren ? (
          <Button size="small" icon={<FolderOutlined />} onClick={() => openDir(r.path)}>
            进入
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Card title="增长趋势" bordered={false} style={{ marginBottom: 20 }}>
        <Segmented options={WINDOW_OPTIONS} value={windowLabel} onChange={(v) => setWindowLabel(String(v))} />
        <div style={{ display: 'inline-flex', gap: 8, marginLeft: 16, alignItems: 'center' }}>
          <InputNumber
            min={1}
            max={24 * 365}
            value={customHours}
            onChange={(v) => setCustomHours(v)}
            placeholder="小时"
            style={{ width: 90 }}
          />
          <Button size="small" onClick={() => customHours && setWindowLabel(`${customHours}h`)}>
            自定义
          </Button>
        </div>
      </Card>

      {topData?.insufficient && (
        <Card bordered={false}>
          <Empty description="历史数据不足（至少需要 2 次扫描）——每次点击「重新扫描」都会自动记录一次快照，积累后即可分析增长趋势。" />
        </Card>
      )}

      {!topData?.insufficient && (topData?.unscannedDirs ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`检测到 ${topData?.unscannedDirs} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。`}
        />
      )}

      {!drillPath ? (
        <Card
          title={`增长排行 Top 20${topData?.compareAt ? `（对比 ${topData.compareAt}）` : ''}`}
          bordered={false}
        >
          {loadingTop ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : topData && topData.entries.length === 0 ? (
            <Empty description="暂无增长数据" />
          ) : (
            <div>
              {topData?.entries.map((e) => {
                const depth = Math.max(0, e.path.split('\\').length - 2);
                const base = e.path.split('\\').pop() || e.path;
                return (
                  <div
                    key={e.path}
                    onClick={() => openDir(e.path)}
                    title={e.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 4px',
                      borderBottom: `1px solid ${figmaColors.borderWhite}`,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 14 * depth, flexShrink: 0 }} />
                    <span style={{ width: 24, flexShrink: 0, color: figmaColors.primary }}>
                      <FolderOutlined />
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }}>
                      {base}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>
                      {e.size == null ? '未扫描' : formatSize(e.size)}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', fontWeight: 600, color: e.growth >= 0 ? figmaColors.green : figmaColors.red }}>
                      {e.growth >= 0 ? '+' : ''}{formatSize(e.growth)}
                    </span>
                    <span style={{ width: 56, textAlign: 'center', color: tierColor[e.tier] }}>{tierLabel[e.tier]}</span>
                    <span style={{ width: 80, textAlign: 'center' }}>
                      {e.sustained ? <Tag color="gold">持续膨胀</Tag> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div>
          <Card bordered={false} style={{ marginBottom: 20 }}>
            <Breadcrumb
              items={crumbs.map((_, i) => {
                const p = crumbs.slice(0, i + 1).join('\\');
                return {
                  title: <a onClick={() => openDir(p === 'c:' ? 'c:\\' : p)}>{crumbs[i]}</a>,
                };
              })}
            />
          </Card>
          <Row gutter={20}>
            <Col span={16}>
              <Card title={`${drillPath} 子目录增长（${windowLabel}）`} bordered={false}>
                {loadingDir ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin />
                  </div>
                ) : dirData && dirData.entries.length === 0 ? (
                  <Empty description="无子目录数据" />
                ) : (
                  <Table<GrowthDirEntry>
                    rowKey="path"
                    columns={columns}
                    dataSource={dirData?.entries ?? []}
                    pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 项` }}
                  />
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card title={`${drillPath} 历史大小趋势`} bordered={false}>
                {trend.length >= 2 ? (
                  <TrendChart points={trend} />
                ) : (
                  <Empty description="历史数据不足，暂无趋势" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          </Row>
          <Button style={{ marginTop: 16 }} onClick={() => setDrillPath(null)}>
            返回排行
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 加路由与导航（两个文件各一次 SearchReplace）**

`config/config.ts` routes 在 `{ path: '/folders', ... }` 后插入：
```ts
{ path: '/trends', name: '趋势分析', component: './Trends' },
```

`src/layouts/index.tsx`：import 行 `import { DashboardOutlined, DatabaseOutlined, FolderOpenOutlined, HddOutlined, ReadOutlined, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons';` 中追加 `LineChartOutlined`（同一次 SearchReplace），并在 `{ key: '/folders', ... }` 后插入：
```tsx
{ key: '/trends', icon: <LineChartOutlined />, label: '趋势分析' },
```

- [ ] **Step 4: tsc 验证**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "src/pages/Trends"`
Expected: 无输出（零错误）

- [ ] **Step 5: 浏览器验证**

`npm run dev`，访问 `http://localhost:8001/trends`：切换窗口、自定义小时、点击排行条目下钻、面包屑返回、趋势折线图渲染正常；无历史时显示引导提示。

- [ ] **Step 6: 提交（需用户确认）**

```bash
git add src/components/TrendChart.tsx src/pages/Trends/index.tsx config/config.ts src/layouts/index.tsx
git commit -m "feat: add growth trends page with ranking, drill-down and trend chart"
```

---

### Task 7: 历史快照管理页（History + 路由导航）

**Files:**
- Create: `src/pages/History/index.tsx`
- Modify: `config/config.ts`（加 `/history` 路由）
- Modify: `src/layouts/index.tsx`（menuItems 加「历史快照」，import 加 `HistoryOutlined`）

**Interfaces:**
- Consumes: Task 5 的 `getHistory/deleteHistory` 与类型、`formatGB/formatSize`
- Produces: `/history` 页面：年/月/日/时组合筛选、快照表格（时间/磁盘已用/目录数/文件数/快照大小/未扫描/操作）、单条删除（Popconfirm）、批量「删除筛选结果」（至少一个筛选条件才启用）

- [ ] **Step 1: 创建 src/pages/History/index.tsx**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Popconfirm, Select, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined } from '@ant-design/icons';
import type { DeleteHistoryFilter, HistorySnapshot } from '@/services/history';
import { deleteHistory, getHistory } from '@/services/history';
import { formatGB, formatSize } from '@/utils/format';

const parseT = (s: string) => new Date(s.replace(' ', 'T'));

export default function HistoryPage() {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [totalSizeMB, setTotalSizeMB] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [day, setDay] = useState<number | undefined>();
  const [hour, setHour] = useState<number | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getHistory();
      setSnapshots(d.snapshots);
      setTotalSizeMB(d.totalSizeMB);
    } catch {
      setSnapshots([]);
      setTotalSizeMB(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(
    () => [...new Set(snapshots.map((s) => parseT(s.scannedAt).getFullYear()))].sort(),
    [snapshots],
  );
  const months = useMemo(
    () =>
      year == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year).map((s) => parseT(s.scannedAt).getMonth() + 1))].sort((a, b) => a - b),
    [snapshots, year],
  );
  const days = useMemo(
    () =>
      month == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year && parseT(s.scannedAt).getMonth() + 1 === month).map((s) => parseT(s.scannedAt).getDate()))].sort((a, b) => a - b),
    [snapshots, year, month],
  );
  const hours = useMemo(
    () =>
      day == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year && parseT(s.scannedAt).getMonth() + 1 === month && parseT(s.scannedAt).getDate() === day).map((s) => parseT(s.scannedAt).getHours()))].sort((a, b) => a - b),
    [snapshots, year, month, day],
  );

  const filtered = useMemo(
    () =>
      snapshots.filter((s) => {
        const t = parseT(s.scannedAt);
        if (year != null && t.getFullYear() !== year) return false;
        if (month != null && t.getMonth() + 1 !== month) return false;
        if (day != null && t.getDate() !== day) return false;
        if (hour != null && t.getHours() !== hour) return false;
        return true;
      }),
    [snapshots, year, month, day, hour],
  );

  const hasAnyFilter = year != null || month != null || day != null || hour != null;

  const del = useCallback(
    async (filter: DeleteHistoryFilter, label: string) => {
      try {
        const r = await deleteHistory(filter);
        setMsg(`已删除 ${r.deleted} 个快照${label}`);
        await load();
      } catch (e) {
        setMsg(`删除失败：${e instanceof Error ? e.message : '未知错误'}`);
      }
    },
    [load],
  );

  const columns: ColumnsType<HistorySnapshot> = [
    { title: '快照时间', dataIndex: 'scannedAt', key: 'scannedAt', width: 180 },
    {
      title: '磁盘已用',
      dataIndex: 'disk',
      key: 'disk',
      width: 110,
      align: 'right',
      render: (d: HistorySnapshot['disk']) => formatGB(d?.usedGB),
    },
    {
      title: '目录数',
      dataIndex: 'dirCount',
      key: 'dirCount',
      width: 110,
      align: 'right',
      render: (v: number) => v?.toLocaleString() ?? '—',
    },
    {
      title: '文件数',
      dataIndex: 'fileCount',
      key: 'fileCount',
      width: 120,
      align: 'right',
      render: (v: number) => v?.toLocaleString() ?? '—',
    },
    {
      title: '快照大小',
      dataIndex: 'fileSizeMB',
      key: 'fileSizeMB',
      width: 100,
      align: 'right',
      render: (v: number) => formatSize((v || 0) * 1024 * 1024),
    },
    {
      title: '未扫描',
      dataIndex: 'unscannedDirs',
      key: 'unscannedDirs',
      width: 80,
      align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="orange">{v}</Tag> : '—'),
    },
    {
      title: '操作',
      key: 'op',
      width: 90,
      render: (_, r) => (
        <Popconfirm
          title="确认删除该快照？"
          description="删除后无法恢复，趋势分析将不再使用该时间点。"
          onConfirm={() => del({ ids: [r.id] }, '')}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title="历史快照"
      bordered={false}
      extra={
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          共 {snapshots.length} 个快照，占用 {formatSize(totalSizeMB * 1024 * 1024)}
        </span>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="每次扫描都会自动记录一次全盘快照，可按年/月/日/时筛选并删除，释放磁盘空间。"
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <Select
          placeholder="年份"
          allowClear
          style={{ width: 110 }}
          value={year}
          options={years.map((y) => ({ value: y, label: `${y} 年` }))}
          onChange={setYear}
        />
        <Select
          placeholder="月份"
          allowClear
          style={{ width: 100 }}
          value={month}
          disabled={year == null || months.length === 0}
          options={months.map((m) => ({ value: m, label: `${m} 月` }))}
          onChange={setMonth}
        />
        <Select
          placeholder="日期"
          allowClear
          style={{ width: 100 }}
          value={day}
          disabled={month == null || days.length === 0}
          options={days.map((d) => ({ value: d, label: `${d} 日` }))}
          onChange={setDay}
        />
        <Select
          placeholder="小时"
          allowClear
          style={{ width: 100 }}
          value={hour}
          disabled={day == null || hours.length === 0}
          options={hours.map((h) => ({ value: h, label: `${h} 时` }))}
          onChange={setHour}
        />
        <Popconfirm
          title={`确认删除筛选出的 ${filtered.length} 个快照？`}
          description="删除后无法恢复。"
          disabled={filtered.length === 0 || !hasAnyFilter}
          onConfirm={() => del({ year, month, day, hour }, `（筛选 ${filtered.length} 条）`)}
        >
          <Button danger icon={<DeleteOutlined />} disabled={filtered.length === 0 || !hasAnyFilter}>
            删除筛选结果
          </Button>
        </Popconfirm>
        {msg && <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{msg}</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Table<HistorySnapshot>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 条` }}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 2: 加路由与导航（两个文件各一次 SearchReplace）**

`config/config.ts` routes 在 `{ path: '/guide', ... }` 后插入：
```ts
{ path: '/history', name: '历史快照', component: './History' },
```

`src/layouts/index.tsx`：import 行追加 `HistoryOutlined`（与 Task 6 的 `LineChartOutlined` 在同一行追加，若 Task 6 已完成则本次 SearchReplace 的 old_str 需包含当前完整 import 行），并在 `{ key: '/guide', ... }` 后插入：
```tsx
{ key: '/history', icon: <HistoryOutlined />, label: '历史快照' },
```

- [ ] **Step 3: tsc 验证**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "src/pages/History"`
Expected: 无输出（零错误）

- [ ] **Step 4: 浏览器验证**

`npm run dev`，访问 `http://localhost:8001/history`：筛选联动（年→月→日→时）、单条删除、批量删除、删除后列表与总占用更新。

- [ ] **Step 5: 提交（需用户确认）**

```bash
git add src/pages/History/index.tsx config/config.ts src/layouts/index.tsx
git commit -m "feat: add history snapshot management page"
```

---

### Task 8: Dashboard 提权引导提示 + 全量验证

**Files:**
- Modify: `src/pages/Dashboard/index.tsx`

**Interfaces:**
- Consumes: 现有 `useModel('scan')` 的 `data.topFolders`（unscanned 数量）
- Produces: 概览页在存在未扫描目录时展示「以管理员身份运行」引导 Alert

- [ ] **Step 1: 修改 Dashboard（同一次 SearchReplace，import 与代码合并）**

`src/pages/Dashboard/index.tsx` 第 2 行 import 改为（追加 `Alert`，其余不变）：
```tsx
import { Alert, Button, Card, Col, Empty, Row, Spin } from 'antd';
```
并将顶部目录卡内的未扫描提示替换为：
```tsx
            {unscannedCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message={`检测到 ${unscannedCount} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。`}
              />
            )}
```
（原代码为 `{unscannedCount > 0 && (<div ...>{unscannedCount} 个目录因权限不足未扫描（不影响使用）</div>)}`）

- [ ] **Step 2: 全量 tsc 验证**

Run: `npx tsc --noEmit --pretty 2>&1`
Expected: 无新错误（预存错误 src/app.tsx、src/pages/404、src/setup/theme.tsx 除外）

- [ ] **Step 3: 后端测试 + 生产构建 + 全链路**

Run:
```bash
node --test server/tests/
npm run build
npm run server
```
Expected：全部测试通过；构建成功；浏览器访问 `http://localhost:8090` 六页导航齐全（概览/目录排行/趋势分析/大文件/清理建议/操作手册/历史快照），重新扫描后 `history/` 新增快照、趋势分析页出现可下钻数据、历史快照页可删除。

- [ ] **Step 4: 提交（需用户确认）**

```bash
git add src/pages/Dashboard/index.tsx
git commit -m "feat: add admin-run guidance on dashboard for unscanned folders"
```

---

## Self-Review

**1. Spec coverage：**
- 记录粒度（全目录树）→ Task 2 `runRobocopyTree` + `accumulateLines` 自底向上累加 ✓
- 存储（history/ + index.json + gzip TSV）→ Task 1 ✓
- 仅手动按时间删除 → Task 1 `deleteSnapshots`（年/月/日/时/ids）+ Task 7 管理页 ✓
- 增长窗口 1y/6m/1m/15d/10d/5d/2d/1d/自定义小时 → Task 3 `parseWindowLabel` + Task 6 Segmented/自定义 ✓
- 增长量排行 Top N + 持续膨胀双标记 → Task 3 `computeGrowthTop` + `isSustained`（1d/7d/30d 锚点）✓
- 活跃程度分档（极高/高/中/低）→ Task 3 `tierOf` + Task 6 展示 ✓
- 逐层下钻 → Task 3 `computeGrowthDir`（直接子目录 + hasChildren）+ Task 6 下钻表格/面包屑 ✓
- 目录趋势序列 → Task 3 `computeGrowthTrend` + Task 6 `TrendChart`（自绘 SVG）✓
- 提权引导提示 → Task 8 Dashboard + Task 6 Trends 页 Alert ✓
- 扫描后自动快照、快照失败不阻塞 → Task 4 POST /api/scan ✓
- 边界（首次/窗口不足/目录新增删除/未扫描/一致性校验/删除全部）→ Task 1/3 各函数 + 测试 ✓

**2. Placeholder scan：** 无 TBD/TODO；每个 Step 含完整代码或精确命令。

**3. Type consistency：**
- `GrowthEntry.path/size/growth/tier/sustained`、`GrowthDirEntry.name/hasChildren` 在 Task 3 服务端与 Task 5 前端类型一一对应 ✓
- `parseWindowLabel` 的 `1y/6m/1m/15d/10d/5d/2d/1d/<N>h` 与 Task 6 `WINDOW_OPTIONS` 的 value 一致（`1m` 默认）✓
- `deleteSnapshots(filter)` 的 `{ ids, year, month, day, hour, before }` 与 `DeleteHistoryFilter`、Task 7 的 `del()` 调用一致 ✓
- `GrowthTopResult` 的 `insufficient/unscannedDirs/compareAt/actualWindowDays` 服务端返回与前端使用一致 ✓
- 测试用例中 `writeFakeSnapshots` 的 index 结构（id/scannedAt/disk/dirCount/fileCount/fileSizeMB/unscannedDirs/warning）与 `SnapshotMeta` 一致 ✓

## Execution Handoff

计划已保存至 `docs/superpowers/plans/2026-09-16-growth-history.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派发独立子代理实现，任务间我审查，迭代快

**2. Inline Execution** — 本会话内按 executing-plans 批量执行，带检查点

选哪种？
