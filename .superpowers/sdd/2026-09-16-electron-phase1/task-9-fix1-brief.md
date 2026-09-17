# Task 9 Fix Brief: server/index.js — PowerShell 完整路径（修复打包后 spawn ENOENT）

项目：d:\Seed\system-c-cleaner —— Electron 打包版运行后，概览页点「开始扫描」报 `spawn powershell.exe ENOENT`。原因：Electron 打包应用（GUI 启动）的环境 PATH 不包含 powershell.exe 所在目录，`spawn('powershell.exe')` 找不到可执行文件。修复：使用完整路径。

## 本任务目标

1. server/index.js 新增 PowerShell 可执行文件路径解析（优先完整路径，回退 'powershell.exe'）
2. `runScan`、`buildElevateCommand`、elevate-restart 的 spawn 改用解析出的路径
3. api.test.js 追加测试（TDD：先测后改）

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- **同一文件禁止并行 SearchReplace**；对 server/index.js 的多处修改按顺序单次编辑。
- **全路径日志**：新增代码无静默 catch。
- 保持现有 API 行为不变（`buildElevateCommand` 的 UAC 命令仍可被 api.test.js 现有断言覆盖）。

## Step 1: 写失败测试（追加到 server/tests/api.test.js 末尾）

```js
test('computePowerShellCandidate 拼接完整路径', () => {
  const { computePowerShellCandidate } = require('../index.js');
  assert.strictEqual(
    computePowerShellCandidate('C:\\Windows'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
});

test('resolvePowerShellPath 返回非空字符串', () => {
  const { resolvePowerShellPath } = require('../index.js');
  const p = resolvePowerShellPath();
  assert.strictEqual(typeof p, 'string');
  assert.ok(p.length > 0);
});
```

Run: `node --test server/tests/api.test.js`
Expected: 新增 2 个用例 FAIL（`computePowerShellCandidate` / `resolvePowerShellPath` 未导出）

## Step 2: 实现（server/index.js）

在 `buildElevateCommand` 函数前（或常量区后）新增：

```js
/** 拼接 PowerShell 完整路径（纯函数，可单测） */
function computePowerShellCandidate(sysRoot) {
  return path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** 打包后 Electron 环境的 PATH 可能不含 powershell.exe，优先用完整路径，回退裸命令 */
function resolvePowerShellPath() {
  const candidate = computePowerShellCandidate(process.env.SystemRoot || 'C:\\Windows');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}
```

（`path`、`fs` 模块文件顶部已 require，无需新增 import。）

然后在模块内定义一次：

```js
const PS_EXE = resolvePowerShellPath();
```

替换以下 3 处 `'powershell.exe'` 为 `PS_EXE`：

1. `runScan` 内：
```js
const ps = spawn(
  'powershell.exe',
  ...
```
改为：
```js
const ps = spawn(
  PS_EXE,
  ...
```

2. `buildElevateCommand` 内（字符串拼接）：
```js
return `Start-Process -FilePath 'powershell.exe' -Verb RunAs ...
```
改为：
```js
return `Start-Process -FilePath '${PS_EXE}' -Verb RunAs ...
```
注意：PS_EXE 是完整路径，若含反斜杠，PowerShell 单引号内反斜杠无转义问题（Windows 路径单引号 OK）。

3. `POST /api/elevate-restart` 内：
```js
spawn(
  'powershell.exe',
  ['-NoProfile', ...
```
改为：
```js
spawn(
  PS_EXE,
  ['-NoProfile', ...
```

导出新增函数（保持既有导出）：

```js
module.exports = { startServer, buildElevateCommand, startElevateMonitor, computePowerShellCandidate, resolvePowerShellPath };
```

## Step 3: 运行确认通过

Run: `node --test server/tests/api.test.js`
Expected: PASS（原有 7 个 + 新增 2 个 = 9 个用例）

## Step 4: 回归全部测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败——history/ 残留真实快照，临时改 history.bak/ 重跑后恢复，禁止删除数据）

## Step 5: 验证打包版修复（可选，需用户配合）

修改后重新打包 win-unpacked（zip 或 `electron-builder --win dir`），让用户重新运行 CDriveCleaner.exe 点扫描验证不再 ENOENT。若无法在本机打包（WDAC 拦 NSIS），可先只更新 `dist_electron\win-unpacked\resources\app.asar` 或用 `electron-builder --win dir` 生成免安装版验证。

## 报告

完成后在报告中写明：
- server/index.js 每处修改（old → new）
- api.test.js 新增用例验证结果
- npm test 回归结果
- 任何偏差
