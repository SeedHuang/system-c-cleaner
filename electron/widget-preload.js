/**
 * Widget 页面 preload：仅暴露一个最小 API（点击打开主窗口）。
 * 不暴露通用 ipcRenderer，保持最小安全面。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  openMain: () => ipcRenderer.send('widget:open-main'),
});
