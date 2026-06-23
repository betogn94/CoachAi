// ============================================================================
// CHECK-QUALITY — prototipo OFFLINE de la "vara de calidad" de planes.
// ============================================================================
// No toca nada del flujo en vivo. Extrae los parsers REALES de index.html y
// corre evaluatePlanQuality() sobre planes de muestra para validar que:
//   - un plan de Jesús (migrado) PASA la vara
//   - un plan flojo (sin kcal / pocos ejercicios) FALLA con razones claras
//
// Uso:  node scripts/check-quality.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, '..', 'index.html');
const MIGRA = join(__dirname, '..', '..', '..', 'AppData', 'Local', 'Temp', 'migra_king');

// — extractor de funciones (brace-matcher que ignora comentarios/strings/templates) —
function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré ${name} en index.html`);
  let i = src.indexOf('{', start);
  let depth = 0, inLine = false, inBlock = false, inStr = false, strCh = '';
  let inTmpl = false, inRegex = false, inClass = false, prevSig = '';
  for (; i < src.length; i++) {
    const c = src[i], c2 = src[i + 1];
    if (inLine)  { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; i++; } continue; }
    if (inStr)   { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
    if (inTmpl)  { if (c === '\\') { i++; continue; } if (c === '`') inTmpl = false; continue; }
    if (inRegex) { if (c === '\\') { i++; continue; } if (c === '[') inClass = true; else if (c === ']') inClass = false; else if (c === '/' && !inClass) inRegex = false; continue; }
    if (c === '/' && c2 === '/') { inLine = true; i++; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '`') { inTmpl = true; continue; }
    if (c === '/') { if (prevSig === '' || '=(,:;[!&|?{}+-*%~^<>'.includes(prevSig)) { inRegex = true; continue; } }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    if (!/\s/.test(c)) prevSig = c;
  }
  throw new Error(`Llaves desbalanceadas en ${name}`);
}

const html = readFileSync(INDEX_HTML, 'utf8');
const fns = ['parseRutinaContenido', 'parseDietaContenido']
  .map(n => extractFunction(html, n)).join('\n\n');
const { parseRutinaContenido, parseDietaContenido } =
  new Function(`"use strict"; let lang='es'; ${fns}
    return { parseRutinaContenido, parseDietaContenido };`)();

// ============================================================================
// computeDietTarget — mismo Mifflin-St Jeor que el system prompt (standalone)
// ============================================================================
function computeDietTarget(p) {
  const peso = parseFloat(p.peso), altura = parseFloat(p.altura), edad = parseInt(p.edad, 10);
  if (!(peso > 0 && altura > 0 && edad > 0)) return null;
  const bmr = 10 * peso + 6.25 * altura - 5 * edad + (p.sexo === 'masculino' ? 5 : -161);
  const af = ({ leve: 1.375, moderado: 1.55, activo: 1.725 })[p.actividad] || 1.55;
  let kcal = bmr * af;
  if (p.objetivo === 'definir') kcal -= 400;
  else if (p.objetivo === 'volumen') kcal += 250;
  kcal = Math.round(kcal / 10) * 10;
  const floor = p.sexo === 'masculino' ? 1500 : 1200;
  if (kcal < floor) kcal = floor;
  const prot = Math.round((p.objetivo === 'definir' ? 2.0 : 1.8) * peso);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  return { kcal, prot, carbs, fat, floor };
}

// ============================================================================
// evaluatePlanQuality — la VARA. Pura. { ok, reasons:[] }.
// Acepta los DOS formatos de dieta: kcal por comida (estilo IA) O Target en el
// header (estilo Jesús migrado). opts: { target:{kcal,prot}, expectedDays }.
// ============================================================================
function evaluatePlanQuality(tipo, contenido, opts = {}) {
  const reasons = [];
  try {
    if (tipo === 'dieta') {
      const p = parseDietaContenido(contenido);
      const days = (p && p.days) || [];
      if (days.length < 7) reasons.push(`solo ${days.length} dias (esperados 7)`);
      let totalMeals = 0, mealsWithK = 0, anyDayFewMeals = false;
      const dayK = [], dayP = [];
      for (const d of days) {
        const meals = d.meals || [];
        // Jesus a veces usa 3 comidas grandes (Des/Alm/Cena, sin merienda) — valido.
        // Lo que delata un plan flojo es un dia de 1-2 comidas.
        if (meals.length < 3) anyDayFewMeals = true;
        let dk = 0, dp = 0, hasK = false;
        for (const m of meals) {
          totalMeals++;
          if (m.kcal != null) { mealsWithK++; dk += m.kcal; dp += (m.prot || 0); hasK = true; }
        }
        if (hasK) { dayK.push(dk); dayP.push(dp); }
      }
      if (anyDayFewMeals) reasons.push('algun dia con menos de 4 comidas');

      // kcal/proteina objetivo: por comida (IA) o por header (Jesus)
      const t = opts.target;
      const headerK = p && p.header && p.header.targetKcal;
      const headerP = p && p.header && p.header.targetProt;
      const effK = dayK.length ? Math.round(dayK.reduce((a, b) => a + b, 0) / dayK.length) : (headerK || null);
      const effP = dayP.length ? Math.round(dayP.reduce((a, b) => a + b, 0) / dayP.length) : (headerP || null);
      if (effK == null) reasons.push('sin kcal (ni por comida ni en el header)');
      else if (t && t.kcal && Math.abs(effK - t.kcal) / t.kcal > 0.12) reasons.push(`kcal fuera de +/-12% (${effK} vs target ${t.kcal})`);
      if (effP == null) reasons.push('sin proteina objetivo');
      else if (t && t.prot && effP < t.prot * 0.85) reasons.push(`proteina baja (${effP} vs target ${t.prot})`);

    } else if (tipo === 'rutina') {
      const days = parseRutinaContenido(contenido) || [];
      const trainDays = days.filter(d => !d.isRest && d.exercises && d.exercises.length > 0);
      const exp = opts.expectedDays || 0;
      if (!trainDays.length) reasons.push('sin dias de entreno');
      else if (exp && trainDays.length < exp) reasons.push(`${trainDays.length} dias de entreno (esperados ${exp})`);
      // Umbral calibrado contra los planes reales de Jesus: dias de 3 ej (superseries)
      // son validos; lo que delata un plan flojo es un dia de 1-2 ej o un promedio bajo.
      if (trainDays.some(d => d.exercises.length < 3)) reasons.push('algun dia con menos de 3 ejercicios');
      if (trainDays.length) {
        const totalEx = trainDays.reduce((a, d) => a + d.exercises.length, 0);
        if (totalEx / trainDays.length < 4) reasons.push(`promedio bajo de ejercicios (${(totalEx / trainDays.length).toFixed(1)}/dia)`);
      }
      if (!/cardio/i.test(contenido)) reasons.push('falta linea de cardio');
      if (!/descanso/i.test(contenido)) reasons.push('falta linea de descanso');
    }
  } catch (e) {
    reasons.push('error al parsear: ' + (e && e.message));
  }
  return { ok: reasons.length === 0, reasons };
}

// ============================================================================
// PRUEBAS
// ============================================================================
const read = (f) => readFileSync(join(MIGRA, f), 'utf8');
const line = '─'.repeat(64);
const show = (titulo, r) => {
  console.log(`\n▸ ${titulo}`);
  console.log(`   ${r.ok ? '✅ PASA la vara' : '❌ FALLA → caeria a plantilla'}`);
  if (r.reasons.length) r.reasons.forEach(x => console.log(`     · ${x}`));
};

console.log(line + '\nVARA DE CALIDAD — prototipo offline\n' + line);

// 1) Dieta de Jesus (migrada #19, Target en header, sin kcal por comida)
show('Dieta de Jesus (migrada #19 Ximena · target 1320/140)',
  evaluatePlanQuality('dieta', read('19_dieta.txt'), { target: { kcal: 1320, prot: 140 } }));

// 2) Rutina de Jesus (migrada #19, 4 dias)
show('Rutina de Jesus (migrada #19 Ximena · 4 dias)',
  evaluatePlanQuality('rutina', read('19_rutina.txt'), { expectedDays: 4 }));

// 3) Dieta FLOJA (sin kcal, sin header) → debe FALLAR
const dietaMala = `LUNES
Desayuno: avena con banana
Almuerzo: pollo con arroz
Cena: ensalada
MARTES
Desayuno: tostadas
Almuerzo: carne con papa
Cena: sopa`;
show('Dieta floja (sin kcal, sin Target, 2 dias)', evaluatePlanQuality('dieta', dietaMala, { target: { kcal: 1500, prot: 130 } }));

// 4) Rutina FLOJA (2 ejercicios, sin cardio) → debe FALLAR
const rutinaMala = `Dia 1 · Piernas
1. Sentadilla — 3x10
2. Prensa — 3x12
---
Descanso: el resto de la semana`;
show('Rutina floja (2 ejercicios, sin cardio)', evaluatePlanQuality('rutina', rutinaMala, { expectedDays: 4 }));

// 5) VALIDACIÓN MASIVA: la vara NO debe rechazar NINGÚN plan real de Jesús.
import { readdirSync } from 'node:fs';
console.log('\n' + line + '\nValidacion masiva contra TODAS las migradas de Jesus\n' + line);
let dietasOk = 0, dietasFail = 0, rutinasOk = 0, rutinasFail = 0;
const files = readdirSync(MIGRA);
for (const f of files.filter(x => x.endsWith('_dieta.txt'))) {
  const txt = read(f);
  const p = parseDietaContenido(txt);
  const target = { kcal: (p && p.header && p.header.targetKcal) || null, prot: (p && p.header && p.header.targetProt) || null };
  const r = evaluatePlanQuality('dieta', txt, { target });
  if (r.ok) dietasOk++; else { dietasFail++; console.log(`❌ DIETA ${f}: ${r.reasons.join(' · ')}`); }
}
for (const f of files.filter(x => x.endsWith('_rutina.txt'))) {
  const txt = read(f);
  const days = parseRutinaContenido(txt) || [];
  const exp = days.filter(d => !d.isRest && d.exercises && d.exercises.length).length;
  const r = evaluatePlanQuality('rutina', txt, { expectedDays: exp });
  if (r.ok) rutinasOk++; else { rutinasFail++; console.log(`❌ RUTINA ${f}: ${r.reasons.join(' · ')}`); }
}
console.log(`\nDietas:  ${dietasOk} pasan / ${dietasFail} fallan`);
console.log(`Rutinas: ${rutinasOk} pasan / ${rutinasFail} fallan`);
console.log('(Lo ideal: 0 fallan — la vara nunca rechaza un plan real de Jesus.)');

console.log('\n' + line);
