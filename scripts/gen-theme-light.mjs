// Genera el bloque body.theme-light a partir de TODAS las reglas body.theme-king
// del index.html, cambiando coral/rosa → violeta. King queda intacto (solo
// LEEMOS sus reglas y emitimos gemelas theme-light). Excluye swaps de logo.
import fs from 'node:fs';

const SRC = 'index.html';
const OUT = 'scripts/theme-light-generated.css';

const html = fs.readFileSync(SRC, 'utf8');

// --- Mapa de colores coral(King) → violeta(default) ---
function transformColors(txt) {
  let s = txt;
  // rgba coral (con y sin espacios) → violeta
  s = s.replace(/rgba\(\s*255\s*,\s*79\s*,\s*123/g, 'rgba(124, 106, 255');
  s = s.replace(/rgba\(\s*255\s*,\s*107\s*,\s*149/g, 'rgba(124, 106, 255');
  s = s.replace(/rgba\(\s*224\s*,\s*58\s*,\s*111/g, 'rgba(90, 72, 224');
  s = s.replace(/rgb\(\s*255\s*,\s*79\s*,\s*123\s*\)/g, 'rgb(124, 106, 255)');
  // hex coral → violeta (case-insensitive)
  const hexMap = {
    'ff4f7b': '7c6aff',  // accent coral → violeta
    'ff6b95': '9d8dff',  // accent-bright → violeta claro
    'e03a6f': '5a48e0',  // accent-deep → violeta profundo
    'fff0f4': 'f1effe',  // surface2 tint
    'fff7f8': 'f5f3ff',
    'fafafb': 'fafaff',  // bg
    'ececf1': 'e9e7f5',  // border
    'f3f1eb': 'f4f3ff',  // ko-cream → blanco violeta
    'ddd7c9': 'e3e0f2',  // ko-prog track
    '1a1917': '1a1a2e',  // ko-ink (queda oscuro, correcto en claro)
    '8c877e': '6b6b80',  // ko-muted
    'e4e0d6': 'e9e7f5',  // ko-line
    'fdf7f8': 'faf9ff',  // bottom-nav band
  };
  for (const [from, to] of Object.entries(hexMap)) {
    s = s.replace(new RegExp('#' + from, 'gi'), '#' + to);
  }
  // Animation-names de King → equivalentes violeta. Los @keyframes NO se
  // scopean por tema: si la regla light apunta a un keyframe *KING (coral),
  // el coral se cuela en el tema claro (pasó con el glow del logo del login).
  s = s.replace(/landingIconGlowKING/g, 'landingIconGlow');
  s = s.replace(/typingPulseKing/g, 'typingPulseLight');   // keyframe violeta definido a mano en el bloque Etapa 1
  return s;
}

// --- Parser CSS recursivo (balance de llaves, saltea comentarios) ---
function parseRules(css) {
  const rules = [];
  let i = 0; const n = css.length;
  while (i < n) {
    // saltar espacios/comentarios al inicio del prelude
    let j = i;
    let found = false;
    while (j < n) {
      if (css[j] === '/' && css[j+1] === '*') { const e = css.indexOf('*/', j+2); j = e === -1 ? n : e + 2; continue; }
      if (css[j] === '{' || css[j] === '}' || css[j] === ';') { found = true; break; }
      j++;
    }
    if (j >= n) break;
    if (css[j] === '}') { i = j + 1; continue; }
    if (css[j] === ';') { i = j + 1; continue; } // @import u otra at-rule sin bloque
    const prelude = css.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    let depth = 1, k = j + 1;
    while (k < n && depth > 0) {
      if (css[k] === '/' && css[k+1] === '*') { const e = css.indexOf('*/', k+2); k = e === -1 ? n : e + 2; continue; }
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      k++;
    }
    const inner = css.slice(j + 1, k - 1);
    rules.push({ prelude, inner });
    i = k;
  }
  return rules;
}

function selectorHasKing(sel) { return /\.theme-king\b/.test(sel); }

// Split por comas de NIVEL SUPERIOR (respeta () y [] → no rompe :is(a,b), :has(), [attr]).
function splitTopLevel(sel) {
  const parts = []; let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// prelude agrupado (a, b, c) → quedarse SOLO con las partes theme-king, → light
function kingSelectorToLight(prelude) {
  const parts = splitTopLevel(prelude).map(p => p.trim()).filter(Boolean);
  const kept = parts.filter(p => selectorHasKing(p)).map(p => p.replace(/\.theme-king\b/g, '.theme-light'));
  return kept.length ? kept.join(',\n') : null;
}

let ruleCount = 0, skippedLogo = 0;
function emitRules(css, indent = '') {
  let out = '';
  for (const { prelude, inner } of parseRules(css)) {
    if (/^@(media|supports)/i.test(prelude)) {
      const innerOut = emitRules(inner, indent + '  ');
      if (innerOut.trim()) out += `${indent}${prelude} {\n${innerOut}${indent}}\n`;
      continue;
    }
    if (/^@/.test(prelude)) continue; // @keyframes etc — no re-tematizar
    if (!selectorHasKing(prelude)) continue;
    // Excluir swaps de logo (el default ya tiene el suyo). Mantener king-onb (fotos).
    if (/tenants\/jesus\/(logo|icon)/i.test(inner)) { skippedLogo++; continue; }
    const lightSel = kingSelectorToLight(prelude);
    if (!lightSel) continue;
    const body = transformColors(inner).trim();
    out += `${indent}${lightSel} {\n${indent}  ${body}\n${indent}}\n`;
    ruleCount++;
  }
  return out;
}

// Procesar TODOS los <style> del documento
let generated = '';
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
let m;
while ((m = styleRe.exec(html)) !== null) {
  generated += emitRules(m[1]);
}

// Chequeos de sanidad
const residualKing = (generated.match(/theme-king/g) || []).length;
const residualCoralHex = (generated.match(/#(ff4f7b|ff6b95|e03a6f)/gi) || []).length;
const residualCoralRgba = (generated.match(/(255,\s*79,\s*123|255,\s*107,\s*149|224,\s*58,\s*111)/g) || []).length;

const header = `/* ============================================================
   DEFAULT LIGHT THEME · reglas generadas desde theme-king (violeta)
   Autogenerado por scripts/gen-theme-light — NO editar a mano.
   ${ruleCount} reglas. Coral→violeta. Logos King excluidos (${skippedLogo}).
   ============================================================ */\n`;
fs.writeFileSync(OUT, header + generated, 'utf8');

console.log('Reglas theme-light generadas:', ruleCount);
console.log('Reglas de logo excluidas:', skippedLogo);
console.log('Residual "theme-king" (debe ser 0):', residualKing);
console.log('Residual coral hex (debe ser 0):', residualCoralHex);
console.log('Residual coral rgba (debe ser 0):', residualCoralRgba);
console.log('Tamaño output:', (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
console.log('Output:', OUT);
