# Task 8 Report: Dashboard 提权引导提示 + 全量验证

状态：**DONE**

## 实现说明

修改文件：`src/pages/Dashboard/index.tsx`

- 先 Read 确认实际内容与简报 old_str 完全一致（原第 135-139 行）。
- 按控制器裁定执行**一次 SearchReplace**：将未扫描提示的旧 div（灰色小字 `rgba(255,255,255,0.45)`）替换为警告色内联样式 div：
  - `background: 'rgba(255,207,38,0.12)'` + `border: '1px solid rgba(255,207,38,0.35)'` + `color: '#FFD666'`（figmaColors.yellow `#FFCF26` 系警告色），`padding: '10px 14px'`、`borderRadius: 10`、`fontSize: 13`。
  - 文案改为引导式：「检测到 {unscannedCount} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。」
- **未触碰 import 行（第 2 行）及其他任何代码**；未引入任何新 import（纯内联样式，无需 antd Alert）。
- 跳过 commit（环境禁止 git），未安装任何 npm 依赖，未派生子代理。

## 验证输出摘要

### 1. `npm test` ✅（exit 0）
`node --test "server/tests/*.test.js"` → **16 个用例全部通过，0 失败**，覆盖 status/history/growth API、snapshot 序列化与删除、增长计算（accumulateLines / diffMaps / tierOf / isSustained / computeGrowthTop / computeGrowthDir / computeGrowthTrend）等。duration 110.7ms。

### 2. `npx tsc --noEmit --pretty` ✅（exit 0）
无任何输出，零类型错误。注意：简报预期的已知预存错误（src/app.tsx、src/setup/theme.tsx）**并未出现**——说明已知错误清单已过期，当前全量类型检查完全干净（结果优于预期）。

### 3. `npm run build` ✅（exit 0）
Umi v4.7.17 / Webpack Compiled successfully in 4.51s，`dist/` 正常生成（含 `p__Dashboard__index.async.js` 等产物），esbuild helper 无冲突。

## 偏差与顾虑

- 无偏差：文件实际内容与简报 old_str 完全一致，一次 SearchReplace 按原样完成。
- 无顾虑。
