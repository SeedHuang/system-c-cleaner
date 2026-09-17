/** 字节数格式化为可读大小（增长量可能为负：按绝对值选单位，保留负号） */
export function formatSize(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (abs >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (abs >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 以 GB 为单位的数值格式化 */
export function formatGB(gb: number | null | undefined): string {
  if (gb == null || Number.isNaN(gb)) return '—';
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(gb * 1024).toFixed(0)} MB`;
}
