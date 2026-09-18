# Phase 4（后台静默扫描 + 系统通知）SDD 进度账本

日期：2026-09-17
Spec：`docs/superpowers/specs/2026-09-17-electron-phase4-design.md`（已批准）
Plan：无独立 plan 文件（按 spec §4 文件变更清单 / §6 TDD 验证直接实施）

## 状态：代码完成 ✅ / 手工验收待确认 ⏳

| 任务 | 交付物 | 状态 |
|---|---|---|
| T1 配置读写 | `electron/settings.js`（`DEFAULTS` 9 字段 + `RULES` 校验 + `loadSettings`/`saveSettings` 容错）+ `settings.test.js` 9 例 | ✅ |
| T2 调度决策 | `electron/scheduler.js`（纯函数 `parseScanTime`/`dayKey`/`dailyAtMs`/`nextDueReason`/`pickPrevUsedGB` + `loadState`/`saveState` + `createScheduler`）+ `scheduler.test.js` 24 例 | ✅ |
| T3 合并通知 | `electron/notify.js`（`buildNotification`/`buildFailureNotification` + `createNotifier`）+ `notify.test.js` 17 例 | ✅ |
| T4 启动提权守卫 | `electron/elevate-guard.js`（`parseElevated`/`shouldAttemptElevate`/`probeElevation` + `createElevateGuard`）+ `elevate-guard.test.js` 17 例 | ✅ |
| T5 主进程集成 | `electron/main.js`：`apiRequest`（Promise 化 HTTP）、`runStartupElevateGuard`、`startScheduler`、`app.setAppUserModelId('com.seed.cdrivecleaner')`、`before-quit` 停调度器、托盘 `onToggleAutoScan` 写回配置 | ✅ |
| T6 托盘开关 | `electron/tray.js` 新增「后台自动扫描」checkbox（共 6 功能项）+ `tray.test.js` 更新为 8 例 | ✅ |
| T7 文档 + 回归 + 打包 | README 补 Phase 4（三·五节 + `settings.json` 配置表）；`npm test` 129/129；`tsc` 0 错误；NSIS 106.58 MB | ✅ |
| T8 移除原生菜单栏 | `electron/main.js`：`Menu.setApplicationMenu(null)` + `autoHideMenuBar: true`（去掉 File/Edit/View/Window 一行） | ✅ |
| T9 趋势分析时间范围 | 后端 `history.js` 新增 `parseRangeDate`/`parseRange`/`pickRangePair` + `resolveGrowthPair` 统一入口；路由透传 `from`/`to`；`growth.ts` service 加 `GrowthRangeParams`；Trends 页 `DatePicker.RangePicker` 与预设窗口二选一；新增 history 5 例 + api 2 例 | ✅ |
| T10 区间精确到分钟 + 「今天」预设 | `parseRangeDate` 支持可选时分秒（`YYYY-MM-DD HH:mm[:ss]`），起点取 `:00.000` / 终点取 `:59.999`；Trends 页开 `showTime` + `format="YYYY-MM-DD HH:mm"` + `presets` 「今天」（00:00:00.000 ~ 23:59:59.999）；新增 history 3 例 | ✅ |
| T11 下钻卡片「打开当前目录」 | `PathLink` link 变体支持 `leadingIcon` + `children`，标题整段图标+文字都触发打开；「子目录增长」「历史大小趋势」两张卡片都改为该模式 | ✅ |
| T12 数据目录迁移到 `~/.system-c-cleaner` | 新增 `electron/migrate-data.js` + `migrate-data.test.js`（10 例）；`electron/main.js` 注入 `CLEANER_DATA_DIR = app.getPath('home')/.system-c-cleaner`；启动时一次性合并 `%APPDATA%\c-drive-cleaner` 老数据；`settings.json` 不迁移；`history/index.json` 按 id 去重 + 按 scannedAt 升序；旧位置写 `.migrated-to` / `.migrated-at` 标记防重复；新增 `scripts/migrate-data.js` CLI（`npm run migrate`），不依赖 Electron | ✅ |
| T13 历史快照页「打开快照目录」 | `listSnapshots` 多返 `historyDir`；`/api/history` 透传；`HistoryList` type 加 `historyDir`；`History/index.tsx` Card `extra` 区加图标按钮 `打开快照目录`，调用 `openInExplorer(historyDir)`，tooltip 含完整路径；history 测试 +1 断言、api 测试 +1 断言 | ✅ |

## 关键设计（对应 spec §4）

- **配置**：`%APPDATA%\c-drive-cleaner\settings.json`，9 字段（`autoScan` / `autoElevateOnStart` / `startDelayMin` / `intervalHours` / `dailyAt` / `minGapMin` / `lowSpacePct` / `growthWarnGB` / `notifyEveryScan`）。
- **调度**：tick 间隔 5 分钟；三种触发合流判定，优先级 `startup > daily > interval`；`minGapMin` 对所有分支统一兜底去重。
- **状态**：`scheduler-state.json` 持久化 `lastScanAt` / `lastDailyKey` / `lastSeenScannedAt` / `lastElevateAttemptAt`（提权守卫与调度器共用同一文件）。
- **通知**：每次扫描只发一条合并通知（剩余占比 + 容量 + 本次增长），超阈值升级为告警标题；点击打开主界面。
- **提权**：启动探测 → 未提权则请求 UAC 重启用管理员运行；已在管理员身份下 / 探测失败 / 冷却期内一律不弹。
- **趋势区间（T9）**：预设窗口与起止日期区间**二选一**（选了区间则预设按钮置灰语义）。区间端点 = `≤ to 23:59:59.999` 的最后一条快照，基准 = `≤ from 00:00:00.000` 的最后一条快照（区间开始前那一帧）；基准缺失回退最早一条；端点=基准 → 数据不足。窗口模式与区间模式统一走 `resolveGrowthPair`，区间非法自动回落窗口模式。

## Rulings / 偏差

| # | 内容 |
|---|---|
| R1 | **提权防死循环不依赖命令行标记**：提权重启后的新进程 `isElevated()===true`，天然跳过（比传标记更可靠，标记可能被伪造或丢失）。另加 10 分钟冷却（`lastElevateAttemptAt` 持久化），避免 UAC 被拒后用户反复启动反复弹窗。 |
| R2 | **探测失败按「未知」处理**：`probeElevation` 返回 `true/false/null`（超时 10s、spawn 异常、输出无法识别均为 `null`）；`shouldAttemptElevate` 只在 `isElevated === false` 时才为真。即宁可漏提权，也不误弹 UAC。 |
| R3 | **startup 触发不写死「仅首次」**：`startupScanDone` 是内存标记（进程内），配合 `minGapMin` 拦截，避免「频繁重启 → 每次都满足 startup」导致连环扫描。 |
| R4 | **扫描失败不推进 `lastScanAt`**：失败时只 `saveState` 现状，下个 tick 立即重试；否则会被 `minGapMin` 静默压制一小时。同时补发「⚠️ 扫描失败」通知。 |
| R5 | **通知统一由调度器发送**：托盘「立即扫描」改为只调 API、不再自己发通知；调度器通过比对 `/api/status` 的 `scannedAt` 变化识别「别处完成的扫描」并补发一条通知（`lastSeenScannedAt` 去重），保证任意入口触发的扫描都只通知一次。 |
| R6 | **启动时不回放旧通知**：`createScheduler.start()` 先读一次 `/api/status` 同步 `lastSeenScannedAt`，避免「上次扫描结果」在重启后被当成新扫描再通知一遍。 |
| R7 | **安静模式边界**：`notifyEveryScan=false` 时普通扫描不通知，但告警（剩余 ≤ `lowSpacePct` 或增长 ≥ `growthWarnGB`）仍通知——静默不等于漏掉风险。 |
| R8 | **配置损坏不能让应用起不来**：`loadSettings` 对缺失/非法字段一律回落默认值并记 warn，`saveSettings` 捕获异常返回 `false` 不抛错。 |
| R9 | **区间非法静默回落窗口模式**：`parseRange` 对格式错误 / `from > to` / `2026-02-30`（`Date` 会归一化到 3 月，需回查年月日确认）一律返回 `null`，调用方走原窗口逻辑——改动对旧行为零影响，也为旧客户端/手拼 URL 兜底。 |
| R10 | **端点不可比时仍返回端点**：`pickRangePair` 在「端点 = 基准」时返回 `{ latestId: latest.id, compareId: null }` 而非把 `latestId` 也置空——前端需要 `latestId` 显示 `scannedAt`，「不可比」只由 `compareId === null` 表达。 |
| R11 | **区间内无新快照 ≠ 无数据**：`computeGrowthTop` 的 insufficient 分支回显 `rangeFrom`/`rangeTo`/`scannedAt`（取 ≤to 的那条），前端能区分「区间选得太早」和「完全没有历史」。 |
| R12 | **趋势折线图不跟随区间**：`/api/growth/trend` 未改动，仍固定取最近 60 个点。区间只作用于 Top 20 排行与下钻子目录——折线图的作用是看长期形态，跟随区间反而会因点太少而失真。 |
| R13 | **三档粒度统一走一个正则**：`parseRangeDate` 用 `(?: (\d{2}):(\d{2})(?::(\d{2}))?)?` 可选组一次覆盖「日期 / 分钟 / 秒」，端点规则按「该粒度的最后一刻」推导（日期→`23:59:59.999`、分钟→`:59.999`、秒→`:999`），无需为每种格式写分支。只接受空格分隔（不接受 `T`），避免与快照 ID 格式混淆。 |
| R14 | **「今天」用 `presets` 而非自定义面板**：antd `RangePicker` 原生不支持「开始面板一个、结束面板一个」的独立快捷按钮，硬做要 `panelRender` 全量自定义、破坏默认 UI。折中为一条整体预设，一次点击同时设好 `startOf('day')` / `endOf('day')`——视觉上「今天」→ `00:00` ~ `23:59`，与用户诉求等价。 |
| R15 | **不迁移 `settings.json`**：用户配置可能与新实例默认值不一致（例如未来新增字段），让用户重启后用新默认值再自行调整，避免旧值「锁住」新功能；旧位置保留原文件供用户手动合并。 |
| R16 | **`oldDir === newDir` 直接 return**：用户通过 `CLEANER_DATA_DIR` 显式覆盖到新位置时不再迁移；开发模式 `isDev === true` 不触发迁移（项目根 ≠ userData 是设计内）。 |
| R17 | **旧位置双标记防重复**：迁移完成后写 `.migrated-to`（内容 = 新路径）和 `.migrated-at`（ISO 时间）；同时 `runMigrate` 跳过这两个文件名，避免把旧位置已经写过的标记再次复制到新位置。 |
| R18 | **迁移 best-effort**：所有 IO 失败都被 try/catch + log 兜住，主进程启动流程不阻塞——迁移是优化路径，失败就当全新用户使用。 |
| R19 | **始终「合并」而非「覆盖」**：新位置有数据时不再返回 `new-exists`；而是逐项合并（顶层文件「存在则不覆盖」、history 按 id 去重 + 时间升序、logs 按文件名去重）。用户部分迁移过 / 跨设备混用 / 手动复制过都不会丢数据。 |
| R20 | **`readIndexSafe` 剥离 UTF-8 BOM**：PowerShell `Set-Content` 默认 UTF-8 with BOM，会让 `JSON.parse` 失败导致合并退化为空——与 `server/history.js:readIndex` 保持一致。 |
| R21 | **`scripts/migrate-data.js` 与主进程共用同一份 `runMigrate`**：CLI 不复制实现，避免行为漂移；`require('../electron/migrate-data')` 失败时回退到 `./electron/migrate-data` 与 `../../electron/migrate-data`，兼容源码目录和打包后 `resources/scripts/` 两种布局。 |

## 验证记录（最近一次打包）

- `npm test`：153/153 通过（server + electron 全量；Phase 4 新增 67 例：settings 9 / scheduler 24 / notify 17 / elevate-guard 17；T9 新增 7 例：history 5 / api 2；T10 新增 history 3 例；T12 + T13 共新增 migrate-data 10 例）
- `npx tsc --noEmit`：0 错误
- 打包：`dist_electron\CDriveCleaner-Setup-0.1.0.exe` 106.61 MB（2026-09-17 18:34:52，含 T8/T9/T10/T11/T12/T13/T14）
- asar 内容校验：含 `electron\settings.js` / `scheduler.js` / `notify.js` / `elevate-guard.js` / `migrate-data.js`，`server\history.js` 内 `pickRangePair`/`parseRangeDate`/`resolveGrowthPair` 命中 10 处、`hasSec`（分钟粒度）命中 3 处、`migrate-data.js` 命中 4 处，`*.test.js` 已排除
- `resources/scripts/` 校验：`scripts/migrate-data.js` 已随 extraResources 进包，可独立跑迁移
- 打包前置：先 `Stop-Process -Name CDriveCleaner -Force`（本次有实例在运行，否则 `EPERM: unlink CDriveCleaner.exe`）

## 手工验收清单（spec §7 的 10 项 + T8/T9/T10/T11/T12 新增 11 项，待用户确认）

| # | 验收项 | 预期 |
|---|---|---|
| 1 | 托盘右键菜单 | 出现「后台自动扫描」勾选项，默认勾选；点击可切换，重启后状态保持 |
| 2 | 关闭自动扫描 | `settings.json` 置 `autoScan:false` → 托盘为未勾选，且后台不再自动扫描 |
| 3 | 启动延迟扫描 | 启动满 `startDelayMin`（默认 3）分钟后自动扫一次，完成弹「扫描完成 剩余 xx%（xx GB）」 |
| 4 | 通知点击 | 点击通知打开主界面 |
| 5 | 托盘驻留扫描 | 关闭主窗口（最小化到托盘）后，后台仍按时自动扫描 |
| 6 | 低空间告警 | `lowSpacePct` 调成 99 重启 → 下次通知标题为「⚠️ C 盘空间告警」 |
| 7 | 增长告警 | `growthWarnGB` 调成 0 重启 → 有增长时标题为告警 |
| 8 | 安静模式 | `notifyEveryScan:false` → 普通扫描无通知，仅告警通知 |
| 9 | 启动提权 | `autoElevateOnStart:true` 且非管理员启动 → 弹一次 UAC，提权后以管理员运行且不再重复弹；置 `false` → 不弹 |
| 10 | 最小间隔去重 | `minGapMin` 内再次启动应用 → 不会立刻重复扫描 |
| 11 | 原生菜单栏移除（T8） | 窗口标题栏下方不再有 File/Edit/View/Window/Help 一行，按 Alt 也不出现 |
| 12 | 预设窗口（T9） | 趋势分析页默认预设按钮可用，点 `1月` → Top 20 标题显示「对比 <快照时间>」 |
| 13 | 区间查看（T9/T10） | 选起止日期+时分 → 预设按钮让位，Top 20 标题显示「（区间 x ~ y）」，数据随区间变化 |
| 14 | 「今天」快捷方式（T10） | 打开区间选择器点「今天」→ 显示 `今天 00:00` ~ `今天 23:59`，Top 20 按当天整天对比 |
| 15 | 区间清除（T9） | 清空区间选择器 → 自动回到预设窗口模式，数据恢复 |
| 16 | 下钻 + 区间（T9） | 选好区间后点目录名下钻 → 子目录增长卡片标题带区间，切换区间数据同步刷新 |
| 17 | 非法区间 | 手工拼 `from=2026-09-01 24:00` 或 `from > to` 的 URL → 后端回落窗口模式并正常返回（不报错） |
| 18 | 下钻卡片打开目录（T11） | 下钻后「子目录增长」「历史大小趋势」两张卡片标题（图标+文字）→ 点击在资源管理器中打开当前下钻目录；面包屑仍可点跳层级 |
| 19 | 数据目录迁移（T12） | `%APPDATA%\c-drive-cleaner` 有数据时启动一次 → 新位置 `%USERPROFILE%\.system-c-cleaner` 出现全部数据（含 `history/` `logs/`），旧位置出现 `.migrated-to` 标记；`settings.json` 不出现在新位置 |
| 20 | 新用户默认位置（T12） | 卸载老版本后首次启动 → 数据目录在 `%USERPROFILE%\.system-c-cleaner`，不再依赖 `%APPDATA%` |
| 21 | 环境变量覆盖（T12） | 启动前设置 `CLEANER_DATA_DIR=D:\test\data` → 数据目录走该路径，不触发迁移 |
| 22 | 手动迁移 CLI（T13） | 准备老位置 + 新位置 → `npm run migrate -- --from D:\old --to D:\new` → 三个快照按时间升序合并、settings.json 不出现、退出码 0 |
| 23 | 手动迁移 CLI 跳过（T13） | 旧目录不存在 → 脚本打印 `[OK] 旧目录为空或不存在，无需迁移`，退出码 0 |
| 24 | 手动迁移 CLI 同路径（T13） | `--from D:\x --to D:\x` → 打印 `[!] --from 与 --to 指向同一路径，跳过迁移`，退出码 0 |
| 25 | 打开快照目录（T13） | 历史快照页右上角「打开快照目录」按钮 → 点击后资源管理器打开 `%USERPROFILE%\.system-c-cleaner\history`，能看到 `index.json` + 各 `<id>.tsv.gz`；hover tooltip 含完整路径 |

## 待办

- [ ] 用户按上节 25 项手工验收
- [ ] 提交并推送 Phase 3 + Phase 4 代码（git 写操作被沙箱拦截，需用户终端执行）
