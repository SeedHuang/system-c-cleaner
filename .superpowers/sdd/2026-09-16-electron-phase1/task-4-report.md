# Task 4 Report: electron/logger.js — 全路径日志模块（TDD）

状态：DONE（3/3 单测通过、27/27 回归通过，有 1 处实现偏差——已记录）

## 交付物

- `d:\Seed\system-c-cleaner\server\tests\logger.test.js` — 3 个测试用例（照简报原文）
- `d:\Seed\system-c-cleaner\electron\logger.js` — `createLogger({ logDir, name='app', write=null, console }) → { info, warn, error }`（console + 文件双写、按天滚动、写失败降级 console）

## TDD 证据

### Step 2 确认失败（实现前）

命令：`node --test server/tests/logger.test.js`

```
# Error: Cannot find module '../../electron/logger.js'
# Require stack:
# - D:\\Seed\\system-c-cleaner\\server\\tests\\logger.test.js
#   code: 'MODULE_NOT_FOUND'
# tests 1, pass 0, fail 1
```

符合预期：模块不存在，测试失败（RED）。

### Step 4 确认通过（实现后）

第一次实现（照简报原文逐字）后运行：3 用例中 2 通过、1 失败——「写文件抛错时降级 console 不向上抛」（`Got unwanted exception. Actual message: "disk full"`，`doesNotThrow` 断言失败）。

原因：简报给的实现中 `writeLine = write || (...)`，注入的 `write` 直接调用、未被 try/catch 包裹，抛错直接上抛，违反 spec 级约束「写文件抛错时必须降级 console 且不向上抛」。按简报约束第 6 条「代码与实际情况冲突以实际为准并记录偏差」，将 writeLine 改为统一 try/catch 包裹（注入 write 与文件写入都走同一降级路径），修复后重跑：

```
ok 1 - 行格式：时间戳 + 级别 + 模块 + 消息 + detail
ok 2 - error 传 Error 时追加堆栈行
ok 3 - 写文件抛错时降级 console 不向上抛
# tests 3, pass 3, fail 0
```

3/3 全部通过（GREEN），exit code 0。

## npm test 回归结果

第一次直接跑：27 用例中 26 通过、1 失败——`GET /api/growth 无历史时 insufficient=true`（api.test.js:31），`expected: true, actual: false`，属于简报所述环境性失败（history/ 目录残留真实快照 index.json + 2 个 tsv.gz）。

处理：按简报要求，临时 `Rename-Item history -> history.bak`，重跑 `npm test`，通过后 `Rename-Item history.bak -> history` 恢复原名。

最终结果：

```
# tests 27
# pass 27
# fail 0
# cancelled 0
```

27/27 全部通过。已验证 history/ 目录恢复原样（index.json + 2 个 tsv.gz 快照完好），未删除任何数据。

补充：`npm run tsc` 零错误（exit code 0）。

## 偏差

- 实现偏差（唯一一处，非测试偏差）：简报原文 `const writeLine = write || ((line) => { ... try/catch 仅包文件写入 ... })` 未捕获注入 write 的抛错，导致测试 3 失败。修复为 `const writeLine = (line) => { try { if (write) { write(line); return; } ... } catch (err) { out.error('[logger] 日志写入失败（降级 console）: ' + err.message); } }`——注入 write 与文件写入统一走降级路径，行为与 spec 级约束及测试 3 完全一致。接口契约（行格式/堆栈行/按天滚动）未受影响。
- 环境性失败（api.test.js「无历史时 insufficient=true」）按简报预置方案处理，非代码问题。
- 未执行任何 git 写命令（含 commit），遵守约束。
