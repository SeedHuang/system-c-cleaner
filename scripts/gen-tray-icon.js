/**
 * 生成托盘图标 electron/assets/tray.png（32×32 RGBA，无外部依赖）。
 * 图案：深蓝 #2697FF 圆形底 + 白色缺口圆环（形似 "C" 盘）。
 * 运行一次即可：node scripts/gen-tray-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32;
const CENTER = (SIZE - 1) / 2; // 15.5
const OUTER_R = 15;
const INNER_R = 8;
// C 缺口：右侧开口角度范围（角度制），从 -35° 到 35°（右侧开口）
const GAP_FROM = -40;
const GAP_TO = 40;

const BLUE = [38, 151, 255, 255]; // #2697FF

function inGap(angleDeg) {
  // 归一化到 [-180, 180]
  let a = angleDeg;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a >= GAP_FROM && a <= GAP_TO;
}

function pixelAt(x, y) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= INNER_R) return [0, 0, 0, 0]; // 内部镂空
  if (d > OUTER_R) return [0, 0, 0, 0]; // 外部透明
  // 圆环区域：缺口（右侧开口）透明，其余白色
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (inGap(angle)) return [0, 0, 0, 0];
  return [255, 255, 255, 255]; // 白色环
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// raw RGBA scanlines（每行前 1 字节 filter=0）
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixelAt(x, y);
    const off = rowStart + 1 + x * 4;
    raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);          // width
ihdr.writeUInt32BE(SIZE, 4);          // height
ihdr[8] = 8;                          // bit depth
ihdr[9] = 6;                          // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'electron', 'assets', 'tray.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`[OK] tray icon written: ${out} (${png.length} bytes)`);
