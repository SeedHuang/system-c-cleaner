/**
 * C 盘分析 - 历史快照与增长趋势数据层
 * 存储：history/<id>.tsv.gz（每行 path<TAB>bytes，gzip 压缩）；索引 history/index.json
 * 纯函数与 I/O 分离，便于 node --test 单测。
 */
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { resolvePaths } = require('./config');

const paths = resolvePaths();
const ROOT = paths.root;
const HISTORY_DIR = paths.historyDir;

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
    dirMap.set(acc + '\\', (dirMap.get(acc + '\\') || 0) + size);
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
  accumulateLines,
  buildSnapshot,
  parseWindowLabel,
  pickCompareId,
  diffMaps,
  tierOf,
  isSustained,
  computeGrowthTop,
  computeGrowthDir,
  computeGrowthTrend,
};
