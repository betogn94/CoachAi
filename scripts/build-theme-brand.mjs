// Genera la capa de tema GENÉRICA para coaches con marca propia (body.theme-brand)
// a partir de la capa de KING (body.theme-king), que ya está probada en producción.
//
// Por qué: cambiar solo branding_config.colors no alcanza — index.html tiene cientos
// de violetas/turquesas escritos a mano. KING lo resolvió con ~530 reglas propias.
// Este script las COPIA (sin tocarlas) cambiando:
//   - el selector: theme-king → theme-brand (solo las partes de la lista que lo
//     mencionan; una regla "body .x, body.theme-king .x" aporta solo la segunda)
//   - cada rosa de KING → una variable --brand-* que applyTenantBranding carga
//     desde branding_config.colors del tenant.
// El resultado va entre marcadores THEME-BRAND en un <style> propio, después del
// último <style> de index.html (así gana en la cascada igual que gana KING).
//
// Uso:  npm run theme:brand          → regenera el bloque
//       npm run theme:brand:check    → falla si el bloque quedó desactualizado
import fs from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const START = '<style id="theme-brand-css">';
const END = '</style><!-- /THEME-BRAND -->';

let html = fs.readFileSync(FILE, 'utf8');
// Sacar el bloque generado anterior antes de leer los estilos (idempotente).
const prev = html.indexOf(START);
if (prev !== -1) html = html.slice(0, prev).replace(/\n$/, '') + html.slice(html.indexOf(END, prev) + END.length);

// ---- 1. Juntar el CSS de todos los <style> en orden ----
const styles = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(m => m[1]);
const css = styles.join('\n');

// ---- 2. Parser mínimo: árbol de reglas y at-rules con bloques ----
function parse(src) {
  let i = 0;
  function skipWs() {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue; }
      break;
    }
  }
  function readUntil(stops) {
    let out = '', depth = 0, q = null;
    while (i < src.length) {
      const c = src[i];
      if (q) { out += c; if (c === '\\') { out += src[++i] || ''; } else if (c === q) q = null; i++; continue; }
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (depth === 0 && stops.includes(c)) break;
      out += c; i++;
    }
    return out;
  }
  function block() {
    const nodes = [];
    for (;;) {
      skipWs();
      if (i >= src.length || src[i] === '}') { i++; return nodes; }
      const prelude = readUntil(['{', ';', '}']).trim();
      if (src[i] === ';') { i++; nodes.push({ type: 'stmt', text: prelude }); continue; }
      if (src[i] === '}') { if (prelude) nodes.push({ type: 'decls', text: prelude }); i++; return nodes; }
      i++; // '{'
      if (prelude.startsWith('@') && /^@(media|supports|container|layer|document)\b/i.test(prelude)) {
        nodes.push({ type: 'group', prelude, children: block() });
      } else if (prelude.startsWith('@')) {
        const body = readBalanced();
        nodes.push({ type: 'atblock', prelude, body });
      } else {
        const body = readBalanced();
        nodes.push({ type: 'rule', selector: prelude, body });
      }
    }
  }
  function readBalanced() {
    let depth = 1, out = '', q = null;
    while (i < src.length) {
      const c = src[i];
      if (q) { out += c; if (c === '\\') { out += src[++i] || ''; } else if (c === q) q = null; i++; continue; }
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") q = c;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { i++; return out; } }
      out += c; i++;
    }
    return out;
  }
  return block();
}

function splitSelectors(sel) {
  const parts = []; let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ---- 3. Colores de KING → variables de marca ----
// Sólidos y sus versiones transparentes. Los rgb() van como "r, g, b" para usar
// rgba(var(--brand-a-rgb), α).
const SOLIDS = [
  ['ff4f7b', 'a'],   // acento principal (coral KING)
  ['ff6b95', 'ab'],  // acento claro
  ['e03a6f', 'a3'],  // acento profundo (degradados, success de KING)
  ['fff0f4', 's2'],  // fondo de tarjeta suave
  ['fdf7f8', 'bg'],  // fondo crema de KING
  ['ff92ae', 'ab'],  // rosa claro secundario
  ['c42960', 'a3'],  // rosa profundo secundario
];
const RGB = { a: '255,79,123', ab: '255,107,149', a3: '224,58,111', s2: '255,240,244', bg: '253,247,248' };
const RGB_EXTRA = [['250,181,173', 'ab']];  // brillo durazno de KING

function recolor(text) {
  let out = text;
  for (const [hex, k] of SOLIDS) out = out.replace(new RegExp('#' + hex + '\\b', 'gi'), `var(--brand-${k})`);
  for (const [k, rgb] of [...Object.entries(RGB), ...RGB_EXTRA.map(([rgb, k]) => [k, rgb])]) {
    const [r, g, b] = rgb.split(',');
    const re = new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*(,\\s*([0-9.]+%?)\\s*)?\\)`, 'gi');
    out = out.replace(re, (_m, _a, alpha) => alpha ? `rgba(var(--brand-${k}-rgb), ${alpha})` : `rgb(var(--brand-${k}-rgb))`);
  }
  return out;
}

// ---- 4. Recorrer el árbol y clonar lo de KING ----
// Imágenes y cosas que son de KING como marca (logos, kettlebell rosa, fotos): no se
// copian; el coach trae lo suyo por branding_config.
const SKIP_DECL = /url\(\s*['"]?\/tenants\/jesus\//i;
const PINK = /#ff4f7b|#ff6b95|#e03a6f|255\s*,\s*79\s*,\s*123|255\s*,\s*107\s*,\s*149|224\s*,\s*58\s*,\s*111/i;
let count = 0;

// Animaciones con rosa: cada @keyframes que pinta rosa tiene su gemela "__brand"
// recoloreada, y las reglas de marca apuntan a la gemela.
const keyframes = [];
const kfNames = new Set();
(function findKf(nodes) {
  for (const n of nodes) {
    if (n.type === 'group') findKf(n.children);
    const m = n.type === 'atblock' && n.prelude.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/i);
    if (m && PINK.test(n.body) && !kfNames.has(m[1])) {
      kfNames.add(m[1]);
      keyframes.push(`@keyframes ${m[1]}__brand {${recolor(n.body)}}`);
    }
  }
})(parse(css));
const renameKf = d => [...kfNames].reduce((s, k) => s.replace(new RegExp(`\\b${k}\\b`, 'g'), `${k}__brand`), d);
function walk(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'rule') {
      const parts = splitSelectors(n.selector).filter(s => /theme-king/.test(s));
      if (!parts.length) continue;
      const sel = parts.map(s => s.replace(/theme-king/g, 'theme-brand')).join(',\n');
      const decls = n.body.split(';').map(d => d.trim()).filter(d => d && !SKIP_DECL.test(d));
      if (!decls.length) continue;
      out.push(`${sel} {\n  ${decls.map(d => renameKf(recolor(d))).join(';\n  ')};\n}`);
      count++;
    } else if (n.type === 'group') {
      const inner = walk(n.children);
      if (inner.length) out.push(`${n.prelude} {\n${inner.join('\n')}\n}`);
    }
  }
  return out;
}
const generated = walk(parse(css));

// Ajustes propios de la capa de marca (escritos a mano). Casos donde copiar KING no
// alcanza porque el acento de un coach puede ser OSCURO (KING es un rosa medio):
// encontrados en el QA de qa-coach con los colores de Salma (2026-10-26).
const PATCHES = `
/* Pastilla "HOY" en Mi Entreno: la regla general "body.theme-brand div {color:var(--text)}"
   le pinta el texto del color del acento → con un acento oscuro queda negro sobre negro. */
body.theme-brand .cai-entv2-card-hoy { color: #fff !important; }
/* Día seleccionado de Mi Alimentación: el botón es blanco sobre el degradado del
   acento, pero sus span (día y número) heredaban --text por la misma regla general. */
body.theme-brand .alimv2-day.sel .dw,
body.theme-brand .alimv2-day.sel .dn { color: #fff !important; }
/* Puntito del pie del menú: el brillo base es turquesa (KING nunca lo pisó). */
@keyframes navFooterPulse__brand {
  0%   { box-shadow: 0 0 0 0 rgba(var(--brand-ab-rgb), 0.55); }
  70%  { box-shadow: 0 0 0 10px rgba(var(--brand-ab-rgb), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--brand-ab-rgb), 0); }
}
body.theme-brand .nav-footer-pulse { animation-name: navFooterPulse__brand !important; }`;

const block = `${START}
/* ============================================================
   GENERADO por scripts/build-theme-brand.mjs — NO editar a mano.
   Capa de tema genérica para coaches con marca propia: copia de
   body.theme-king con los rosas de KING pasados a variables
   --brand-* (las carga applyTenantBranding desde
   branding_config.colors). KING no usa esta capa.
   Regenerar: npm run theme:brand   (${count} reglas)
   ============================================================ */
${keyframes.join('\n')}
${generated.join('\n')}
${PATCHES}
${END}`;

const last = html.lastIndexOf('</style>');
const next = html.slice(0, last + '</style>'.length) + '\n' + block + html.slice(last + '</style>'.length);

if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(FILE, 'utf8');
  // CRLF/LF no cuenta: bump-version y git en Windows pueden cambiar los finales de línea.
  if (cur.replace(/\r/g, '') !== next.replace(/\r/g, '')) { console.error('theme-brand desactualizado: correr npm run theme:brand'); process.exit(1); }
  console.log(`theme-brand OK (${count} reglas)`);
} else {
  fs.writeFileSync(FILE, next);
  console.log(`theme-brand generado: ${count} reglas`);
}
