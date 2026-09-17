/**
 * 取路径的上级目录。
 * 'C:\Users\a' -> 'C:\Users'；'C:\Windows' -> 'C:\'；'C:\' -> 'C:\'（已是根则返回自身）
 */
export function parentOf(p: string): string {
  const s = String(p ?? '').replace(/[\\/]+$/, '');
  if (!s) return s;
  if (/^[a-zA-Z]:$/.test(s)) return `${s}\\`; // 'C:' 视作 'C:\'
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  if (i < 0) return s;
  if (i === 2 && /^[a-zA-Z]:/.test(s)) return s.slice(0, 3); // 盘的根目录
  return s.slice(0, i);
}
