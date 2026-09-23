/**
 * autostart.js 单测（方案 A：计划任务自启）。
 *
 * 覆盖：
 *  - buildTaskXml 纯函数：RunLevel/LogonTrigger/不限时（PT0S）/参数/XML 转义
 *  - 开发模式禁用（isEnabled=false / setEnabled 拒绝）
 *  - setEnabled(true)：写 UTF-16LE+BOM 的 XML 临时文件 → schtasks /Create /XML /F
 *  - setEnabled(true) 失败 → 降级 Run 键（setLoginItemSettings）
 *  - setEnabled(false)：删任务 + 清理 Run 键残留
 *  - isEnabled：任务存在 / 不存在时回查登录项
 *  - refresh：任务存在时用当前 exe 路径重建（自愈旧路径）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAutostart, buildTaskXml, TASK_NAME } = require('./autostart');

function makeApp({ isPackaged = true, openAtLogin = false } = {}) {
  const calls = [];
  return {
    isPackaged,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (opts) => calls.push(opts),
    __calls: calls,
  };
}

function makeLog() {
  const lines = [];
  return {
    info: (...args) => lines.push(['info', ...args]),
    warn: (...args) => lines.push(['warn', ...args]),
    error: (...args) => lines.push(['error', ...args]),
    debug: (...args) => lines.push(['debug', ...args]),
    __lines: lines,
  };
}

/** fake execFile：按脚本队列回结果，并记录调用（含 opts，用于断言 timeout） */
function makeExecFile(script) {
  const calls = [];
  const fn = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const step = script[calls.length - 1];
    setTimeout(() => cb(step ? step.err : null, step ? step.stdout : '', step ? step.stderr : ''), 0);
  };
  fn.__calls = calls;
  return fn;
}

// ---------- buildTaskXml ----------

test('buildTaskXml：含登录触发 / 最高权限 / 不限时 / --hidden 参数', () => {
  const xml = buildTaskXml({ exePath: 'C:\\Program Files\\Roberta\\Roberta.exe', args: '--hidden' });
  assert.ok(xml.includes('<LogonTrigger>'), '应有 LogonTrigger');
  assert.ok(xml.includes('<RunLevel>Highest</RunLevel>'), '应最高权限（免 UAC 的关键）');
  assert.ok(xml.includes('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'), '必须不限时，否则默认 72h 杀常驻进程');
  assert.ok(xml.includes('<Command>C:\\Program Files\\Roberta\\Roberta.exe</Command>'));
  assert.ok(xml.includes('<Arguments>--hidden</Arguments>'));
});

test('buildTaskXml：XML 特殊字符转义（路径含 & 等不产生非法 XML）', () => {
  const xml = buildTaskXml({ exePath: 'D:\\Tools & Stuff\\a<b>.exe', args: '--hidden' });
  assert.ok(xml.includes('D:\\Tools &amp; Stuff\\a&lt;b&gt;.exe'));
  assert.ok(!xml.includes('D:\\Tools & Stuff'), '原始 & 不应出现');
});

// ---------- 开发模式 ----------

test('开发模式 isEnabled 返回 false', async () => {
  const app = makeApp({ isPackaged: false, openAtLogin: true });
  const a = createAutostart({ app, log: makeLog() });
  assert.strictEqual(await a.isEnabled(), false);
  assert.strictEqual(await a.refresh(), false);
});

test('开发模式 setEnabled 不做任何写操作且记 warn 日志', async () => {
  const app = makeApp({ isPackaged: false });
  const log = makeLog();
  const a = createAutostart({ app, log });
  assert.strictEqual(await a.setEnabled(true), false);
  assert.strictEqual(app.__calls.length, 0);
  assert.ok(log.__lines.some((l) => l[0] === 'warn' && l[1] === 'autostart'));
});

// ---------- setEnabled(true) ----------

test('启用成功：写 UTF-16LE+BOM 临时 XML → schtasks /Create /TN /XML /F（带 timeout）', async () => {
  const app = makeApp({ isPackaged: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-test-'));
  const ef = makeExecFile([{ err: null, stdout: 'SUCCESS' }]);
  const log = makeLog();
  const a = createAutostart({ app, log, execFileFn: ef, tmpDir });
  assert.strictEqual(await a.setEnabled(true), true);

  // schtasks 调用参数
  assert.strictEqual(ef.__calls.length, 1);
  const { file, args, opts } = ef.__calls[0];
  assert.strictEqual(file, 'schtasks');
  assert.strictEqual(args[0], '/Create');
  assert.strictEqual(args[1], '/TN');
  assert.strictEqual(args[2], TASK_NAME);
  assert.strictEqual(args[3], '/XML');
  assert.strictEqual(args[5], '/F');
  assert.strictEqual(opts.timeout, 10000, '必须有 timeout，防 schtasks 挂起阻塞托盘创建');

  // XML 文件（含其私有临时目录）已被清理
  assert.strictEqual(fs.existsSync(args[4]), false);
  assert.strictEqual(fs.readdirSync(tmpDir).length, 0);

  // 启用成功后应清掉 Run 键残留（防登录双实例）
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }]);
});

test('启用成功：写入的 XML 内容正确（UTF-16LE + BOM + 当前 exe 路径）', async () => {
  const app = makeApp({ isPackaged: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-test-'));
  // 拦截：让 schtasks 成功但先读走 XML 内容
  let xmlContent = null;
  const ef = (file, args, opts, cb) => {
    if (args[0] === '/Create') xmlContent = fs.readFileSync(args[4], 'utf16le');
    setTimeout(() => cb(null, 'SUCCESS', ''), 0);
  };
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef, tmpDir });
  await a.setEnabled(true);
  assert.ok(xmlContent.startsWith('\ufeff<?xml'), '应带 BOM');
  assert.ok(xmlContent.includes('<RunLevel>Highest</RunLevel>'));
  assert.ok(xmlContent.includes(`<Command>${process.execPath}</Command>`), 'Command 应为当前 exe 路径');
  assert.ok(xmlContent.includes('<Arguments>--hidden</Arguments>'));
});

test('启用失败（schtasks 报错）→ 降级 Run 键方式且仍返回 true', async () => {
  const app = makeApp({ isPackaged: true });
  const ef = makeExecFile([{ err: Object.assign(new Error('access denied'), { code: 1 }), stdout: '', stderr: 'ERROR: 拒绝访问' }]);
  const log = makeLog();
  const a = createAutostart({ app, log, execFileFn: ef });
  assert.strictEqual(await a.setEnabled(true), true);
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: true, args: ['--hidden'] }]);
  assert.ok(log.__lines.some((l) => l[0] === 'warn'));
});

// ---------- setEnabled(false) ----------

test('关闭：删除真失败（任务仍在）→ 如实返回 false + 清 Run 键 + warn', async () => {
  const app = makeApp({ isPackaged: true });
  // Delete 报错，回查 Query 成功（任务仍在）→ 真删除失败
  const ef = makeExecFile([
    { err: Object.assign(new Error('denied'), { code: 1 }), stdout: '', stderr: 'ERROR: 拒绝访问' },
    { err: null, stdout: 'INFO: task exists' },
  ]);
  const log = makeLog();
  const a = createAutostart({ app, log, execFileFn: ef });
  assert.strictEqual(await a.setEnabled(false), false, '删除失败必须如实上报，否则托盘显示已关闭但自启仍生效');
  assert.strictEqual(ef.__calls[0].args[0], '/Delete');
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }]); // Run 键残留仍清理
  assert.ok(log.__lines.some((l) => l[0] === 'warn'));
});

test('关闭：任务本就不存在（Delete 报错 + 回查无任务）→ 视为成功', async () => {
  const app = makeApp({ isPackaged: true });
  const ef = makeExecFile([
    { err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' },
    { err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' },
  ]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.setEnabled(false), true);
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }]);
});

test('关闭：任务删除成功', async () => {
  const app = makeApp({ isPackaged: true });
  const ef = makeExecFile([{ err: null, stdout: 'SUCCESS' }]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.setEnabled(false), true);
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }]);
});

// ---------- isEnabled ----------

test('isEnabled：任务存在 → true（不查登录项）', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: false });
  const ef = makeExecFile([{ err: null, stdout: 'INFO: task exists' }]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.isEnabled(), true);
  assert.strictEqual(ef.__calls[0].args[0], '/Query');
});

test('isEnabled：任务不存在 → 回查登录项（Run 键降级状态）', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true });
  const ef = makeExecFile([{ err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' }]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.isEnabled(), true);
});

test('isEnabled：任务不存在且登录项未设置 → false', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: false });
  const ef = makeExecFile([{ err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' }]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.isEnabled(), false);
});

// ---------- refresh（启动自愈） ----------

test('refresh：任务已存在 → 用当前 exe 重建（自愈旧路径），并清 Run 键残留', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: false });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-test-'));
  let createdXml = null;
  const ef = (file, args, opts, cb) => {
    if (args[0] === '/Query') return setTimeout(() => cb(null, 'INFO: exists', ''), 0);
    if (args[0] === '/Create') createdXml = fs.readFileSync(args[4], 'utf16le');
    setTimeout(() => cb(null, 'SUCCESS', ''), 0);
  };
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef, tmpDir });
  assert.strictEqual(await a.refresh(), true);
  assert.ok(createdXml && createdXml.includes(`<Command>${process.execPath}</Command>`), '重建应使用当前 exe 路径');
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }], '应清 Run 键残留防双实例');
});

test('refresh：任务不存在且 Run 键未开 → false（不主动创建任务）', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: false });
  const ef = makeExecFile([{ err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' }]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.refresh(), false);
  // 只有一次 Query，没有 Create
  assert.strictEqual(ef.__calls.length, 1);
  assert.strictEqual(ef.__calls[0].args[0], '/Query');
});

test('refresh 迁移：任务不存在但 Run 键开启（旧版升级）→ 注册任务并清 Run 键', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true });
  const ef = makeExecFile([
    { err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' }, // Query: 无任务
    { err: null, stdout: 'SUCCESS' },                                                          // Create: 成功
  ]);
  const log = makeLog();
  const a = createAutostart({ app, log, execFileFn: ef });
  assert.strictEqual(await a.refresh(), true);
  assert.strictEqual(ef.__calls[1].args[0], '/Create', '应尝试迁移注册计划任务');
  assert.deepStrictEqual(app.__calls, [{ openAtLogin: false, args: ['--hidden'] }], '迁移成功后应清掉 Run 键');
  assert.ok(log.__lines.some((l) => l[0] === 'info' && String(l[2] || '').includes('迁移')));
});

test('refresh 迁移：任务注册失败但 Run 键仍生效 → 返回 true（自启实际在用）', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true });
  const ef = makeExecFile([
    { err: Object.assign(new Error('not found'), { code: 1 }), stdout: '', stderr: 'ERROR' },                              // Query: 无任务
    { err: Object.assign(new Error('denied'), { code: 1 }), stdout: '', stderr: 'ERROR' }, // Create: 失败
  ]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.refresh(), true, 'Run 键仍生效，不能报 false');
  assert.strictEqual(app.__calls.length, 0, '迁移失败不得清 Run 键（否则自启直接失效）');
});

test('refresh：任务重建失败但 Run 键降级在位 → 仍返回 true', async () => {
  const app = makeApp({ isPackaged: true, openAtLogin: true }); // 降级方式在位
  const ef = makeExecFile([
    { err: null, stdout: 'INFO: exists' },                                   // Query: 任务存在
    { err: Object.assign(new Error('denied'), { code: 1 }), stdout: '', stderr: 'ERROR' }, // Create 失败
  ]);
  const a = createAutostart({ app, log: makeLog(), execFileFn: ef });
  assert.strictEqual(await a.refresh(), true);
});
