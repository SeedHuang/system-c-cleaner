# Task 4 Report: server/index.js 路由接入（history/growth API + 扫描后自动快照）

状态：**DONE**

## 实现说明

本任务把 `server/history.js`（Task 1~3 完成）接入现有 HTTP 服务 `server/index.js`，并重构为可被测试 require 的 `startServer` 导出。

### 改动文件

**1. 新建 `server/tests/api.test.js`**（Step 1）
- 按简报完整测试代码创建，含 3 个用例：
  - `GET /api/status` 正常返回（校验 `hasResult` / `scanning` 字段）
  - `GET /api/history` 空历史返回空列表（校验 `snapshots` 数组与 `totalSizeMB` number）
  - `GET /api/growth` 无历史时 `insufficient=true`
- 使用 `node:test` 的 `before/after` 钩子：`startServer(0)` 监听随机端口，避免端口冲突，测试后 `server.close()`。

**2. 整体覆盖 `server/index.js`**（Step 3）
- 顶部新增 `const history = require('./history');`
- 新增 `readBody(req)`（解析 JSON 请求体，失败回退 `{}`）
- `handle` 改为 `async` 并整体包 try/catch（错误统一 500）
- 新增路由：
  - `GET /api/history` → `history.listSnapshots()` → `{ snapshots, totalSizeMB }`
  - `DELETE /api/history` → `history.deleteSnapshots(filter)` → `{ deleted }`
  - `GET /api/growth?window=&top=` → `history.computeGrowthTop`（top 收敛到 1~100）
  - `GET /api/growth/dir?path=&window=` → `history.computeGrowthDir`
  - `GET /api/growth/trend?path=&points=` → `history.computeGrowthTrend`（points 收敛到 5~120）
- `POST /api/scan` 改造：扫描成功后自动 `history.buildSnapshot({ scannedAt, disk })`；快照失败仅附带 `snapshotWarning` 字段，不影响主结果与 200 返回；扫描本身失败仍返回 500
- 底部重构：`startServer(port = PORT)` 导出 + `require.main === module` main guard（直接运行时启动，被 require 时只导出 `{ startServer }`）

## 测试命令与输出

### Step 2：写测试后确认失败

```
node --test server/tests/api.test.js
```

结果：**FAIL**（预期失败）。失败原因不是简报预料的 `Cannot find module`，而是旧 `index.js` 在 require 时直接 `server.listen(8090)`，导致 `Error: listen EADDRINUSE: address already in use :::8090`。本质相同：旧实现未导出 `startServer`、不可被测试 require，测试失败确认了接入必要性。

### Step 4：覆盖后运行 API 测试

```
node --test server/tests/api.test.js
```

结果：**3 pass, 0 fail**（`GET /api/status`、`GET /api/history`、`GET /api/growth` 全部通过）。

### npm test 全量

```
npm test
```

结果：**16 pass, 0 fail**（api.test.js 3 用例 + history.test.js 13 用例 = 16，与预期 13 + 3 = 16 一致）。

## 偏差与顾虑

1. **Step 2 失败模式与简报预期不同**：简报预期 `Cannot find module '../index.js'` 或 `startServer is not a function`，实际是 `EADDRINUSE: :::8090`（旧文件 require 即监听固定端口）。失败性质一致（证明需要重构），不影响后续步骤。
2. **未真实触发 POST /api/scan 扫描**：按环境注意要求，只做了代码接入与只读 API 测试，未实跑 PowerShell 全盘扫描。`POST /api/scan` 的自动快照逻辑（`buildSnapshot` 成功/失败分支）仅通过代码审查验证，未做端到端验证。
3. **历史数据影响**：`GET /api/history` / `GET /api/growth` 读取项目根 `history/` 目录；测试运行时若有真实快照会产生非空数据，但测试断言对空/非空均稳健（仅校验结构字段类型）。
4. **未运行 git commit**（按简报要求跳过）。
