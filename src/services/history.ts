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
  /** 快照文件所在的本地目录（用于「打开历史快照目录」按钮）；null 表示尚未定位 */
  historyDir: string | null;
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
