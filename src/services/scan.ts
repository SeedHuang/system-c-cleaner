import type { CleanupLevel } from '@/setup/theme';

export interface ScanItem {
  id: string;
  name: string;
  path: string;
  sizeGB: number | null;
  level: CleanupLevel;
  reason: string;
  action?: string;
  status?: 'ok' | 'unscanned' | 'na';
}

export interface LargeFile {
  name: string;
  path: string;
  sizeGB: number;
}

export interface TopFolder {
  name: string;
  path: string;
  sizeGB: number | null;
  status?: 'ok' | 'unscanned';
}

export interface ScanResult {
  scannedAt: string;
  disk: { totalGB: number; usedGB: number; freeGB: number };
  topFolders: TopFolder[];
  items: ScanItem[];
  largeFiles: LargeFile[];
  snapshotWarning?: string;
}

export interface ScanStatus {
  hasResult: boolean;
  scanning: boolean;
  scannedAt: string | null;
  disk: ScanResult['disk'] | null;
  elevatedScan?: 'idle' | 'running' | 'cancelled';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export function getStatus(): Promise<ScanStatus> {
  return request<ScanStatus>('/api/status');
}

export function getScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan');
}

export function triggerScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', { method: 'POST' });
}

export function elevateRestart(): Promise<{ ok: boolean; elevatedScan: string }> {
  return request<{ ok: boolean; elevatedScan: string }>('/api/elevate-restart', { method: 'POST' });
}
