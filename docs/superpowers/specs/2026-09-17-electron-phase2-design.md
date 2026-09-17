# C 盘空间分析工具 — Electron 桌面化 Phase 2（托盘 + 窗口行为 + 开机自启）设计文档

日期：2026-09-17
状态：待用户审阅
基于：Phase 1（`2026-09-16-electron-phase1-design.md`）已交付外壳与安装包，本阶段在其上增加桌面常驻体验

## 1. 背景与目标

Phase 1 交付了 Electron 外壳 + NSIS 安装包，但应用仍为「关窗即退出」的单窗口形态，不符合桌面常驻工具定位，也无法为 Phase 4（后台静默扫描）铺路。

Phase 2 目标：

- **系统托盘**：最小化/关闭后常驻托盘，托盘菜单提供常用操作
- **窗口行为**：关闭按钮 → 最小化到托盘（不退出）；自启时隐藏启动
- **开机自启**：`app.setLoginItemSettings` 实现，默认关闭、用户可手动开启

整体改造共 4 个 Phase，各独立 spec+plan 逐步推进：

| Phase | 主题 | 交付边界 |
|---|---|---|
| 1（已完成） | Electron 外壳 + 一键安装包 | exe 安装即用、全功能可用、日志体系、提权适配 |
| **2（本阶段）** | 托盘 + 窗口行为 + 开机自启 | 系统托盘图标/菜单、关窗最小化到托盘、`setLoginItemSettings` |
| 3 | 桌面悬浮小部件 | 无边框透明置顶窗口 + 前端 `/widget` 页面 |
| 4 | 后台静默扫描 + 通知 | 主进程定时器、系统通知、静默清理 |

### 1.1 需求确认结论（brainstorming）

| 决策点 | 结论 |
|---|---|
| 关闭按钮行为 | **最小化到托盘**，托盘菜单「退出」才真正退出 |
| 托盘菜单项 | 打开主界面 / 立即扫描 / 开机自启（开关）/ 退出 |
| 开机自启 | **默认关闭**，用户手动开启；`app.setLoginItemSettings`（注册表 HKCU Run） |
| 自启启动显示 | **隐藏到托盘**（启动参数 `--hidden`），不打扰；手动启动显示窗口 |
| 立即扫描实现 | 主进程 fire-and-forget `POST /api/scan`（复用内嵌 server），**不引入 IPC/preload** |
| 托盘图标 | 程序化生成 32×32 PNG（无外部依赖），放 `electron/assets/tray.png` |

### 1.2 延续的核心约束（不因本阶段改变）

1. 全路径日志：关键步骤、交互、catch 分支均有日志（Phase 1 已落地，本阶段延续）
2. TDD：新模块先写测试再实现
3. UI 风格冻结（暗色 #212332/#2A2D3E/#2697FF），本阶段不涉及前端样式
4. 只读安全原则不变（扫描/快照只读，权限不足跳过）
5. 不引入 IPC/preload（本阶段最小改动；Phase 3/4 如确需再评估）

## 2. 架构总览

```
electron/main.js（修改）
  ├─ 解析启动参数（新增 --hidden）
  ├─ 启动内嵌 http 服务（复用 startServer）
  ├─ createWindow()
  │    ├─ --hidden → 创建但不显示（隐藏到托盘）
  │    └─ 正常 → 显示
  ├─ createTray()（新增 electron/tray.js）
  │    ├─ 单击 → 显示主窗口
  │    └─ 右键菜单：打开主界面 / 立即扫描 / 开机自启 / 退出
  ├─ createAutostart()（新增 electron/autostart.js）
  │    └─ isEnabled() / setEnabled()（setLoginItemSettings 封装）
  ├─ 窗口 close → 拦截 → hide()（除非 isQuitting）
  └─ window-all-closed → 不再退出（常驻托盘）
```

- 前端 `src/` **零改动**
- server/index.js **零改动**（托盘「立即扫描」由主进程直接 http 调用）
- Electron 安全默认不变（contextIsolation: true, nodeIntegration: false, 无 preload）

## 3. 关键设计

### 3.1 系统托盘（electron/tray.js，新增）

接口：

```js
createTray({ icon, getMenuState, onShow, onScan, onToggleAutostart, onQuit, log })
```

- `Tray`：`new Tray(icon)`，`setToolTip('CDriveCleaner - C 盘空间分析')`
- 单击托盘图标 → `onShow()`（显示并聚焦主窗口）
- 右键菜单（`Menu.buildFromTemplate`）：

| 菜单项 | 行为 |
|---|---|
| 打开主界面 | `onShow()` |
| 立即扫描 | `onScan()`（主进程 http POST /api/scan） |
| 开机自启 | checkbox，状态由 `getMenuState()` 提供（`autostart: true/false`），点击 `onToggleAutostart()` |
| 退出 | `onQuit()`（置 isQuitting 后 app.quit） |

- 菜单项「开机自启」的状态在每次打开菜单时刷新（`tray.on('right-click')` 或 `popUpContextMenu` 前调用 `getMenuState`）
- 托盘创建失败 → `log.error` 降级（应用仍可运行，仅无托盘）

### 3.2 窗口行为（electron/main.js 修改）

```
let isQuitting = false;

mainWindow.on('close', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    mainWindow.hide();
    log.info('window', '关闭窗口 → 最小化到托盘');
  }
});
```

- 托盘「退出」/ 应用退出：`isQuitting = true; app.quit()`
- `window-all-closed`：**移除 Phase 1 的 app.quit()**，改为常驻（仅隐藏窗口）
- `--hidden` 启动：创建窗口后不 `show()`，记录日志「隐藏启动（自启/静默）」
- 手动启动：正常显示窗口
- `--scan-on-start`（提权重启链路）与 `--hidden` 可共存

### 3.3 开机自启（electron/autostart.js，新增）

```js
createAutostart({ app, log }) // 返回 { isEnabled, setEnabled }
```

- `isEnabled()`：
  - 开发模式（`!app.isPackaged`）→ 返回 `false`（避免指向 electron.exe 的无效配置）
  - 打包后 → `app.getLoginItemSettings().openAtLogin`
- `setEnabled(enabled)`：
  - 开发模式 → 直接返回 false（打日志说明）
  - 打包后 → `app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })`
- 全程日志（enable/disable/开发模式跳过原因）

### 3.4 立即扫描（electron/main.js）

```js
function triggerScan() {
  http.request({ host: '127.0.0.1', port: embeddedPort, path: '/api/scan', method: 'POST' }, ...)
  // fire-and-forget：不阻塞；请求错误记日志
}
```

- 扫描完成后：若主窗口可见 → `mainWindow.webContents.reload()`（刷新结果；隐藏则下次打开自动加载最新）
- server 已处理防并发（`scanning` 标志），托盘连点无副作用

### 3.5 托盘图标（electron/assets/tray.png，程序化生成）

- 新增 `scripts/gen-tray-icon.js`（Node 纯脚本，无外部依赖）：
  - 用 zlib 手写 PNG 编码，生成 32×32 深蓝底（#2697FF）+ 白色 C 形/圆点
  - 输出 `electron/assets/tray.png`
- 图标随 asar 打包（`electron/**` 已在 electron-builder.yml files 中），`nativeImage.createFromPath` 支持 asar 内路径
- 生成脚本仅在开发期运行一次；产物提交仓库

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `electron/tray.js` | 新增 | 托盘创建与菜单（TDD） |
| `electron/autostart.js` | 新增 | 开机自启封装（TDD） |
| `electron/assets/tray.png` | 新增 | 托盘图标（脚本生成） |
| `scripts/gen-tray-icon.js` | 新增 | 图标生成脚本（一次运行） |
| `electron/main.js` | 修改 | 集成托盘/窗口行为/自启/立即扫描/--hidden |
| `electron/tray.test.js` | 新增 | 托盘测试（node:test） |
| `electron/autostart.test.js` | 新增 | 自启测试（node:test） |
| `README.md` | 修改 | 补充 Phase 2 功能说明 |

不改动：`server/index.js`、前端 `src/`、PowerShell 脚本、electron-builder.yml（图标在 asar 内，无需 extraResources）

## 5. 边界情况

| 场景 | 处理 |
|---|---|
| 开发模式（npm run electron:dev） | 关闭仍最小化到托盘（行为一致）；自启功能禁用并记日志 |
| 托盘图标单击与右键（Windows 差异） | 单击显示窗口；右键弹菜单（`setContextMenu` 同时挂 click） |
| 立即扫描时 server 未就绪 | http 请求 error → log.warn，不崩溃 |
| 多实例 | 本阶段不处理（Phase 4 评估单实例锁） |
| 自启 + 提权重启参数冲突 | `--hidden` 与 `--scan-on-start` 可共存 |
| 托盘创建失败 | log.error 降级，应用不崩溃（无托盘运行） |
| Windows 资源管理器未就绪时托盘初始化 | Tray 在 app ready 后创建（现有 bootstrap 时序满足） |

## 6. TDD 验证

- `electron/autostart.test.js`：
  - 开发模式 `isEnabled()` 返回 false、`setEnabled(true)` 不调用 setLoginItemSettings
  - 打包模式 `isEnabled()` 透传 getLoginItemSettings().openAtLogin
  - 打包模式 `setEnabled(true)` 调用 `setLoginItemSettings({openAtLogin:true, args:['--hidden']})`
- `electron/tray.test.js`：
  - 菜单模板含 4 项（打开主界面/立即扫描/开机自启/退出）
  - 开机自启项 checkbox 状态与 getMenuState 一致
  - 各项点击回调正确绑定
- 运行：`npx tsc --noEmit`（全量，忽略已知清单）+ `npm test`（现有测试不回归）

## 7. 手工验收清单

1. 打包运行：关窗 → 图标进托盘，进程不退出
2. 单击托盘 → 窗口恢复显示
3. 右键托盘 → 菜单 4 项
4. 「立即扫描」→ server 日志出现扫描开始，完成后窗口刷新
5. 「开机自启」勾选 → 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 出现 CDriveCleaner（带 --hidden）
6. 重启系统 → 应用自启且隐藏到托盘（无窗口弹出）
7. 托盘「退出」→ 进程真正退出
8. 日志完整：window close→hide、托盘点击、自启开关均有记录

## 8. 排除项（本阶段不做）

- IPC / preload 引入（保持最小改动）
- 多实例单例锁
- 前端设置页（自启开关仅放托盘菜单）
- 托盘气泡通知 / 扫描完成通知（Phase 4）
- 窗口记忆位置/大小
- 自定义 exe/托盘图标美化（图标先用程序化占位，后续可替换）
