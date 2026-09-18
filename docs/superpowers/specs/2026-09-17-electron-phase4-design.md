# C 盘空间分析工具 — Electron 桌面化 Phase 4（后台静默扫描 + 通知）设计文档

日期：2026-09-17
状态：待用户审阅
基于：Phase 1（外壳/安装包）、Phase 2（托盘/窗口/自启）、Phase 3（桌面小组件）已交付，本阶段增加后台自动扫描与系统通知

## 1. 背景与目标

Phase 1~3 后应用常驻托盘、有浮窗，但**扫描仍全靠手动**（点按钮或托盘「立即扫描」）。用户不会天天主动看，磁盘悄悄涨满时无人知道。

Phase 4 目标：

- **自动扫描**：启动后延迟扫一次、按固定间隔循环扫、每天固定时间扫（三种触发统一调度，互不叠加）
- **系统通知**：扫描完成后弹 Windows 通知，一次扫描**只弹一条**（合并剩余空间 + 增长量 + 阈值告警）
- **管理员常驻**：启动时提权一次，之后所有扫描都以管理员身份运行，数据完整（不再有「未扫描目录」）
- **可控**：托盘菜单加「后台自动扫描」开关；阈值集中在 `settings.json`，改完无需重启

整体改造共 4 个 Phase：

| Phase | 主题 | 交付边界 |
|---|---|---|
| 1（已完成） | Electron 外壳 + 一键安装包 | exe 安装即用、全功能可用、日志体系、提权适配 |
| 2（已完成） | 托盘 + 窗口行为 + 开机自启 | 托盘图标/菜单、关窗最小化、setLoginItemSettings |
| 3（已完成） | 桌面悬浮小部件 | 无边框透明置顶窗口 + 前端 `/widget` 页面 |
| **4（本阶段）** | 后台静默扫描 + 通知 | 主进程调度器、启动提权、合并通知、阈值配置 |

### 1.1 需求确认结论（brainstorming）

| 决策点 | 结论 |
|---|---|
| 扫描触发 | **三种全启用**：启动后延迟一次 + 固定间隔循环 + 每天固定时间 |
| 通知条件 | **三种全启用**：剩余空间超阈值 + 增长超阈值 + 每次扫完都通知 |
| 通知形式 | **一次扫描合并为一条**（不同时弹多条） |
| 提权策略 | **启动时提权一次，之后常驻管理员**；开机自启（`--hidden`）同样弹 UAC（用户已确认接受） |
| 默认阈值 | 启动延迟 3 分钟 / 间隔 12 小时 / 每日 09:00 / 最短间隔 60 分钟 / 剩余 ≤10% 告警 / 增长 ≥2GB 告警 |
| 托盘开关 | **新增 checkbox「后台自动扫描」**（关掉即完全停止自动扫描与通知，手动扫描仍可用） |
| 配置界面 | 本期不做设置页，阈值写在 `settings.json`（改完 ≤5 分钟生效，无需重启） |

### 1.2 延续的核心约束

1. 全路径日志：关键步骤、每个触发决策、catch 分支均有日志（延续）
2. TDD：新模块先写测试再实现（纯函数与副作用分离，便于 node:test）
3. UI 风格冻结（暗色 #212332/#2A2D3E/#2697FF），本阶段无新 UI 页面
4. 只读安全原则不变（扫描仍为只读）
5. 托盘/自启/窗口行为/浮窗（Phase 2、3）不回归

## 2. 架构总览

```
electron/main.js（修改：集成调度与通知）
  ├─ setupScheduler()（新增 electron/scheduler.js）
  │    ├─ tick 每 5 分钟：loadSettings() → nextDueReason() → 触发扫描
  │    ├─ 扫描：POST /api/scan（等结果）→ GET /api/history（取上次快照）
  │    └─ 完成后：buildNotification() → new Notification() → 点击打开主窗口
  ├─ createElevateGuard()（新增 electron/elevate-guard.js）
  │    └─ 启动时若未提权 → 复用 buildElevateCommand() 触发 UAC 重启
  └─ 托盘菜单新增「后台自动扫描」（electron/tray.js 修改）

electron/settings.js（新增）      settings.json 读写 + 默认值补齐
electron/scheduler.js（新增）     纯函数 nextDueReason() + tick 循环
electron/notify.js（新增）        纯函数 buildNotification()
electron/elevate-guard.js（新增） 纯函数 shouldAttemptElevate() + isElevated()
```

- `server/index.js` **零改动**（复用 `POST /api/scan`、`GET /api/history`、`GET /api/status`、`buildElevateCommand`）
- 不引入 `schtasks` / 系统计划任务（应用本身常驻托盘，主进程调度足够；避免注册系统任务带来的权限、残留与调试成本）

## 3. 关键设计

### 3.1 配置（electron/settings.js，新增，TDD）

- 位置：`path.join(dataDir, 'settings.json')`（userData 下，与 widget-state 同级）
- `loadSettings(file)`：读文件 → 与 `DEFAULTS` 合并 → 类型/范围校验（非法值回落默认）→ 失败/缺失返回 DEFAULTS（不抛错）
- `saveSettings(file, patch)`：合并写回（本期仅供后续设置页/人工调整使用）
- 每次调度 tick 前重新读取 → **改配置 ≤5 分钟生效，无需重启**

```json
{
  "autoScan": true,
  "autoElevateOnStart": true,
  "startDelayMin": 3,
  "intervalHours": 12,
  "dailyAt": "09:00",
  "minGapMin": 60,
  "lowSpacePct": 10,
  "growthWarnGB": 2,
  "notifyEveryScan": true
}
```

### 3.2 调度器（electron/scheduler.js，新增，TDD）

**纯函数**（决策核心，无副作用）：

```js
nextDueReason({ now, appStartedAt, startupScanDone, lastScanAt, lastDailyKey, cfg })
// → 'startup' | 'daily' | 'interval' | null（只返回首要原因，用于日志）
```

判定顺序与规则：

| 触发 | 条件 |
|---|---|
| `startup` | `now - appStartedAt ≥ startDelayMin` 且 本次启动尚未扫过 |
| `daily` | 已过 `dailyAt` 且 `今天(YYYY-MM-DD) !== lastDailyKey` |
| `interval` | `lastScanAt` 存在 且 `now - lastScanAt ≥ intervalHours` |
| 通用去重 | 以上任一还需满足 `!lastScanAt \|\| now - lastScanAt ≥ minGapMin` |
| 总开关 | `cfg.autoScan === true`，否则恒返回 `null` |

**副作用部分**（`createScheduler({...})` 注入依赖，便于测试）：

- `tick()` 每 5 分钟执行一次：
  1. `loadSettings()`
  2. 读 `/api/status` → `scanning` 为真则跳过（记日志，不排队）
  3. `nextDueReason()` 判定 → `null` 则静默返回（debug 级日志）
  4. 命中则记 info 日志（含原因）→ `POST /api/scan`（等待结果）
  5. 成功 → 写状态（`lastScanAt`、`lastDailyKey`、内存 `startupScanDone=true`）→ 通知
- 状态持久化：`scheduler-state.json`（`{ lastScanAt, lastDailyKey }`，崩溃重启后不会重复触发）
- 扫描失败（HTTP 非 200 / 网络错误）→ error 日志 + 失败通知（受 `notifyEveryScan` 控制），**不推进** `lastScanAt`（下个 tick 再试，避免失败后被 minGap 静默 1 小时）

### 3.3 通知（electron/notify.js，新增，TDD）

**纯函数**：

```js
buildNotification({ disk, prevUsedGB, cfg, scannedAt })
// disk: { totalGB, usedGB, freeGB }（来自扫描结果）
// → { title, body, urgent } | null
```

| 情况 | 输出 |
|---|---|
| `disk` 缺失/字段非法 | `null`（不发通知） |
| 剩余空间 `freeGB/totalGB*100 ≤ lowSpacePct` | `urgent = true` |
| `prevUsedGB != null` 且 `usedGB - prevUsedGB ≥ growthWarnGB` | `urgent = true`（无上次快照则不判定增长） |
| `notifyEveryScan === false` 且 `urgent === false` | `null`（安静模式） |

文案（合并为一条）：

- `urgent` → title：`⚠️ C 盘空间告警`；否则 title：`扫描完成`
- body：`剩余 12.3%（24.6 GB）` + （有增长时）`，本次 +2.1 GB`
- 点击通知 → `showMainWindow()`（主窗口已销毁时走既有兜底重建）

**副作用部分**（`createNotifier({ Notification, showMain, log })`）：

- `Notification.isSupported()` 为假 → 记 warn 并跳过
- 构造/`show()` 全部包 try/catch + 日志
- 已知限制：开发模式通知显示为 `Electron`，安装版（NSIS 快捷方式 + AppUserModelID）才显示 `CDriveCleaner`

### 3.4 启动提权（electron/elevate-guard.js，新增，TDD）

**纯函数**：

```js
shouldAttemptElevate({ isElevated, lastAttemptAt, now, cfg, isHidden })
// → boolean
```

- `isElevated === true` → `false`（提权重启后的新进程天然不重复弹窗，**这是防死循环的主保障**，不依赖命令行标记）
- `cfg.autoElevateOnStart === false` → `false`
- `lastAttemptAt` 存在且 `now - lastAttemptAt < 10 分钟` → `false`（冷却，防快速重启连弹）

**探测函数**：`isElevated({ psPath })` → spawn PowerShell 执行
`([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`
→ 输出 `True`/`False`；spawn 失败/非零退出 → 记 error 并返回 `null`（`null` 视为「未知」，不弹 UAC，降级运行）

**流程**（main.js，`whenReady` 后、启动扫描前）：

```
isElevated() → true  → 跳过，日志「已以管理员身份运行」
             → false → shouldAttemptElevate()?
                         ├─ 是 → 写 scheduler-state（lastElevateAttemptAt）
                         │       → spawn buildElevateCommand(pid, flagPath, exePath)
                         │         ├─ UAC 点是 → relaunch-admin.ps1 提权重启（新进程 isElevated=true → 跳过）
                         │         └─ UAC 点否 → 退出码非 0 → 日志 + 本次会话不再尝试
                         └─ 否 → 日志「跳过启动提权（冷却/已关闭）」，以普通权限继续
```

- 与现有「概览页一键提权重扫」共用同一 ps1 与命令构造（DRY），两条入口互不冲突
- 开机自启（`--hidden`）同样走此流程（用户已确认）；UAC 无人应答时由既有 60 秒超时转「已取消」，应用以普通权限继续运行

### 3.5 托盘菜单（electron/tray.js 修改 + 测试更新）

菜单新增一项（位于「显示/隐藏桌面小组件」之后、「退出」之前）：

| 菜单项 | 行为 |
|---|---|
| 后台自动扫描 | checkbox，状态 `getMenuState().autoScan`，点击 → 写 `settings.json` 的 `autoScan` |

- `getMenuState` 扩展为 `{ autostart, widgetVisible, autoScan }`
- `tray.test.js` 更新：断言菜单含 **6 个功能项**、`autoScan` checkbox 状态正确
- 点击开关后需重建菜单（下次右键自动重建，沿用现有实现）

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `electron/settings.js` | 新增 | 配置读写 + 默认值 + 校验 |
| `electron/settings.test.js` | 新增 | 默认值/残缺/非法值/往返 |
| `electron/scheduler.js` | 新增 | `nextDueReason()` 纯函数 + `createScheduler()` |
| `electron/scheduler.test.js` | 新增 | 三种触发/去重/扫描中跳过/失败不推进 |
| `electron/notify.js` | 新增 | `buildNotification()` 纯函数 + `createNotifier()` |
| `electron/notify.test.js` | 新增 | 文案组合/无增长/阈值边界/安静模式 |
| `electron/elevate-guard.js` | 新增 | `shouldAttemptElevate()` + `isElevated()` |
| `electron/elevate-guard.test.js` | 新增 | 已提权跳过/冷却/开关关闭/探测失败降级 |
| `electron/main.js` | 修改 | 集成提权守卫、调度器、通知器；退出时清理定时器 |
| `electron/tray.js` | 修改 | 菜单加「后台自动扫描」 |
| `electron/tray.test.js` | 修改 | 6 功能项断言 + autoScan 状态 |
| `README.md` | 修改 | 补充 Phase 4 功能与 settings.json 说明 |

不改动：`server/index.js`、PowerShell 脚本、前端页面、`electron-builder.yml`

## 5. 边界情况

| 场景 | 处理 |
|---|---|
| 扫描中又有触发点到达 | 跳过本次 tick，记日志（不排队、不叠加） |
| 应用频繁重启 | `minGapMin`（60 分钟）保证不会连扫；状态持久化跨进程生效 |
| 系统休眠/唤醒跨过多个触发点 | tick 恢复后按去重规则只扫一次（`daily` 用日期串判重） |
| 扫描失败（ps1 出错/超时/端口占用） | error 日志 + 失败通知；**不**推进 `lastScanAt`，下个 tick 重试 |
| 无历史快照（首次运行） | 不做增长判定与展示，仅报剩余空间 |
| PowerShell 探测提权状态失败 | 记 error，返回 `null` → 视为未知，不弹 UAC，降级运行 |
| UAC 被拒 / 系统策略禁用提权 | 记日志 → 应用以普通权限继续（不阻塞启动） |
| 通知不被系统支持 | `Notification.isSupported() === false` → warn 日志并跳过 |
| 托盘退出应用 | 调度器随进程结束（本阶段不做系统级计划任务，符合设计边界） |
| `settings.json` 被改成非法值 | 校验回落默认值 + warn 日志（不崩溃） |

## 6. TDD 验证

- `electron/settings.test.js`：无文件→默认值；残缺字段→补齐；非法值（字符串/越界/负数）→回落；`saveSettings` 往返
- `electron/scheduler.test.js`：启动延迟未到→`null`；延迟到且未扫过→`startup`；距上次扫描达间隔→`interval`；过 `dailyAt` 且今日未扫→`daily`；`minGapMin` 未到→`null`（三种触发均被拦截）；`autoScan=false`→恒 `null`；优先级顺序
- `electron/notify.test.js`：剩余超阈值→`urgent` + 告警 title；增长达阈值→`urgent`；两者都无但 `notifyEveryScan`→普通文案；`notifyEveryScan=false` 且无告警→`null`；`disk` 缺失→`null`；边界值（恰好等于阈值）
- `electron/elevate-guard.test.js`：已提权→`false`；开关关闭→`false`；冷却期内→`false`；冷却期外且未提权→`true`
- 回归：`npm test` 全量不回归、`npx tsc --noEmit` 0 错误、`npm run build` + 打包成功

## 7. 手工验收清单

1. 启动应用 → 弹 UAC（点「是」）→ 应用以管理员重启并自动扫描；概览「未扫描目录」应减少/消失
2. 启动后 3 分钟内自动扫描一次，完成后弹**一条**通知（含剩余空间；有上次快照时含增长量）
3. 把 `settings.json` 的 `intervalHours` 改为 `1`、`minGapMin` 改为 `1` → ≤5 分钟生效，1 小时后自动再扫并通知
4. 把 `lowSpacePct` 改为 `99` → 下次扫描通知标题带「⚠️ C 盘空间告警」
5. 把 `growthWarnGB` 改为 `0` → 下次通知体现增长告警
6. 托盘菜单「后台自动扫描」取消勾选 → 不再自动扫描/通知；手动「立即扫描」仍可用；重新勾选后恢复
7. UAC 点「否」→ 应用仍能正常启动并运行（普通权限），日志有「本次会话不再尝试提权」
8. 扫描进行中再等一个触发点 → 日志显示跳过（不并发扫描）
9. 通知点击 → 打开并聚焦主窗口
10. 日志完整：触发决策（原因）、扫描开始/结束、通知构造与展示、提权各分支均有记录

## 8. 排除项（本阶段不做）

- 设置界面（阈值仅通过 `settings.json` 调整；设置页留待后续）
- Windows 任务计划程序（`schtasks`）与「应用未运行也能扫」
- 通知历史/未读中心、通知免打扰时段
- 扫描结果自动清理建议、静默删除/清理动作（只读原则不变）
- 通知声音/图标自定义、Toast 按钮交互（查看详情/稍后提醒）
- 多磁盘（D/E 盘）监控扩展
