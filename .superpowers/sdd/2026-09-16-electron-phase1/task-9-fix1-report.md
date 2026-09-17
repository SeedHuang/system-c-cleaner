# Task 9 Fix1 报告：server/index.js — PowerShell 完整路径（修复打包后 spawn ENOENT）

日期：2026-09-16
状态：DONE

## 问题背景

Electron 打包版（GUI 启动）的环境 PATH 不包含 powershell.exe 所在目录，`spawn('powershell.exe')` 报 `spawn powershell.exe ENOENT`。修复方式：模块加载时解析 PowerShell 完整路径（优先 `SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`，不存在则回退 `'powershell.exe'`），所有 spawn 使用解析出的 `PS_EXE`。

## Step 1 & Step 3: api.test.js 新增用例

追加到 `server/tests/api.test.js` 末尾（原 7 个用例之后）：

1. `computePowerShellCandidate 拼接完整路径` — 断言 `computePowerShellCandidate('C:\\Windows') === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'`
2. `resolvePowerShellPath 返回非空字符串` — 断言返回 `string` 且 `length > 0`

验证结果：

- 实现前：2 个新用例 FAIL（`computePowerShellCandidate is not a function` / `resolvePowerShellPath is not a function`），TDD 红
- 实现后：2 个新用例 PASS（红转绿）

本机实际解析值：`resolvePowerShellPath()` → `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`（大小写来自 `SystemRoot=C:\WINDOWS`，Windows 文件系统大小写不敏感，无影响）。

## server/index.js 每处修改（old → new）

### 修改 1：新增两个纯函数 + PS_EXE 常量（常量区后，`let scanning = false;` 前）

old（`const SCAN_ON_START = ...` 之后、`let scanning = false;` 之前无内容）:

```js
// 以管理员身份启动时自动重扫一次
const SCAN_ON_START = process.argv.includes('--scan-on-start');

let scanning = false;
```

new:

```js
// 以管理员身份启动时自动重扫一次
const SCAN_ON_START = process.argv.includes('--scan-on-start');

/** 拼接 PowerShell 完整路径（纯函数，可单测） */
function computePowerShellCandidate(sysRoot) {
  return path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** 打包后 Electron 环境的 PATH 可能不含 powershell.exe，优先用完整路径，回退裸命令 */
function resolvePowerShellPath() {
  const candidate = computePowerShellCandidate(process.env.SystemRoot || 'C:\\Windows');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

// 打包版（Electron GUI 启动）PATH 可能不含 powershell.exe，统一用解析出的完整路径
const PS_EXE = resolvePowerShellPath();

let scanning = false;
```

### 修改 2：runScan 内 spawn 命令（第 1 处 `'powershell.exe'`）

old:

```js
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
```

new:

```js
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
```

### 修改 3：buildElevateCommand 字符串拼接（第 2 处）

old:

```js
  return `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ELEVATE_SCRIPT}','-OldPid','${pid}'`;
```

new:

```js
  return `Start-Process -FilePath '${PS_EXE}' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ELEVATE_SCRIPT}','-OldPid','${pid}'`;
```

说明：PS_EXE 为完整路径，PowerShell 单引号内反斜杠无转义问题（Windows 路径单引号 OK），与简报一致。

### 修改 4：POST /api/elevate-restart 内 spawn 命令（第 3 处）

old:

```js
      spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildElevateCommand(process.pid)],
        { windowsHide: true },
      );
```

new:

```js
      spawn(
        PS_EXE,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildElevateCommand(process.pid)],
        { windowsHide: true },
      );
```

### 修改 5：module.exports 导出新函数（保持既有导出）

old:

```js
  module.exports = { startServer, buildElevateCommand, startElevateMonitor };
```

new:

```js
  module.exports = { startServer, buildElevateCommand, startElevateMonitor, computePowerShellCandidate, resolvePowerShellPath };
```

### 验证残留

`grep powershell.exe server/index.js` 仅剩 4 处，均为函数定义/注释/回退字符串（line 34 `path.join` 内的文件名、37/43 注释、40 回退值），无遗留硬编码 spawn 命令。

## 现有 API 行为确认

`buildElevateCommand` 输出从 `'powershell.exe'` 变为完整路径后，api.test.js 既有断言均不受影响（均未断言 `powershell.exe` 字面量）：

- `buildElevateCommand 构造 UAC 命令`（`-Verb RunAs`、`'-OldPid','12345'`）→ PASS
- `buildElevateCommand 指向 relaunch-admin 脚本`（`relaunch-admin.ps1`）→ PASS

## 测试结果

### node --test server/tests/api.test.js（实现后，history/ 残留真实快照时）

- pass 8 / fail 1
- 唯一失败：`GET /api/growth 无历史时 insufficient=true` — 环境性失败（`d:\Seed\system-c-cleaner\history\` 残留 2 个真实快照 `2026-09-16T18-34-49.tsv.gz`、`2026-09-16T18-37-08.tsv.gz` + `index.json`），非本次修改引入

### npm test（history/ 临时改名为 history.bak/ 后）

- tests 32 / pass 32 / fail 0 — 全部通过
- 覆盖 api.test.js（9 个，含新增 2 个）+ history.test.js + port 相关测试等

### 环境处理

按简报约束 5：`history/` → `history.bak/` → npm test → `history.bak/` → `history/`。已恢复原状，数据完整（2 个 tsv.gz + index.json 均在，未删除任何数据），`history.bak` 已不存在。

## 偏差记录

1. **无代码偏差**：实现完全按简报 Step 2 执行，无冲突。
2. **验证方式说明**：`tsconfig.json` 仅 include `src/config/typings.d.ts`，不覆盖 `server/`（纯 CommonJS JS），故不适用 `npx tsc` 目录级检查；本项目对 server 的验证手段为 `node --test`，已按简报执行。
3. **PS_EXE 实际值大小写**：本机解析为 `C:\WINDOWS\...`（来自 `SystemRoot` 环境变量），与测试里传入字面量 `C:\Windows` 的结果大小写不同但路径等价，Windows 大小写不敏感，无影响。
4. **Step 5（打包验证）未执行**：简报标注为可选、需用户配合，本次未重新打包。代码层面修复已完成，打包验证留待用户。
