const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
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
  assert.strictEqual(r.historyDir, dir);
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

test('parseRangeDate 起点/终点与非法格式', () => {
  assert.strictEqual(history.parseRangeDate('2026-09-01'), new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
  assert.strictEqual(history.parseRangeDate('2026-09-01', 'end'), new Date(2026, 8, 1, 23, 59, 59, 999).getTime());
  assert.strictEqual(history.parseRangeDate('2026-9-1'), null); // 必须补零
  assert.strictEqual(history.parseRangeDate('2026-02-30'), null); // 不存在的日期不能被 Date 归一化
  assert.strictEqual(history.parseRangeDate('2026-13-01'), null);
  assert.strictEqual(history.parseRangeDate(''), null);
  assert.strictEqual(history.parseRangeDate(null), null);
});

test('parseRangeDate 支持时分（分钟粒度）：起点取 :00.000、终点取 :59.999', () => {
  assert.strictEqual(history.parseRangeDate('2026-09-01 09:15'), new Date(2026, 8, 1, 9, 15, 0, 0).getTime());
  assert.strictEqual(history.parseRangeDate('2026-09-01 09:15', 'end'), new Date(2026, 8, 1, 9, 15, 59, 999).getTime());
  // 「今天」预设的终点：23:59 → 23:59:59.999，与整天语义对齐
  assert.strictEqual(history.parseRangeDate('2026-09-01 23:59', 'end'), new Date(2026, 8, 1, 23, 59, 59, 999).getTime());
});

test('parseRangeDate 支持秒（秒粒度）与非法时分秒', () => {
  assert.strictEqual(history.parseRangeDate('2026-09-01 09:15:30'), new Date(2026, 8, 1, 9, 15, 30, 0).getTime());
  assert.strictEqual(history.parseRangeDate('2026-09-01 09:15:30', 'end'), new Date(2026, 8, 1, 9, 15, 30, 999).getTime());
  assert.strictEqual(history.parseRangeDate('2026-09-01 24:00'), null); // 小时越界
  assert.strictEqual(history.parseRangeDate('2026-09-01 12:60'), null); // 分钟越界
  assert.strictEqual(history.parseRangeDate('2026-09-01 12:00:60'), null); // 秒越界
  assert.strictEqual(history.parseRangeDate('2026-09-01 12'), null); // 缺分钟
  assert.strictEqual(history.parseRangeDate('2026-09-01 1:05'), null); // 必须补零
  assert.strictEqual(history.parseRangeDate('2026-09-01T09:15'), null); // 只接受空格分隔
  assert.strictEqual(history.parseRangeDate('2026-02-30 09:15'), null); // 不存在的日期
});

test('parseRange 支持分钟粒度（前端 RangePicker 传参格式）', () => {
  const r = history.parseRange({ from: '2026-09-01 09:15', to: '2026-09-01 18:30' });
  assert.strictEqual(r.fromMs, new Date(2026, 8, 1, 9, 15, 0, 0).getTime());
  assert.strictEqual(r.toMs, new Date(2026, 8, 1, 18, 30, 59, 999).getTime());
  assert.strictEqual(history.parseRange({ from: '2026-09-01 18:30', to: '2026-09-01 09:15' }), null); // from > to
});

test('parseRange 合法区间与非法组合', () => {
  const r = history.parseRange({ from: '2026-09-01', to: '2026-09-15' });
  assert.strictEqual(r.fromMs, new Date(2026, 8, 1).getTime());
  assert.strictEqual(r.toMs, new Date(2026, 8, 15, 23, 59, 59, 999).getTime());
  assert.strictEqual(history.parseRange({ from: '2026-09-15', to: '2026-09-01' }), null); // from > to
  assert.strictEqual(history.parseRange({ from: '2026-09-01' }), null); // 缺 to
  assert.strictEqual(history.parseRange({ to: '2026-09-01' }), null); // 缺 from
  assert.strictEqual(history.parseRange({ from: '2026-09-01', to: 'bad' }), null);
  assert.strictEqual(history.parseRange({}), null);
  assert.strictEqual(history.parseRange(), null);
});

/** 便于按 from/to 字符串直接调 pickRangePair */
function pickRangePairOf(index, from, to) {
  const r = history.parseRange({ from, to });
  return history.pickRangePair(index, r.fromMs, r.toMs);
}

function snapIndex(arr) {
  return { snapshots: arr.map(([id, s]) => ({ id, scannedAt: s })) };
}

const RANGE_FIXTURE = snapIndex([
  ['a', '2026-08-10 10:00:00'],
  ['b', '2026-09-02 10:00:00'],
  ['c', '2026-09-10 10:00:00'],
  ['d', '2026-09-20 10:00:00'],
]);

test('pickRangePair 端点取 ≤to、基准取 ≤from（区间开始前最后一帧）', () => {
  const r = pickRangePairOf(RANGE_FIXTURE, '2026-09-01', '2026-09-15');
  assert.strictEqual(r.latestId, 'c'); // ≤ 9/15 的最后一条
  assert.strictEqual(r.compareId, 'a'); // ≤ 9/01 的最后一条（即区间开始前的那一帧）
  assert.strictEqual(r.actualDays, 31); // 8/10 → 9/10
});

test('pickRangePair from 早于所有快照时基准回退最早一条', () => {
  const r = pickRangePairOf(RANGE_FIXTURE, '2026-07-01', '2026-09-05');
  assert.strictEqual(r.latestId, 'b');
  assert.strictEqual(r.compareId, 'a');
});

test('pickRangePair 不可比场景（端点仍返回、基准为 null）', () => {
  // to 早于所有快照 → 端点不存在
  assert.deepStrictEqual(
    pickRangePairOf(RANGE_FIXTURE, '2026-07-01', '2026-08-01'),
    { latestId: null, compareId: null, actualDays: null },
  );
  // 区间内没有新快照 → 端点与基准是同一条（b），无法算增长
  assert.deepStrictEqual(
    pickRangePairOf(RANGE_FIXTURE, '2026-09-05', '2026-09-06'),
    { latestId: 'b', compareId: null, actualDays: null },
  );
  // from==to 且当天 00:00~23:59 无快照 → 端点与基准同为 a
  assert.deepStrictEqual(
    pickRangePairOf(RANGE_FIXTURE, '2026-08-20', '2026-08-20'),
    { latestId: 'a', compareId: null, actualDays: null },
  );
  // 仅一条快照 → 端点即该条，基准无
  assert.deepStrictEqual(
    pickRangePairOf(snapIndex([['a', '2026-09-10 10:00:00']]), '2026-09-01', '2026-09-15'),
    { latestId: 'a', compareId: null, actualDays: null },
  );
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
  assert.strictEqual(users.tier, 'low'); // 简报原为 'medium'，但 fake 数据 growth=600(字节) 按 tierOf 字节阈值应为 'low'（见 task-3-report.md 偏差记录）
});

test('computeGrowthTop 区间模式：端点/基准按日期取，window 回显 null', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir,
    new Map([['c:\\', 1000], ['c:\\users', 800], ['c:\\users\\a', 300]]),
    new Map([['c:\\', 500], ['c:\\users', 200], ['c:\\users\\a', 50]]),
  );
  const r = await history.computeGrowthTop({ from: '2026-07-01', to: '2026-09-30', top: 10 }, dir, nowMs);
  assert.strictEqual(r.insufficient, false);
  assert.strictEqual(r.window, null);
  assert.strictEqual(r.rangeFrom, '2026-07-01');
  assert.strictEqual(r.rangeTo, '2026-09-30');
  assert.strictEqual(r.scannedAt, '2026-09-16 11:00:00'); // 端点 = ≤9/30 的最后一条
  assert.strictEqual(r.compareAt, '2026-08-01 10:00:00'); // 基准 = 区间开始前那一帧
  assert.strictEqual(r.entries.find((e) => e.path === 'c:\\users').growth, 600);
});

test('computeGrowthTop 区间内无新快照 → insufficient，区间信息仍回显', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir, new Map([['c:\\', 1000]]), new Map([['c:\\', 500]]));
  const r = await history.computeGrowthTop({ from: '2026-07-01', to: '2026-08-15', top: 10 }, dir, nowMs);
  assert.strictEqual(r.insufficient, true);
  assert.strictEqual(r.window, null);
  assert.strictEqual(r.rangeFrom, '2026-07-01');
  assert.strictEqual(r.rangeTo, '2026-08-15');
  assert.strictEqual(r.scannedAt, '2026-08-01 10:00:00'); // 端点仍是区间内最后一条，供前端显示
});

test('computeGrowthTop 区间非法时回落窗口模式', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir, new Map([['c:\\', 1000]]), new Map([['c:\\', 500]]));
  const r = await history.computeGrowthTop({ window: '1m', from: 'bad', to: '2026-09-30' }, dir, nowMs);
  assert.strictEqual(r.window, '1m');
  assert.strictEqual(r.rangeFrom, null);
  assert.strictEqual(r.insufficient, false);
});

test('computeGrowthDir 区间模式回显区间并正常下钻', async () => {
  const dir = tmpDir();
  const nowMs = Date.parse('2026-09-16T12:00:00');
  await writeFakeSnapshots(dir,
    new Map([['c:\\', 1000], ['c:\\users', 800], ['c:\\users\\a', 300], ['c:\\windows', 200]]),
    new Map([['c:\\', 500], ['c:\\users', 200], ['c:\\users\\a', 50], ['c:\\windows', 150]]),
  );
  const r = await history.computeGrowthDir({ path: 'c:\\', from: '2026-07-01', to: '2026-09-30' }, dir, nowMs);
  assert.strictEqual(r.insufficient, false);
  assert.strictEqual(r.window, null);
  assert.strictEqual(r.rangeFrom, '2026-07-01');
  assert.deepStrictEqual(r.entries.map((e) => e.name).sort(), ['users', 'windows']);
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

test('resolvePaths.historyDir 与 HISTORY_DIR 一致（可配置）', () => {
  const { resolvePaths } = require('../config.js');
  const history = require('../history.js');
  const p = resolvePaths({ CLEANER_DATA_DIR: 'D:/ud' });
  // 偏差：简报断言 'D:/ud/history'，但 Windows 上 path.join 会把正斜杠规范化为反斜杠（'D:\\ud\\history'）
  assert.strictEqual(p.historyDir, path.join('D:/ud', 'history'));
});
