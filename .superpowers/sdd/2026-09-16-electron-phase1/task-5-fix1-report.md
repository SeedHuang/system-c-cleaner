# Task 5 Fix 1 报告：server/index.js 空吞 catch 补日志

- 日期：2026-09-16
- 文件：`server/index.js`
- 目的：按 spec 全路径日志要求，给 3 处空吞 catch 补 `log.warn` 日志（catch 无日志 = 代码缺陷）

## 1. 修改内容（old → new）

### 修改 1：`readBody()` 内（原第 94 行，现第 94-99 行）

old:
```js
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
```

new:
```js
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        log.warn('api', '请求体 JSON 解析失败，按空对象处理', { err: err.message });
        resolve({});
      }
```

### 修改 2：`handle()` 内 POST /api/elevate-restart 分支（现第 252 行）

old:
```js
      if (fs.existsSync(ELEVATE_FLAG)) {
        try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
      }
```

new:
```js
      if (fs.existsSync(ELEVATE_FLAG)) {
        try { fs.unlinkSync(ELEVATE_FLAG); } catch (err) { log.warn('elevate', '删除提权标志失败（忽略）', { err: err.message }); }
      }
```

锚点：`elevatedScan = 'running';` 上下文（避免与第 3 处同名代码块歧义）。

### 修改 3：`startServer()` 内（现第 280 行）

old:
```js
  if (fs.existsSync(ELEVATE_FLAG)) {
    try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
  }
```

new:
```js
  if (fs.existsSync(ELEVATE_FLAG)) {
    try { fs.unlinkSync(ELEVATE_FLAG); } catch (err) { log.warn('elevate', '启动时删除提权标志失败（忽略）', { err: err.message }); }
  }
```

锚点：`const server = http.createServer(handle);` 上下文（避免与第 2 处歧义）。

已通过 Read 复核最终文件确认三处均正确落地。修改逐个顺序执行，未对同一文件并行 SearchReplace。

## 2. 测试验证结果

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 单测（首次） | `node --test server/tests/api.test.js` | 7 用例：6 过 1 失败（`GET /api/growth 无历史时 insufficient=true`，因 `history/` 残留真实快照） |
| 单测（改名后重跑） | 临时 `history/` → `history.bak/` 后重跑 | 7/7 全过 ✅ |
| 全量测试（改名后） | `npm test` | 29/29 全过 ✅ |
| TypeScript 编译 | `npm run tsc` | 零错误 ✅ |

> `history/` 已恢复原名，真实快照数据未删除（`index.json` + 2 个 `.tsv.gz` 完整保留）。

## 3. 偏差说明

- 无代码层面偏差。三处修改与任务描述完全一致。
- `npm test` / 单测首次运行失败（1/7、28/29）并非本次修改引入，而是 `d:\Seed\system-c-cleaner\history\` 下残留 2026-09-16 的两份真实扫描快照，导致 `computeGrowth` 认为有历史（`insufficient=false`）。按任务指定流程临时改名为 `history.bak/` 重跑后全部通过，随后已恢复原名。
- 未执行任何 git 写命令（未 commit）。

## 4. 结论

任务 5 fix1 完成，3 处空吞 catch 均已补上结构化日志，测试与类型检查全部通过。
