/**
 * Widget 页面 preload：暴露主窗口唤起 + 手写拖拽三件套。
 * 不暴露通用 ipcRenderer，保持最小安全面。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  openMain: () => ipcRenderer.send('widget:open-main'),
  // 手写拖拽：pointerdown/move/up 三个时刻各发一次 screenX/screenY。
  // 主进程按"位移增量"更新窗口位置（避免跳到屏幕中心的典型 bug）。
  dragStart: (screenX, screenY) => ipcRenderer.send('widget:drag-start', { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send('widget:drag-move', { screenX, screenY }),
  dragEnd: () => ipcRenderer.send('widget:drag-end'),
});
