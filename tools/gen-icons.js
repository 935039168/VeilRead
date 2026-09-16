// Generates icons/icon{16,48,128}.png — run: node tools/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
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
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const BG = hex('#232338');
const BG2 = hex('#2e2e4a');
const STROKE = hex('#a78bfa');
const STROKE_HI = hex('#c4b5fd');

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;
  const r = S * 0.22;                 // corner radius
  const sw = S * 0.075;               // V stroke half-width
  const top = S * 0.28, bot = S * 0.76;
  const ax = S * 0.30, bx = S * 0.70, vx = S * 0.5;
  const SS = 3;                       // supersample
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let bgA = 0, vA = 0, hiA = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px2 = x + (sx + 0.5) / SS, py2 = y + (sy + 0.5) / SS;
          // rounded-rect coverage
          const rx = Math.min(Math.max(px2, r), S - r), ry = Math.min(Math.max(py2, r), S - r);
          const inside = px2 >= 0 && px2 <= S && py2 >= 0 && py2 <= S &&
            (px2 === rx || Math.hypot(px2 - rx, py2 - ry) <= r);
          if (inside) {
            bgA += 1;
            const d1 = distSeg(px2, py2, ax, top, vx, bot);
            const d2 = distSeg(px2, py2, vx, bot, bx, top);
            if (d1 <= sw || d2 <= sw) {
              vA += 1;
              // subtle highlight on the left arm
              if (d1 <= sw && d2 > sw) hiA += 1;
            }
          }
        }
      }
      const n = SS * SS;
      const bg = bgA / n, v = vA / n, hi = hiA / n;
      const i = (y * S + x) * 4;
      const cr = BG[0] + (BG2[0] - BG[0]) * (py2y(y) / S), cg = BG[1] + (BG2[1] - BG[1]) * (py2y(y) / S), cb = BG[2] + (BG2[2] - BG[2]) * (py2y(y) / S);
      let R = cr, G = cg, B = cb;
      if (v > 0) {
        const mix = hi / Math.max(v, 1e-6);
        const sc = [STROKE[0] + (STROKE_HI[0] - STROKE[0]) * mix,
                    STROKE[1] + (STROKE_HI[1] - STROKE[1]) * mix,
                    STROKE[2] + (STROKE_HI[2] - STROKE[2]) * mix];
        R = R * (1 - v) + sc[0] * v;
        G = G * (1 - v) + sc[1] * v;
        B = B * (1 - v) + sc[2] * v;
      }
      px[i] = Math.round(R); px[i + 1] = Math.round(G); px[i + 2] = Math.round(B);
      px[i + 3] = Math.round(bg * 255);
    }
  }
  return px;
}
function py2y(y) { return y; }

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 48, 128]) writePNG(path.join(outDir, `icon${s}.png`), s, render(s));
console.log('icons written:', fs.readdirSync(outDir).join(', '));
