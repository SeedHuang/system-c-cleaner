export type GrowthTier = 'extreme' | 'high' | 'medium' | 'low';

export interface GrowthEntry {
  path: string;
  size: number | null;
  growth: number;
  tier: GrowthTier;
  sustained: boolean;
}

export interface GrowthTopResult {
  window: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
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
  window: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  actualWindowDays: number | null;
  insufficient: boolean;
  entries: GrowthDirEntry[];
}

/** 时间范围参数：from+to 为绝对区间（优先），否则用预设 window */
export interface GrowthRangeParams {
  window?: string;
  from?: string;
  to?: string;
}

/** 区间优先，缺一个就回落预设窗口 */
function rangeQuery(params: GrowthRangeParams): Record<string, string> {
  return params.from && params.to
    ? { from: params.from, to: params.to }
    : { window: params.window || '1m' };
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

export function getGrowth(params: GrowthRangeParams & { top?: number }): Promise<GrowthTopResult> {
  const q = new URLSearchParams({ ...rangeQuery(params), top: String(params.top ?? 20) });
  return request<GrowthTopResult>(`/api/growth?${q}`);
}

export function getGrowthDir(params: GrowthRangeParams & { path: string }): Promise<GrowthDirResult> {
  const q = new URLSearchParams({ path: params.path, ...rangeQuery(params) });
  return request<GrowthDirResult>(`/api/growth/dir?${q}`);
}

export function getGrowthTrend(params: { path: string; points?: number }): Promise<GrowthTrendResult> {
  const q = new URLSearchParams({ path: params.path, points: String(params.points ?? 60) });
  return request<GrowthTrendResult>(`/api/growth/trend?${q}`);
}
