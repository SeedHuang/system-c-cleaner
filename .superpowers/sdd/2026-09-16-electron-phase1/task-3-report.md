# Task 3 Report: electron/port.js — 端口启动与退避（TDD）

状态：DONE（全部通过，无偏差）

## 交付物

- `d:\Seed\system-c-cleaner\server\tests\port.test.js` — 4 个测试用例（照简报原文）
- `d:\Seed\system-c-cleaner\electron\port.js` — `startWithFallback(preferred, tryListen, maxTries = 10)`（照简报原文）

## TDD 证据

### Step 2 确认失败（实现前）

命令：`node --test server/tests/port.test.js`

```
# Error: Cannot find module '../../electron/port.js'
# Require stack:
# - D:\\Seed\\system-c-cleaner\\server\\tests\\port.test.js
#   code: 'MODULE_NOT_FOUND'
# tests 1, pass 0, fail 1
```

符合预期：模块不存在，测试失败。

### Step 4 确认通过（实现后）

命令：`node --test server/tests/port.test.js`

```
ok 1 - 首选端口可用时直接返回
ok 2 - EADDRINUSE 时退避到下一个端口
ok 3 - 全部占用时抛出最后一个错误
ok 4 - 非 EADDRINUSE 错误直接抛出不重试
# tests 4, pass 4, fail 0
```

## npm test 回归结果

第一次直接跑：24 用例中 23 通过、1 失败——`GET /api/growth 无历史时 insufficient=true`（api.test.js:31），失败原因为 `expected: true, actual: false`，属于简报所述环境性失败（history/ 目录残留真实快照）。

处理：按简报要求，临时 `Rename-Item history -> history.bak`，重跑 `npm test`，通过后 `Rename-Item history.bak -> history` 恢复原名。

最终结果：

```
# tests 24
# pass 24
# fail 0
# cancelled 0
```

24/24 全部通过。已验证 history/ 目录恢复原样（index.json + 2 个 tsv.gz 快照完好），未删除任何数据。

## 偏差

- 无代码偏差，测试与实现均照简报原文执行。
- 环境性失败（api.test.js「无历史时 insufficient=true」）按简报预置方案处理，非代码问题。
- 未执行任何 git 写命令（含 commit），遵守约束。
