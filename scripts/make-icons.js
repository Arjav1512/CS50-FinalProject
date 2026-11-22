// Generates icons/icon{16,32,48,128}.png (no dependencies; uses zlib).
// Design: the popup's score ring — an indigo rounded square with a white
// three-quarter ring and a dot, matching --accent-primary in style.css.
//   node scripts/make-icons.js
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');
const BG = [79, 70, 229];       // #4f46e5
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Coverage (0..1) of the shape at a point in a unit square [0,1]².
function shape(x, y) {
  const r = 0.22; // corner radius of the background
  const dx = Math.max(r - x, 0, x - (1 - r)), dy = Math.max(r - y, 0, y - (1 - r));
  if (dx * dx + dy * dy > r * r) return null;            // outside rounded square
  const cx = x - 0.5, cy = y - 0.5;
  const d = Math.hypot(cx, cy);
  const angle = (Math.atan2(cx, -cy) + 2 * Math.PI) % (2 * Math.PI); // 0 at top, clockwise
  const onRing = d > 0.25 && d < 0.36 && angle < Math.PI * 1.5;
  const onDot = Math.hypot(cx, cy) < 0.085;
  return onRing || onDot ? FG : BG;
}

function png(size) {
  const ss = 4; // supersampling for anti-aliasing
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shape((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
      }
      const n = ss * ss;
      const o = 1 + x * 4;
      if (a) { row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a; }
      row[o + 3] = Math.round((a / n) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(OUT, `icon${size}.png`), png(size));
  console.log(`icons/icon${size}.png`);
}
