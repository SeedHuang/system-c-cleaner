/**
 * Phase 4 配置读写（userData/settings.json）。
 * 纯函数 + 容错：文件缺失/损坏/字段非法一律回落默认值 —— 配置问题不能让应用崩溃。
 * 校验规则集中在 RULES，新增字段时同步加规则与默认值。
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  autoScan: true,
  autoElevateOnStart: true,
  startDelayMin: 3,
  intervalHours: 12,
  dailyAt: '09:00',
  minGapMin: 60,
  lowSpacePct: 10,
  growthWarnGB: 2,
  notifyEveryScan: true,
};

const isBool = (v) => typeof v === 'boolean';
const isNumIn = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const RULES = {
  autoScan: isBool,
  autoElevateOnStart: isBool,
  startDelayMin: isNumIn(0, 1440),
  intervalHours: isNumIn(1, 168),
  dailyAt: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  minGapMin: isNumIn(0, 1440),
  lowSpacePct: isNumIn(1, 100),
  growthWarnGB: isNumIn(0, 10240),
  notifyEveryScan: isBool,
};

function readRaw(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(txt);
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    return null;
  }
}

/** 读配置：未知字段忽略，非法字段回落默认值（可选 log 记录告警） */
function loadSettings(file, log) {
  const raw = readRaw(file);
  const out = { ...DEFAULTS };
  if (!raw) return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue;
    if (RULES[key](raw[key])) {
      out[key] = raw[key];
    } else if (log) {
      log.warn('settings', '配置项非法，已回落默认值', { key, value: raw[key], fallback: DEFAULTS[key] });
    }
  }
  return out;
}

/** 合并写回（只写已知字段）；成功 true，失败 false 不抛错 */
function saveSettings(file, patch) {
  try {
    const merged = { ...loadSettings(file), ...(patch && typeof patch === 'object' ? patch : {}) };
    const clean = {};
    for (const key of Object.keys(DEFAULTS)) {
      clean[key] = RULES[key](merged[key]) ? merged[key] : DEFAULTS[key];
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { DEFAULTS, RULES, loadSettings, saveSettings };
