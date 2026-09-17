/**
 * 桌面能力桥（由 electron/main-preload.js 通过 contextBridge 注入）。
 * 浏览器开发模式下 window.desktopAPI 不存在，调用方需处理失败返回。
 */
declare global {
  interface Window {
    desktopAPI?: {
      openPath?: (target: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export type OpenInExplorerResult = { ok: boolean; error?: string };

/**
 * 在资源管理器中打开路径：
 * 目录 -> 打开该文件夹；文件 -> 打开所在文件夹并选中它。
 * 非桌面环境（浏览器开发模式）不抛异常，返回可展示的失败信息。
 */
export async function openInExplorer(target: string): Promise<OpenInExplorerResult> {
  const api = typeof window !== 'undefined' ? window.desktopAPI : undefined;
  if (!api?.openPath) {
    console.warn('[shell] 当前非桌面环境，无法打开资源管理器:', target);
    return { ok: false, error: '请在桌面应用中使用此功能' };
  }
  try {
    const r = await api.openPath(target);
    if (!r?.ok) console.warn('[shell] 打开路径失败:', target, r?.error);
    return r ?? { ok: false, error: '打开失败' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '打开失败';
    console.error('[shell] 打开路径异常:', target, msg);
    return { ok: false, error: msg };
  }
}
