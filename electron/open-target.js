const fs = require('fs');

/**
 * 判断「打开」的目标该如何处理（纯函数，便于单测）。
 * 目录 -> 打开该文件夹；文件 -> 打开所在文件夹并选中它；其它/不存在 -> 不动作。
 *
 * @param {unknown} target 渲染进程传来的路径
 * @param {(p: string) => { isDirectory(): boolean, isFile(): boolean }} [statFn]
 *        默认 fs.statSync，测试时注入假实现
 * @returns {'folder' | 'file' | 'missing'}
 */
function resolveOpenAction(target, statFn = fs.statSync) {
  if (typeof target !== 'string') return 'missing';
  const p = target.trim();
  if (!p) return 'missing';
  try {
    const st = statFn(p);
    if (!st) return 'missing';
    if (typeof st.isDirectory === 'function' && st.isDirectory()) return 'folder';
    if (typeof st.isFile === 'function' && st.isFile()) return 'file';
    // 设备 / 管道等既非目录也非普通文件
    return 'missing';
  } catch {
    // ENOENT / EACCES / 其它任何异常：一律视为不可打开，不向上抛
    return 'missing';
  }
}

module.exports = { resolveOpenAction };
