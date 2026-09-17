/**
 * C 盘分析 - 路径与配置解析（单一来源，server 与 electron 主进程共用）
 * 开发/独立运行默认写项目根；打包后由 electron/main.js 注入 CLEANER_* 环境变量。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function resolvePaths(env = process.env) {
  const dataDir = env.CLEANER_DATA_DIR || ROOT;
  const scriptsDir = env.CLEANER_SCRIPTS_DIR || path.join(ROOT, 'scripts');
  return {
    root: ROOT,
    dataDir,
    scriptsDir,
    logDir: env.CLEANER_LOG_DIR || path.join(dataDir, 'logs'),
    resultFile: path.join(dataDir, 'scan-result.json'),
    historyDir: path.join(dataDir, 'history'),
    // 与 relaunch-admin.ps1 的 flag 写入位置必须一致：
    // 注入模式 = dataDir 根；默认模式 = root/history（维持现有行为）
    elevateFlag: env.CLEANER_DATA_DIR
      ? path.join(dataDir, '.elevated-launch.flag')
      : path.join(ROOT, 'history', '.elevated-launch.flag'),
    psScript: path.join(scriptsDir, 'scan-c.ps1'),
    elevateScript: path.join(scriptsDir, 'relaunch-admin.ps1'),
  };
}

module.exports = { resolvePaths, ROOT };
