# Task 9 Fix 2 Report: server/index.js — spawn cwd 改为真实目录

日期：2026-09-16
状态：DONE

## 一、修改内容（old → new）

文件：`d:\Seed\system-c-cleaner\server\index.js`（runScan 内，约第 76-81 行，单处改动）

**old：**
```js
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { cwd: paths.root, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
    );
```

**new：**
```js
    const ps = spawn(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      // cwd 必须为真实目录：打包后 paths.root 是 app.asar 内路径，作工作目录会导致 spawn ENOENT
      { cwd: paths.dataDir, windowsHide: true, env: { ...process.env, CLEANER_RESULT_PATH: RESULT_FILE } },
    );
```

`paths.dataDir` 在 `server/config.js` 中已存在（`env.CLEANER_DATA_DIR || ROOT`）：打包后 = userData 真实可写目录，开发模式 = 项目根（行为不变）。PowerShell 扫描脚本用绝对路径（`-File PS_SCRIPT`），不依赖 cwd，无副作用。未新增/修改任何 API 行为与日志。

## 二、回归测试结果

**1. `node --test server/tests/api.test.js`（首次）：9 例中 8 通过、1 失败**
- 失败用例：`GET /api/growth 无历史时 insufficient=true`（api.test.js:31）
- 原因：`history/` 目录残留 3 个真实快照（环境性失败，非本次改动引入——本次改动只改 spawn 的 cwd，不涉及 growth 逻辑）

**2. 按简报约束处理环境性失败（未删除任何数据）**：`history/` 临时改名为 `history.bak/` 后重跑。

**3. `npm test`（history.bak 状态下）：32/32 全部通过（0 fail）**
- 覆盖 api.test.js（9 例，含此前失败的 growth 用例）、config.test.js、history.test.js、logger、port 等
- 用例数：tests 32，pass 32，fail 0

**4. 恢复**：`history.bak/` 已改回原名 `history/`，目录内 3 项快照完好（Test-Path = True，条目数 3），未删除任何数据。

## 三、代码自检：无其他 cwd 问题

对整个 `server/` 目录 grep `cwd`，仅命中 `server/index.js` 第 79-80 行（即本次修改的 runScan spawn 及其注释），无其他 `cwd: paths.root` 或指向 asar 内路径的 spawn：
- `server/index.js` elevate-restart 的 spawn（约第 270-274 行）：无 cwd 选项，不涉及
- `server/history.js`：grep 无任何 cwd 用法，不涉及

结论：server 侧所有 spawn 的 cwd 已无 asar 路径问题。

## 四、偏差记录

- 无代码层面的偏差。简报中示例代码与实际代码完全一致（行号 76-80 吻合）。
- 过程性说明（简报已预期）：首次 `node --test server/tests/api.test.js` 出现 1 例环境性失败（history/ 残留真实快照），按简报约定用 `history.bak/` 临时改名方案重跑 `npm test` 后 32/32 全绿，随后已恢复原名。
- 简报 Step 2 提到「npm test 全部通过（若遇 api.test.js 环境性失败…临时改 history.bak/ 再跑）」——本次即按此路径执行。
