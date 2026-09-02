// Test del CLAMP de kcal (Fase 3) — extrae las funciones REALES de index.html
// (mismo extractor que scripts/test-parsers.mjs) y corre escenarios del clamp.
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const INDEX_HTML = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré la función ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  let inLine = false, inBlock = false, inStr = false, strCh = '';
  let inTmpl = false, inRegex = false, inClass = false;
  let prevSig = '';
  for (; i < src.length; i++) {
    const c = src[i], c2 = src[i + 1];
    if (inLine)  { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; i++; } continue; }
    if (inStr)   { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
    if (inTmpl)  { if (c === '\\') { i++; continue; } if (c === '`') inTmpl = false; continue; }
    if (inRegex) {
      if (c === '\\') { i++; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) inRegex = false;
      continue;
    }
    if (c === '/' && c2 === '/') { inLine = true; i++; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '`') { inTmpl = true; continue; }
    if (c === '/') {
      if (prevSig === '' || '=(,:;[!&|?{}+-*%~^<>'.includes(prevSig)) { inRegex = true; continue; }
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    if (!/\s/.test(c)) prevSig = c;
  }
  throw new Error(`Llaves desbalanceadas en ${name}`);
}

const html = readFileSync(INDEX_HTML, 'utf8');
const fns = ['parseRutinaContenido', 'parseDietaContenido', 'computeDietTarget', 'dietaAvgDayKcal', 'evaluatePlanQuality']
  .map(n => extractFunction(html, n)).join('\n\n');
const factory = new Function(`"use strict"; let lang='es'; ${fns};
  return { parseDietaContenido, computeDietTarget, dietaAvgDayKcal, evaluatePlanQuality };`);
const { parseDietaContenido, computeDietTarget, dietaAvgDayKcal, evaluatePlanQuality } = factory();

// ── Dietas sintéticas ──────────────────────────────────────────────────────
function mkDieta(targetHeader, mealKcal, protDia) {
  // 7 días, 4 comidas de mealKcal. Proteína del día parametrizable (para que
  // las dietas "correctas" cumplan también la regla de proteína de la vara);
  // el resto se llena con C/G coherentes para que kcal ≈ 4P+4C+9G y parsee.
  const dias = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO','DOMINGO'];
  const p = Math.max(1, Math.round((protDia || mealKcal * 4 * 0.30 / 4) / 4));
  const resto = Math.max(40, mealKcal - p * 4);
  const c = Math.max(1, Math.round(resto * 0.65 / 4));
  const g = Math.max(1, Math.round(resto * 0.35 / 9));
  const linea = t => `${t}: pollo con arroz — ${mealKcal}cal · P:${p}g C:${c}g G:${g}g`;
  return `Plan nutricional — Test | Target: ${targetHeader} kcal/día | P:150g C:200g G:60g\n\n` +
    dias.map(d => `${d}\n${linea('Des')}\n${linea('Alm')}\n${linea('Mer')}\n${linea('Cena')}\nTotal: ${mealKcal * 4}kcal · P:${p*4}g C:${c*4}g G:${g*4}g`).join('\n\n');
}

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? ` — ${extra}` : ''));
  if (!cond) fails++;
}

// Perfil tipo Roxana: mujer 53a, 56kg, 153cm, definir
const target = computeDietTarget({ peso: 56, altura: 153, edad: 53, sexo: 'femenino', objetivo: 'definir', actividad: 'leve' });
console.log('\nTarget determinístico (perfil tipo Roxana):', JSON.stringify(target));
check('target calculado y con floor respetado', target && target.kcal >= 1200 && target.kcal < 1600);

// 1) dietaAvgDayKcal mide bien
const dietaOk = mkDieta(target.kcal, Math.round(target.kcal / 4), target.prot);
const avgOk = dietaAvgDayKcal(parseDietaContenido(dietaOk));
check('dietaAvgDayKcal ≈ target en dieta correcta', Math.abs(avgOk - target.kcal) / target.kcal < 0.02, `avg=${avgOk}`);

// 2) dieta EN target → la vara la deja pasar (sin falso positivo)
const q1 = evaluatePlanQuality('dieta', dietaOk, { target });
check('vara ACEPTA dieta en target', q1.ok, q1.reasons.join('|'));

// 3) dieta Roxana-style (2500 kcal para target ~1300) → la vara la caza
const dietaRox = mkDieta(2500, 625);
const q2 = evaluatePlanQuality('dieta', dietaRox, { target });
check('vara RECHAZA dieta +90% del target', !q2.ok && q2.reasons.includes('kcal lejos del target'), q2.reasons.join('|'));

// 4) dieta SUB-porcionada (Haiku clásico: -35%) → también la caza
const dietaSub = mkDieta(target.kcal, Math.round(target.kcal * 0.65 / 4));
const q3 = evaluatePlanQuality('dieta', dietaSub, { target });
check('vara RECHAZA dieta -35% del target', !q3.ok && q3.reasons.includes('kcal lejos del target'), q3.reasons.join('|'));

// 5) clamp del auto-ajuste: réplica exacta de la expresión de autoAdjustDiet
function autoAdjustClamped(prevContent, adjContent) {
  const _prevP = parseDietaContenido(prevContent);
  const _refK = (_prevP && _prevP.header && _prevP.header.targetKcal) || dietaAvgDayKcal(_prevP);
  const _adjP = parseDietaContenido(adjContent);
  const _adjK = dietaAvgDayKcal(_adjP) || (_adjP && _adjP.header && _adjP.header.targetKcal);
  return !!(_refK && _adjK && Math.abs(_adjK - _refK) / _refK > 0.15);
}
const prev = mkDieta(1385, 346); // dieta del coach a 1385
check('auto-ajuste: drift chico (−6%) PASA', !autoAdjustClamped(prev, mkDieta(1300, 325)));
check('auto-ajuste: drift grande (+80%) CLAMPEADO', autoAdjustClamped(prev, mkDieta(2500, 625)));
check('auto-ajuste: sin datos medibles → fail-open (pasa)', !autoAdjustClamped(prev, 'texto sin dieta'));

// 6) header miente pero comidas reales OK → la vara mide las COMIDAS, no el header
const dietaHeaderMentiroso = mkDieta(9999, Math.round(target.kcal / 4), target.prot);
const q4 = evaluatePlanQuality('dieta', dietaHeaderMentiroso, { target });
check('vara ignora header mentiroso si las comidas están en target', q4.ok, q4.reasons.join('|'));

console.log(fails ? `\n❌ ${fails} FALLAS` : '\n✅ Todo verde');
process.exit(fails ? 1 : 0);
