/**
 * 开机自启封装（仅打包后生效）。
 * 开发模式（!app.isPackaged）下禁用，避免写入指向 electron.exe 的无效配置。
 */
function createAutostart({ app, log }) {
  const isEnabled = () => {
    if (!app.isPackaged) return false;
    return app.getLoginItemSettings().openAtLogin === true;
  };

  const setEnabled = (enabled) => {
    if (!app.isPackaged) {
      log.warn('autostart', '开发模式不支持开机自启，已跳过', { enabled });
      return false;
    }
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    log.info('autostart', enabled ? '已开启开机自启' : '已关闭开机自启');
    return true;
  };

  return { isEnabled, setEnabled };
}

module.exports = { createAutostart };
