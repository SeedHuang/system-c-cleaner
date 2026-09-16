# Task 9 Report: 一键提权重启（UAC 弹窗）+ 自动重扫

## 状态

**DONE** — 功能已按简报完整实现，全部验证通过。

## 实现说明

新增「一键以管理员身份重扫」（UAC 弹窗）功能：概览页存在未扫描目录时，提示条提供按钮，点击触发系统 UAC 授权；确认后旧服务退出，以管理员身份启动新服务并自动重扫（`--scan-on-start`），完成后页面自动刷新。一次性提权，后续普通重扫均在管理员模式下执行。

### 变更文件

1. **创建 `d:\Seed\system-c-cleaner\scripts\relaunch-admin.ps1`**（纯 ASCII，无 BOM 依赖）
   - 提权脚本：写标志文件 `history/.elevated-launch.flag` → 等旧进程退出（最多 30s，保证 8090 释放）→ `Start-Process node server/index.js --scan-on-start -WindowStyle Hidden`。

2. **追加 `d:\Seed\system-c-cleaner\server\tests\api.test.js`** 2 个用例
   - `GET /api/status 包含 elevatedScan 字段`：断言 `body.elevatedScan === 'idle'`。
   - `buildElevateCommand 构造 UAC 命令`：断言命令含 `-Verb RunAs` 与 `'-OldPid','12345'`。
   - 先运行确认失败（elevatedScan undefined / buildElevateCommand is not a function），实现后转绿。

3. **整体覆盖 `d:\Seed\system-c-cleaner\server\index.js`**
   - 新增：`SCAN_ON_START`（`--scan-on-start` 开关）、`elevatedScan` 状态（idle/running/cancelled）、`ELEVATE_SCRIPT/ELEVATE_FLAG` 常量、`scanOnce()`（自动 runScan + buildSnapshot）、`buildElevateCommand(pid)`（纯函数构造 UAC 命令）、`POST /api/elevate-restart`（spawn 触发 UAC，立即返回 200 `{ok, elevatedScan:'running'}`）、`/api/status` 增加 `elevatedScan` 字段、`startServer` 启动时删标志 + `--scan-on-start` 时触发 `scanOnce()`、main-guard 非提权模式加 1s 提权看门狗（确认标志 → 1s 后 exit；60s 未确认 → `cancelled`）、exports 增加 `buildElevateCommand`。

4. **修改 `d:\Seed\system-c-cleaner\src\services\scan.ts`**（两次顺序 SearchReplace）
   - `ScanStatus` 增加 `elevatedScan?: 'idle' | 'running' | 'cancelled'`。
   - `triggerScan` 后追加 `elevateRestart()`（POST `/api/elevate-restart`）。

5. **整体覆盖 `d:\Seed\system-c-cleaner\src\pages\Dashboard\index.tsx`**
   - 新增提权状态机 `ElevatePhase`（idle/requesting/waiting/restarting/scanning/done/cancelled/failed）、`elevateMsg`、`handleElevate`、4s 轮询 `useEffect`（旧服务消失→restarting、scanning→扫描中、完成→refresh()）、提示条加「一键以管理员身份重扫」按钮（loading/disabled 状态机控制）。`useModel('scan')` 的 `refresh` 已确认存在于 `src/models/scan.ts`。

6. **更新 `d:\Seed\system-c-cleaner\docs\superpowers\specs\2026-09-16-growth-history-design.md`**
   - §1.1 表格行改为「一键以管理员身份重启并自动重扫（UAC 弹窗，一次性提权）」。
   - §6.3 整节替换为「6.3 一键提权重启（UAC）」。

## 验证输出摘要

| 命令 | 结果 |
|---|---|
| `node --test server/tests/api.test.js` | **5 用例通过**（pass 5 / fail 0），含 2 个新用例 |
| `npm test` | **18 用例通过**（pass 18 / fail 0，13 history + 5 api） |
| `npx tsc --noEmit --pretty 2>&1 \| Select-String "src/pages/Dashboard\|src/services/scan"` | 无输出（零错误） |
| `npx tsc --noEmit --pretty`（全量） | 无输出（exit 0，无任何错误，含既有已知错误清单亦未出现） |
| `powershell ... [scriptblock]::Create((Get-Content -Raw 'scripts\relaunch-admin.ps1'))` | 无报错（exit 0，仅语法校验，未执行） |

## 偏差与顾虑

- **ps1 校验命令引号问题（非脚本问题）**：首次以 `"$null = ..."` 双引号外层运行时 `$null` 被外层 PowerShell 展开导致 `=` 报错；改用外层单引号 `'$null = ... [scriptblock]::Create(...)'` 后通过。`relaunch-admin.ps1` 本身语法无误。
- 按简报要求：未触发 UAC（未调用 `POST /api/elevate-restart`）、未运行真实扫描（未用 `--scan-on-start` 启动服务）、未运行任何 git 命令、未安装 npm 依赖、未编辑 `scripts/scan-c.ps1`、未派生子代理。
- 提权交接为端到端流程（UAC 弹窗 + 真实重启），本环境仅通过 `buildElevateCommand` 纯函数与 `/api/status` 字段做了单元级验证，未做真实 UAC 端到端验证（有意避免弹窗）。
