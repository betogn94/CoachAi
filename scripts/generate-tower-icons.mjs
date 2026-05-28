#!/usr/bin/env node
/**
 * Generates Tower PWA icons (192, 512, 512-maskable) as PNG files.
 * Pure Node — uses built-in `zlib` only, no dependencies.
 *
 * The rook is drawn as 16x16 pixel art and nearest-neighbor scaled.
 * Maskable variant adds extra safe-zone padding (icon takes ~64% of canvas).
 *
 * Run from project root:
 *   node scripts/generate-tower-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'tower');

// Colors
const BG       = [0x0B, 0x0F, 0x17, 0xFF]; // dark navy (matches Tower bg)
const ACCENT   = [0x5B, 0x8D, 0xEF, 0xFF]; // azure rook
const TRANSPARENT = [0, 0, 0, 0];

// 16x16 sprite of the rook. 1 = accent pixel, 0 = background.
// Hand-drawn to match the SVG silhouette used in the favicon.
const ROOK_16 = `
................
................
.X.X.X.X.X.X....
.X.X.X.X.X.X....
.XXXXXXXXXXX....
..XXXXXXXXX.....
..XXXXXXXXX.....
..XXXXXXXXX.....
..XXXXXXXXX.....
..XXXXXXXXX.....
..XXXXXXXXX.....
..XXXXXXXXX.....
.XXXXXXXXXXX....
XXXXXXXXXXXXX...
XXXXXXXXXXXXX...
................
`.trim().split('\n').map(r => r.split('').map(c => c === 'X' ? 1 : 0));

function makeCanvas(size, fill = BG) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i*4+0] = fill[0];
    px[i*4+1] = fill[1];
    px[i*4+2] = fill[2];
    px[i*4+3] = fill[3];
  }
  return px;
}

function drawSprite(canvas, canvasSize, sprite, scale, offsetX, offsetY, color = ACCENT) {
  const spriteH = sprite.length;
  const spriteW = sprite[0].length;
  for (let sy = 0; sy < spriteH; sy++) {
    for (let sx = 0; sx < spriteW; sx++) {
      if (!sprite[sy][sx]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const cx = offsetX + sx * scale + dx;
          const cy = offsetY + sy * scale + dy;
          if (cx < 0 || cy < 0 || cx >= canvasSize || cy >= canvasSize) continue;
          const i = (cy * canvasSize + cx) * 4;
          canvas[i+0] = color[0];
          canvas[i+1] = color[1];
          canvas[i+2] = color[2];
          canvas[i+3] = color[3];
        }
      }
    }
  }
}

function roundedCornerMask(canvas, size, radius) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (x < radius && y < radius)             inside = (radius-x)**2 + (radius-y)**2 <= radius*radius;
      else if (x >= size-radius && y < radius)  inside = (x-(size-radius))**2 + (radius-y)**2 <= radius*radius;
      else if (x < radius && y >= size-radius)  inside = (radius-x)**2 + (y-(size-radius))**2 <= radius*radius;
      else if (x >= size-radius && y >= size-radius) inside = (x-(size-radius))**2 + (y-(size-radius))**2 <= radius*radius;
      if (!inside) {
        const i = (y * size + x) * 4;
        canvas[i+3] = 0; // transparent
      }
    }
  }
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // IDAT: filter byte (0 = None) per row + RGBA bytes
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.subarray ?
      Buffer.from(rgba.buffer, rgba.byteOffset + y*stride, stride).copy(raw, y * (stride + 1) + 1) :
      Buffer.from(rgba).copy(raw, y * (stride + 1) + 1, y*stride, y*stride + stride);
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIcon(size, { maskable = false, rounded = true } = {}) {
  const canvas = makeCanvas(size, BG);
  // For maskable, leave more safe-zone padding (icon ~64% of canvas)
  const targetIconSize = Math.floor(size * (maskable ? 0.55 : 0.78));
  const spriteSize = 16;
  const scale = Math.max(1, Math.floor(targetIconSize / spriteSize));
  const actualIconSize = scale * spriteSize;
  const offset = Math.floor((size - actualIconSize) / 2);
  drawSprite(canvas, size, ROOK_16, scale, offset, offset);

  // Soft rounded corners on non-maskable (looks nicer in app drawers; iOS
  // also masks to its own shape, but Android may not).
  if (rounded && !maskable) {
    const radius = Math.floor(size * 0.18); // ~18% corner radius
    roundedCornerMask(canvas, size, radius);
  }

  return encodePng(size, size, canvas);
}

function ensureDir(p) { try { mkdirSync(p, { recursive: true }); } catch {} }

ensureDir(OUT_DIR);

const variants = [
  { file: 'icon-192.png',           size: 192, opts: { maskable: false } },
  { file: 'icon-512.png',           size: 512, opts: { maskable: false } },
  { file: 'icon-512-maskable.png',  size: 512, opts: { maskable: true } },
  { file: 'icon-180.png',           size: 180, opts: { maskable: false } }, // apple-touch-icon
];

for (const v of variants) {
  const png = buildIcon(v.size, v.opts);
  writeFileSync(resolve(OUT_DIR, v.file), png);
  console.log(`✓ ${v.file} (${v.size}x${v.size}, ${png.length.toLocaleString()} bytes)`);
}
console.log('\nTower icons generated in tower/.');
