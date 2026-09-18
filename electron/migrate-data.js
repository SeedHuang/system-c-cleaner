/**
 * 数据迁移：从 %APPDATA%\c-drive-cleaner（app.getPath('userData')）一次迁移到
 * %USERPROFILE%\.system-c-cleaner。
 *
 * 触发条件：用户未通过 CLEANER_DATA_DIR 显式覆盖；新位置是默认计算出来的。
 *
 * 设计要点：
 *  - 主进程调用、CLI 脚本调用、用户手动跑都走同一份逻辑（不依赖 Electron）
 *  - 始终「合并」：旧 → 新，有则补、新有则保留；不做破坏性覆盖
 *  - history/index.json 按快照 id 去重合并，按 scannedAt 升序；旧 index 列了 id 但
 *    .tsv.gz 文件不存在则剔除该条（与 server/history.js:listSnapshots 一致）
 *  - logs/ 按文件名去重（同日期日志不覆盖新位置现有文件）
 *  - 不拷贝 settings.json（让用户用新实例默认值）
 *  - 旧位置写 `.migrated-to` + `.migrated-at` 标记防重复
 *  - 所有失败都被 try/catch + log 兜住，best-effort；CLI 模式退出码反映成败
 */
const fsp = require('fs/promises');
const path = require('path');

/** 不拷贝的顶层文件名（配置可能与新实例默认值不一致） */
const SKIP_FILES = new Set(['settings.json']);
/** 跳转标记文件名（旧位置已有 [self] 标记时跳过复制） */
const MARKER_FILES = new Set(['.migrated-to', '.migrated-at']);

/** 安全读取 JSON；读不到/解析失败 → 返回 {snapshots:[]}；剥离 BOM 兼容 PowerShell Set-Content 默认编码 */
async function readIndexSafe(file) {
  try {
    const raw = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.snapshots)) return data;
  } catch { /* 文件不存在或非法 → 默认 empty */ }
  return { snapshots: [] };
}

/** index.json 合并：旧 + 新 → 按 id 去重 → 按 scannedAt 升序 */
function mergeIndex(oldIdx, newIdx) {
  const byId = new Map();
  for (const s of newIdx.snapshots) {
    if (s && s.id) byId.set(s.id, s);
  }
  for (const s of oldIdx.snapshots) {
    if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
  }
  const merged = [...byId.values()].sort((a, b) => {
    const ta = new Date(String(a.scannedAt || '').replace(' ', 'T')).getTime();
    const tb = new Date(String(b.scannedAt || '').replace(' ', 'T')).getTime();
    return ta - tb;
  });
  return { snapshots: merged };
}

/**
 * @param {object} args
 * @param {string} args.oldDir 老位置（%APPDATA%\c-drive-cleaner）
 * @param {string} args.newDir 新位置（%USERPROFILE%\.system-c-cleaner）
 * @param {(level: string, scope: string, msg: string, extra?: object) => void} [args.log] 日志
 * @returns {Promise<{
 *   migrated: boolean,
 *   reason: 'old-empty'|'same-dir'|'done',
 *   stats?: { files: number, snapshotsMerged: number, snapshotsSkipped: number, logsCopied: number },
 *   migratedAt?: string,
 * }>}
 */
async function runMigrate({ oldDir, newDir, log = () => {} } = {}) {
  const safeLog = (level, msg, extra) => {
    try { log(level, 'migrate', msg, extra); } catch { /* 日志失败不影响迁移 */ }
  };

  if (!oldDir || !newDir) {
    safeLog('warn', '迁移跳过：oldDir/newDir 缺失', { oldDir, newDir });
    return { migrated: false, reason: 'old-empty' };
  }
  if (path.resolve(oldDir) === path.resolve(newDir)) {
    safeLog('info', '迁移跳过：oldDir === newDir（用户显式覆盖或环境变量已指向新位置）');
    return { migrated: false, reason: 'same-dir' };
  }

  // 旧目录不存在 → 全新用户，无可搬
  let oldStat;
  try {
    oldStat = await fsp.stat(oldDir);
    if (!oldStat.isDirectory()) {
      safeLog('warn', '迁移跳过：oldDir 不是目录', { oldDir });
      return { migrated: false, reason: 'old-empty' };
    }
  } catch {
    safeLog('info', '迁移跳过：旧目录不存在', { oldDir });
    return { migrated: false, reason: 'old-empty' };
  }

  await fsp.mkdir(newDir, { recursive: true });

  // 列出旧位置内容，识别「无可搬」的空目录（避免 migrated=true 但 stats 全 0）
  const oldEntriesAll = await fsp.readdir(oldDir, { withFileTypes: true });
  // 标记文件（.migrated-to / .migrated-at）视为"已处理"，不算实际数据
  const realEntries = oldEntriesAll.filter((e) => !MARKER_FILES.has(e.name));
  if (realEntries.length === 0) {
    safeLog('info', '迁移跳过：旧目录为空', { oldDir });
    return { migrated: false, reason: 'old-empty' };
  }

  // 复制顶层项（文件或目录），冲突时按各子规则处理
  let filesCopied = 0;
  let logsCopied = 0;
  let snapshotsMerged = 0;
  let snapshotsSkipped = 0;

  for (const ent of oldEntriesAll) {
    if (MARKER_FILES.has(ent.name)) continue; // 旧位置已有的标记不复制
    if (ent.isFile() && SKIP_FILES.has(ent.name)) continue; // settings.json 不拷贝

    const src = path.join(oldDir, ent.name);
    const dst = path.join(newDir, ent.name);

    // 顶层文件：新位置不存在才复制
    if (ent.isFile()) {
      try {
        await fsp.access(dst);
        // 新位置已有，跳过
        continue;
      } catch {
        await fsp.copyFile(src, dst);
        filesCopied += 1;
      }
      continue;
    }

    // 顶层目录：history / logs 走各自的合并规则；其他目录直接合并拷贝
    if (ent.isDirectory()) {
      if (ent.name === 'history') {
        const merged = await mergeHistoryDir(src, dst, log);
        snapshotsMerged += merged.added;
        snapshotsSkipped += merged.skipped;
      } else if (ent.name === 'logs') {
        const c = await mergeLogsDir(src, dst, log);
        logsCopied += c;
      } else {
        // 其他顶层目录（如未来新增）按「存在则跳过」处理
        try { await fsp.access(dst); } catch { await fsp.cp(src, dst, { recursive: true }); filesCopied += 1; }
      }
    }
  }

  // 旧位置写跳转标记
  const migratedAt = new Date().toISOString();
  await fsp.writeFile(path.join(oldDir, '.migrated-to'), newDir);
  await fsp.writeFile(path.join(oldDir, '.migrated-at'), migratedAt);

  const stats = { files: filesCopied, snapshotsMerged, snapshotsSkipped, logsCopied };
  safeLog('info', '数据已迁移', { from: oldDir, to: newDir, at: migratedAt, stats });
  return { migrated: true, reason: 'done', stats, migratedAt };
}

/** 合并 history 目录：index.json 按 id 合并且升序；.tsv.gz 仅在新位置缺失时复制 */
async function mergeHistoryDir(srcDir, dstDir, log) {
  await fsp.mkdir(dstDir, { recursive: true });
  const oldIdx = await readIndexSafe(path.join(srcDir, 'index.json'));
  const newIdx = await readIndexSafe(path.join(dstDir, 'index.json'));
  let added = 0;
  let skipped = 0;

  // 验证旧 index 里的每条快照文件是否真实存在；不存在的剔除
  const validOld = [];
  for (const s of oldIdx.snapshots) {
    if (!s || !s.id) continue;
    try {
      await fsp.access(path.join(srcDir, `${s.id}.tsv.gz`));
      validOld.push(s);
    } catch {
      skipped += 1;
      try { log('warn', 'migrate', '旧快照文件已缺失，跳过', { id: s.id }); } catch { /* log fail */ }
    }
  }

  // 复制旧快照文件到新位置（仅新位置缺失的）
  for (const s of validOld) {
    const src = path.join(srcDir, `${s.id}.tsv.gz`);
    const dst = path.join(dstDir, `${s.id}.tsv.gz`);
    try {
      await fsp.access(dst);
      // 已存在，不复制
    } catch {
      await fsp.copyFile(src, dst);
      added += 1;
    }
  }

  // 合并 index.json
  const merged = mergeIndex({ snapshots: validOld }, newIdx);
  await fsp.writeFile(path.join(dstDir, 'index.json'), JSON.stringify(merged, null, 2));
  return { added, skipped };
}

/** 合并 logs 目录：按文件名去重，同名保留新位置已有 */
async function mergeLogsDir(srcDir, dstDir, log) {
  await fsp.mkdir(dstDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const src = path.join(srcDir, ent.name);
    const dst = path.join(dstDir, ent.name);
    try {
      await fsp.access(dst);
      // 新位置已有同名文件，保留
    } catch {
      await fsp.copyFile(src, dst);
      copied += 1;
    }
  }
  return copied;
}

module.exports = { runMigrate, mergeIndex, SKIP_FILES, MARKER_FILES };