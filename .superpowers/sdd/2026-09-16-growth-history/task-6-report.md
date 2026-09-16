# Task 6 Report: 趋势分析页（/trends）

## 状态：DONE

## 实现说明

按简报逐字实现，未做任何偏差：

1. **`src/components/TrendChart.tsx`（新建）**
   - 自绘 SVG 折线趋势图，零依赖，`formatSize` 标注最小/最大值。
   - 数据点不足（<2 个有效点）时渲染降级提示文案。

2. **`src/pages/Trends/index.tsx`（新建）**
   - 时间窗口 Segmented（1d/2d/5d/10d/15d/1m/6m/1y）+ 自定义小时 InputNumber。
   - 增长排行 Top 20（`getGrowth({ window, top: 20 })`），含层级缩进、活跃程度 tier 配色、持续膨胀 Tag。
   - 逐层下钻（`getGrowthDir`）+ 面包屑 + 右侧趋势图（`getGrowthTrend({ points: 60 })` + TrendChart）。
   - 数据不足（`insufficient`）Empty 引导与权限不足（`unscannedDirs`）提权 Alert。

3. **`config/config.ts`**（一次 SearchReplace）
   - routes 新增 `{ path: '/trends', name: '趋势分析', component: './Trends' }`。

4. **`src/layouts/index.tsx`**（一次 SearchReplace，import + menuItems 合并）
   - import 新增 `LineChartOutlined`（按字母序插在 HddOutlined 与 ReadOutlined 之间）。
   - menuItems 新增 `{ key: '/trends', icon: <LineChartOutlined />, label: '趋势分析' }`（位于 /folders 之后）。

依赖核对：Task 5 的 `src/services/growth.ts`（getGrowth/getGrowthDir/getGrowthTrend 及 GrowthDirEntry/GrowthDirResult/GrowthTopResult/GrowthTier 类型）、`src/utils/format.ts` 的 `formatSize`、`src/setup/theme.tsx` 的 `figmaColors` 均已存在，别名 `@/setup/theme`、`@/utils/format`、`@/services/growth` 可解析。

## 验证命令与输出

### 1) Trends 目录检查

```
npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/Trends"
```

输出：无（空），退出码 0。✅

### 2) 全量检查

```
npx tsc --noEmit --pretty 2>&1
```

输出：无（空），退出码 0。✅ 未出现任何新增错误；简报提及的预存错误（src/app.tsx、src/setup/theme.tsx）在当前 tsc 检查范围内亦未触发。

## 偏差与顾虑

- 无代码偏差：四个文件均按简报逐字实现。
- 未运行 git（按要求跳过）；未安装任何 npm 依赖（趋势图为自绘 SVG）。
- 未修改 `src/pages/History`（Task 7 范围）。
- 顾虑：无。前端页面已编译通过，但未启动 dev server 做运行时联调（简报未要求）。
