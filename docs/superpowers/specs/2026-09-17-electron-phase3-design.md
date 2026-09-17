# C 盘空间分析工具 — Electron 桌面化 Phase 3（桌面悬浮小部件）设计文档

日期：2026-09-17
状态：待用户审阅
基于：Phase 1（外壳/安装包）、Phase 2（托盘/窗口/自启）已交付，本阶段增加桌面常驻悬浮小部件

## 1. 背景与目标

Phase 2 后应用常驻托盘，但查看磁盘状态仍需打开主窗口。Phase 3 提供一个**桌面悬浮小部件**（Widget）：始终置顶、可拖拽的小卡片，随时展示 C 盘使用情况，点击直达主窗口。

Phase 3 目标：

- **Widget 窗口**：无边框、透明、置顶、不进任务栏的小窗口，默认右上角，可拖拽，记住位置
- **Widget 内容**：C 盘总容量/已用/剩余 + 使用率进度条 + 最占空间 Top 3 文件夹
- **交互**：点击打开主窗口、拖拽移动、右键菜单（刷新/显示主窗口/隐藏小组件）
- **开关**：托盘菜单「显示/隐藏桌面小组件」checkbox（默认显示）

整体改造共 4 个 Phase：

| Phase | 主题 | 交付边界 |
|---|---|---|
| 1（已完成） | Electron 外壳 + 一键安装包 | exe 安装即用、全功能可用、日志体系、提权适配 |
| 2（已完成） | 托盘 + 窗口行为 + 开机自启 | 托盘图标/菜单、关窗最小化、setLoginItemSettings |
| **3（本阶段）** | 桌面悬浮小部件 | 无边框透明置顶窗口 + 前端 `/widget` 页面 |
| 4 | 后台静默扫描 + 通知 | 主进程定时器、系统通知、静默清理 |

### 1.1 需求确认结论（brainstorming）

| 决策点 | 结论 |
|---|---|
| 显示内容 | **磁盘使用率卡**：C 盘总容量/已用/剩余 + 使用率进度条 + Top 3 最占空间文件夹 |
| 默认位置 | **右上角**，可拖拽，记住上次位置 |
| 交互 | 点击打开主窗口 / 可拖拽 / 右键菜单 / **始终置顶**（全选） |
| 显隐开关 | 托盘菜单「显示/隐藏桌面小组件」（默认显示） |
| 数据来源 | widget 页面同源 fetch `/api/scan` + `/api/status`（复用内嵌 server，定时轮询） |
| IPC 引入 | **引入最小 IPC**：preload + `ipcRenderer` 仅用于「点击 widget 打开主窗口」（Phase 2 预留评估点，本阶段确需） |

### 1.2 延续的核心约束

1. 全路径日志：关键步骤、交互、catch 分支均有日志（延续）
2. TDD：新模块先写测试再实现
3. UI 风格冻结（暗色 #212332/#2A2D3E/#2697FF），widget 页面遵循同风格
4. 只读安全原则不变
5. 托盘/自启/窗口行为（Phase 2）不回归

## 2. 架构总览

```
electron/main.js（修改）
  ├─ createWidget()（新增 electron/widget.js）
  │    ├─ BrowserWindow: 无边框/透明/置顶/不进任务栏/不可缩放
  │    ├─ 位置：widget-state.js 读取（默认右上角），move 事件保存
  │    └─ 加载 http://localhost:<port>/widget（前端新增页面）
  ├─ ipcMain.on('widget:open-main') → showMainWindow()
  ├─ widget 窗口 context-menu → 原生菜单（刷新/显示主窗口/隐藏小组件）
  └─ 托盘菜单新增「显示/隐藏桌面小组件」（electron/tray.js 修改）

electron/widget-preload.js（新增）  contextBridge 暴露 widgetAPI.openMain()
src/pages/Widget/index.tsx（新增）  磁盘卡 UI + 轮询 + 拖拽 + 点击
```

- server/index.js **零改动**
- 托盘行为（Phase 2）保留，仅菜单新增一项

## 3. 关键设计

### 3.1 Widget 窗口（electron/widget.js，新增）

```js
new BrowserWindow({
  width: 320, height: 150,
  frame: false,          // 无边框
  transparent: true,     // 透明背景（卡片圆角）
  resizable: false,
  alwaysOnTop: true,     // 始终置顶
  skipTaskbar: true,     // 不进任务栏
  webPreferences: { contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, 'widget-preload.js') },
})
```

- 位置：`loadWidgetState()` 读取（默认右上角：`{x: screenWidth-340, y: 60}`），越界则回退默认
- `move` 事件 → 防抖保存 `saveWidgetState()`
- 关闭行为：`close` 事件拦截 → `hide()`（隐藏而非销毁，托盘开关控制显隐）
- 加载失败/页面错误 → 日志（延续 did-fail-load 处理）

### 3.2 位置状态（electron/widget-state.js，新增，TDD）

```js
loadWidgetState(file) // → { x, y } | null（无文件/解析失败/越界 → null 回退默认）
saveWidgetState(file, bounds) // 写 JSON
```

- 存储位置：`path.join(dataDir, 'widget-state.json')`（userData 下）
- 越界校验：bounds 与 `screen.getDisplayMatching` 或简单校验（x/y ≥ 0 且 < 屏幕宽高，含负坐标场景回退默认）
- 纯函数化设计，便于 node:test

### 3.3 IPC / preload（最小引入）

- `electron/widget-preload.js`：`contextBridge.exposeInMainWorld('widgetAPI', { openMain: () => ipcRenderer.send('widget:open-main') })`
- `main.js`：`ipcMain.on('widget:open-main', showMainWindow)`
- 仅此一个通道；**不**暴露通用 ipcRenderer（保持最小面）

### 3.4 前端 /widget 页面（src/pages/Widget/index.tsx，新增）

- 路由：`config/config.ts` 增加 `{ path: '/widget', component: './Widget', layout: false }`（**不设 name**，不进主导航菜单）
- 布局：无布局（layout: false），页面 CSS 背景透明；卡片深色圆角（#212332 底 + #2697FF 强调）
- 数据：同源 `fetch('/api/scan')` + `fetch('/api/status')`；每 60s 轮询；失败显示占位并重试
- 展示：总容量 / 已用 / 剩余 + 使用率进度条 + Top 3 最占空间文件夹（scan-result.topFolders 前 3）
- 拖拽：卡片主体 CSS `-webkit-app-region: drag`；进度条/文本交互区 `no-drag`
- 点击：整卡 `onClick={() => window.widgetAPI?.openMain()}`（preload 暴露；无 preload 时安全降级）
- 右键：不自行拦截，交由主进程 `context-menu` 事件弹原生菜单

### 3.5 托盘菜单（electron/tray.js 修改 + 测试更新）

菜单新增一项（位于「开机自启」后）：

| 菜单项 | 行为 |
|---|---|
| 显示/隐藏桌面小组件 | checkbox，状态 `getMenuState().widgetVisible`，点击 `onToggleWidget()` |

- `getMenuState` 扩展：`{ autostart, widgetVisible }`
- tray.test.js 更新：菜单含 5 个功能项、widget 开关 checkbox 状态

### 3.6 右键菜单（main.js）

```js
widgetWindow.webContents.on('context-menu', () => {
  Menu.buildFromTemplate([
    { label: '刷新数据', click: () => widgetWindow.webContents.reload() },
    { label: '显示主窗口', click: showMainWindow },
    { label: '隐藏小组件', click: () => toggleWidget(false) },
  ]).popup();
});
```

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `electron/widget.js` | 新增 | widget 窗口创建/位置/右键菜单绑定 |
| `electron/widget-state.js` | 新增 | 位置存取（TDD） |
| `electron/widget-state.test.js` | 新增 | 位置测试 |
| `electron/widget-preload.js` | 新增 | contextBridge 暴露 openMain |
| `src/pages/Widget/index.tsx` | 新增 | 前端磁盘卡页面 |
| `src/pages/Widget/index.css` | 新增 | 页面样式（透明背景、拖拽区域） |
| `config/config.ts` | 修改 | 新增 /widget 路由（layout: false，无 name） |
| `electron/tray.js` | 修改 | 菜单加「显示/隐藏桌面小组件」 |
| `electron/tray.test.js` | 修改 | 菜单 5 项断言 |
| `electron/main.js` | 修改 | widget 集成、IPC、托盘开关联动 |
| `README.md` | 修改 | 补充 Phase 3 功能 |

不改动：`server/index.js`、PowerShell 脚本、其他前端页面、electron-builder.yml（widget 相关文件均在 asar 内）

## 5. 边界情况

| 场景 | 处理 |
|---|---|
| 分辨率变化/多显示器 | 位置越界校验，越界回退默认右上角 |
| widget 页面加载时 server 未就绪 | fetch 失败 → 占位 + 定时重试 |
| 无 scan-result.json（未扫描过） | 显示「暂无数据，请先扫描」，点击打开主窗口引导 |
| widget 窗口被用户关掉 | 拦截 close → hide（不销毁），托盘开关仍可控 |
| 点击 widget 但主窗口已销毁 | showMainWindow 兜底重建（复用 Phase 2 逻辑） |
| 透明窗口在部分系统主题下 | 卡片自带深色背景，不依赖系统透明效果 |
| IPC 通道未注册（开发时序） | preload 暴露的 API 调用安全降级（optional chaining） |

## 6. TDD 验证

- `electron/widget-state.test.js`：
  - save 后 load 返回相同位置
  - 无文件 → null
  - 损坏 JSON → null
  - 越界坐标 → null（回退默认）
- `electron/tray.test.js`（更新）：
  - 菜单 5 个功能项（打开主界面/立即扫描/开机自启/显示小组件/退出）
  - widget checkbox 状态与 getMenuState().widgetVisible 一致
- 回归：`npx tsc --noEmit` + `npm test`（全量不回归）

## 7. 手工验收清单

1. 打包运行：右上角出现悬浮卡片，始终置顶，不进任务栏
2. 卡片显示：总容量/已用/剩余 + 使用率进度条 + Top 3 文件夹
3. 拖拽卡片到任意位置 → 重启应用位置保持
4. 点击卡片 → 打开并聚焦主窗口
5. 右键卡片 → 菜单：刷新数据/显示主窗口/隐藏小组件
6. 托盘菜单「显示/隐藏桌面小组件」→ 显隐切换生效
7. 未扫描过 → 卡片显示引导文案，点击可打开主窗口
8. 日志完整：widget 创建/位置保存/显隐切换均有记录

## 8. 排除项（本阶段不做）

- widget 多形态/主题切换/尺寸调节
- 引入 electron-store（位置用 fs JSON 即可）
- widget 动画/毛玻璃效果
- 跨窗口 IPC 扩展（仅保留 widget:open-main 一个通道）
- 主窗口设置页内开关（开关仅放托盘菜单）
