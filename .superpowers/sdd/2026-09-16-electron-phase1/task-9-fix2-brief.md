# Task 9 Fix 2 Brief: server/index.js — spawn cwd 改为真实目录（修复打包后 ENOENT）

项目：d:\Seed\system-c-cleaner —— Electron 打包版扫描报 `spawn ...powershell.exe ENOENT`，但用户终端 node 直接 spawn 同路径成功。根因：**打包后 `paths.root` = `app.asar` 内路径**（server/config.js 的 ROOT = path.resolve(__dirname, '..')，__dirname 在 asar 内），`runScan` 的 `spawn(..., { cwd: paths.root })` 用 asar 内目录作工作目录 → Node 底层 CreateProcess 失败，报误导性 ENOENT。这是 Electron 知名问题（子进程 cwd 不能是 asar 路径）。

## 本任务目标

`runScan` 的 `cwd: paths.root` 改为 `cwd: paths.dataDir`：
- 打包后：dataDir = userData（`%APPDATA%\CDriveCleaner`，真实可写目录）
- 开发模式：dataDir = 项目根（行为不变）

PowerShell 扫描脚本用绝对路径（`-File PS_SCRIPT`），不依赖 cwd，故 cwd 改动无副作用。

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- 同一文件禁止并行 SearchReplace；单处修改。
- 不新增/修改任何 API 行为与日志。

## Step 1: 修改 server/index.js（runScan 内）

现有（约第 76-80 行）：

```js
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { cwd: paths.root, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
    );
```

改为：

```js
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      // cwd 必须为真实目录：打包后 paths.root 是 app.asar 内路径，作工作目录会导致 spawn ENOENT
      { cwd: paths.dataDir, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
    );
```

仅此一处改动。同时检查确认：`server/history.js` 的 `spawn('cmd.exe', ...)` 无 cwd 选项（不涉及），`server/index.js` 的 elevate-restart spawn 无 cwd（不涉及）——无需改动。

## Step 2: 回归测试

Run: `node --test server/tests/api.test.js`
Expected: 全部通过（9 个用例，本次改动不改变 API 行为）

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败——history/ 残留真实快照，临时改 history.bak/ 重跑后恢复，禁止删除数据）

## Step 3: 代码自检

确认 server/index.js 中除 runScan 外没有其他 `cwd: paths.root` 或 `cwd:` 指向 asar 内路径的 spawn。

## 报告

完成后在报告中写明：
- 修改的 old → new
- 回归测试结果
- 确认无其他 cwd 问题
- 任何偏差
