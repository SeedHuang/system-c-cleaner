/**
 * 端口启动与退避：从首选端口起，EADDRINUSE 则 +1 重试，超限抛最后一个错误。
 * @param {number} preferred 首选端口
 * @param {(port:number)=>Promise<any>} tryListen 在端口上启动并 resolve 的异步函数
 * @param {number} maxTries 最大尝试次数（默认 10）
 * @returns {Promise<{port:number, server:any}>}
 */
async function startWithFallback(preferred, tryListen, maxTries = 10) {
  let lastErr;
  for (let i = 0; i < maxTries; i++) {
    const port = preferred + i;
    try {
      const server = await tryListen(port);
      return { port, server };
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { startWithFallback };
