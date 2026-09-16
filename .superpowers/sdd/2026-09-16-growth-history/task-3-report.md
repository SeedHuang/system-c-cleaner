# Task 3 Report: 增长分析（窗口差值 + 排行 + 双标记 + 下钻 + 趋势）

日期：2026-09-16
状态：**DONE_WITH_CONCERNS**（简报存在一处内部矛盾，做了最小裁决，见「偏差与顾虑」）

## 实现说明

### 修改的文件

- `server/tests/history.test.js`
  - 文件顶部补充 `const zlib = require('zlib');`（原有 `fs/os/path/test/assert/history` 已存在，未改动）。
  - 保留原有 5 个用例不动，末尾追加简报 Step 1 中的 8 个 `test(...)` 块（parseWindowLabel / pickCompareId / diffMaps / tierOf / isSustained / computeGrowthTop / computeGrowthDir / computeGrowthTrend）及辅助函数 `writeFakeSnapshots`。
- `server/history.js`
  - 在 `buildSnapshot` 之后、`module.exports` 之前追加简报 Step 3 的实现块（逐字）：`parseWindowLabel` / `pickCompareId` / `diffMaps` / `tierOf` / `isSustained` / `growthFor`(内部) / `loadAnchorGrowth`(内部) / `computeGrowthTop` / `normalizeKey`(内部) / `computeGrowthDir` / `computeGrowthTrend`。
  - `module.exports` 追加 `parseWindowLabel, pickCompareId, diffMaps, tierOf, isSustained, computeGrowthTop, computeGrowthDir, computeGrowthTrend`；`normalizeKey/growthFor/loadAnchorGrowth` 不导出（与简报一致）。

### 关键实现点

- **存储键格式**：`normalizeKey` 严格按简报 key/prefix 逻辑——根目录 `c:\` 保留尾斜杠，其余目录去尾斜杠；`computeGrowthDir` 用 `key === 'c:\\' ? 'c:\\' : key + '\\'` 构造 prefix 做直接子目录匹配，未用「简单 replace 尾斜杠后当 key」的错误做法（简报明确要求）。
- **窗口解析**：`parseWindowLabel` 支持 `1y/6m/1m/15d/10d/5d/2d/1d/<N>h`（1y=365 天、1m=30 天），非法返回 null。
- **对比选择**：`pickCompareId` 找「≤ now-window 的最晚快照」，不足回退最早，仅 1 条返回 `id: null`。
- **三态差值**：`diffMaps` 未扫描（size 为 null）不参与；latest 独有记全额正增长；compare 独有记负增长；共有取差值。
- **双标记**：排行与下钻均通过 `loadAnchorGrowth` 加载 1d/7d/30d 锚点快照，`isSustained` 判定持续膨胀（日/周/月都 >0 且月增长 >1GB）。
- **趋势序列**：`computeGrowthTrend` 用 `normalizeKey` 匹配键，取最近 `points`（5~120 截断）个快照，返回 `{t, size}` 序列，缺失为 null。

## 测试命令与输出

失败先行（Step 2）：

```
node --test server/tests/history.test.js
# → FAIL：history.parseWindowLabel is not a function 等，pass 5 / fail 8
```

实现后（Step 4）：

```
node --test server/tests/history.test.js
1..13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# duration_ms ~82
```

全部 13 个用例通过（原有 5 个 + 简报追加 8 个）。

> 说明：简报任务描述称「7 个新测试用例」，但简报 Step 1 实际列出 8 个 `test(...)` 块（5 个纯函数用例 + computeGrowthTop/computeGrowthDir/computeGrowthTrend 3 个 I/O 用例）。已按 Step 1 逐字全部追加。

## 偏差与顾虑

1. **简报自身矛盾（computeGrowthTop 测试的 tier 期望）**：
   - 简报 `computeGrowthTop` 测试 fake 数据 `growth = 600`（字节），却断言 `users.tier === 'medium'`。
   - 而简报 `tierOf` 字节阈值为 `medium ≥ 100MB`（且 `tierOf` 单元测试已验证字节语义：6GB→extreme、200MB→medium、10MB→low，全部通过），因此 `tierOf(600)` 按简报实现必然返回 `'low'`。
   - 简报作者显然把 fake 数据当作 MB 级（增长 600MB → medium）误用了字节单位。
   - **裁决**：保持实现逐字（字节语义，`tierOf` 供 Task 4 API 按字节调用，是正确产品语义），将测试断言 `'medium'` 修正为 `'low'`（`tierOf(600)==='low'` 正是字节语义下的正确结果），并加注释说明。`medium` 分档仍由 `tierOf` 单元测试（200MB→medium）覆盖。
   - 若希望测试验证「增长 600 → medium」，应把 fake 数据改为 MB 级字节数（×1048576）并将 growth 断言改为 629145600——因简报原文断言 `growth === 600` 与此冲突，选择了改动面最小的方案。

2. **未执行的步骤**：按环境要求跳过 git commit、npm install、robocopy 实扫；未派生子代理。

3. **验证方式**：`tsconfig.json` 仅 include `src/config/typings.d.ts`，不含 `server` 目录，故 `npx tsc` 不检查 `server/*.js`（与用户规则中已知错误清单的检查范围无关）；改用 `node --test` 实际执行验证，语法与运行均已覆盖。
