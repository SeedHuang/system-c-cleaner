/**
 * Phase 4 启动提权守卫。
 *
 * 目标：启动时提权一次，之后应用以管理员身份常驻，后续所有扫描数据完整。
 * 防死循环：提权重启后的新进程 isElevated=true → 直接跳过（不依赖命令行标记）。
 * 降级原则：探测失败（未知）/ UAC 被拒 / 配置关闭 → 一律以普通权限继续运行，不阻塞启动。
 */

const ELEVATE_COOLDOWN_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10 * 1000;

const PS_ELEVATED_CHECK =
  '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())' +
  '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';

/** PowerShell 输出 'True'/'False' → true/false；其他（空、报错信息）→ null（未知） */
function parseElevated(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

/** 是否该弹 UAC（纯函数）：仅「确认未提权 + 开关开启 + 过了冷却期」才尝试 */
function shouldAttemptElevate({ isElevated, lastAttemptAt, now, cfg }) {
  if (isElevated !== false) return false; // true=已提权；null=未知 → 都不弹
  if (!cfg || cfg.autoElevateOnStart !== true) return false;
  if (typeof lastAttemptAt === 'number' && Number.isFinite(lastAttemptAt) &&
      now - lastAttemptAt < ELEVATE_COOLDOWN_MS) return false;
  return true;
}

/** 探测当前进程是否管理员（spawn 注入便于测试）；失败/超时 → null */
function probeElevation({ psPath, spawnFn, log, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let out = '';
    let child = null;
    try {
      child = spawnFn(psPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_ELEVATED_CHECK], {
        windowsHide: true,
      });
    } catch (err) {
      log.error('elevate', '提权探测进程启动异常，按未知处理', { err: err.message });
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      log.error('elevate', '提权探测超时，按未知处理', { timeoutMs });
      try { child.kill(); } catch (err) { /* 忽略 */ }
      resolve(null);
    }, timeoutMs);
    const done = (value) => { clearTimeout(timer); resolve(value); };
    if (child.stdout) child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('error', (err) => {
      log.error('elevate', '提权探测失败，按未知处理', { err: err.message });
      done(null);
    });
    child.on('close', (code) => {
      const elevated = parseElevated(out);
      log.info('elevate', '提权状态探测完成', { code, elevated, raw: out.trim().slice(0, 80) });
      done(elevated);
    });
  });
}

/**
 * 提权守卫（依赖注入）
 * @returns { run(cfg) } → 'already-elevated' | 'requested' | 'request-failed' | 'skipped-disabled' | 'skipped-cooldown' | 'probe-failed'
 */
function createElevateGuard({ probe, requestRestart, log, now = Date.now, getState, saveState }) {
  async function run(cfg) {
    if (!cfg || cfg.autoElevateOnStart !== true) {
      log.info('elevate', '启动提权已关闭（settings.autoElevateOnStart=false），跳过');
      return 'skipped-disabled';
    }

    const elevated = await probe();
    if (elevated === null) {
      log.error('elevate', '提权状态未知，不弹 UAC，以普通权限继续运行');
      return 'probe-failed';
    }
    if (elevated === true) {
      log.info('elevate', '已以管理员身份运行，跳过启动提权');
      return 'already-elevated';
    }

    const st = getState() || {};
    if (!shouldAttemptElevate({ isElevated: false, lastAttemptAt: st.lastElevateAttemptAt, now: now(), cfg })) {
      log.info('elevate', '跳过启动提权（冷却期内，10 分钟内已尝试过）', {
        lastElevateAttemptAt: st.lastElevateAttemptAt,
      });
      return 'skipped-cooldown';
    }

    log.info('elevate', '未提权，请求以管理员身份重启（即将弹出 UAC）');
    saveState({ lastElevateAttemptAt: now() });
    try {
      await requestRestart();
    } catch (err) {
      log.error('elevate', '请求提权重启失败，以普通权限继续运行', { err: err.message });
      return 'request-failed';
    }
    return 'requested';
  }

  return { run };
}

module.exports = {
  ELEVATE_COOLDOWN_MS,
  PS_ELEVATED_CHECK,
  parseElevated,
  shouldAttemptElevate,
  probeElevation,
  createElevateGuard,
};
