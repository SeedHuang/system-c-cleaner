# Roberta（C 盘空间分析工具）

基于 **Electron + umi/max + antd5** 的 Windows 桌面应用，用于分析 C 盘空间占用（磁盘总览 / 文件夹分布 / 大文件排行 / 历史趋势）。

架构：前端（umi/max + antd5）→ 本地 Node server（8090）→ PowerShell 只读扫描脚本。

---

## 一、环境准备（需要装什么）

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Windows | 10 / 11 | 需要自带 PowerShell 5.1（Windows 自带，无需单独安装） |
| Node.js | **18+（建议 20 / 22 LTS）** | 运行构建与本地服务 |
| npm | 随 Node 自带 | 包管理器 |
| git（可选） | — | 拉取代码/版本管理 |

> 无需安装 Visual Studio / C++ 工具链：本项目没有原生模块，`electron-builder` 打包不需要编译环境。

---

## 二、安装依赖

```bash
npm install
```

项目已配置国内镜像（`.npmrc`）：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

- `electron` 二进制会从镜像自动下载，无需翻墙
- 若安装时 electron 下载失败，重跑 `npm install` 即可（断点续传）

---

## 三、开发运行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 纯 Web 模式（浏览器访问，不启动 Electron） |
| `npm run electron:dev` | 桌面模式：起前端 + 启动 Electron 窗口 |
| `npm test` | 运行全部单元测试（server + electron） |

## 三·五、桌面特性（Phase 2 / Phase 3 / Phase 4）

- **系统托盘**：关闭窗口最小化到托盘（常驻后台，不退出），单击托盘图标恢复窗口
- **托盘右键菜单**：打开主界面 / 立即扫描 / 开机自启（开关）/ 显示或隐藏桌面小组件（开关）/ 后台自动扫描（开关）/ 退出
- **开机自启**：默认关闭；勾选后写入注册表 `HKCU\...\Run`，开机自启时**隐藏到托盘**（`--hidden`）
- **立即扫描**：托盘直接触发一次 C 盘扫描，完成后刷新窗口
- **桌面小组件**（Phase 3）：右上角悬浮卡片，始终置顶、可拖拽（记住位置）；显示 C 盘总容量/已用/剩余 + 使用率进度条 + Top 3 最占空间文件夹；点击打开主窗口；右键可刷新/隐藏；托盘菜单可开关

### 后台自动扫描（Phase 4）

默认开启。主进程内置调度器（每 5 分钟检查一次），三种触发条件合流，任一满足即扫：

| 触发 | 条件 |
|---|---|
| 启动扫描 | 应用启动满 `startDelayMin` 分钟后扫一次 |
| 间隔扫描 | 距上次扫描超过 `intervalHours` 小时 |
| 定时扫描 | 到达当天 `dailyAt` 时刻且当天未扫过 |

优先级：启动扫描 > 定时扫描 > 间隔扫描；三者统一受 `minGapMin` 兜底拦截（两次扫描最小间隔），避免频繁重启触发连续扫描。扫描进行中不会重复触发；触发失败**不推进**上次扫描时间，下个检查周期自动重试。

### 系统通知（Phase 4）

扫描完成后发送**一条合并通知**（不是多条）：

- 普通：标题「扫描完成」，内容「剩余 20.0%（100.0 GB）」；有增长时追加「，本次 +2.1 GB」
- 告警：剩余空间 ≤ `lowSpacePct`，或本次增长 ≥ `growthWarnGB` 时，标题升级为「⚠️ C 盘空间告警」
- `notifyEveryScan` 设为 `false` 时进入安静模式：仅告警才通知
- 扫描失败会发「⚠️ 扫描失败」通知
- 点击任意通知 → 打开主界面

### 启动提权（Phase 4）

默认开启：应用启动时检测当前是否为管理员，**非管理员则请求 UAC 提权重启**（每次启动都会弹一次 UAC 确认，这是预期行为）；已在管理员身份下运行则跳过。同一台机器 10 分钟内只尝试一次，防止提权失败导致反复弹窗。不需要可在 `settings.json` 中将 `autoElevateOnStart` 设为 `false`。

## 三·六、趋势分析时间范围

「趋势分析」页支持两种时间范围，**二选一**，选了其中一个另一个自动让位：

| 方式 | 说明 |
|---|---|
| 预设窗口 | `1天 / 2天 / 5天 / 10天 / 15天 / 1月 / 6月 / 1年` 快捷按钮 + 自定义小时数（默认），对比「窗口前的那一帧快照」 |
| 起止时间区间 | 日期 + 时分选择器（精确到分钟），另有「今天」快捷方式 |

**区间语义**（`YYYY-MM-DD HH:mm`，也兼容只给日期 `YYYY-MM-DD`）：

| 端点 | 取值 |
|---|---|
| 结束（to） | 该粒度的**最后一刻**最后一条快照：`2026-09-17 18:30` → `≤ 18:30:59.999`；只给日期 → `≤ 23:59:59.999` |
| 基准（from） | `≤` 该粒度**起点**的最后一条快照（即「区间开始前那一帧」）：`2026-09-17 09:15` → `≤ 09:15:00.000`；只给日期 → `≤ 00:00:00.000` |

- **「今天」快捷方式**：点击后开始 = 今天 `00:00:00.000`、结束 = 今天 `23:59:59.999`（等价于整天）
- 基准缺失时回退到最早一条快照；端点与基准为同一条时判定为「数据不足」
- 区间参数非法（格式错误、时分越界如 `24:00`、`开始 > 结束`）自动回落预设窗口，行为与旧版一致
- 切换区间后会重新拉取 Top 20 排行与下钻子目录数据；「增长趋势」折线图仍固定展示最近 60 个点，不跟随区间

---

## 四、构建打包

| 命令 | 作用 |
|---|---|
| `npm run electron:build` | 构建前端 → 生成 NSIS 一键安装包（`dist_electron/Roberta-Setup-*.exe`） |
| `npm run electron:build-run` | 一键：构建前端 → 打包安装包 → 启动应用 |

打包产物：

```
dist_electron/
├── win-unpacked/              # 免安装绿色版（可直接运行）
└── Roberta-Setup-0.1.0.exe    # 一键安装包
```

**打包缓存**（可删除，会重新下载；保留可加速打包）：

- `.electron-cache/` — electron 二进制下载缓存
- `.electron-builder-cache/` — electron-builder 工具缓存（nsis / 7zip）

均已加入 `.gitignore`，不会提交到仓库。

---

## 五、运行数据与日志

首次运行后，数据写入 `%USERPROFILE%\.system-c-cleaner\`（用户主目录下的隐藏文件夹）：

```
%USERPROFILE%\.system-c-cleaner\
├── scan-result.json      # 最近一次扫描结果
├── settings.json         # Phase 4 配置（阈值，见下表）
├── scheduler-state.json  # Phase 4 调度状态（上次扫描时间，重启后不重复扫）
├── history/              # 历史快照
└── logs/                 # 运行日志（main-*.log / server-*.log）
```

> 扫描为**只读**操作，不会删除/修改任何文件。

**数据目录迁移**：旧版本（≤ 0.1.0）的数据原本在 `%APPDATA%\c-drive-cleaner\`。升级到新版首次启动时，会**自动**合并旧位置的数据到新位置：

- 顶层文件（`scan-result.json` 等）：新位置没有才补，旧的有值不会覆盖新的
- `history/index.json`：按快照 id 去重合并，按 `scannedAt` 升序；旧 index 列了 id 但 `.tsv.gz` 文件缺失则剔除该条（不污染新 index）
- `history/<id>.tsv.gz`：新位置没有才复制
- `logs/`：按文件名去重（同名日志保留新位置现有）
- `settings.json` 不迁移（让用户用新实例默认值）

旧位置会写两个标记文件：`.migrated-to`（内容 = 新路径）、`.migrated-at`（ISO 时间）。

**手动迁移脚本**：默认由 Electron 主进程在 `app.whenReady()` 里自动触发迁移。如果你想手动跑或迁移到非默认位置：

```powershell
# 用 npm script（仓库根目录）
npm run migrate                              # 默认：%APPDATA%\c-drive-cleaner → %USERPROFILE%\.system-c-cleaner

# 直接调脚本
node scripts/migrate-data.js                 # 默认路径
node scripts/migrate-data.js --from D:\old  --to D:\new
node scripts/migrate-data.js --dry-run       # 占位（实际还是会迁移；当前 runMigrate 不区分 dry-run）

# 看帮助
node scripts/migrate-data.js --help
```

退出码 0 = 成功或无需迁移；1 = 参数错误或 IO 失败。脚本不依赖 Electron，可独立跑（脚本依赖 `electron/migrate-data.js` 模块，require 路径自动兼容源码 / 打包后 `resources/scripts/` 与 `resources/app/` 两种布局）。

**环境变量覆盖**：可通过 `CLEANER_DATA_DIR` 把数据目录指到任意位置（开发模式、多实例、便携模式都用这个）。

### settings.json 配置项（Phase 4）

可直接编辑 `settings.json`（改完重启应用生效）。字段缺失或取值非法会**自动回落默认值**并记一条 warn 日志，不会导致启动失败。

| 字段 | 默认值 | 取值范围 | 说明 |
|---|---|---|---|
| `autoScan` | `true` | true/false | 后台自动扫描总开关（与托盘「后台自动扫描」勾选同步） |
| `autoElevateOnStart` | `true` | true/false | 启动时非管理员则请求 UAC 提权重启 |
| `startDelayMin` | `3` | 0–1440 | 启动后延迟多少分钟开始首次扫描 |
| `intervalHours` | `12` | 1–168 | 固定间隔扫描周期（小时） |
| `dailyAt` | `"09:00"` | `HH:mm` | 每天固定扫描时刻 |
| `minGapMin` | `60` | 0–1440 | 两次扫描最小间隔（分钟），兜底去重 |
| `lowSpacePct` | `10` | 1–100 | 剩余空间低于该百分比 → 告警通知 |
| `growthWarnGB` | `2` | 0–10240 | 单次增长超过该值（GB）→ 告警通知 |
| `notifyEveryScan` | `true` | true/false | false = 安静模式，仅告警时通知 |

---

## 六、注意事项

### PowerShell 脚本编码

`scripts/*.ps1` 必须保存为 **UTF-8 带 BOM**（单个 BOM），否则 Windows PowerShell 5.1 解析中文会报错。修改后请检查文件开头字节为 `EF BB BF`。

### Windows Defender 应用控制（WDAC / Smart App Control）

未签名的 `Roberta.exe` 可能被 **Smart App Control（SAC）** 或企业 WDAC 策略拦截（事件 ID 3077，提示签名级别不满足）。

- 个人电脑：若开启 Smart App Control，需在「Windows 安全中心 → 应用和浏览器控制」中关闭（**单向操作，关闭后不可重开**）
- 企业电脑：需由 IT 配置 WDAC 补充策略放行，或对安装包进行代码签名

### 管理员提权

「一键以管理员身份重启扫描」通过 UAC 提权（`scripts/relaunch-admin.ps1`），需要用户点击 UAC 确认。
