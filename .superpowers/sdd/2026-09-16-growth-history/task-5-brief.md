# Task 5 Brief: 前端数据层（services/growth.ts + services/history.ts + scan.ts 小改）

项目：d:\Seed\system-c-cleaner（umi/max + antd5 前端）。本任务新增前端 API 封装服务与类型，供后续 Task 6（趋势分析页）、Task 7（历史快照页）消费。Task 4 已完成后端路由。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 验证命令：每次编辑 .ts 后运行 `npx tsc --noEmit --pretty 2>&1 | grep "src/services"`（应无输出）。全部完成后可跑全量 `npx tsc --noEmit --pretty`（已知预存错误：src/app.tsx、src/setup/theme.tsx 可忽略；src/pages/404 本项目不存在）。
- 禁止安装 npm 依赖。
- 文件编辑用 Write/SearchReplace 工具。
- **同一文件禁止并行 SearchReplace；scan.ts 的 import 变更与代码变更必须在同一次 SearchReplace 内完成**（本任务 scan.ts 无 import 变更，只加一个可选字段，一次 SearchReplace 即可）。
- 不要派生子代理。
- 参照现有 `src/services/scan.ts` 的 `request<T>` 封装风格。

## Files

- Create: `src/services/growth.ts`
- Create: `src/services/history.ts`
- Modify: `src/services/scan.ts`（`ScanResult` 接口加可选字段 `snapshotWarning?: string;`）

## Interfaces

- Consumes: Task 4 的 API（经 umi proxy `/api`）
- Produces（供 Task 6/7 页面使用）：
  - `src/services/growth.ts`：类型 `GrowthTier / GrowthEntry / GrowthTopResult / GrowthDirEntry / GrowthDirResult / GrowthTrendPoint / GrowthTrendResult`；函数 `getGrowth / getGrowthDir / getGrowthTrend`
  - `src/services/history.ts`：类型 `HistorySnapshot / HistoryList / DeleteHistoryFilter`；函数 `getHistory / deleteHistory`

## Steps

### Step 1: 创建 src/services/growth.ts

```ts
export type GrowthTier = 'extreme' | 'high' | 'medium' | 'low';

export interface GrowthEntry {
  path: string;
  size: number | null;
  growth: number;
  tier: GrowthTier;
  sustained: boolean;
}

export interface GrowthTopResult {
  window: string;
  scannedAt: string;
  compareAt: string | null;
  actualWindowDays: number | null;
  insufficient: boolean;
  unscannedDirs: number;
  entries: GrowthEntry[];
}

export interface GrowthDirEntry extends GrowthEntry {
  name: string;
  hasChildren: boolean;
}

export interface GrowthDirResult {
  path: string;
  window: string;
  actualWindowDays: number | null;
  insufficient: boolean;
  entries: GrowthDirEntry[];
}

export interface GrowthTrendPoint {
  t: string;
  size: number | null;
}

export interface GrowthTrendResult {
  path: string;
  points: GrowthTrendPoint[];
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export function getGrowth(params: { window: string; top?: number }): Promise<GrowthTopResult> {
  const q = new URLSearchParams({ window: params.window, top: String(params.top ?? 20) });
  return request<GrowthTopResult>(`/api/growth?${q}`);
}

export function getGrowthDir(params: { path: string; window: string }): Promise<GrowthDirResult> {
  const q = new URLSearchParams({ path: params.path, window: params.window });
  return request<GrowthDirResult>(`/api/growth/dir?${q}`);
}

export function getGrowthTrend(params: { path: string; points?: number }): Promise<GrowthTrendResult> {
  const q = new URLSearchParams({ path: params.path, points: String(params.points ?? 60) });
  return request<GrowthTrendResult>(`/api/growth/trend?${q}`);
}
```

### Step 2: 创建 src/services/history.ts

```ts
export interface HistorySnapshot {
  id: string;
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  dirCount: number;
  fileCount: number;
  fileSizeMB: number;
  unscannedDirs: number;
  warning: string | null;
}

export interface HistoryList {
  snapshots: HistorySnapshot[];
  totalSizeMB: number;
}

export interface DeleteHistoryFilter {
  ids?: string[];
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  before?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export function getHistory(): Promise<HistoryList> {
  return request<HistoryList>('/api/history');
}

export function deleteHistory(filter: DeleteHistoryFilter): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
}
```

### Step 3: 修改 src/services/scan.ts

用一次 SearchReplace：把 `ScanResult` 接口

```ts
export interface ScanResult {
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  topFolders: TopFolder[];
  items: ScanItem[];
  largeFiles: LargeFile[];
}
```

改为（末尾追加一个可选字段，其余不动）：

```ts
export interface ScanResult {
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  topFolders: TopFolder[];
  items: ScanItem[];
  largeFiles: LargeFile[];
  snapshotWarning?: string;
}
```

### Step 4: tsc 验证

Run: `npx tsc --noEmit --pretty 2>&1 | grep "src/services"`
Expected: 无输出（零错误）

### Step 5: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-5-report.md` 写入完整报告（实现说明、验证命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、验证摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要安装依赖。
