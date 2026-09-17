/**
 * 主窗口 preload：只暴露「打开资源管理器」一个能力（最小权限面，不开 nodeIntegration）
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  /**
   * 打开路径。
   * 目录 -> 打开该文件夹；文件 -> 打开所在文件夹并选中它。
   * @param {string} target 绝对路径
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
});
