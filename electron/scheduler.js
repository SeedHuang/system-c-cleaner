/**
 * Phase 4 后台自动扫描调度器。
 *
 * 设计要点：
 *  - 三种触发（startup / daily / interval）统一由 nextDueReason() 判定，任一命中只扫一次；
 *    额外的 minGapMin 兜底去重，避免频繁重启导致连续扫描。
 *  - 状态持久化到 scheduler-state.json：lastScanAt / lastDailyKey / lastSeenScannedAt / lastElevateAttemptAt
 *    （lastElevateAttemptAt 由提权守卫写入，共用同一状态文件）。
 *  - 「别处完成的扫描」（托盘立即扫描、概览按钮、提权重启后的 --scan-on-start）通过比对
 *    /api/status 的 scannedAt 变化来补发通知，保证每次扫描只通知一条。
 *  - 纯函数与副作用分离：nextDueReason / pickPrevUsedGB / dayKey / parseScanTime 可直接单测。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TICK_MS = 5 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 3600 * 1000;

const EMPTY_STATE = {
  lastScanAt: null,
  lastDailyKey: null,
  lastSeenScannedAt: null,
  lastElevateAttemptAt: null,
};

/** 'YYYY-MM-DD HH:mm:ss' 或 ISO → 毫秒；非法返回 null */
function parseScanTime(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const ms = new Date(s.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 本地日期键 'YYYY-MM-DD'（daily 触发按天去重） */
function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'HH:mm' → 今日该时刻的时间戳；格式非法返回 null（该触发不生效） */
function dailyAtMs(now, dailyAt) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(dailyAt || ''));
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/**
 * 触发判定（纯函数）
 * @returns {'startup'|'daily'|'interval'|null} 首要原因（优先级 startup > daily > interval）
 */
function nextDueReason({ now, appStartedAt, startupScanDone, lastScanAt, lastDailyKey, cfg }) {
  if (!cfg || cfg.autoScan !== true) return null;
  // 通用去重：任意两次自动扫描至少间隔 minGapMin
  if (lastScanAt && now - lastScanAt < cfg.minGapMin * MINUTE_MS) return null;

  const reasons = [];
  if (!startupScanDone && now - appStartedAt >= cfg.startDelayMin * MINUTE_MS) reasons.push('startup');
  const dMs = dailyAtMs(now, cfg.dailyAt);
  if (dMs != null && now >= dMs && dayKey(now) !== lastDailyKey) reasons.push('daily');
  if (lastScanAt && now - lastScanAt >= cfg.intervalHours * HOUR_MS) reasons.push('interval');
  return reasons.length ? reasons[0] : null;
}

/** 历史快照里「本次之前最近一条」的已用空间（用于增长量）；缺失返回 null */
function pickPrevUsedGB(snapshots, scannedAt) {
  const cur = parseScanTime(scannedAt);
  if (!cur || !Array.isArray(snapshots)) return null;
  let best = null;
  let bestMs = null;
  for (const s of snapshots) {
    if (!s) continue;
    const t = parseScanTime(s.scannedAt);
    if (!t || t >= cur) continue;
    if (bestMs == null || t > bestMs) { best = s; bestMs = t; }
  }
  const used = best && best.disk && typeof best.disk.usedGB === 'number' ? best.disk.usedGB : null;
  return Number.isFinite(used) ? used : null;
}

function loadState(file) {
  try {
    if (!fs.existsSync(file)) return { ...EMPTY_STATE };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const out = { ...EMPTY_STATE };
    for (const key of Object.keys(EMPTY_STATE)) {
      const v = raw && raw[key];
      if (key === 'lastDailyKey') {
        if (typeof v === 'string') out[key] = v;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        out[key] = v;
      }
    }
    return out;
  } catch (err) {
    return { ...EMPTY_STATE };
  }
}

function saveState(file, patch) {
  try {
    const next = { ...loadState(file), ...(patch && typeof patch === 'object' ? patch : {}) };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 调度器（副作用编排，依赖全部注入便于测试）
 * @param api { getStatus():{scanning,scannedAt,disk}, triggerScan():{scannedAt,disk}, getHistory():{snapshots} }
 * @param notifier { notify({disk,prevUsedGB,scannedAt,cfg}), notifyFailed({error,cfg}) }
 */
function createScheduler({
  stateFile,
  log,
  api,
  notifier,
  loadSettings,
  now = Date.now,
  tickMs = DEFAULT_TICK_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let state = loadState(stateFile);
  let appStartedAt = now();
  let startupScanDone = false;
  let timer = null;

  async function notifyCompleted(scannedAt, disk, cfg) {
    try {
      const hist = await api.getHistory();
      const prevUsedGB = pickPrevUsedGB(hist && hist.snapshots, scannedAt);
      await notifier.notify({ disk, prevUsedGB, scannedAt, cfg });
    } catch (err) {
      log.warn('scheduler', '通知发送异常（忽略，不影响扫描结果）', { err: err.message });
    }
  }

  /** 一次调度判定（5 分钟一次） */
  async function tick() {
    const cfg = loadSettings();
    if (!cfg || cfg.autoScan !== true) {
      log.debug('scheduler', '后台自动扫描已关闭，跳过本次 tick');
      return { reason: null, triggered: false, notified: false };
    }

    let status = null;
    try {
      status = await api.getStatus();
    } catch (err) {
      log.error('scheduler', '读取扫描状态失败，跳过本次 tick', { err: err.message });
      return { reason: null, triggered: false, notified: false };
    }

    // 1) 别处完成的扫描（托盘 / 概览按钮 / 提权重启后的 --scan-on-start）：补一条通知，只补一次
    let notified = false;
    const seen = parseScanTime(status && status.scannedAt);
    if (seen && seen !== state.lastSeenScannedAt) {
      log.info('scheduler', '检测到新完成的扫描，发送通知', { scannedAt: status.scannedAt });
      await notifyCompleted(status.scannedAt, status && status.disk, cfg);
      notified = true;
      state = { ...state, lastSeenScannedAt: seen, lastScanAt: Math.max(state.lastScanAt || 0, seen) };
      saveState(stateFile, state);
    }

    // 2) 扫描进行中：不排队、不叠加
    if (status && status.scanning) {
      log.info('scheduler', '扫描进行中，本次跳过');
      return { reason: null, triggered: false, notified };
    }

    // 3) 触发判定
    const reason = nextDueReason({
      now: now(),
      appStartedAt,
      startupScanDone,
      lastScanAt: state.lastScanAt,
      lastDailyKey: state.lastDailyKey,
      cfg,
    });
    if (!reason) {
      log.debug('scheduler', '未到触发条件', { lastScanAt: state.lastScanAt, lastDailyKey: state.lastDailyKey });
      return { reason: null, triggered: false, notified };
    }

    log.info('scheduler', '触发自动扫描', {
      reason,
      lastScanAt: state.lastScanAt,
      lastDailyKey: state.lastDailyKey,
    });
    try {
      const data = await api.triggerScan();
      const ms = parseScanTime(data && data.scannedAt) || now();
      startupScanDone = true;
      state = {
        ...state,
        lastScanAt: ms,
        lastSeenScannedAt: ms,
        lastDailyKey: dayKey(now()),
      };
      saveState(stateFile, state);
      await notifyCompleted(data && data.scannedAt, data && data.disk, cfg);
      notified = true;
      log.info('scheduler', '自动扫描完成', { reason, scannedAt: data && data.scannedAt });
      return { reason, triggered: true, notified };
    } catch (err) {
      // 失败不推进 lastScanAt：下个 tick 立即重试，不被 minGap 静默一小时
      log.error('scheduler', '自动扫描失败（不推进状态，下个 tick 重试）', { reason, err: err.message });
      saveState(stateFile, state);
      try {
        await notifier.notifyFailed({ error: err.message, cfg });
      } catch (e2) {
        log.warn('scheduler', '失败通知发送异常（忽略）', { err: e2.message });
      }
      return { reason, triggered: false, notified: false, error: err.message };
    }
  }

  /** 启动：同步已有扫描时间（不回放旧通知）并开始定时 tick */
  async function start() {
    state = loadState(stateFile);
    appStartedAt = now();
    startupScanDone = false;
    try {
      const st = await api.getStatus();
      const seen = parseScanTime(st && st.scannedAt);
      if (seen) {
        state = { ...state, lastSeenScannedAt: seen, lastScanAt: Math.max(state.lastScanAt || 0, seen) };
        log.info('scheduler', '启动同步已有扫描时间（不回放旧通知）', { scannedAt: st.scannedAt });
      }
    } catch (err) {
      log.warn('scheduler', '启动读取扫描状态失败（按本地状态继续）', { err: err.message });
    }
    saveState(stateFile, state);
    timer = setIntervalFn(() => {
      tick().catch((err) => log.error('scheduler', 'tick 异常', err));
    }, tickMs);
    log.info('scheduler', '后台调度器已启动', {
      tickMs,
      lastScanAt: state.lastScanAt,
      lastDailyKey: state.lastDailyKey,
    });
  }

  function stop() {
    if (timer != null) {
      clearIntervalFn(timer);
      timer = null;
      log.info('scheduler', '后台调度器已停止');
    }
  }

  return { start, stop, tick, state: () => state };
}

module.exports = {
  DEFAULT_TICK_MS,
  parseScanTime,
  dayKey,
  dailyAtMs,
  nextDueReason,
  pickPrevUsedGB,
  loadState,
  saveState,
  createScheduler,
};
