/**
 * 开机自启封装（仅打包后生效）。
 *
 * 方案 A：计划任务（schtasks）替代 Run 注册表键。
 *   - 任务以「最高权限」在用户登录时启动本应用（--hidden 静默驻留托盘），不弹 UAC；
 *   - 任务存储在 System32\Tasks 下的 XML（由 Windows 托管），应用只调官方 schtasks 接口，不手写注册表；
 *   - 创建失败（权限/策略限制）→ 降级回 Electron 登录项（HKCU Run 键），保证功能可用；
 *   - refresh()：启动时自愈——任务存在则用当前 exe 路径重建（安装位置变更）；
 *     检测到旧版 Run 键自启则迁移到计划任务并清掉 Run 键（避免双实例启动）。
 *
 * 关键细节：XML 必须是 UTF-16LE + BOM（schtasks /XML 的要求）；
 *   ExecutionTimeLimit 必须为 PT0S（不限时）——任务计划默认 72 小时上限会杀掉常驻应用；
 *   所有 schtasks 调用带 timeout（防 AV 拦截挂起导致托盘永不创建）。
 *
 * 开发模式（!app.isPackaged）下禁用，避免把 electron.exe 注册成自启任务。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TASK_NAME = 'Roberta-Autostart';
const HIDDEN_FLAG = '--hidden';
const SCHTASKS_TIMEOUT_MS = 10 * 1000;

/** XML 转义（路径里可能出现 & 等字符） */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 构建任务定义 XML：登录触发 + 最高权限 + 不限时 + 静默启动参数 */
function buildTaskXml({ exePath, args }) {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <RunLevel>Highest</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>false</AllowHardTerminate>',
    '    <StartWhenAvailable>false</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>', // 不限时：默认 72h 会杀掉常驻应用
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${escapeXml(exePath)}</Command>`,
    `      <Arguments>${escapeXml(args)}</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ].join('\r\n');
}

/** 执行 schtasks，返回 Promise<{ err, stdout, stderr }>（不抛异常，失败交由调用方决策）。
 *  timeout 必须有：schtasks 被杀软拦截挂起时，否则 await 永不返回，托盘将无法创建。 */
function runSchtasks(args, execFileFn) {
  return new Promise((resolve) => {
    execFileFn('schtasks', args, { windowsHide: true, timeout: SCHTASKS_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function createAutostart({ app, log, execFileFn = execFile, tmpDir = os.tmpdir() }) {
  /** 任务是否存在。注意：任何错误（缺 schtasks/策略拦截/拒绝访问）都按「不存在」处理，
   *  语义是尽力而为的降级；错误详情记 debug 日志供诊断。 */
  async function queryTask() {
    const r = await runSchtasks(['/Query', '/TN', TASK_NAME], execFileFn);
    if (r.err) {
      log.debug('autostart', '查询计划任务失败（按不存在处理）', { code: r.err.code, stderr: r.stderr.trim().slice(0, 120) });
      return false;
    }
    return true;
  }

  /** 用当前 exe 路径（重新）注册任务；返回是否成功 */
  async function createTask() {
    // 私有临时目录：避免在全局 temp 下用可预测文件名写入（symlink TOCTOU）
    let workDir = null;
    try {
      workDir = fs.mkdtempSync(path.join(tmpDir, 'roberta-autostart-'));
      const xmlFile = path.join(workDir, 'task.xml');
      // schtasks /XML 要求 UTF-16LE 编码（带 BOM）
      fs.writeFileSync(xmlFile, '\ufeff' + buildTaskXml({ exePath: process.execPath, args: HIDDEN_FLAG }), 'utf16le');
      const r = await runSchtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlFile, '/F'], execFileFn);
      if (r.err) {
        log.error('autostart', '注册计划任务失败', { code: r.err.code, stderr: r.stderr.trim().slice(0, 200) });
        return false;
      }
      log.info('autostart', '计划任务已注册（最高权限，登录启动）', { task: TASK_NAME, exe: process.execPath });
      return true;
    } catch (err) {
      log.error('autostart', '注册计划任务异常', { err: err.message });
      return false;
    } finally {
      try { if (workDir) fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
    }
  }

  /** 删除任务；区分「本就不存在」（成功）与「真删除失败」（失败，调用方需如实上报） */
  async function deleteTask() {
    const r = await runSchtasks(['/Delete', '/TN', TASK_NAME, '/F'], execFileFn);
    if (!r.err) return true;
    // 删除报错可能是任务本就不存在（schtasks 不区分错误码），回查确认
    if (!(await queryTask())) {
      log.debug('autostart', '任务不存在，视为已删除');
      return true;
    }
    log.error('autostart', '删除计划任务失败（自启可能仍生效）', { code: r.err.code, stderr: r.stderr.trim().slice(0, 200) });
    return false;
  }

  const isEnabled = async () => {
    if (!app.isPackaged) return false;
    if (await queryTask()) return true;
    // 任务不存在 → 检查是否处于「Run 键降级」状态
    return app.getLoginItemSettings().openAtLogin === true;
  };

  const setEnabled = async (enabled) => {
    if (!app.isPackaged) {
      log.warn('autostart', '开发模式不支持开机自启，已跳过', { enabled });
      return false;
    }
    if (enabled) {
      if (await createTask()) {
        // 清掉可能的 Run 键残留（旧版遗留/历史降级），否则登录时 Run 键 + 任务会启动两个实例
        app.setLoginItemSettings({ openAtLogin: false, args: [HIDDEN_FLAG] });
        return true;
      }
      // 降级：计划任务注册失败（权限/组策略限制）→ 回退 Run 键方式（会弹 UAC，但功能可用）
      log.warn('autostart', '计划任务注册失败，降级为登录项（Run 键）方式');
      app.setLoginItemSettings({ openAtLogin: true, args: [HIDDEN_FLAG] });
      return true;
    }
    // 关闭：删除任务；失败必须如实上报（否则托盘显示已关闭但自启仍生效）
    const deleted = await deleteTask();
    // 同时清掉可能的降级残留（Run 键）
    app.setLoginItemSettings({ openAtLogin: false, args: [HIDDEN_FLAG] });
    if (!deleted) {
      log.warn('autostart', '计划任务未能删除，开机自启可能仍然生效');
      return false;
    }
    log.info('autostart', '已关闭开机自启（任务与登录项均已清理）');
    return true;
  };

  /**
   * 启动自愈 + 迁移，返回当前自启是否处于开启状态（供托盘菜单缓存）：
   *  1. 任务已存在 → 用当前 exe 路径重建（覆盖安装/移动位置后旧任务指向失效路径），
   *     重建失败但任务仍在 → 自启实际生效，必须返回 true；顺带清 Run 键残留防双实例；
   *  2. 任务不存在但 Run 键开启 → 旧版升级迁移：注册任务并清掉 Run 键；
   *  3. 都不存在 → false。
   */
  const refresh = async () => {
    if (!app.isPackaged) return false;
    if (await queryTask()) {
      const ok = await createTask();
      if (ok) {
        app.setLoginItemSettings({ openAtLogin: false, args: [HIDDEN_FLAG] }); // 清残留防双实例
        return true;
      }
      log.warn('autostart', '任务重建失败，沿用现有任务（仍会自启）');
      return true;
    }
    if (app.getLoginItemSettings().openAtLogin === true) {
      log.info('autostart', '检测到旧版 Run 键自启，迁移到计划任务');
      if (await createTask()) {
        app.setLoginItemSettings({ openAtLogin: false, args: [HIDDEN_FLAG] }); // 迁移成功，清掉 Run 键
      }
      // 无论迁移是否成功，Run 键都还在生效（失败时未清理），自启状态为开
      return true;
    }
    return false;
  };

  return { isEnabled, setEnabled, refresh };
}

module.exports = { createAutostart, buildTaskXml, TASK_NAME, HIDDEN_FLAG, SCHTASKS_TIMEOUT_MS };
