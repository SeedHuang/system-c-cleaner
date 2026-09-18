/**
 * 数据迁移测试（从 %APPDATA%\c-drive-cleaner 迁到 %USERPROFILE%\.system-c-cleaner）
 * 设计：始终「合并」——新位置有数据时不去重 / 只合并 / 保留两边。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const { runMigrate } = require('./migrate-data');

function tmpPair() {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-old-'));
  const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-new-'));
  return { oldDir, newDir };
}

async function cleanup(d) {
  try { await fsp.rm(d, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ }
}

test('runMigrate：旧目录不存在 → 直接返回，新位置不动', async () => {
  const { oldDir, newDir } = tmpPair();
  await cleanup(oldDir);
  await fsp.writeFile(path.join(newDir, 'sentinel.json'), 'keep');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.reason, 'old-empty');
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'sentinel.json'), 'utf8'), 'keep');
  await cleanup(newDir);
});

test('runMigrate：oldDir === newDir → 直接返回', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-same-'));
  await fsp.writeFile(path.join(dir, 'scan-result.json'), 'x');
  const r = await runMigrate({ oldDir: dir, newDir: dir, log: () => {} });
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.reason, 'same-dir');
  assert.strictEqual(await fsp.readFile(path.join(dir, 'scan-result.json'), 'utf8'), 'x');
  await cleanup(dir);
});

test('runMigrate：旧有数据 → 合并到新位置（顶层文件 + history + logs）', async () => {
  const { oldDir, newDir } = tmpPair();
  // 准备老位置：history 必须有 index.json 才会被合并
  await fsp.writeFile(path.join(oldDir, 'scan-result.json'), '{"x":1}');
  await fsp.writeFile(path.join(oldDir, 'scheduler-state.json'), '{"y":2}');
  await fsp.mkdir(path.join(oldDir, 'history'), { recursive: true });
  await fsp.writeFile(path.join(oldDir, 'history', 'index.json'), JSON.stringify({
    snapshots: [{ id: 'a', scannedAt: '2026-09-10 10:00:00' }],
  }));
  await fsp.writeFile(path.join(oldDir, 'history', 'a.tsv.gz'), 'gz');
  await fsp.mkdir(path.join(oldDir, 'logs'), { recursive: true });
  await fsp.writeFile(path.join(oldDir, 'logs', 'main-2026-09-17.log'), 'log');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);
  // 顶层文件、history、logs 都搬过来
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'scan-result.json'), 'utf8'), '{"x":1}');
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'scheduler-state.json'), 'utf8'), '{"y":2}');
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'history', 'a.tsv.gz'), 'utf8'), 'gz');
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'logs', 'main-2026-09-17.log'), 'utf8'), 'log');
  // 老位置出现 .migrated-to，内容是新路径
  assert.strictEqual(await fsp.readFile(path.join(oldDir, '.migrated-to'), 'utf8'), newDir);
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：不拷贝 settings.json', async () => {
  const { oldDir, newDir } = tmpPair();
  await fsp.writeFile(path.join(oldDir, 'settings.json'), '{"autoScan":false}');
  await fsp.writeFile(path.join(oldDir, 'scan-result.json'), '{}');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);
  assert.strictEqual(fs.existsSync(path.join(newDir, 'settings.json')), false);
  assert.strictEqual(fs.existsSync(path.join(newDir, 'scan-result.json')), true);
  assert.strictEqual(fs.existsSync(path.join(oldDir, 'settings.json')), true);
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：index.json 兼容 UTF-8 BOM（PowerShell Set-Content 默认编码）', async () => {
  const { oldDir, newDir } = tmpPair();
  await fsp.mkdir(path.join(oldDir, 'history'), { recursive: true });
  await fsp.writeFile(path.join(oldDir, 'history', 'index.json'), '\uFEFF' + JSON.stringify({
    snapshots: [{ id: 'a', scannedAt: '2026-09-10 10:00:00' }],
  }));
  await fsp.writeFile(path.join(oldDir, 'history', 'a.tsv.gz'), 'A');
  await fsp.mkdir(path.join(newDir, 'history'), { recursive: true });
  // 新位置也加 BOM，验证双向都能解析
  await fsp.writeFile(path.join(newDir, 'history', 'index.json'), '\uFEFF' + JSON.stringify({
    snapshots: [{ id: 'c', scannedAt: '2026-09-12 10:00:00' }],
  }));
  await fsp.writeFile(path.join(newDir, 'history', 'c.tsv.gz'), 'C');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);
  const merged = JSON.parse(await fsp.readFile(path.join(newDir, 'history', 'index.json'), 'utf8'));
  assert.deepStrictEqual(merged.snapshots.map((s) => s.id), ['a', 'c']);
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：index.json 按 id 合并且按时间升序；新旧都有的 id 不重复', async () => {
  const { oldDir, newDir } = tmpPair();
  // 老位置：a, b
  await fsp.mkdir(path.join(oldDir, 'history'), { recursive: true });
  await fsp.writeFile(path.join(oldDir, 'history', 'index.json'), JSON.stringify({
    snapshots: [
      { id: 'a', scannedAt: '2026-09-10 10:00:00' },
      { id: 'b', scannedAt: '2026-09-15 10:00:00' },
    ],
  }));
  await fsp.writeFile(path.join(oldDir, 'history', 'a.tsv.gz'), 'A');
  await fsp.writeFile(path.join(oldDir, 'history', 'b.tsv.gz'), 'B');
  // 新位置：c（用户已有数据）
  await fsp.mkdir(path.join(newDir, 'history'), { recursive: true });
  await fsp.writeFile(path.join(newDir, 'history', 'index.json'), JSON.stringify({
    snapshots: [
      { id: 'c', scannedAt: '2026-09-12 10:00:00' },
    ],
  }));
  await fsp.writeFile(path.join(newDir, 'history', 'c.tsv.gz'), 'C');

  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);

  // index.json 合并：a（09-10）、c（09-12）、b（09-15）按 scannedAt 升序
  const merged = JSON.parse(await fsp.readFile(path.join(newDir, 'history', 'index.json'), 'utf8'));
  assert.deepStrictEqual(merged.snapshots.map((s) => s.id), ['a', 'c', 'b']);
  // 三个快照文件都在新位置
  for (const id of ['a', 'b', 'c']) {
    assert.strictEqual(fs.existsSync(path.join(newDir, 'history', `${id}.tsv.gz`)), true, `缺 ${id}.tsv.gz`);
  }
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：旧 index.json 列了 id 但 .tsv.gz 文件缺失 → 跳过该快照，不污染新 index', async () => {
  const { oldDir, newDir } = tmpPair();
  await fsp.mkdir(path.join(oldDir, 'history'), { recursive: true });
  // index 列了 a、b；但只有 a 文件存在
  await fsp.writeFile(path.join(oldDir, 'history', 'index.json'), JSON.stringify({
    snapshots: [
      { id: 'a', scannedAt: '2026-09-10 10:00:00' },
      { id: 'b', scannedAt: '2026-09-15 10:00:00' }, // b 文件缺失
    ],
  }));
  await fsp.writeFile(path.join(oldDir, 'history', 'a.tsv.gz'), 'A');

  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);

  const merged = JSON.parse(await fsp.readFile(path.join(newDir, 'history', 'index.json'), 'utf8'));
  // 只搬了 a；b 因为文件缺失被剔除
  assert.deepStrictEqual(merged.snapshots.map((s) => s.id), ['a']);
  assert.strictEqual(fs.existsSync(path.join(newDir, 'history', 'a.tsv.gz')), true);
  assert.strictEqual(fs.existsSync(path.join(newDir, 'history', 'b.tsv.gz')), false);
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：新已有顶层 scan-result.json 时保留新值，只补缺失顶层文件', async () => {
  const { oldDir, newDir } = tmpPair();
  // 新位置已有 scan-result.json
  await fsp.writeFile(path.join(newDir, 'scan-result.json'), 'new-data');
  // 老位置也有 scan-result.json + scheduler-state.json
  await fsp.writeFile(path.join(oldDir, 'scan-result.json'), 'old-data');
  await fsp.writeFile(path.join(oldDir, 'scheduler-state.json'), '{"y":2}');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);
  // 新位置 scan-result.json 没被覆盖
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'scan-result.json'), 'utf8'), 'new-data');
  // scheduler-state.json 被补过来
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'scheduler-state.json'), 'utf8'), '{"y":2}');
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：旧位置完全是空目录 → 也返回 migrated=false，但不报错', async () => {
  const { oldDir, newDir } = tmpPair();
  // oldDir 是空目录（mkdtempSync 默认创建的就是空）
  // 验证迁移仍会写标记并把空目录"标记"为已迁移
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  // 空目录 → 无可搬 → 不算成功迁移
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.reason, 'old-empty');
  await cleanup(oldDir); await cleanup(newDir);
});

test('runMigrate：logs/ 按文件名去重（同名日志同日期不复制）', async () => {
  const { oldDir, newDir } = tmpPair();
  await fsp.mkdir(path.join(oldDir, 'logs'), { recursive: true });
  await fsp.writeFile(path.join(oldDir, 'logs', 'main-2026-09-17.log'), 'old-log');
  await fsp.mkdir(path.join(newDir, 'logs'), { recursive: true });
  await fsp.writeFile(path.join(newDir, 'logs', 'main-2026-09-17.log'), 'new-log');
  const r = await runMigrate({ oldDir, newDir, log: () => {} });
  assert.strictEqual(r.migrated, true);
  // 同名日志保留新的
  assert.strictEqual(await fsp.readFile(path.join(newDir, 'logs', 'main-2026-09-17.log'), 'utf8'), 'new-log');
  await cleanup(oldDir); await cleanup(newDir);
});