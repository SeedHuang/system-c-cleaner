# Task 5 报告：server/index.js 改造（路径可配置化 + 全路径日志 + 请求日志 + startElevateMonitor）

日期：2026-09-16
状态：DONE

## 一、server/index.js 修改摘要（old → new）

采用「读取全文后整体重写」方式，一次 Write 完成，既有路由/逻辑逐字保留，仅按简报 2a-2h 修改。

### 2a. 常量区（原 12-24 行）
- **old**: 手写常量 `const ROOT = path.join(__dirname, '..')`、`RESULT_FILE = path.join(ROOT, 'scan-result.json')`、`PS_SCRIPT = path.join(ROOT, 'scripts', 'scan-c.ps1')`、`DIST_DIR = path.join(ROOT, 'dist')`、`ELEVATE_SCRIPT = path.join(ROOT, 'scripts', 'relaunch-admin.ps1')`、`ELEVATE_FLAG = path.join(ROOT, 'history', '.elevated-launch.flag')`
- **new**: 新增 `const { resolvePaths } = require('./config')`、`const { createLogger } = require('../electron/logger')`；`const paths = resolvePaths()`；常量改为 `RESULT_FILE = paths.resultFile`、`PS_SCRIPT = paths.psScript`、`DIST_DIR = path.join(paths.root, 'dist')`、`ELEVATE_SCRIPT = paths.elevateScript`、`ELEVATE_FLAG = paths.elevateFlag`；新增 `const log = createLogger({ logDir: paths.logDir, name: 'server' })`；`PORT`、`SCAN_ON_START`、`scanning`、`elevatedScan`、`elevateStartedAt` 保留。原 `ROOT` 定义删除（改用 `paths.root`）。

### 2b. readJson（33-46 行）
- **old**: `catch { return null; }`（空吞）
- **new**: `catch (err) { log.warn('json', '读取/解析失败，返回 null', { file, err: err.message }); return null; }`

### 2c. runScan（58-87 行）
- **old**: spawn 无 env，`cwd: ROOT`，`ps.on('error', reject)`，close 分支无日志
- **new**: 开头 `log.info('scan', '扫描开始', { script: PS_SCRIPT })`；`cwd: paths.root`；新增 `env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE }`；`ps.on('error', (err) => { log.error('scan', '扫描进程启动失败', err); reject(err); })`；close 成功分支 `log.info('scan', '扫描完成', { exit, resultSize, elapsedMs })`，失败分支构造 err 后 `log.error('scan', '扫描失败', err)` 再 reject。

### 2d. handle()（155-271 行）
- **old**: `const url` / `const p` 在 try 内定义；try 外无日志；catch 仅 `sendJson(res, 500, ...)`
- **new**: `const url` / `const p` 移到 handle 开头（try 外）；try 前注册 `res.on('finish', () => { if (p.startsWith('/api/')) log.info('api', \`${req.method} ${p} -> ${res.statusCode}\`); })`；catch 改为 `log.error('api', \`接口异常 ${req.method} ${p}\`, e)` 后再 `sendJson(res, 500, { error: e.message })`。try 内路由逻辑逐字保留。

### 2e. scanOnce 与 POST /api/scan 快照告警（console → log.*）
- scanOnce：
  - `console.log('[server] 管理员模式启动，自动重新扫描…')` → `log.info('scan', '管理员模式启动，自动重新扫描')`
  - `console.warn('[history]', snapshotWarning)` → `log.warn('scan', snapshotWarning)`（scanOnce 与 POST /api/scan 分支各一处，均替换）
  - `console.error('[server] 自动扫描失败:', err.message)` → `.catch((err) => log.error('scan', '自动扫描失败', err))`
  - `console.log('[server] 自动扫描完成')` → `log.info('scan', '自动扫描完成')`

### 2f. POST /api/elevate-restart（256 行）
- **old**: `console.log('[server] 已请求以管理员身份重启，等待 UAC 授权…')`
- **new**: `log.info('elevate', '收到提权重启请求，等待 UAC 授权')`

### 2g. startServer（279 行）
- **old**: `console.log(\`[server] C盘分析 API 服务已启动: http://localhost:${port}\`)`
- **new**: `log.info('server', 'API 服务已启动', { url: \`http://localhost:${port}\` })`

### 2h. startElevateMonitor 抽取 + 导出（285-305 行）
- **old**: require.main 分支内内联 `setInterval` 轮询（含 `if (!SCAN_ON_START)` 包裹），`module.exports = { startServer, buildElevateCommand }`
- **new**: 抽取为 `function startElevateMonitor()`（保留 `if (SCAN_ON_START) return;` 守卫与轮询逻辑，内部 console 改 log.info/log.warn）；require.main 分支改为 `startServer(PORT); startElevateMonitor();`；else 分支 `module.exports = { startServer, buildElevateCommand, startElevateMonitor }`。

### 保留未动
- `serveStatic` / `readBody` / `sendJson` / `buildElevateCommand` 逻辑逐字保留；`readBody` 的 `catch { resolve({}) }` 与两处 unlink 的 `catch {}` 非本任务改造范围（有意静默），按简报未改动。
- 模块被 require 时不自动启动服务（`require.main === module` 判断保留）。

## 二、api.test.js 新增用例验证结果

在 `server/tests/api.test.js` 末尾追加（简报原文）：
1. `startElevateMonitor 存在且为函数`
2. `buildElevateCommand 指向 relaunch-admin 脚本`

- 改造前运行 `node --test server/tests/api.test.js`：新增第 1 个用例 FAIL（`startElevateMonitor` 为 `undefined`），与简报 Step 1 预期一致；第 2 个用例 PASS。
- 改造后运行：7/7 PASS（原有 5 个 + 新增 2 个）。

## 三、npm test 回归结果

`npm test` → 29/29 全部通过（含 api.test.js 7 个、config 2 个、history 10 个、logger 3 个、port 4 个等）。

处理过程：首次运行 api.test.js 时「无历史时 insufficient=true」用例因 history/ 残留真实快照（2 个 .tsv.gz + index.json）环境性失败；按简报约束 6 将 history/ 临时改名 history.bak/ 后重跑，全部通过，随后已改回原名，数据完整无删除。

## 四、冒烟验证结果（已执行）

- `node server/index.js` 启动成功，终端输出 `[2026-09-16 19:35:50.908] [INFO] [server] API 服务已启动 {"url":"http://localhost:8090"}`。
- `Invoke-RestMethod http://localhost:8090/api/status` 返回 200 JSON：`{"hasResult":true,"scanning":false,"scannedAt":"2026-09-16 18:37:08","disk":{...},"elevatedScan":"idle"}`。
- 日志文件 `logs/server-2026-09-16.log` 已生成，含启动日志与请求日志 `[INFO] [api] GET /api/status -> 200`。
- 验证完成后已停止服务进程。

## 五、偏差

无代码偏差。简报代码与现有文件完全兼容（依赖 `server/config.js` 的 `resolvePaths`、`electron/logger.js` 的 `createLogger` 均已存在且接口一致）。
