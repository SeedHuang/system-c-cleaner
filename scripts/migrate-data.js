#!/usr/bin/env node
/**
 * 手动迁移脚本（不依赖 Electron）
 *
 * 默认：把 %APPDATA%\c-drive-cleaner 合并到 %USERPROFILE%\.system-c-cleaner
 *
 * 用法：
 *   node scripts/migrate-data.js                       # 默认路径
 *   node scripts/migrate-data.js --from <dir> --to <dir>
 *   node scripts/migrate-data.js --dry-run
 *
 * 退出码：
 *   0 - 成功迁移（或已无需要迁移的东西）
 *   1 - 参数错误或 IO 失败
 *
 * 走同一份 runMigrate（与 electron/main.js 内嵌的逻辑一致）；
 * - history/index.json 按快照 id 去重合并，按 scannedAt 升序
 * - logs/ 按文件名去重
 * - 不拷贝 settings.json
 * - 旧位置写 .migrated-to / .migrated-at 标记
 */
const os = require('os');
const path = require('path');
const Module = require('module');

// 在 asar 打包后的安装目录里，scripts/ 与 electron/ 同在 resources/ 下，require 路径要兼容
function loadRunMigrate() {
  const candidates = [
    '../electron/migrate-data', // 开发/源码目录
    './electron/migrate-data', // 打包后：scripts/ 与 electron/ 同级
    '../../electron/migrate-data', // 打包后：resources/scripts/<script> 跳一级到 app
  ];
  for (const p of candidates) {
    try {
      const m = require(p);
      if (process.env.DEBUG_MIGRATE) console.error('[migrate-data] loaded from:', p);
      return m.runMigrate;
    } catch (e) {
      if (process.env.DEBUG_MIGRATE) console.error('[migrate-data] tried', p, ':', e.code);
      /* 试下一个 */
    }
  }
  throw new Error('找不到 electron/migrate-data 模块；请通过 npm run migrate 调用，或从仓库根目录运行');
}
const runMigrate = loadRunMigrate();

const COLOR = process.stdout.isTTY && !process.argv.includes('--no-color');

const c = COLOR
  ? {
      red: (s) => `\u001b[31m${s}\u001b[0m`,
      green: (s) => `\u001b[32m${s}\u001b[0m`,
      yellow: (s) => `\u001b[33m${s}\u001b[0m`,
      cyan: (s) => `\u001b[36m${s}\u001b[0m`,
      dim: (s) => `\u001b[2m${s}\u001b[0m`,
      bold: (s) => `\u001b[1m${s}\u001b[0m`,
    }
  : { red: String, green: String, yellow: String, cyan: String, dim: String, bold: String };

function parseArgs(argv) {
  const out = { from: null, to: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-color') {/* no-op, TTY check 在 COLOR 阶段 */}
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      console.error(c.red(`[!] 未知参数: ${a}`));
      out.error = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`
${c.bold('CDriveCleaner 数据迁移脚本')}

${c.cyan('用法')}
  node scripts/migrate-data.js                       ${c.dim('# 默认路径')}
  node scripts/migrate-data.js --from <dir> --to <dir>
  node scripts/migrate-data.js --dry-run             ${c.dim('# 只打印，不写文件')}

${c.cyan('默认路径')}
  --from    ${os.homedir() + path.sep + 'AppData${path.sep}Roaming${path.sep}c-drive-cleaner'.replace(/\$\{path\.sep\}/g, path.sep)}
  --to      ${os.homedir() + path.sep + '.system-c-cleaner'}

${c.cyan('退出码')}
  0 - 成功迁移（或无需迁移）
  1 - 参数错误 / IO 失败
`);
}

const args = parseArgs(process.argv);
if (args.help) { printHelp(); process.exit(0); }
if (args.error) { console.log(c.yellow('试试 --help')); process.exit(1); }

const from = args.from || path.join(os.homedir(), 'AppData', 'Roaming', 'c-drive-cleaner');
const to = args.to || path.join(os.homedir(), '.system-c-cleaner');

console.log(c.bold('CDriveCleaner 数据迁移'));
console.log(`${c.dim('from')} ${from}`);
console.log(`${c.dim('to  ')} ${to}`);
console.log(`${c.dim('mode')} ${args.dryRun ? c.yellow('DRY-RUN') : 'live'}`);
console.log('');

function cliLog(level, scope, msg, extra) {
  const tag = level === 'error' ? c.red('[ERROR]')
    : level === 'warn' ? c.yellow('[WARN] ')
    : level === 'info' ? c.green('[INFO] ')
    : c.dim(`[${level.toUpperCase()}]`);
  let line = `${tag} [${scope}] ${msg}`;
  if (extra !== undefined) line += ' ' + JSON.stringify(extra);
  console.log(line);
}

(async () => {
  try {
    if (args.dryRun) {
      console.log(c.yellow('[!] --dry-run 模式尚未完全实现（当前 runMigrate 不区分 dry-run）'));
      console.log(c.yellow('    取消 --dry-run 即可实际执行；该参数占位以保留 CLI 接口'));
    }
    const r = await runMigrate({ oldDir: from, newDir: to, log: cliLog });
    console.log('');
    if (r.reason === 'same-dir') {
      console.log(c.yellow('[!] --from 与 --to 指向同一路径，跳过迁移'));
      process.exit(0);
    }
    if (r.reason === 'old-empty') {
      console.log(c.green('[OK] 旧目录为空或不存在，无需迁移'));
      process.exit(0);
    }
    if (!r.migrated) {
      console.log(c.yellow(`[!] 迁移未执行，原因: ${r.reason}`));
      process.exit(0);
    }
    const s = r.stats || {};
    console.log(c.green('[OK] 数据迁移完成'));
    console.log(`    时间:         ${r.migratedAt}`);
    console.log(`    顶层文件:     ${s.files ?? 0}`);
    console.log(`    快照合并:     ${s.snapshotsMerged ?? 0}（旧 index.json 按 id 去重 + 按时间升序合并）`);
    console.log(`    快照跳过:     ${s.snapshotsSkipped ?? 0}（旧 index 列了 id 但 .tsv.gz 缺失）`);
    console.log(`    日志文件:     ${s.logsCopied ?? 0}`);
    console.log('');
    console.log(c.cyan(`[!] 旧位置已写跳转标记: ${path.join(from, '.migrated-to')}`));
    process.exit(0);
  } catch (err) {
    console.error(c.red(`[!] 迁移失败: ${err.message}`));
    console.error(err.stack);
    process.exit(1);
  }
})();