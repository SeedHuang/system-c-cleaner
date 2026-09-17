/**
 * Widget 位置状态存取（userData/widget-state.json）。
 * 纯函数化：无文件 / 损坏 / 非有限数 → load 返回 null（调用方回退默认位置）。
 */
const fs = require('fs');
const path = require('path');

function loadWidgetState(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return null;
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return null;
    return { x: Math.round(data.x), y: Math.round(data.y) };
  } catch (err) {
    return null;
  }
}

function saveWidgetState(file, bounds) {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ x: Math.round(bounds.x), y: Math.round(bounds.y) }), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { loadWidgetState, saveWidgetState };
