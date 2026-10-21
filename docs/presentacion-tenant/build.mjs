// Genera CoachAI-Pro-Presentacion.html: un solo archivo con las imágenes incrustadas (base64).
// Uso: node docs/presentacion-tenant/build.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'index.html'), 'utf8');
const mime = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
let n = 0;
const out = src.replace(/src="(img\/[^"]+)"/g, (m, p) => {
  const file = resolve(here, p);
  const b64 = readFileSync(file).toString('base64');
  n++;
  return `src="data:${mime[extname(p).toLowerCase()]};base64,${b64}"`;
});
const dest = resolve(here, 'CoachAI-Pro-Presentacion.html');
writeFileSync(dest, out);
// Copia servida públicamente en coachaipro.ai/presentacion (docs/ está excluida de Vercel).
const pub = resolve(here, '..', '..', 'presentacion.html');
writeFileSync(pub, out);
console.log(`OK · ${n} imágenes incrustadas · ${(statSync(dest).size / 1024 / 1024).toFixed(2)} MB → ${dest}\n   + copia pública → ${pub}`);
