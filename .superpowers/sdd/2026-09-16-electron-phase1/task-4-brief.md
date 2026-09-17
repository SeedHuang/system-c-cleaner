# Task 4 Brief: electron/logger.js — 全路径日志模块（TDD）

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务创建统一日志模块 `electron/logger.js`（console + 文件双写、按天滚动、写失败降级），供 server 与 electron 主进程共用。

前置：Task 1-3 已完成（依赖就绪、server/config.js、electron/port.js）。`npm run tsc` 零错误。

## 本任务目标

按 TDD 流程创建：
- `electron/logger.js`：导出 `createLogger({ logDir, name='app', write=null, console=global.console }) → { info(module,msg,detail), warn(module,msg,detail), error(module,msg,errOrDetail) }`
- `server/tests/logger.test.js`：3 个测试用例（require 相对路径 `'../../electron/logger.js'`）

接口契约（后续 Task 5/8 依赖，务必精确实现）：
- 行格式：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg {"detail":...}`（detail 为 JSON，无 detail 时不带后缀）
- `error(module, msg, err instanceof Error)`：第一行 `... 扫描失败: <err.message>`，第二行 `堆栈: <err.stack>`
- 按天滚动文件：`<logDir>/<name>-YYYY-MM-DD.log`
- `write` 可注入（测试用）；写文件抛错时调用 `console.error('[logger] 日志写入失败（降级 console）: <msg>')`，不向上抛
- 未提供 `logDir` 时只输出 console

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- TDD 顺序：先写测试 → 跑确认失败（模块不存在）→ 实现 → 跑确认通过 → 回归 npm test。
- 日志模块自身失败（写文件抛错）必须降级 console 且不抛错——这是 spec 级约束（catch 无日志 = 代码缺陷，但日志自身失败不能影响主流程）。
- 同一文件多处修改合并为一次编辑。

## 环境注意事项

- 单测单独跑：`node --test server/tests/logger.test.js`。
- 回归 `npm test` 时若 api.test.js 环境性失败（history/ 残留真实快照），处理方式同 Task 2：临时改 history/ 为 history.bak/，跑完恢复。禁止删除数据。

## Step 1: 写失败测试

创建 `server/tests/logger.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../../electron/logger.js');

function memoryLog() {
  const lines = [];
  return { lines, write: (l) => lines.push(l), console: { log() {}, error() {} } };
}

test('行格式：时间戳 + 级别 + 模块 + 消息 + detail', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.info('main', '启动完成', { port: 8090 });
  assert.match(m.lines[0], /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[main\] 启动完成 \{"port":8090\}$/);
});

test('error 传 Error 时追加堆栈行', () => {
  const m = memoryLog();
  const log = createLogger({ write: m.write, console: m.console });
  log.error('server', '扫描失败', new Error('exit 1'));
  assert.match(m.lines[0], /\[ERROR\] \[server\] 扫描失败: exit 1$/);
  assert.ok(m.lines.some((l) => l.includes('堆栈: Error: exit 1')));
});

test('写文件抛错时降级 console 不向上抛', () => {
  const m = memoryLog();
  const errors = [];
  m.console.error = (x) => errors.push(x);
  const log = createLogger({ write: () => { throw new Error('disk full'); }, console: m.console });
  assert.doesNotThrow(() => log.info('main', 'hi'));
  assert.ok(errors.some((x) => x.includes('disk full')));
});
```

## Step 2: 运行确认失败

Run: `node --test server/tests/logger.test.js`
Expected: FAIL（`Cannot find module '../../electron/logger.js'`）

## Step 3: 实现

创建 `electron/logger.js`：

```js
/**
 * 全路径日志：console + 文件双写，按天滚动，写失败降级 console（不抛错）。
 * 级别：INFO（正常分支）/ WARN（边界分支）/ ERROR（catch 分支，含堆栈）。
 */
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function dayFile(dir, name) {
  const d = new Date();
  return path.join(dir, `${name}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
}

function createLogger({ logDir = null, name = 'app', write = null, console: out = console } = {}) {
  const writeLine = write || ((line) => {
    if (!logDir) return;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(dayFile(logDir, name), line + '\n', 'utf8');
    } catch (err) {
      out.error(`[logger] 日志写入失败（降级 console）: ${err.message}`);
    }
  });
  const emit = (level, module, msg, detail) => {
    const line = `[${ts()}] [${level}] [${module}] ${msg}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`;
    writeLine(line);
    if (level === 'ERROR') out.error(line); else out.log(line);
  };
  return {
    info: (module, msg, detail) => emit('INFO', module, msg, detail),
    warn: (module, msg, detail) => emit('WARN', module, msg, detail),
    error: (module, msg, errOrDetail) => {
      if (errOrDetail instanceof Error) {
        emit('ERROR', module, `${msg}: ${errOrDetail.message}`);
        writeLine(`[${ts()}] [ERROR] [${module}] 堆栈: ${errOrDetail.stack || ''}`);
      } else {
        emit('ERROR', module, msg, errOrDetail);
      }
    },
  };
}

module.exports = { createLogger };
```

## Step 4: 运行确认通过

Run: `node --test server/tests/logger.test.js`
Expected: PASS（3 个用例）

## Step 5: 回归既有测试

Run: `npm test`
Expected: 全部通过（若遇 api.test.js 环境性失败，按上文处理 history/ 后重跑）

## 报告

完成后在报告中写明：
- 测试先失败后通过的证据（命令输出摘要）
- `npm test` 回归结果
- 任何偏差
