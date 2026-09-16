# C 盘空间分析仪表盘 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 umi/max + antd5 的深色仪表盘 Web 应用，通过只读 PowerShell 扫描分析 C 盘构成，用四色分类告诉用户哪些能删、哪些绝对不能动，并给出操作建议。

**Architecture:** 前端 umi/max(React18) + antd5 深色主题（对齐 Figma Dark 参考稿）；本地 Node 服务（`server/index.js`）暴露 `/api/scan`，调用 `scripts/scan-c.ps1` 只读扫描引擎，结果缓存到 `scan-result.json`；前端通过 model 共享扫描数据。扫描脚本用 robocopy `/L` 只读模式计算目录大小，逐项 try/catch，权限不足标「未扫描」。

**Tech Stack:** Node 22 / npm、@umijs/max ^4.3、antd ^5.21、TypeScript ^5.5、PowerShell 5.1（robocopy）、原生 Node http（无 express）。

**Spec:** [2026-09-15-c-drive-cleaner-design.md](../specs/2026-09-15-c-drive-cleaner-design.md)

## Global Constraints

- 扫描脚本纯只读：绝不删除/移动/修改任何文件、目录或注册表项；无权限目录跳过并标注，绝不提权。
- 界面中所有清理命令仅为建议，删除动作由用户手动执行。
- 系统关键项（System32、pagefile.sys、System Volume Information、bootmgr）标红「绝对不要动」。
- 视觉对齐 Figma Dark：背景 `#212332`、卡片 `#2A2D3E`、主色 `#2697FF`、红 `#EE2727`/黄 `#FFCF26`/青 `#26E5FF`/绿 `#70CF12`/橙 `#FFA113`。
- `scan-c.ps1` 必须保存为 **UTF-8 with BOM**，否则 PowerShell 5.1 解析中文会失败（这是踩过的坑）。
- 每次编辑 .ts/.tsx 后运行 `npx tsc --noEmit --pretty`（不能用 GetDiagnostics）；已知预存错误（src/app.tsx、src/pages/404、src/setup/theme.tsx）可忽略——本项目无 404 页，实际预存错误清单以当时 tsc 输出为准。
- 同一文件禁止并行 SearchReplace；import 变更与代码变更必须在同一次 SearchReplace 内完成。
- 离线可用：不引 CDN，图表用自绘组件。

---

### Task 1: 项目脚手架（umi/max + antd5 + Figma 深色主题）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `typings.d.ts`
- Create: `.gitignore`
- Create: `config/config.ts`
- Create: `src/app.tsx`
- Create: `src/setup/theme.tsx`
- Create: `src/global.less`

**Interfaces:**
- Consumes: 无
- Produces: `figmaTheme`（antd v5 `ThemeConfig`）、`figmaColors`、`cleanupLevels`（四色分类常量）、`CleanupLevel` 类型，供 Task 4/5 使用。

- [x] **Step 1: 写 package.json 并安装依赖**
  - 依赖：`@umijs/max@^4.3.29`、`antd@^5.21.6`、`react@^18.3.1`、`react-dom@^18.3.1`、`@ant-design/icons@^5.5.1`；dev：`typescript@^5.5.4`、`@types/react`、`@types/react-dom`。
  - 运行 `npm install`。注意：`postinstall` 会执行 `max setup`，若此时 src 页面不存在会报 MODULE_NOT_FOUND——先写好页面文件再 install，或 install 后单独 `npx max setup`。
- [x] **Step 2: config/config.ts**
  - `antd: { configProvider: {} }` **必须显式开启**，否则 umi 不渲染 ConfigProvider、`src/app.tsx` 的 theme 失效（踩过的坑：整页白底白字）。
  - routes：`/` 重定向 `/dashboard`；五页：dashboard/folders/large-files/cleanup/guide。
  - `proxy: { '/api': { target: 'http://localhost:8090', changeOrigin: true } }`。
- [x] **Step 3: src/setup/theme.tsx + src/app.tsx**
  - `figmaTheme = { algorithm: theme.darkAlgorithm, token: {...}, components: {...} }`，token 值见 Global Constraints。
  - `app.tsx` 导出 `export const antd = { theme: figmaTheme }`。
- [x] **Step 4: tsc 验证**
  - 运行 `npx tsc --noEmit --pretty 2>&1`，零错误。

### Task 2: 只读扫描引擎 scripts/scan-c.ps1

**Files:**
- Create: `scripts/scan-c.ps1`（**UTF-8 with BOM**）

**Interfaces:**
- Consumes: 无
- Produces: 写 `scan-result.json`，结构：`{ scannedAt, disk:{totalGB,usedGB,freeGB}, topFolders:[{name,path,sizeGB,status}], items:[{id,name,path,sizeGB,level,reason,action?,status}], largeFiles:[{name,path,sizeGB}] }`，其中 `level ∈ safe|caution|keep|never`，`status ∈ ok|unscanned`。

- [x] **Step 1: 目录大小函数 Get-RobocopySize**
  - `robocopy <dir> NULL /L /E /XJ /BYTES /NFL /NDL /NJH /NP /NC /R:0 /W:0`；`/L` 只列出不复制，`/XJ` 跳过 junction。
  - 正则解析汇总行（中英文）：`^\s*(?:字节|Bytes)\s*:\s+([\d,]+)`，取第一列（总计）。
  - **关键坑**：robocopy exit code ≥ 8 只表示部分文件失败（如个别无权限），Bytes 汇总仍有效，不能因此标整个目录 unscanned。只有「解析不到汇总行且 exit≥8」或「Bytes 为 0 且 exit≥8」才标 unscanned。
  - 解析失败时 fallback：`Get-ChildItem -Recurse -File` 累加。
- [x] **Step 2: 大文件 Top50 Get-LargeFiles**
  - `robocopy C:\ NULL /L /S /XJ /BYTES /FP /NDL /NJH /NP /NC /R:0 /W:0` 流式解析。
  - **关键坑**：文件行格式是 `大小 + 多空格 + 完整路径`，不是 tab 分隔。正则：`^\s*(\d[\d,]*)\s+(\S.*)$`。
  - 收集 >100MB，按大小降序取前 50。
- [x] **Step 3: 扫描范围**
  - 顶层目录：`C:\` 直接子目录（排除 `$` 开头）。
  - 特殊位置：TEMP、Windows\Temp、SoftwareDistribution\Download、回收站、缩略图缓存、Minidump、INetCache、D3DSCache、Edge/Chrome/Firefox 缓存、微信/QQ 缓存、hiberfil/pagefile/swapfile（仅属性读长度）、System32、System Volume Information、Windows.old、WinSxS、NuGet/npm/pip/yarn 缓存、MEMORY.DMP。
  - 每项按安全等级打标 + 原因 + 建议操作（建议操作只展示，脚本不执行）。
- [x] **Step 4: 实跑验证**
  - 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\scan-c.ps1`。
  - 预期：`scan-result.json` 生成，topFolders 中 Program Files≈7.5GB、Users≈130GB、Windows≈38GB（真实值），largeFiles 含 hiberfil.sys 等；无中文乱码、无解析错误。

### Task 3: 本地 API 服务 server/index.js

**Files:**
- Create: `server/index.js`

**Interfaces:**
- Consumes: `scripts/scan-c.ps1`（child_process 调用）
- Produces: HTTP 端口 8090；`GET /api/status` → `{hasResult,scanning,scannedAt,disk}`；`GET /api/scan` → 缓存结果或 404；`POST /api/scan` → 触发扫描（防并发，409 进行中），完成后返回结果；非 `/api` 路径 → 托管 `dist/`（SPA fallback）。

- [x] **Step 1: 实现路由与扫描调用**
  - 原生 `http.createServer`，无外部依赖。
  - `spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File', psPath])`，`windowsHide: true`。
  - 单实例锁 `scanning` 标志防并发。
- [x] **Step 2: 启动验证**
  - `node server/index.js` → 输出 `[server] C盘分析 API 服务已启动: http://localhost:8090`。
  - `curl http://localhost:8090/api/status` 返回 JSON。

### Task 4: 前端数据层（services + model）

**Files:**
- Create: `src/services/scan.ts`
- Create: `src/models/scan.ts`
- Delete: `src/mock/scan.ts`（demo 用，已无引用）

**Interfaces:**
- Consumes: `GET/POST /api/scan`、`GET /api/status`（经 umi proxy）
- Produces: `useModel('scan')`，返回 `{ data: ScanResult|null, loading, scanning, error, refresh, startScan }`；类型 `ScanResult/ScanItem/LargeFile/TopFolder/ScanStatus`（与 scan-result.json 结构一致，供 Task 5 使用）。

- [x] **Step 1: src/services/scan.ts**
  - `fetch` 封装：非 2xx 时解析 `{error}` 抛出；导出 `getStatus/getScan/triggerScan`。
- [x] **Step 2: src/models/scan.ts**
  - `useModel('scan')` 模型：`refresh()` 拉缓存（404 视为无数据不报错）；`startScan()` POST 触发扫描；`useEffect` 挂载时自动 refresh。
- [x] **Step 3: tsc 验证（已修复）**
  - 根因：model 插件 `enableBy: config`，必须 `config.ts` 显式 `model: {}` 才启用。加后 `npx max setup` 重新生成 `.umi/plugin-model`，`useModel` 导出成功，`npx tsc --noEmit` 零错误。

### Task 5: 页面与布局接入真实数据

**Files:**
- Modify: `src/layouts/index.tsx`
- Modify: `src/pages/Dashboard/index.tsx`
- Modify: `src/pages/Folders/index.tsx`
- Modify: `src/pages/LargeFiles/index.tsx`
- Modify: `src/pages/Cleanup/index.tsx`
- Keep: `src/pages/Guide/index.tsx`（静态操作手册，不引用数据）
- Keep: `src/components/StorageDonut.tsx`、`src/components/BarList.tsx`、`src/components/StatCard.tsx`

**Interfaces:**
- Consumes: `useModel('scan')`、`ScanResult` 类型、`cleanupLevels`、`formatGB/formatSize`
- Produces: 五个页面的真实数据渲染 + 空状态引导 + 顶栏扫描按钮。

- [x] **Step 1: Layout 顶栏**
  - 「开始扫描/重新扫描」按钮绑定 `startScan`，`loading=scanning`；可用空间卡片显示 `data.disk.freeGB` 与 `scannedAt`；`error` 显示红色提示条。
- [x] **Step 2: Dashboard**
  - 空数据 → Empty + 扫描引导按钮；有数据 → 4 张 StatCard（总/已用/可用/可安全清理预估）、顶层目录 BarList（取有值的前 10，蓝色系渐变）、空间构成 BarList（按 level 聚合）、右侧 StorageDonut 同心圆环。
- [x] **Step 3: Folders / LargeFiles / Cleanup**
  - Folders：items 表格，大小可排序、名称/路径可搜索，unscanned 显示「未扫描」。
  - LargeFiles：largeFiles 表格，大小降序，空数据显示 Empty。
  - Cleanup：按 safe→caution→keep→never 分组卡片，每项路径/原因/建议操作，unscanned 灰色「未扫描」。
- [x] **Step 4: tsc + 浏览器验证**
  - `npx tsc --noEmit --pretty 2>&1` 零错误。
  - 浏览器实测（dev 8001 + 生产 8090）：深色主题、真实数据渲染、四色构成齐全（可清理 8.3GB / 谨慎 45.6GB / 保留 187.7GB / 勿动 16.0GB）、大文件表、清理分组、操作手册均正常。

### Task 6: 生产构建与一键入口

**Files:**
- Modify: `package.json`（加 `"server": "node server/index.js"`）
- Create: `运行分析.bat`（可选：一键启动 server + 打开浏览器）

**Interfaces:**
- Consumes: Task 3 server、Task 1~5 前端
- Produces: 生产产物 `dist/`，可由 `node server/index.js` 同源托管。

- [x] **Step 1: 生产构建**
  - `npm run build` → 生成 `dist/`（umi.js 167KB + 异步分包）。
- [x] **Step 2: 生产全链路**
  - `node server/index.js` 托管 dist → 浏览器访问 `http://localhost:8090`，五页 + 重新扫描按钮 + 可用空间卡片全链路可用。
- [x] **Step 3: 一键入口**
  - `运行分析.bat`：启动 server → 3 秒后打开 `http://localhost:8090`。

---

## Self-Review

**1. Spec coverage：**
- 只读原则 → Task 2 全部函数 + Task 3 无任何写操作 ✓
- 四色分类/绝对不要动 → Task 2 打标 + Task 5 Cleanup 分组 ✓
- 目录大小（robocopy + fallback）→ Task 2 Step 1 ✓
- 大文件 Top50 → Task 2 Step 2 ✓
- Figma 深色主题 → Task 1 Step 3 ✓
- API 设计（status/scan/触发/缓存）→ Task 3 ✓
- 页面映射（概览/目录/大文件/清理/手册）→ Task 5 ✓
- 缓存复用 → Task 3 GET /api/scan + Task 4 refresh ✓
- 无权限目录标注 → Task 2 status=unscanned + Task 5 展示 ✓
- 测试验证 → 各 Task 的验证步骤 ✓
- **缺口**：spec §7.2 提到 `vssadmin list shadowstorage`（系统还原点大小）未在 Task 2 实现——还原点已由「系统还原区(System Volume Information)」红色项覆盖（该目录无权限，标 unscanned）。为完整覆盖 spec，可接受当前实现（还原点大小依赖管理员权限，跳过合理），无需新增任务。

**2. Placeholder scan：** 无 TBD/TODO；每个 Step 含可执行命令。

**3. Type consistency：** `ScanResult/ScanItem/LargeFile/TopFolder` 与 scan-result.json 字段一一对应（id/name/path/sizeGB/level/reason/action/status）；`CleanupLevel ∈ safe|caution|keep|never` 贯穿 Task 2 打标与 Task 5 渲染；`formatGB(number|null)` 处理 null。

## Execution Handoff

- Task 1~3 及 Task 4/5 的代码编写已完成（真实扫描数据已验证）；剩余：Task 4 Step 3（useModel 修复）、Task 5 Step 4（tsc+浏览器）、Task 6（构建+入口）。
- 建议 **Inline Execution**（剩余任务少且依赖顺序清晰）：先重启 dev 修复 useModel → tsc → 浏览器全链路 → 生产构建。
