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
