// Recolorea un logo nuestro (degradado violeta → azul → turquesa) a los colores de
// un coach, conservando brillo, sombras y transparencia. Usa ffmpeg (PNG ↔ RGBA crudo).
// Primer uso: Team Arete, rojo → naranja (2026-11-25).
//
// Uso: node scripts/recolor-logo.mjs <entrada.png> <salida.png> <#colorVioleta> <#colorTurquesa>
//   El extremo violeta del degradado toma el 1er color y el turquesa el 2º; el medio
//   (azul) queda entre los dos. Los píxeles grises/blancos no se tocan.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , inp, out, hexA, hexB] = process.argv;
if (!inp || !out || !hexA || !hexB) { console.error('uso: recolor-logo.mjs in.png out.png #aaaaaa #bbbbbb'); process.exit(1); }

const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', inp]).toString().trim().split(',').map(Number);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', inp, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });

const hex = s => { const n = parseInt(s.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
}
function toRgb(hh, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
}
const [hA, sA, lA] = toHsl(...hex(hexA));
const [hB, sB, lB] = toHsl(...hex(hexB));
// Distancia de tono con signo (para interpolar por el camino corto: 357° → 25° pasa por 0°).
const dh = ((hB - hA + 540) % 360) - 180;
// Brillo de referencia del degradado original en cada extremo (violeta #7c6aff / turquesa #2ecfb5).
const L_V = toHsl(124, 106, 255)[2], L_T = toHsl(46, 207, 181)[2];

let changed = 0;
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i + 3] === 0) continue;
  const [hh, s, l] = toHsl(raw[i], raw[i + 1], raw[i + 2]);
  if (s < 0.18 || hh < 150 || hh > 300) continue;           // grises / blancos / otros: igual
  const t = Math.min(1, Math.max(0, (265 - hh) / (265 - 172))); // 0 = violeta, 1 = turquesa
  const nh = (hA + dh * t + 360) % 360;
  const ns = Math.min(1, (sA + (sB - sA) * t) * Math.min(1, s / 0.85));
  // Conserva sombras y brillos: escala la luz del píxel respecto a la del degradado original.
  const lRef = L_V + (L_T - L_V) * t, lNew = lA + (lB - lA) * t;
  const nl = Math.min(0.95, Math.max(0, l * (lNew / lRef)));
  [raw[i], raw[i + 1], raw[i + 2]] = toRgb(nh, ns, nl);
  changed++;
}
const tmp = path.join(os.tmpdir(), `recolor-${process.pid}.raw`);
fs.writeFileSync(tmp, raw);
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', tmp, '-compression_level', '9', out]);
fs.unlinkSync(tmp);
console.log(`${out}: ${w}x${h}, ${changed} píxeles recoloreados`);
