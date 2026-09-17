/**
 * 系统托盘：图标 + 右键菜单（打开主界面 / 立即扫描 / 开机自启 / 退出）。
 * electron 依赖通过参数注入（Tray / Menu），便于 node:test 无 electron 环境测试。
 */
function createTray({ Tray, Menu, icon, getMenuState, onShow, onScan, onToggleAutostart, onQuit, log }) {
  let tray;
  try {
    tray = new Tray(icon);
    tray.setToolTip('CDriveCleaner - C 盘空间分析');

    const buildMenu = () => {
      const state = getMenuState();
      const menu = Menu.buildFromTemplate([
        { label: '打开主界面', click: onShow },
        { label: '立即扫描', click: onScan },
        { label: '开机自启', type: 'checkbox', checked: state.autostart, click: onToggleAutostart },
        { type: 'separator' },
        { label: '退出', click: onQuit },
      ]);
      tray.setContextMenu(menu);
    };

    tray.on('click', onShow); // Windows：单击显示主窗口
    tray.on('right-click', buildMenu); // 右键：重建菜单（刷新自启状态）
    buildMenu();
    log.info('tray', '托盘已创建');
  } catch (err) {
    log.error('tray', '托盘创建失败（应用继续运行，仅无托盘）', err);
    return null;
  }
  return tray;
}

module.exports = { createTray };
