# C 盘空间分析工具 — Electron 桌面化 Phase 1（外壳 + 一键安装包）设计文档

日期：2026-09-16
状态：待用户审阅
基于：v3 设计文档（`2026-09-16-growth-history-design.md`），本阶段不改动既有分析与展示功能

## 1. 背景与目标

现状：工具是「Web 前端（umi/max + antd5）+ 本地 Node http 服务（server/index.js）+ PowerShell 扫描脚本」架构，需用户手动装 Node 环境并运行 `node server/index.js` 才能使用，对普通用户门槛高。

Phase 1 目标（整体 Electron 改造的第 1 阶段）：

- **打包**：产出 Windows 一键安装包（NSIS `.exe`），目标电脑零环境依赖（内置 Node + Chromium）
- **外壳**：Electron 主进程承载现有全部功能（扫描 / 历史 / 趋势 / 大文件 / 清理建议），前端与 server 逻辑最大程度复用
- **权限**：保留并适配「一键以管理员身份重扫」（UAC），满足更大本地权限诉求
- **日志**：全路径日志体系落地，关键步骤、交互、异常均有据可查

整体改造共 4 个 Phase，各独立 spec+plan 逐步推进：

| Phase | 主题 | 交付边界 |
|---|---|---|
| **1（本阶段）** | Electron 外壳 + 一键安装包 | exe 安装即用、全功能可用、日志体系、提权适配 |
| 2 | 托盘 + 窗口行为 + 开机自启 | 系统托盘图标/菜单、关窗最小化到托盘、`setLoginItemSettings` |
| 3 | 桌面悬浮小部件 | 无边框透明置顶窗口 + 前端 `/widget` 页面 |
| 4 | 后台静默扫描 + 通知 | 主进程定时器、系统通知、静默清理 |

### 1.1 需求确认结论（brainstorming）

| 决策点 | 结论 |
|---|---|
| 转化方式 | **最小改动**：主进程内嵌现有 http 服务 + BrowserWindow 加载；不做 IPC 全面重构 |
| 数据目录 | 打包后写入 `%APPDATA%\CDriveCleaner`（userData），开发模式保持项目根（现状不变） |
| PowerShell 脚本 | `scripts/` 放 asar 外（extraResources），PowerShell 可读 |
| 端口 | 生产 8090 起，EADDRINUSE 退避 8091…8099；开发加载 umi dev server（8000） |
| 安装包 | NSIS 一键安装；productName 用英文 `CDriveCleaner`（避开中文路径/权限坑） |
| 提权重扫 | 保留 `/api/elevate-restart` 机制，脚本启动目标改为 Electron exe |
| 版本 | electron ^44（当前稳定主版本）、electron-builder（npm 最新稳定，执行时锁定） |

### 1.2 延续的核心安全原则（不因桌面化改变）

1. 扫描与快照全程只读：绝不删除、移动、修改任何文件/目录/注册表项
2. 权限不足目录：跳过并标注，绝不提权、不夺所有权
3. 「以管理员身份运行」仅为引导/一键提权重扫，由用户主动触发 UAC

## 2. 架构总览

```
electron/main.js（新增，主进程入口）
  ├─ 解析启动参数与环境（CLEANER_*）
  ├─ 启动内嵌 http 服务（复用 server/index.js 的 startServer）
  ├─ 创建 BrowserWindow
  │    ├─ 生产：加载 http://localhost:<port>（server 托管 asar 内 dist/）
  │    └─ 开发：加载 http://localhost:8000（umi dev + proxy 转发 /api）
  ├─ --scan-on-start → 以 SCAN_ON_START 启动内嵌服务（提权重扫链路）
  └─ 全路径日志（console + 文件双写）
```

- 前端 `src/` **零改动**（本 Phase）
- server 逻辑原样复用，仅做「路径可配置化」改造
- Electron 安全默认：`contextIsolation: true`、`nodeIntegration: false`、无 preload（本 Phase 不需要 IPC）

## 3. 关键决策：数据目录重定向（打包后必需）

现有代码硬编码写项目根（`scan-result.json`、`history/`、`.elevated-launch.flag`）。打包后安装到 `C:\Program Files\...` 普通用户不可写，必须重定向。

引入环境变量，**默认值保持现状**（开发/既有 `npm run server` 行为不变），打包后由 main.js 注入：

| 环境变量 | 默认（开发/现状） | 打包后（main.js 注入） |
|---|---|---|
| `CLEANER_DATA_DIR` | 项目根 | `app.getPath('userData')`（`%APPDATA%\CDriveCleaner`） |
| `CLEANER_SCRIPTS_DIR` | `项目根/scripts` | `process.resourcesPath/scripts`（asar 外） |
| `CLEANER_LOG_DIR` | 项目根（或终端） | `app.getPath('userData')/logs` |
| `CLEANER_RESULT_PATH` | （未设置，脚本默认写项目根） | `userData/scan-result.json` |

改造点：

- `server/index.js`：
  - `RESULT_FILE = path.join(env.CLEANER_DATA_DIR || ROOT, 'scan-result.json')`
  - `PS_SCRIPT = path.join(env.CLEANER_SCRIPTS_DIR || path.join(ROOT,'scripts'), 'scan-c.ps1')`
  - `ELEVATE_SCRIPT = path.join(env.CLEANER_SCRIPTS_DIR || path.join(ROOT,'scripts'), 'relaunch-admin.ps1')`
  - `ELEVATE_FLAG = path.join(env.CLEANER_DATA_DIR || ROOT, '.elevated-launch.flag')`
  - spawn 扫描时传入 `env`：`CLEANER_RESULT_PATH`（若设置了 DATA_DIR 则一并设置）
- `server/history.js`：`HISTORY_DIR = path.join(env.CLEANER_DATA_DIR || ROOT, 'history')`
- `scripts/scan-c.ps1`：结果路径支持 `$env:CLEANER_RESULT_PATH` 覆盖
- `scripts/relaunch-admin.ps1`：启动目标改为 Electron exe（路径经 `$env:CLEANER_EXE_PATH` 传入，兼容开发模式 `node` 回退）

## 4. 关键决策：PowerShell 脚本放 asar 外

- `scripts/` 通过 electron-builder `extraResources` 复制到 `resources/scripts`（asar 外）
- 原因：PowerShell **无法读取 asar 压缩包内的 `.ps1`**
- 打包后 `CLEANER_SCRIPTS_DIR = process.resourcesPath/scripts`

## 5. 关键决策：端口策略

- **生产**：main.js 尝试 8090 起内嵌服务，`EADDRINUSE` 则 8091…8099 退避；`BrowserWindow` 加载 `http://localhost:<实际端口>`（server 同源托管 dist/，前端 `/api` 相对路径天然可用，无需改动）
- **开发**：main.js 尝试内嵌启动 8090（失败则说明已有服务，记 `[WARN]` 并复用），窗口加载 `http://localhost:8000`（umi dev + proxy）
- startServer 需支持返回 `server.address().port`（现有已返回 server 实例，补端口获取）

## 6. 提权重扫适配（打包后仍可用）

保留现有 `/api/elevate-restart` 全链路：

1. 前端点击 → `POST /api/elevate-restart`
2. server 构造 UAC 命令（`Start-Process -Verb RunAs`），spawn PowerShell
3. `relaunch-admin.ps1`（管理员运行）：写 `.elevated-launch.flag` → 等旧进程退出 → 启动新进程
4. 新进程：Electron exe + `--scan-on-start` → main.js 识别参数 → 以 `SCAN_ON_START` 启动内嵌服务 → 自动重扫
5. 旧进程轮询 flag → 确认后 1 秒退出；60 秒未确认 → 记取消，保持当前服务

脚本改造：

- `relaunch-admin.ps1`：
  - `$exe = $env:CLEANER_EXE_PATH`（打包后 = Electron exe 全路径）
  - 未设置时回退 `node server/index.js --scan-on-start`（开发模式现状）
  - flag 路径改为 `Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag'`（无 env 时沿用项目根）
- `server/index.js` 的 `buildElevateCommand` 传入 `CLEANER_EXE_PATH` 环境变量
- main.js 读取 `process.argv` 中的 `--scan-on-start` → 注入 `SCAN_ON_START` 启动内嵌服务

## 7. 打包配置（electron-builder）

package.json 新增：

```jsonc
{
  "main": "electron/main.js",
  "scripts": {
    "electron": "electron .",
    "electron:dev": "concurrently -k \"npm:dev\" \"npm:electron\"",
    "electron:build": "electron-builder --win"
  },
  "devDependencies": {
    "electron": "^44.0.0",
    "electron-builder": "latest",      // 执行时以 npm 最新稳定版锁定
    "concurrently": "latest"
  }
}
```

electron-builder 配置（`electron-builder.yml` 或 package.json `build` 字段，plan 时择一）：

```yaml
appId: com.seed.cdrivecleaner
productName: CDriveCleaner
files:
  - dist/**
  - server/**
  - package.json
extraResources:
  - from: scripts
    to: scripts
win:
  target:
    - nsis
nsis:
  oneClick: true
  perMachine: false
  artifactName: CDriveCleaner-Setup-${version}.exe
```

要点：

- `files` 只含 `dist/` + `server/` + `package.json`（server 只用 Node 内置模块，**无外部运行时依赖**，包体小）
- `dist/` 在 asar 内由 Node `fs.createReadStream` 读取（Electron fs 支持 asar）✓
- `.npmrc`：`electron_mirror` + `electron_builder_binaries_mirror` 指向 npmmirror（国内下载加速）

## 8. 日志设计（全路径日志）

### 8.1 目标与原则

- **零新依赖**：Node 内置 `fs`，纯 append + console 双写
- **全路径**：正常分支有痕迹、异常分支有现场、边界分支有说明

### 8.2 日志位置

| 模式 | 目录 |
|---|---|
| 打包后 | `%APPDATA%\CDriveCleaner\logs\`（userData） |
| 开发 | 终端 stdout + 项目根 `logs/` |

- 按天滚动：`main-YYYY-MM-DD.log`、`server-YYYY-MM-DD.log`
- 行格式：`[2026-09-16 14:30:01.123] [INFO] [模块] 消息`

### 8.3 级别约定

| 级别 | 适用 |
|---|---|
| `INFO` | 正常分支关键步骤（含数值：端口、耗时、文件大小、状态码） |
| `ERROR` | 每个 `catch` / 失败分支（含 `err.message` + `err.stack` + 上下文变量） |
| `WARN` | 边界/防御分支（端口退避、扫描 409 并发、UAC 超时取消、日志降级） |

### 8.4 必须埋点清单

**主进程（main）**
- 启动：版本、启动参数、`CLEANER_*` 解析结果
- 端口：尝试 → 退避 → 选中实际端口
- 服务：内嵌 server 启动成功/失败
- 窗口：创建、`did-finish-load`、`did-fail-load`（errorCode + URL）、渲染进程崩溃
- `--scan-on-start`：识别并触发

**http 服务（server）**
- 扫描：请求方、开始、结束（耗时 + 结果文件大小）、失败（exit code + stderr 片段）
- 提权链路：收到请求 → UAC 已弹 → 已确认（flag）→ 旧进程退出 → 超时取消
- 所有 `/api/*` 请求：`METHOD /path → 状态码`（单行请求日志）

**前端（src/services 层）**
- 关键动作埋点：点击扫描、点击提权重扫、请求失败（UI 提示 + console）

### 8.5 强制约束

- **`catch` 无日志 = 代码缺陷**（spec 级约束，plan 每任务验收逐条核对）
- 现有代码空吞错误处（如 `readJson` 的 `catch {}`、`readIndex`），本次改造涉及处补日志
- 日志函数自身失败（写文件抛错）不得影响主流程：降级为 `console` 输出，不向上抛

## 9. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `electron/main.js` | 主进程入口（窗口、服务、提权、日志编排） |
| 新增 | `electron/logger.js` | 统一日志模块（main 与 server 共用；可单测） |
| 新增 | `electron/env.js` | 环境变量路径解析（可单测纯函数） |
| 新增 | `electron/port.js` | 端口选择/退避（可单测纯函数） |
| 新增 | `electron-builder.yml` | 打包配置 |
| 新增 | `.npmrc` | electron 镜像 |
| 新增 | `server/tests/electron-env.test.js` 等 | 新增可测逻辑的 TDD 测试 |
| 修改 | `package.json` | main、scripts、devDependencies |
| 修改 | `server/index.js` | 路径可配置化 + 全路径日志 + 请求日志 |
| 修改 | `server/history.js` | `HISTORY_DIR` 可配置化 |
| 修改 | `scripts/scan-c.ps1`* | `$env:CLEANER_RESULT_PATH` 覆盖 |
| 修改 | `scripts/relaunch-admin.ps1`* | 启动目标 electron exe + flag 路径 |
| 不改 | `src/` 全部、`config/config.ts` | UI 冻结 |

\* `.ps1` 为 UTF-8 **带 BOM**（PowerShell 5.1 解析中文必需），**只允许 Write 全量重写并保留 BOM，禁止 SearchReplace，写入前备份**。

## 10. 边界情况

| 场景 | 处理 |
|---|---|
| 打包后安装到 Program Files（不可写） | 数据全部重定向 `%APPDATA%\CDriveCleaner` |
| 端口 8090 被其他程序占用 | 退避 8091…8099，日志记录实际端口 |
| 开发时 8090 已有手动服务 | 复用现有，`[WARN]` 记录，不重复启动 |
| PowerShell 读不到 asar 内脚本 | `scripts/` 走 extraResources 放 asar 外 |
| UAC 取消/超时（60s） | 旧进程保持，`[WARN]` 记录「授权被取消」 |
| 提权重扫后数据文件 | 新旧进程共用同一 `CLEANER_DATA_DIR`，结果一致 |
| 日志写文件失败 | 降级 console，不抛错、不影响功能 |
| 首次安装无扫描结果 | 沿用现有引导（概览页触发扫描） |
| `.ps1` 编辑 | 仅 Write 全量重写保 BOM，禁止 SearchReplace |

## 11. 测试与验证（TDD）

### 11.1 测试策略

- 顺序：**先写失败测试 → 确认失败 → 实现 → 确认通过 → 重构**
- 沿用 `node --test server/tests/`（Node 内置，零依赖，与 history.test.js 同风格）
- 可测纯逻辑（路径解析、端口退避、日志行格式、提权命令构造）全部抽模块单测；Electron API（BrowserWindow 等）不做单测，靠集成/手工验证

### 11.2 单测覆盖（先测后写）

- `env.js`：默认值（开发）与打包注入值解析
- `port.js`：首选端口、占用退避、超限失败
- `logger.js`：行格式、级别、文件按天滚动、写失败降级
- server 路径改造：`RESULT_FILE` / `HISTORY_DIR` 随环境变量切换

### 11.3 集成/手工验证

1. `npm run electron:dev` → 窗口弹出、页面正常、可触发扫描
2. `npm run electron:build` → 产出 `dist_electron/CDriveCleaner-Setup-*.exe`
3. 安装后运行：扫描/历史/趋势/大文件/清理建议全部可用；数据落在 `%APPDATA%\CDriveCleaner`
4. 一键提权重扫 → UAC → 管理员模式自动重扫，结果可读
5. 检查日志文件：关键步骤、异常分支、请求日志齐全

### 11.4 编译检查

- 每编辑 .ts/.tsx 后 `npx tsc --noEmit --pretty 2>&1 | grep "<目录>"`；全部完成后全量 `npx tsc --noEmit --pretty`
- 已知预存错误（src/app.tsx、src/pages/404、src/setup/theme.tsx）可忽略

## 12. Global Constraints（本阶段强制）

1. **UI 冻结**：沿用已定 Figma Dark 主题（`#212332` / `#2A2D3E` / `#2697FF`，状态色 `#EE2727` 红、`#FFCF26` 黄、`#26E5FF` 青、`#70CF12` 绿、`#FFA113` 橙）；Phase 1 不触碰 `src/` UI，后续新增页面严格对齐
2. **抽象 / DRY**：禁止复制粘贴相同功能；日志、路径解析、端口、提权命令构造等重复逻辑必须抽单一模块复用；plan 每任务验收「发现与既有功能重叠 → 复用而非新建」
3. **TDD**：每任务「先写失败测试 → 实现 → 通过 → 重构」；沿用 `node --test`；前端 services 层可测逻辑必须测
4. **全路径日志**：正常 `INFO`、catch/失败 `ERROR`（含 stack）、边界 `WARN`；catch 无日志 = 代码缺陷
5. **BOM 保护**：`scripts/*.ps1` 只允许 Write 全量重写并保留 UTF-8 BOM，禁止 SearchReplace；写入前备份
6. **零新运行时依赖**：新增 devDependency 仅 electron / electron-builder / concurrently；server 运行时仅 Node 内置模块
7. **同一文件禁止并行 SearchReplace**；import 变更与代码变更在同一次 SearchReplace 内完成
8. **git 提交**：仅当用户明确要求时 commit
9. **安全**：`contextIsolation: true`、`nodeIntegration: false`；不新增攻击面

## 13. 不做的事（Phase 1 明确排除）

- ❌ 托盘/关窗最小化/开机自启（Phase 2）
- ❌ 桌面悬浮小部件（Phase 3）
- ❌ 后台静默扫描/清理 + 通知（Phase 4）
- ❌ Win11 小组件面板（Electron 不支持，Phase 3 用悬浮窗替代）
- ❌ IPC 全面重构（保持 http 内嵌，最小改动）
- ❌ 自动更新、代码签名、多语言
- ❌ 前端 UI 任何改动
