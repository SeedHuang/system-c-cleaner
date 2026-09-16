# Task 3 Brief: 增长分析（窗口差值 + 排行 + 双标记 + 下钻 + 趋势）

项目：d:\Seed\system-c-cleaner（C 盘分析工具）。本任务在 server/history.js（已实现存储层 + 全树快照捕获）上追加增长分析函数，供 Task 4 的 API 路由调用。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 运行测试：`npm test` 或 `node --test server/tests/history.test.js`。
- 禁止安装 npm 依赖；不运行 npm install / postinstall。
- 文件编辑用 Write/SearchReplace 工具。
- 不要动 `server/tests/history.test.js` 里已有的 5 个用例；在其后追加新用例。
- 不要派生子代理。

## 存储键格式裁定（重要，来自 Task 2）

快照 Map 的键格式：**根目录 `c:\`（带尾斜杠），其余目录 `c:\users` 等（无尾斜杠）**。
因此 computeGrowthDir / computeGrowthTrend 的路径归一化**必须**用下面代码块里给出的 key/prefix 逻辑（不是简单地 `replace(/[\\/]+$/,'')` 后直接当 key，否则根目录查不到）。

## Files

- Modify: `server/history.js`
- Modify: `server/tests/history.test.js`（文件顶部需补 `const zlib = require('zlib');`）

## Interfaces

- Consumes: Task 1 已导出的 `readIndex`、`loadSnapshotMap`
- Produces（追加到 module.exports）：
  - `parseWindowLabel(label) → { ms, label } | null`（`1y/6m/1m/15d/10d/5d/2d/1d/<N>h`；1y=365天、1m=30天；非法返回 null）
  - `pickCompareId(index, nowMs, windowMs) → { id, actualWindowDays } | { id: null }`（最近但不晚于 now-window；不足用最早快照；仅 1 条时 id=null）
  - `diffMaps(latest, compare) → Map<string, { size, growth }>`（三态：新增=全额、删除=负、未扫描=跳过）
  - `tierOf(growthBytes) → 'extreme'|'high'|'medium'|'low'`
  - `isSustained(day, week, month, thresholdBytes = 1GB) → boolean`
  - `computeGrowthTop({ window, top }, historyDir = HISTORY_DIR, nowMs = Date.now()) → Promise<GrowthTopResult>`
  - `computeGrowthDir({ path, window }, historyDir = HISTORY_DIR, nowMs = Date.now()) → Promise<GrowthDirResult>`
  - `computeGrowthTrend({ path, points }, historyDir = HISTORY_DIR) → Promise<GrowthTrendResult>`
  - 内部辅助（不导出）：`growthFor(latest, compare, p)`、`loadAnchorGrowth(index, latestId, paths, historyDir, nowMs)`

类型（JSON 结构）：
- `GrowthTopResult = { window, scannedAt, compareAt, actualWindowDays, insufficient, unscannedDirs, entries: [{ path, size, growth, tier, sustained }] }`
- `GrowthDirEntry = { path, name, size, growth, tier, sustained, hasChildren }`
- `GrowthDirResult = { path, window, actualWindowDays, insufficient, entries: GrowthDirEntry[] }`
- `GrowthTrendResult = { path, points: [{ t, size }] }`

## Steps

### Step 1: 写失败测试

在 `server/tests/history.test.js` 末尾追加（先确认文件顶部有 `const zlib = require('zlib');`，没有就补上；`fs/os/path` 已存在）：

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

### Step 2: 运行测试确认失败

Run: `node --test server/tests/history.test.js`
Expected: FAIL，报 `history.parseWindowLabel is not a function`

### Step 3: 实现

在 `server/history.js` 中（`buildSnapshot` 之后、`module.exports` 之前）追加：

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

/** 路径归一化（匹配存储键格式）：根目录 'c:\' 带尾斜杠，其余无尾斜杠 */
function normalizeKey(p) {
  const raw = String(p || 'c:\\').toLowerCase().replace(/[\\/]+$/, '');
  return raw === 'c:' ? 'c:\\' : raw;
}

async function computeGrowthDir({ path: p = 'c:\\', window = '1m' } = {}, historyDir = HISTORY_DIR, nowMs = Date.now()) {
  const w = parseWindowLabel(window);
  const index = readIndex(historyDir);
  const sorted = [...index.snapshots].sort((a, b) => new Date(b.scannedAt.replace(' ', 'T')) - new Date(a.scannedAt.replace(' ', 'T')));
  const latest = sorted[0];
  if (!w || !latest) return { path: p, window, insufficient: true, entries: [] };
  const compare = pickCompareId(index, nowMs, w.ms);
  if (!compare.id) return { path: p, window, insufficient: true, entries: [] };
  const key = normalizeKey(p);
  const prefix = key === 'c:\\' ? 'c:\\' : key + '\\';
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
  return { path: key, window, actualWindowDays: compare.actualWindowDays, insufficient: false, entries: children };
}

async function computeGrowthTrend({ path: p = 'c:\\', points = 60 } = {}, historyDir = HISTORY_DIR) {
  const index = readIndex(historyDir);
  const sorted = [...index.snapshots].sort((a, b) => new Date(a.scannedAt.replace(' ', 'T')) - new Date(b.scannedAt.replace(' ', 'T')));
  const key = normalizeKey(p);
  const use = sorted.slice(-Math.min(Math.max(points, 5), 120), sorted.length);
  const out = [];
  for (const s of use) {
    const m = await loadSnapshotMap(s.id, historyDir);
    const size = m.get(key);
    out.push({ t: s.scannedAt, size: size == null ? null : size });
  }
  return { path: key, points: out };
}
```

在 `module.exports` 中追加：`parseWindowLabel, pickCompareId, diffMaps, tierOf, isSustained, computeGrowthTop, computeGrowthDir, computeGrowthTrend`（`normalizeKey/growthFor/loadAnchorGrowth` 不导出）。

### Step 4: 运行测试确认通过

Run: `node --test server/tests/history.test.js`
Expected: PASS（11 个用例）

### Step 5: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-3-report.md` 写入完整报告（实现说明、测试命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、测试摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要运行 robocopy 实扫。
