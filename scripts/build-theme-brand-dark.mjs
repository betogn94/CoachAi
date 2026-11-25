// Genera la capa de tema OSCURO para coaches con marca propia (body.theme-brand-dark).
// Primer uso: Team Arete (negro + rojo, 2026-11-24).
//
// Idea: el tema oscuro ORIGINAL de la app (las reglas base, sin clase de tema) ya está
// completo, pero pinta violeta/lila/azul/turquesa a mano en cientos de reglas y sus
// grises oscuros tiran a azul marino. Este script copia, de cada regla base, SOLO las
// declaraciones de color, bajo body.theme-brand-dark, cambiando:
//   - violeta  #7c6aff → var(--bd-a)  (acento del coach)
//   - lila     #b4a7ff → var(--bd-ab) (acento claro)
//   - azul     #5b9fff → var(--bd-a2) (acento profundo, 2ª parada de degradados)
//   - turquesa #2ecfb5 → var(--bd-t)  (tercer tono / éxito)
//   - grises y negros azulados → el mismo gris pero neutro.
// Copia TODAS las declaraciones de color (aunque no cambien) para que el orden entre
// reglas quede igual que en el tema base (la capa le suma la misma especificidad a todas).
// No toca el tema claro, ni KING, ni theme-brand: solo aplica con esa clase en <body>.
//
// Uso:  npm run theme:brand-dark          → regenera el bloque
//       npm run theme:brand-dark:check    → falla si quedó desactualizado
import fs from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const START = '<style id="theme-brand-dark-css">';
const END = '/* /THEME-BRAND-DARK */</style>'; // el cierre va DENTRO: build-theme-brand.mjs se engancha del último '</style>'
const BRAND_START = '<style id="theme-brand-css">';

let html = fs.readFileSync(FILE, 'utf8');
const prev = html.indexOf(START);
if (prev !== -1) html = html.slice(0, prev).replace(/\r?\n$/, '') + html.slice(html.indexOf(END, prev) + END.length);

const styles = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(m => m[1]);
const css = styles.join('\n');

// ---- Parser mínimo (copia del de build-theme-brand.mjs) ----
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
// Separa declaraciones por ';' sin romper url(data:...;base64,...) ni strings.
function splitDecls(body) {
  const out = []; let depth = 0, q = null, cur = '';
  for (const c of body) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---- Colores ----
const BRAND = [
  [124, 106, 255, 'a'],
  [180, 167, 255, 'ab'],
  [91, 159, 255, 'a2'],
  [46, 207, 181, 't'],
];
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
// Gris/negro azulado (fondos navy, textos lavanda apagados) → gris neutro de igual brillo.
function neutral(r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  if (s < 0.04) return null;                               // ya es neutro
  if (!(h >= 200 && h <= 290)) return null;                // solo azules/violetas
  if (!(l < 0.22 || (s < 0.30 && l < 0.75))) return null;  // oscuros o apagados, no acentos
  const y = 0.299 * r + 0.587 * g + 0.114 * b;             // mismo brillo percibido
  return [y, y, y];
}
function mapColor(r, g, b) {
  for (const [R, G, B, k] of BRAND) if (r === R && g === G && b === B) return { v: k };
  const n = neutral(r, g, b);
  return n ? { rgb: n } : null;
}
let changed = 0;
function recolor(text) {
  let out = text.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+%?)\s*)?\)/gi, (m, r, g, b, a) => {
    const x = mapColor(+r, +g, +b); if (!x) return m; changed++;
    if (x.v) return a != null ? `rgba(var(--bd-${x.v}-rgb), ${a})` : `rgb(var(--bd-${x.v}-rgb))`;
    const [R, G, B] = x.rgb.map(Math.round);
    return a != null ? `rgba(${R}, ${G}, ${B}, ${a})` : `rgb(${R}, ${G}, ${B})`;
  });
  out = out.replace(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi, (m) => {
    const x = mapColor(...hexToRgb(m)); if (!x) return m; changed++;
    return x.v ? `var(--bd-${x.v})` : toHex(...x.rgb);
  });
  return out;
}

// ---- Selectores ----
// Fuera de :not(...), mencionar otro tema = la regla es de ese tema → no va.
const OTHER_THEME = /theme-(king|brand|light)\b/;
const stripNot = s => s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
function scope(sel) {
  if (OTHER_THEME.test(stripNot(sel))) return null;
  // ":not(.theme-king)" y similares son siempre ciertos bajo esta capa → se sacan (si
  // quedaran, build-theme-brand.mjs copiaría estas reglas creyéndolas de KING).
  sel = sel.replace(/:not\(\s*\.theme-(king|brand|light)(\s*,\s*\.theme-(king|brand|light))*\s*\)/g, '');
  if (/theme-(king|brand|light)\b/.test(sel)) return null;
  if (/^:root\b/.test(sel)) return null;                    // variables: las pone applyTenantBranding
  if (/^html\b/.test(sel)) return sel.replace(/^html/, 'html:has(> body.theme-brand-dark)');
  if (/^body\b/.test(sel)) return sel.replace(/^body/, 'body.theme-brand-dark');
  return 'body.theme-brand-dark ' + sel;
}
const COLOR_PROP = /^(--[\w-]+|color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|box-shadow|text-shadow|fill|stroke|outline(-color)?|caret-color|text-decoration(-color)?|accent-color|filter|-webkit-text-fill-color|-webkit-text-stroke(-color)?)$/i;
const HAS_COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(--|\b(white|black|transparent|currentcolor)\b/i;

// ---- Keyframes con colores que cambian → gemelas "__bd" ----
const tree = parse(css);
const kf = [], kfNames = new Set();
(function findKf(nodes) {
  for (const n of nodes) {
    if (n.type === 'group') findKf(n.children);
    const m = n.type === 'atblock' && n.prelude.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/i);
    if (m && !kfNames.has(m[1])) {
      const before = changed, body = recolor(n.body);
      if (changed > before) { kfNames.add(m[1]); kf.push(`@keyframes ${m[1]}__bd {${body}}`); }
    }
  }
})(tree);
const kfRe = kfNames.size ? new RegExp(`\\b(${[...kfNames].join('|')})\\b`) : null;

let count = 0;
function walk(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'rule') {
      const parts = splitSelectors(n.selector).map(scope).filter(Boolean);
      if (!parts.length) continue;
      const decls = [], bgLong = [];
      for (const d of splitDecls(n.body)) {
        // Longhands de fondo SIN color (clip, size, position…): el shorthand "background"
        // copiado los resetea, así que si la regla copia un fondo, van con él (si no, los
        // textos con degradado "background-clip:text" se vuelven bloques de color).
        if (/^(-webkit-)?background-(clip|origin|size|position|position-x|position-y|repeat|attachment|blend-mode)\s*:/i.test(d)) { bgLong.push(decls.length); decls.push(d); continue; }
        const c = d.indexOf(':'); if (c < 0) continue;
        const prop = d.slice(0, c).trim();
        if (/^animation(-name)?$/i.test(prop)) {
          if (kfRe && kfRe.test(d)) decls.push(d.replace(new RegExp(kfRe.source, 'g'), '$1__bd'));
          continue;
        }
        if (!COLOR_PROP.test(prop) || !HAS_COLOR.test(d)) continue;
        if (/url\(/i.test(d)) continue;                          // imágenes: quedan como en la base
        decls.push(recolor(d));
      }
      // Los longhands quedan en su lugar original, solo si la regla copia un shorthand de fondo.
      if (!decls.some(d => /^background\s*:/i.test(d))) for (const i of bgLong.reverse()) decls.splice(i, 1);
      if (!decls.length) continue;
      out.push(`${parts.join(',\n')} {\n  ${decls.join(';\n  ')};\n}`);
      count++;
    } else if (n.type === 'group') {
      const inner = walk(n.children);
      if (inner.length) out.push(`${n.prelude} {\n${inner.join('\n')}\n}`);
    }
  }
  return out;
}
const generated = walk(tree);

// Ajustes a mano (casos donde copiar no alcanza). Se suman con el QA visual.
const PATCHES = `
/* Valores por defecto de la capa (violeta) por si el tenant no trae colores. Van en
   :root (no en body) para que los del tenant, puestos en el style de <html>, ganen. */
:root {
  --bd-a: #7c6aff; --bd-a-rgb: 124, 106, 255;
  --bd-ab: #b4a7ff; --bd-ab-rgb: 180, 167, 255;
  --bd-a2: #5b9fff; --bd-a2-rgb: 91, 159, 255;
  --bd-t: #2ecfb5; --bd-t-rgb: 46, 207, 181;
}
/* SVG con colores como ATRIBUTO (degradados de los anillos, íconos): el CSS gana a
   los atributos de presentación, así que alcanza con apuntar al valor del atributo. */
${[['7c6aff', 'a'], ['b4a7ff', 'ab'], ['5b9fff', 'a2'], ['2ecfb5', 't']].map(([h, k]) => [
  `body.theme-brand-dark [stop-color="#${h}" i] { stop-color: var(--bd-${k}) !important; }`,
  `body.theme-brand-dark [stroke="#${h}" i] { stroke: var(--bd-${k}) !important; }`,
  `body.theme-brand-dark [fill="#${h}" i] { fill: var(--bd-${k}) !important; }`,
].join('\n')).join('\n')}`;

const block = `${START}
/* ============================================================
   GENERADO por scripts/build-theme-brand-dark.mjs — NO editar a mano.
   Tema OSCURO para coaches con marca propia (body.theme-brand-dark):
   las reglas de color del tema base con violeta/lila/azul/turquesa
   pasados a --bd-* (los carga applyTenantBranding desde
   branding_config.colors) y los grises azulados pasados a neutros.
   Regenerar: npm run theme:brand-dark   (${count} reglas)
   ============================================================ */
${PATCHES}
${kf.join('\n')}
${generated.join('\n')}
${END}`;

// Va ANTES del bloque theme-brand (build-theme-brand.mjs siempre lo deja último).
const at = html.indexOf(BRAND_START);
let next;
if (at !== -1) next = html.slice(0, at) + block + '\n' + html.slice(at);
else { const l = html.lastIndexOf('</style>') + '</style>'.length; next = html.slice(0, l) + '\n' + block + html.slice(l); }

if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(FILE, 'utf8');
  if (cur.replace(/\r/g, '') !== next.replace(/\r/g, '')) { console.error('theme-brand-dark desactualizado: correr npm run theme:brand-dark'); process.exit(1); }
  console.log(`theme-brand-dark OK (${count} reglas)`);
} else {
  fs.writeFileSync(FILE, next);
  console.log(`theme-brand-dark generado: ${count} reglas, ${kf.length} keyframes, ${changed} colores cambiados`);
}
