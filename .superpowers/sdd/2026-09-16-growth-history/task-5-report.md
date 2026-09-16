# Task 5 Report: 前端数据层（services/growth.ts + services/history.ts + scan.ts 小改）

状态：DONE

## 实现说明

1. **创建 `src/services/growth.ts`**（新增）
   - 类型：`GrowthTier`（'extreme' | 'high' | 'medium' | 'low'）、`GrowthEntry`、`GrowthTopResult`、`GrowthDirEntry`（extends GrowthEntry，含 name/hasChildren）、`GrowthDirResult`、`GrowthTrendPoint`、`GrowthTrendResult`
   - 函数：`getGrowth`（GET /api/growth）、`getGrowthDir`（GET /api/growth/dir）、`getGrowthTrend`（GET /api/growth/trend）
   - 使用 fetch 封装的私有 `request<T>`（风格对齐现有 scan.ts）
   - 全部按简报代码逐字实现

2. **创建 `src/services/history.ts`**（新增）
   - 类型：`HistorySnapshot`、`HistoryList`、`DeleteHistoryFilter`
   - 函数：`getHistory`（GET /api/history）、`deleteHistory`（DELETE /api/history，JSON body，返回 `{ deleted: number }`）
   - 私有 `request<T>(url, init?)` 支持 RequestInit（对齐现有 scan.ts 风格）
   - 全部按简报代码逐字实现

3. **修改 `src/services/scan.ts`**（一次 SearchReplace）
   - `ScanResult` 接口末尾追加可选字段 `snapshotWarning?: string;`
   - 其余部分（import 行、其他接口、request 封装）均未改动
   - 无 import 变更

## 验证命令与输出

| 命令 | 输出 | 结论 |
|---|---|---|
| `npx tsc --noEmit --pretty`（过滤 src/services） | `NO_SERVICES_ERRORS`（即无匹配行） | ✅ src/services 零错误 |
| `npx tsc --noEmit --pretty`（全量） | 无输出，exit code 0 | ✅ 全量零错误（无新增跨文件连锁错误） |

说明：简报中的验证命令使用 `grep`，但本环境为 Windows PowerShell，无 grep 命令，故用 `Select-String "src/services"` 等价实现过滤，语义一致（无输出即零错误）。

## 偏差与顾虑

- **无代码偏差**：三个文件均严格按简报代码实现，未做任何额外修改。
- **环境偏差（仅验证方式）**：`grep` 在 PowerShell 不可用，改用 `Select-String`，结果语义等价。
- **其他**：未运行 git（按要求跳过 commit）、未安装任何 npm 依赖、未派生子代理。

## 完成标准核对

- ✅ `npx tsc --noEmit --pretty` 无 src/services 相关错误
- ✅ 全量 tsc 零错误
