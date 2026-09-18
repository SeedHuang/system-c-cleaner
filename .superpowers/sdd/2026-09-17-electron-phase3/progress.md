# Phase 3（桌面悬浮小部件）SDD 进度账本

日期：2026-09-17
Spec：`docs/superpowers/specs/2026-09-17-electron-phase3-design.md`
Plan：无独立 plan 文件（按 spec 内任务直接 TDD 实施）

## 状态：代码完成 ✅ / 手工验收部分确认 ⏳

| 任务 | 交付物 | 状态 |
|---|---|---|
| T1 位置存取 | `electron/widget-state.js` + 测试（6 例：存取/无文件/损坏 JSON/非有限数/越界） | ✅ |
| T2 窗口与 preload | `electron/widget.js`（无边框/透明/置顶/不进任务栏/位置记忆/右键菜单）+ `electron/widget-preload.js` | ✅ |
| T3 前端页面 | `src/pages/Widget/index.tsx` + `index.css`（磁盘卡 + 60s 轮询 + 拖拽 + 点击打开主窗口） | ✅ |
| T4 托盘开关 | `electron/tray.js` 菜单新增「显示/隐藏桌面小组件」+ `tray.test.js` 更新（6 例，断言 5 功能项） | ✅ |
| T5 主进程集成 | `electron/main.js`：`createSystemWidget` / `toggleWidget` / `ipcMain.on('widget:open-main')` / widget 状态文件 | ✅ |
| T6 文档 + 回归 + 打包 | README 补 Phase 3；`npm test` 61/61；`tsc` 0 错误；NSIS 106.57MB | ✅ |

## Phase 3 期间额外交付（非 spec 内，用户当场提出）

| # | 内容 | 涉及文件 |
|---|---|---|
| E1 | 主窗口扫描状态轮询：托盘/后台触发的扫描，主窗口按钮能实时变「正在扫描，请稍候…」，结束后自动刷新 | `src/models/scan.ts` |
| E2 | 提权重扫修复（详见 R3） | `server/index.js`、`scripts/relaunch-admin.ps1`、`src/pages/Dashboard/index.tsx` |
| E3 | 增长量负数单位换算（详见 R4） | `src/utils/format.ts` |
| E4 | 点击路径/图标在资源管理器中打开（详见 R5） | `electron/main-preload.js`、`electron/open-target.js`(+test)、`src/components/PathLink.tsx`、`src/utils/shell.ts`、`src/utils/path.ts`、`Folders`/`Trends`/`LargeFiles` 三页 |
| E5 | 浮窗隐藏后托盘勾选状态不同步（详见 R1） | `electron/main.js`、`electron/widget.js` |

## Rulings / 偏差

| # | 内容 |
|---|---|
| R1 | **浮窗隐藏不同步托盘**：浮窗有两条隐藏路径（托盘勾选走 `toggleWidget`；浮窗右键「隐藏小组件」与 `Alt+F4` 直接 `hide()`），后者未回写主进程 `widgetVisible`，导致托盘勾选永远停留旧值、需点两次才能恢复。修复：`createWidget` 传 `onVisibilityChange` 回写状态；widget `close` 处理器改走 `toggle(false)`，两条路径统一。 |
| R2 | **托盘立即扫描时主窗口无反应**：扫描确实触发（日志 `POST /api/scan -> 200`），但前端 `scanning` 只是页面按钮的本地状态，从不读 server 状态。修复：`src/models/scan.ts` 增加 3 秒轮询 `/api/status`，扫描结束自动 `refresh()`。 |
| R3 | **提权重扫必失败**：UAC 提权进程**不继承调用者环境变量**，`$env:CLEANER_DATA_DIR`/`$env:CLEANER_EXE_PATH` 为空 → flag 写到 `resources\history\` 而旧进程在等 `%APPDATA%` 下的 flag（永远等不到）；且未显式传启动命令。修复：`buildElevateCommand` 显式传 `-FlagPath`/`-ExePath`，`try/catch` 让 UAC 被拒立即返回非 0；监控只认 flag 文件；409 返回真实原因；`relaunch-admin.ps1` 新增两个参数并写 `logs/elevate.log`；前端提权阶段改为从 `/api/status` 推导（挂载即同步 + 4 秒轮询），切页回来不再恢复成可点击。 |
| R4 | **趋势「增长量」显示 `-29044421 B`**：`formatSize` 用带符号原值比较单位阈值，负数永远落到最后的 `B` 分支。修复：按 `Math.abs` 选单位、保留符号。该函数为公共函数，Trends/History 等处一并修好。 |
| R5 | **项目原本没有打开资源管理器的能力**：主窗口此前无 preload。新增最小 IPC（`contextBridge` 暴露 `desktopAPI.openPath` + `ipcMain.handle('shell:open-path')`），判定逻辑抽成纯函数 `resolveOpenAction(path, statFn)` 并 TDD（8 例）；文件与目录区分处理（目录 `openPath`、文件 `showItemInFolder` 定位选中）；浏览器开发模式安全降级返回「请在桌面应用中使用此功能」。 |
| R6 | **打包 EPERM**：应用实例运行中会锁住 `dist_electron\win-unpacked\CDriveCleaner.exe`，`electron-builder` 覆盖时 `unlink` 被拒。处置：打包前先结束 `CDriveCleaner` 进程（本轮多次遇到）。 |
| R7 | **趋势分析点击分工调整**：初版把目录名称也做成「打开文件夹」，用户反馈名称区域过大易误触。调整为：仅路径可点（Top20 灰色父路径、表格「上级目录」列），名称与行其他区域一律下钻（表格新增 `onRow` 整行下钻，「进入」按钮加 `stopPropagation` 防重复请求）。 |

## 验收结论

- **已通过**：打开文件夹功能（目录排行路径、趋势分析父路径与上级目录列、大文件操作列图标）—— 用户确认「验证通过」。
- **待用户逐项确认**：
  1. 浮窗显隐同步修复（浮窗右键隐藏 / `Alt+F4` 后，托盘勾选应自动取消）
  2. spec 手工清单第 3 项：拖拽卡片后重启，位置是否保持
  3. spec 手工清单第 7 项：从未扫描过时，卡片显示引导文案且可点击打开主窗口
- 其余清单项（卡片置顶/内容展示/点击打开主窗口/右键菜单/托盘开关）在开发与排障过程中已被用户实际操作过，未见异常。

## 验证记录（最近一次打包）

- `npm test`：61/61 通过（含 `open-target.test.js` 8 例）
- `npx tsc --noEmit`：0 错误
- `parentOf` 逻辑：以 `node --experimental-strip-types` 直接跑真源码，8 用例全过
- 打包：`CDriveCleaner-Setup-0.1.0.exe` 106.57 MB（2026-09-17 15:21:46），asar 内含 `main-preload.js`/`open-target.js`/`widget.js`，测试文件已排除

## 待办

- [ ] 提交并推送 Phase 3 代码（git 写操作被沙箱拦截，需用户终端执行；已提供 3 段提交命令）
- [ ] 用户逐项确认上节「待用户逐项确认」3 条
- [ ] 进入 Phase 4（后台静默扫描 + 通知），需先 brainstorming 需求讨论
