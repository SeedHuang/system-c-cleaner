/**
 * 全路径日志：console + 文件双写，按天滚动，写失败降级 console（不抛错）。
 * 级别：INFO（正常分支）/ WARN（边界分支）/ ERROR（catch 分支，含堆栈）。
 */
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function dayFile(dir, name) {
  const d = new Date();
  return path.join(dir, `${name}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
}

function createLogger({ logDir = null, name = 'app', write = null, console: out = console } = {}) {
  const writeLine = (line) => {
    try {
      if (write) { write(line); return; }
      if (!logDir) return;
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(dayFile(logDir, name), line + '\n', 'utf8');
    } catch (err) {
      out.error(`[logger] 日志写入失败（降级 console）: ${err.message}`);
    }
  };
  const emit = (level, module, msg, detail) => {
    const line = `[${ts()}] [${level}] [${module}] ${msg}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`;
    writeLine(line);
    if (level === 'ERROR') out.error(line); else out.log(line);
  };
  return {
    info: (module, msg, detail) => emit('INFO', module, msg, detail),
    warn: (module, msg, detail) => emit('WARN', module, msg, detail),
    error: (module, msg, errOrDetail) => {
      if (errOrDetail instanceof Error) {
        emit('ERROR', module, `${msg}: ${errOrDetail.message}`);
        writeLine(`[${ts()}] [ERROR] [${module}] 堆栈: ${errOrDetail.stack || ''}`);
      } else {
        emit('ERROR', module, msg, errOrDetail);
      }
    },
  };
}

module.exports = { createLogger };
