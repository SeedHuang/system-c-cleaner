/**
 * Phase 4 系统通知。
 *
 * 文案合并为一条：一次扫描只弹一条通知，包含剩余空间 + （有上次快照时）本次增长量；
 * 触达阈值（剩余空间过低 / 增长过大）时标题换成告警样式。
 * 纯函数 buildNotification / buildFailureNotification 可单测；createNotifier 负责与 electron 对接。
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 构造通知内容（纯函数）
 * @param disk { totalGB, usedGB, freeGB } 扫描结果里的磁盘信息
 * @param prevUsedGB 上一条历史快照的已用空间（无 → null，不做增长判定）
 * @returns { title, body, urgent } | null（null = 不发通知）
 */
function buildNotification({ disk, prevUsedGB, cfg, scannedAt }) {
  if (!disk || typeof disk !== 'object') return null;
  const { totalGB, usedGB, freeGB } = disk;
  if (!isNum(totalGB) || !isNum(usedGB) || !isNum(freeGB) || totalGB <= 0) return null;

  const settings = cfg || {};
  const freePct = (freeGB / totalGB) * 100;
  const lowSpace = isNum(settings.lowSpacePct) && freePct <= settings.lowSpacePct;

  let growthGB = null;
  if (isNum(prevUsedGB)) {
    const g = Number((usedGB - prevUsedGB).toFixed(1));
    if (g !== 0) growthGB = g;
  }
  const growthWarn = growthGB != null && isNum(settings.growthWarnGB) && growthGB >= settings.growthWarnGB;
  const urgent = !!lowSpace || !!growthWarn;

  // 安静模式：仅在告警时打扰
  if (!urgent && settings.notifyEveryScan === false) return null;

  let body = `剩余 ${freePct.toFixed(1)}%（${freeGB.toFixed(1)} GB）`;
  if (growthGB != null) body += `，本次 ${growthGB > 0 ? '+' : '-'}${Math.abs(growthGB).toFixed(1)} GB`;

  return { title: urgent ? '⚠️ C 盘空间告警' : '扫描完成', body, urgent };
}

/** 扫描失败通知（受 notifyEveryScan 控制） */
function buildFailureNotification({ error, cfg }) {
  const settings = cfg || {};
  if (settings.notifyEveryScan === false) return null;
  const reason = typeof error === 'string' && error.trim() ? error.trim() : '未知原因';
  return { title: '⚠️ 扫描失败', body: `自动扫描未能完成：${reason}`, urgent: true };
}

/** 与 electron Notification 对接（类通过参数注入，便于测试） */
function createNotifier({ Notification, showMain, log }) {
  function present(built) {
    if (!built) {
      log.debug('notify', '无需通知（不满足发送条件）');
      return false;
    }
    try {
      const unsupported = !Notification ||
        (typeof Notification.isSupported === 'function' && !Notification.isSupported());
      if (unsupported) {
        log.warn('notify', '当前系统不支持通知，已跳过', { title: built.title });
        return false;
      }
      const n = new Notification({ title: built.title, body: built.body });
      n.on('click', () => {
        log.info('notify', '通知被点击，打开主窗口');
        try {
          showMain();
        } catch (err) {
          log.error('notify', '通知点击后打开主窗口失败', { err: err.message });
        }
      });
      n.show();
      log.info('notify', '通知已发送', { title: built.title, body: built.body, urgent: !!built.urgent });
      return true;
    } catch (err) {
      log.error('notify', '通知展示失败（忽略，不影响扫描）', { title: built.title, err: err.message });
      return false;
    }
  }

  return {
    notify: ({ disk, prevUsedGB, cfg, scannedAt }) => present(buildNotification({ disk, prevUsedGB, cfg, scannedAt })),
    notifyFailed: ({ error, cfg }) => present(buildFailureNotification({ error, cfg })),
  };
}

module.exports = { buildNotification, buildFailureNotification, createNotifier };
