# C 盘空间分析工具（CDriveCleaner）

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

## 三·五、桌面特性（Phase 2 / Phase 3）

- **系统托盘**：关闭窗口最小化到托盘（常驻后台，不退出），单击托盘图标恢复窗口
- **托盘右键菜单**：打开主界面 / 立即扫描 / 开机自启（开关）/ 显示或隐藏桌面小组件（开关）/ 退出
- **开机自启**：默认关闭；勾选后写入注册表 `HKCU\...\Run`，开机自启时**隐藏到托盘**（`--hidden`）
- **立即扫描**：托盘直接触发一次 C 盘扫描，完成后刷新窗口
- **桌面小组件**（Phase 3）：右上角悬浮卡片，始终置顶、可拖拽（记住位置）；显示 C 盘总容量/已用/剩余 + 使用率进度条 + Top 3 最占空间文件夹；点击打开主窗口；右键可刷新/隐藏；托盘菜单可开关

---

## 四、构建打包

| 命令 | 作用 |
|---|---|
| `npm run electron:build` | 构建前端 → 生成 NSIS 一键安装包（`dist_electron/CDriveCleaner-Setup-*.exe`） |
| `npm run electron:build-run` | 一键：构建前端 → 打包安装包 → 启动应用 |

打包产物：

```
dist_electron/
├── win-unpacked/              # 免安装绿色版（可直接运行）
└── CDriveCleaner-Setup-0.1.0.exe  # 一键安装包
```

**打包缓存**（可删除，会重新下载；保留可加速打包）：

- `.electron-cache/` — electron 二进制下载缓存
- `.electron-builder-cache/` — electron-builder 工具缓存（nsis / 7zip）

均已加入 `.gitignore`，不会提交到仓库。

---

## 五、运行数据与日志

首次运行后，数据写入 `%APPDATA%\c-drive-cleaner\`：

```
%APPDATA%\c-drive-cleaner\
├── scan-result.json     # 最近一次扫描结果
├── history/             # 历史快照
└── logs/                # 运行日志（main-*.log / server-*.log）
```

> 扫描为**只读**操作，不会删除/修改任何文件。

---

## 六、注意事项

### PowerShell 脚本编码

`scripts/*.ps1` 必须保存为 **UTF-8 带 BOM**（单个 BOM），否则 Windows PowerShell 5.1 解析中文会报错。修改后请检查文件开头字节为 `EF BB BF`。

### Windows Defender 应用控制（WDAC / Smart App Control）

未签名的 `CDriveCleaner.exe` 可能被 **Smart App Control（SAC）** 或企业 WDAC 策略拦截（事件 ID 3077，提示签名级别不满足）。

- 个人电脑：若开启 Smart App Control，需在「Windows 安全中心 → 应用和浏览器控制」中关闭（**单向操作，关闭后不可重开**）
- 企业电脑：需由 IT 配置 WDAC 补充策略放行，或对安装包进行代码签名

### 管理员提权

「一键以管理员身份重启扫描」通过 UAC 提权（`scripts/relaunch-admin.ps1`），需要用户点击 UAC 确认。
