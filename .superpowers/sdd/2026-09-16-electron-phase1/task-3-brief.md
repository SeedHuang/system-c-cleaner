# Task 3 Brief: electron/port.js — 端口启动与退避（TDD）

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务创建端口启动/退避模块 `electron/port.js`，供主进程启动内嵌 http 服务时使用（EADDRINUSE 则退避到下一端口）。

前置：Task 1（依赖与基础配置）、Task 2（server/config.js 路径解析）已完成。`npm run tsc` 零错误。

## 本任务目标

按 TDD 流程创建：
- `electron/port.js`：导出 `startWithFallback(preferred, tryListen, maxTries = 10)`
- `server/tests/port.test.js`：4 个测试用例（测试文件放在 server/tests/ 下以纳入 `npm test`，require 相对路径 `'../../electron/port.js'`）

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- TDD 顺序：先写测试 → 跑确认失败（模块不存在）→ 实现 → 跑确认通过 → 回归 npm test。
- 本任务为纯逻辑模块，无 I/O 无 catch 需求。
- 同一文件多处修改合并为一次编辑。

## 环境注意事项

- 单测单独跑：`node --test server/tests/port.test.js`。
- 回归 `npm test` 时若 api.test.js 环境性失败（history/ 残留真实快照），处理方式同 Task 2：临时改 history/ 为 history.bak/，跑完恢复。禁止删除数据。

## Step 1: 写失败测试

创建 `server/tests/port.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { startWithFallback } = require('../../electron/port.js');

test('首选端口可用时直接返回', async () => {
  const r = await startWithFallback(8090, async (p) => ({ p }));
  assert.deepStrictEqual(r, { port: 8090, server: { p: 8090 } });
});

test('EADDRINUSE 时退避到下一个端口', async () => {
  const tryListen = async (p) => {
    if (p === 8090) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
    return { p };
  };
  const r = await startWithFallback(8090, tryListen);
  assert.strictEqual(r.port, 8091);
});

test('全部占用时抛出最后一个错误', async () => {
  const tryListen = async (p) => { throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' }); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 3), /in use/);
});

test('非 EADDRINUSE 错误直接抛出不重试', async () => {
  const tryListen = async () => { throw new Error('boom'); };
  await assert.rejects(() => startWithFallback(8090, tryListen, 5), /boom/);
});
```

## Step 2: 运行确认失败

Run: `node --test server/tests/port.test.js`
Expected: FAIL（`Cannot find module '../../electron/port.js'`）

## Step 3: 实现

创建 `electron/port.js`（注意目录 electron/ 尚不存在，创建文件时自动建目录）：

```js
/**
 * 端口启动与退避：从首选端口起，EADDRINUSE 则 +1 重试，超限抛最后一个错误。
 * @param {number} preferred 首选端口
 * @param {(port:number)=>Promise<any>} tryListen 在端口上启动并 resolve 的异步函数
 * @param {number} maxTries 最大尝试次数（默认 10）
 * @returns {Promise<{port:number, server:any}>}
 */
async function startWithFallback(preferred, tryListen, maxTries = 10) {
  let lastErr;
  for (let i = 0; i < maxTries; i++) {
    const port = preferred + i;
    try {
      const server = await tryListen(port);
      return { port, server };
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { startWithFallback };
```

## Step 4: 运行确认通过

Run: `node --test server/tests/port.test.js`
Expected: PASS（4 个用例）

## Step 5: 回归既有测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败，按上文处理 history/ 后重跑）

## 报告

完成后在报告中写明：
- 测试先失败后通过的证据（命令输出摘要）
- `npm test` 回归结果
- 任何偏差
