#!/usr/bin/env node
/**
 * Generates Tower PWA icons (192, 512, 512-maskable, 180-apple, favicon-32).
 * Uses @resvg/resvg-js (WASM, no native deps) to render an SVG to PNG.
 *
 * Run from project root:
 *   node scripts/generate-tower-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'tower');

// ----- Brand tokens (matches tower/index.html theme) -----
const BG       = '#0B0F17';
const ACCENT   = '#5B8DEF';
const HIGHLIGHT = '#7AA3F5'; // lighter accent for top-light dimension
const SHADOW   = '#3F6BC9'; // darker accent for bottom shading

/**
 * Chess rook silhouette. Designed at 0..1000 coordinates so we can transform
 * it cleanly into any target canvas size with a single scale + translate.
 *
 * Anatomy (top to bottom):
 *   - Crown: 3 merlons (battlements) sitting on a base bar
 *   - Collar: thin shelf below the crown
 *   - Neck:  narrows from collar to body
 *   - Body:  curved bell — narrow at top, flares outward at the bottom
 *   - Base:  wide slab with a stacked foot ring
 */
const ROOK_PATH = `
  M 220 80
  L 350 80 L 350 180 L 430 180 L 430 80 L 570 80
  L 570 180 L 650 180 L 650 80 L 780 80
  L 780 220
  L 820 240 L 820 290 L 180 290 L 180 240 L 220 220 Z
  M 290 290 L 710 290
  L 670 360 L 670 420
  C 670 510, 700 580, 740 660
  L 260 660
  C 300 580, 330 510, 330 420
  L 330 360 Z
  M 180 660 L 820 660
  L 820 760 L 880 760 L 880 880 L 120 880 L 120 760 L 180 760 Z
`.trim().replace(/\s+/g, ' ');

/**
 * Build a full icon SVG at the given internal size (drawing happens at
 * 0..1000 then mapped to viewBox; resvg rasterizes at the requested PNG size).
 *
 * Options:
 *   - bgRadius: corner radius of the background square (0..0.5 of size)
 *   - safeZone: 0..1 — how much of the canvas the icon occupies
 *                  (smaller = more padding; maskable wants ~0.6)
 *   - flat:    true to skip gradient/highlights (smaller files, harsher look)
 */
function buildSvg({ size, bgRadius = 0.22, safeZone = 0.78, flat = false } = {}) {
  const r = Math.round(size * bgRadius);
  // Map rook (0..1000) into a centered safe-zone box
  const iconBox = Math.round(size * safeZone);
  const offset = Math.round((size - iconBox) / 2);
  const scale = iconBox / 1000;

  const gradient = flat ? '' : `
    <linearGradient id="rookGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${HIGHLIGHT}"/>
      <stop offset="55%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${SHADOW}"/>
    </linearGradient>
    <radialGradient id="bgGlow" cx="0.5" cy="0.35" r="0.7">
      <stop offset="0%" stop-color="#142035" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
  `;

  const fill = flat ? ACCENT : 'url(#rookGrad)';
  const bgOverlay = flat ? '' : `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bgGlow)"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${gradient}</defs>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  ${bgOverlay}
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${ROOK_PATH}" fill="${fill}" stroke="${SHADOW}" stroke-width="8" stroke-linejoin="round"/>
  </g>
</svg>`;
}

function renderToPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)', // transparent outside the rounded rect
  });
  return resvg.render().asPng();
}

function ensureDir(p) { try { mkdirSync(p, { recursive: true }); } catch {} }
ensureDir(OUT_DIR);

const variants = [
  { file: 'icon-192.png',          size: 192, opts: { safeZone: 0.78 } },
  { file: 'icon-512.png',          size: 512, opts: { safeZone: 0.78 } },
  { file: 'icon-512-maskable.png', size: 512, opts: { safeZone: 0.58, bgRadius: 0 } },
  { file: 'icon-180.png',          size: 180, opts: { safeZone: 0.78 } }, // apple-touch
  { file: 'icon-favicon.png',      size: 64,  opts: { safeZone: 0.84, flat: true } },
];

for (const v of variants) {
  const svg = buildSvg({ size: v.size, ...v.opts });
  const png = renderToPng(svg, v.size);
  writeFileSync(resolve(OUT_DIR, v.file), png);
  console.log(`✓ ${v.file} (${v.size}x${v.size}, ${png.length.toLocaleString()} bytes)`);
}

// Also write the source SVG (handy if you ever want to edit by hand)
writeFileSync(resolve(OUT_DIR, 'icon-source.svg'), buildSvg({ size: 512, safeZone: 0.78 }));
console.log('✓ icon-source.svg');
console.log('\nTower icons generated in tower/.');
