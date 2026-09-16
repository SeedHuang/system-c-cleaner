# Task 7 Report: 历史快照管理页（History + 路由导航）

日期：2026-09-16
状态：**DONE**

## 实现说明

### 1. 创建 `src/pages/History/index.tsx`

按简报 Step 1 逐字实现「历史快照」页面，功能包括：

- 年/月/日/时四级联动 `Select` 组合筛选（月份/日期/小时选项基于上一级选择结果动态派生，禁用逻辑见简报）
- `getHistory()` 加载快照列表与总占用（Task 5 提供），`formatSize` 显示 `共 N 个快照，占用 X`
- 快照 `Table`：快照时间 / 磁盘已用(`formatGB`) / 目录数 / 文件数 / 快照大小(`formatSize`) / 未扫描(`Tag`) / 操作列
- 单条删除：`Popconfirm` + `deleteHistory({ ids: [r.id] })`
- 批量删除：`Popconfirm` + `deleteHistory({ year, month, day, hour })`，「删除筛选结果」按钮在无筛选条件或筛选结果为空时 `disabled`
- 删除后调用 `load()` 刷新，操作结果以 `msg` 文本反馈

依赖确认（编辑前已核验类型完全匹配）：
- `src/services/history.ts`：`HistorySnapshot`、`HistoryList`、`DeleteHistoryFilter`、`getHistory()`、`deleteHistory()`（Task 5 产物）
- `src/utils/format.ts`：`formatGB`、`formatSize`（均存在且签名匹配）

### 2. `config/config.ts`（一次 SearchReplace）

在 `/guide` 路由后新增：

```ts
{ path: '/history', name: '历史快照', component: './History' },
```

### 3. `src/layouts/index.tsx`（一次 SearchReplace）

一次 SearchReplace 内同时完成：

- import 块新增 `HistoryOutlined`（按字母序插入 `HddOutlined` 与 `LineChartOutlined` 之间）
- `menuItems` 末尾新增 `{ key: '/history', icon: <HistoryOutlined />, label: '历史快照' }`

Task 6 已有的 `LineChartOutlined` import 与 `/trends` 菜单项保持原样，未受影响。旧文件的 import 与 menuItems 内容与简报 old_str 完全一致，替换精确匹配。

## 验证命令与输出

### 第一级（单目录）

```
npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/History"
```

输出：**无输出（零匹配），exit code 0** ✅

### 第二级（全量）

```
npx tsc --noEmit --pretty 2>&1
```

输出：**无任何输出，exit code 0** ✅（全项目零编译错误，本次修改未引入跨文件连锁错误；此前简报提到的已知错误清单 src/app.tsx / src/pages/404 / src/setup/theme.tsx 在当前快照下也未报错）

## 偏差与顾虑

- **无偏差**：三个文件均按简报逐字实现/修改；未运行 git、未安装依赖、未派生子代理。
- 顾虑：无。
