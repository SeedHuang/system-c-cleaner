# C 盘空间分析仪表盘工具 — 设计文档（v2，umi/max + antd5）

日期：2026-09-15（v2 架构调整）
状态：待用户审阅

## 1. 背景与目标

用户 Windows 系统 C 盘（约 399GB 可用）在重装系统两周内流失约 120GB（日均 2-10GB）。用户非专业，害怕误删导致系统崩溃，需要一个**只读**工具分析 C 盘构成，明确哪些可删、哪些绝对不能动，并给出详细操作建议。

v2 要求：不再用纯 PowerShell 生成静态 HTML，改为 **umi/max + antd5** 的 Web 应用，页面视觉风格对齐 Figma 参考稿（SaaS - File Management Dashboard (Dark)，1440×900，深色主题）。

目标：
- 本地启动 Web 应用，点击「开始扫描」完成 C 盘只读分析
- 以 Figma 深色仪表盘风格展示：磁盘概览、目录排行、大文件、四色清理分类、操作手册
- 扫描结果持久化为 JSON，重复打开应用无需重扫
- 全程只读，不删除、不移动、不修改任何文件

非目标：
- 不实现任何"执行清理"功能（删除动作永远由用户手动完成）
- 不做实时监控 / 定时任务
- 不扫描除 C 盘以外的磁盘（代码保留扩展余地）

## 2. 核心安全原则（写死在脚本与界面里）

1. 扫描脚本只读：绝不删除、移动、修改任何文件、目录或注册表项。
2. 权限不足的目录：跳过并标注「未扫描（权限不足）」，绝不尝试提权或强制访问。
3. 界面中所有清理命令仅作为**建议**展示，由用户确认后在 Windows 自带工具（磁盘清理、DISM 等）中自行执行。
4. 系统关键项以红色「绝对不要动」标记，并写明原因。

## 3. 技术栈与架构

- 前端：**umi/max**（React 18）+ **antd 5**，`darkAlgorithm` + 自定义 token（对齐 Figma 色板）
- 后端：项目内 **Node 本地服务**（`server/index.js`），负责：
  - 接收前端「扫描」请求，调用 PowerShell 扫描脚本（`child_process`）
  - 读取生成的 `scan-result.json` 并缓存，返回给前端
  - 生产模式托管前端构建产物 `dist/`
- 扫描引擎：PowerShell（`scripts/scan-c.ps1`），输出 JSON
- 开发模式：`umi dev` 通过 proxy 将 `/api` 转发到本地 Node 服务

```
┌────────────────────────┐   /api/scan    ┌──────────────────────────┐   child_process   ┌────────────────────┐
│  umi/max + antd5 前端  │ ─────────────▶ │  Node 本地服务 server/    │ ────────────────▶ │ scripts/scan-c.ps1 │
│  Figma 深色仪表盘      │ ◀───────────── │  (缓存 scan-result.json)  │ ◀──────────────── │ 只读扫描引擎       │
└────────────────────────┘  JSON 数据     └──────────────────────────┘   scan-result.json └────────────────────┘
```

## 4. 交付物（文件结构）

```
d:\Seed\system-c-cleaner\
├── package.json                  # umi/max + antd5 + 服务端依赖
├── config/
│   └── config.ts                 # umi 配置：antd、路由、/api 代理
├── src/
│   ├── app.tsx                   # 运行时配置：antd 深色主题 token
│   ├── setup/
│   │   └── theme.tsx             # Figma 色板 → antd theme tokens
│   ├── components/               # 复用组件：StorageDonut 用量圆环、FolderBar 条形图等
│   ├── pages/
│   │   ├── Dashboard/index.tsx   # 概览：用量圆环 + 空间构成 + 顶层目录
│   │   ├── Folders/index.tsx     # 目录排行明细
│   │   ├── LargeFiles/index.tsx  # 大文件 Top 50
│   │   ├── Cleanup/index.tsx     # 四色清理分类清单
│   │   └── Guide/index.tsx       # 操作手册
│   └── services/scan.ts          # 调 /api/scan 的封装
├── server/
│   └── index.js                  # 本地 API 服务（调 PS 扫描、缓存、托管 dist）
├── scripts/
│   └── scan-c.ps1                # 只读扫描引擎 → scan-result.json
└── scan-result.json              # 扫描结果缓存（生成物）
```

## 5. 页面与菜单映射（Figma 风格）

左侧导航（220px，`#2A2D3E`，激活项蓝色渐变圆角条）映射：

| Figma 菜单 | 本工具页面 | 内容 |
|---|---|---|
| Dashboard | 概览 | 磁盘用量圆环、空间构成环形图、顶层目录条形图 |
| Documents | 目录排行 | 所有扫描目录大小明细表（可排序/搜索） |
| Store | 大文件 | 全盘 Top 50 大文件表 |
| Task | 清理建议 | 四色分类清单（可安全/谨慎/保留/勿动） |
| Settings | 操作手册 | 磁盘清理、DISM、关休眠等逐步指引 |
| Log Out | — | 不实现（保留视觉占位或隐藏） |

顶部栏：搜索框（325px 圆角卡片 + 蓝色搜索按钮）、「开始扫描」主按钮（替代 Add New，`#2697FF`）、右侧存储用量卡片（替代用户卡，显示已用/可用）。

## 6. Figma 设计规范（提取自参考稿）

| Token | 值 | 用途 |
|---|---|---|
| colorBgLayout | `#212332` | 页面背景 |
| colorBgContainer / 卡片 | `#2A2D3E` | 侧边栏、卡片、搜索框 |
| colorPrimary | `#2697FF` | 主按钮、激活项、强调 |
| primaryHover | `#46A6FF` / `#377AFF` | 渐变激活条 `#2697FF→#66B6FF` |
| 状态色 | `#EE2727` 红 / `#FFCF26` 黄 / `#26E5FF` 青 / `#70CF12` 绿 / `#FFA113` 橙 | 四色分类与图表 |
| 文本 | `#FFFFFF`（主）、`#F0F0F0`、`#B5C9DB`（次）、60% 透明度（弱化） | 标题/正文/说明 |
| 升级卡 | `#34384D` | 提示卡片背景 |
| 字体 | Poppins（中文回退系统字体栈） | 全局 |
| 圆角 | 10px（卡片/按钮）、15px（高亮卡片）、35px | — |
| 边框 | `rgba(38,151,255,0.15)` / `rgba(255,255,255,0.1)` | 卡片描边 |

## 7. 扫描引擎设计（scripts/scan-c.ps1，纯只读）

### 7.1 目录大小计算
- 首选 `robocopy C:\<dir> NULL /L /E /XJ /BYTES /NFL /NDL /NJH /NP /NC /R:0 /W:0`
  - `/L` 只列出不复制；`/XJ` 跳过 junction 防循环；`/BYTES` 字节输出
  - 解析汇总行字节数，**兼容中英文表头**（`Bytes` / `字节`）
- fallback：`[System.IO.Directory]::EnumerateFiles` + try/catch 累加
- robocopy 非零退出码按语义处理（1 = 正常列出），异常记录告警

### 7.2 扫描范围
A. **顶层目录**：`C:\` 直接子目录逐个算大小；无权限的标注「未扫描」。
B. **用户目录二级**：`C:\Users\` 下所有用户配置文件目录（跳过 Default/Public/junction），逐项计算。
C. **特殊位置清单**（存在性 + 大小，不存在跳过）：
   - TEMP：`%TEMP%`、`C:\Windows\Temp`、`C:\Windows\SoftwareDistribution\Download`
   - `C:\Windows.old`（若存在）
   - 系统文件大小：`hiberfil.sys` / `pagefile.sys` / `swapfile.sys`（仅读属性）
   - 回收站 `C:\$Recycle.Bin`
   - 浏览器缓存：Edge / Chrome / Firefox User Data Cache
   - 通讯缓存：微信 `WeChat Files` / `xwechat_files`、QQ `Tencent Files`
   - 系统缓存：缩略图 Explorer、INetCache、D3DSCache、CrashDumps、Minidump、MEMORY.DMP
   - 开发缓存：NuGet / npm / yarn / pip
   - 虚拟磁盘：Docker / WSL `.vhdx`
   - 系统还原：`vssadmin list shadowstorage`（只读查询）
D. **大文件 Top 50**：全盘列出文件（robocopy /L /S），正则解析大小+路径，>100MB 排序取前 50。

### 7.3 输出
- 生成 `scan-result.json`：含扫描时间、磁盘总容量/可用、全部扫描项（路径、大小、安全等级、原因、操作指引、扫描状态）、大文件列表、未扫描清单。
- 目标扫描耗时 1~3 分钟。

## 8. 四色分类规则（沿用 v1）

| 等级 | 颜色 | 典型项 | 处理建议 |
|---|---|---|---|
| 可安全清理 | 🟢 `#70CF12` | TEMP、浏览器缓存、缩略图、回收站、SoftwareDistribution\Download、CrashDumps、>30天 Windows.old | 磁盘清理或按指引手动删 |
| 谨慎清理 | 🟡 `#FFCF26` | hiberfil.sys（需关休眠）、还原点（留最新1个）、WinSxS（DISM）、微信/QQ 缓存（聊天图片不可恢复）、AppData 缓存 | 先读原因再操作 |
| 建议保留 | 🔵 `#2697FF` | Program Files、用户文档、Windows 本体、驱动 | 不动 |
| 绝对不要动 | 🔴 `#EE2727` | System32、pagefile.sys、System Volume Information、bootmgr、注册表 hive、WinSxS 内部 | 写明原因 |

## 9. API 设计

- `POST /api/scan` — 触发扫描（可选 force 重扫）；扫描中返回进度/进行中状态；完成后返回结果
- `GET /api/scan` — 返回缓存结果（未扫描过则提示）
- `GET /api/status` — 是否已有结果、扫描时间
- 生产：同服务托管 `dist/`，静态资源 + API 同源

## 10. 错误处理

- 扫描脚本每项独立 try/catch，单项失败只记录不中断
- 无权限目录 → 「未扫描」清单
- 目录不存在 → 跳过
- robocopy 异常 → .NET fallback → 仍失败标记「无法计算」
- 前端：扫描失败展示错误提示；无数据页给出「开始扫描」引导

## 11. 测试与验证

- 实机运行 `npm run dev` 与生产构建，验证扫描 → 数据 → 图表全链路
- 验证无权限目录进入「未扫描」清单
- 验证二次打开应用命中缓存
- 验证离线可访问（无外网依赖：图标用 antd 图标 + 本地 SVG，不引 CDN）
- 前端代码遵循用户约定：每次编辑后 `npx tsc --noEmit` 检查；已知预存错误清单除外

## 12. 不做的事

- 不实现删除/清理功能
- 不做监控/定时
- 不做多盘（代码保留扩展）
