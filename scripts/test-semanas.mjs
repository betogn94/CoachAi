// ============================================================================
// RED DE REGRESIÓN DEL RELOJ ISO — test-semanas.mjs
// ============================================================================
// Corre `node scripts/test-semanas.mjs` (o `npm run test:semanas`).
//
// Proyecto semanas-calendario (docs/semanas-calendario.md, F1). Extrae los
// helpers REALES desde index.html (getISOWeekKey + isoWeekRange + isoWeekShift
// + isoWeeksBetween) y los somete a:
//   1. Anclas de verdad conocida (fechas verificadas a mano):
//        - 2026-01-01 es JUEVES → pertenece a 2026-W01 (que arranca 2025-12-29)
//        - 2020 tuvo 53 semanas ISO (2020-W53 = 2020-12-28 .. 2021-01-03)
//        - 2026-09-28 es LUNES de 2026-W40
//   2. Alta en CADA día de la semana → el rango siempre arranca lunes.
//   3. Round-trip exhaustivo: para ~800 días seguidos (incluye 2 bordes de año
//      ISO y fechas de cambio de hora DST), getISOWeekKey(d) → isoWeekRange →
//      d ∈ [start, end], y start es lunes.
//   4. Shift y between: inversos, bordes de año, W53.
//
// Si tocás cualquiera de los 4 helpers y rompés un caso, esto lo caza en dev.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Extractor por balance de llaves (mismo enfoque que test-parsers.mjs).
function extractFunction(name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré la función ${name} en index.html`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`No cerró el cuerpo de ${name}`);
}

const code = ['getISOWeekKey', 'isoWeekRange', 'isoWeekShift', 'isoWeeksBetween']
  .map(extractFunction).join('\n');
const api = new Function(`${code}; return { getISOWeekKey, isoWeekRange, isoWeekShift, isoWeeksBetween };`)();
const { getISOWeekKey, isoWeekRange, isoWeekShift, isoWeeksBetween } = api;

let ok = 0, fail = 0;
function eq(desc, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { fail++; console.log(`✗ ${desc}\n    esperado: ${w}\n    obtenido: ${g}`); }
}

// Fecha LOCAL a partir de 'YYYY-MM-DD' (getISOWeekKey lee componentes locales).
const L = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// ── 1. Anclas de verdad conocida ─────────────────────────────────────────────
eq('2026-01-01 (jueves) → 2026-W01', getISOWeekKey(L('2026-01-01')), '2026-W01');
eq('2025-12-29 (lunes de W01-2026, año calendario anterior)', getISOWeekKey(L('2025-12-29')), '2026-W01');
eq('2025-12-28 (domingo) → 2025-W52', getISOWeekKey(L('2025-12-28')), '2025-W52');
eq('rango 2026-W01 cruza el año', isoWeekRange('2026-W01'), { start: '2025-12-29', end: '2026-01-04' });
eq('2020-12-31 → 2020-W53 (año de 53 semanas)', getISOWeekKey(L('2020-12-31')), '2020-W53');
eq('rango 2020-W53', isoWeekRange('2020-W53'), { start: '2020-12-28', end: '2021-01-03' });
eq('2021-01-01 (viernes) → 2020-W53', getISOWeekKey(L('2021-01-01')), '2020-W53');
eq('2026-09-28 (lunes) → 2026-W40', getISOWeekKey(L('2026-09-28')), '2026-W40');
eq('rango 2026-W40', isoWeekRange('2026-W40'), { start: '2026-09-28', end: '2026-10-04' });

// ── 2. Alta en cada día de la semana → rango arranca lunes ───────────────────
const altaSemana = ['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-27'];
for (const alta of altaSemana) {
  const r = isoWeekRange(getISOWeekKey(L(alta)));
  eq(`alta ${alta} → su semana ISO arranca el lunes 21`, r.start, '2026-09-21');
  eq(`alta ${alta} → termina el domingo 27`, r.end, '2026-09-27');
}

// ── 3. Round-trip exhaustivo (~800 días: 2025-06-01 → 2027-08-09) ───────────
// Cubre 2 bordes de año ISO (2025→2026, 2026→2027) y varias fechas DST
// (EU: 2025-10-26, 2026-03-29, 2026-10-25 · US: 2025-11-02, 2026-03-08).
{
  let rtFail = 0;
  const d0 = Date.parse('2025-06-01T12:00:00Z');
  for (let i = 0; i < 800; i++) {
    const iso = new Date(d0 + i * 86400000).toISOString().slice(0, 10);
    const key = getISOWeekKey(L(iso));
    const r = isoWeekRange(key);
    if (!r || iso < r.start || iso > r.end) { rtFail++; if (rtFail < 4) console.log(`✗ round-trip ${iso}: key ${key} rango ${JSON.stringify(r)}`); continue; }
    // start SIEMPRE lunes (getUTCDay de un YYYY-MM-DD parseado UTC)
    if (new Date(r.start + 'T00:00:00Z').getUTCDay() !== 1) { rtFail++; console.log(`✗ ${key}: start ${r.start} no es lunes`); }
  }
  eq('round-trip 800 días consecutivos (0 fallas)', rtFail, 0);
}

// ── 4. Shift y between ───────────────────────────────────────────────────────
eq('shift 2026-W01 -1 → 2025-W52', isoWeekShift('2026-W01', -1), '2025-W52');
eq('shift 2025-W52 +1 → 2026-W01', isoWeekShift('2025-W52', 1), '2026-W01');
eq('shift 2020-W53 +1 → 2021-W01', isoWeekShift('2020-W53', 1), '2021-W01');
eq('shift 2021-W01 -1 → 2020-W53', isoWeekShift('2021-W01', -1), '2020-W53');
eq('shift 0 = identidad', isoWeekShift('2026-W40', 0), '2026-W40');
eq('shift +10 desde 2026-W40', isoWeekShift('2026-W40', 10), '2026-W50');
eq('between misma semana = 0', isoWeeksBetween('2026-W40', '2026-W40'), 0);
eq('between 2025-W52 → 2026-W02 = 2', isoWeeksBetween('2025-W52', '2026-W02'), 2);
eq('between negativo', isoWeeksBetween('2026-W40', '2026-W38'), -2);
eq('between cruzando W53', isoWeeksBetween('2020-W52', '2021-W01'), 2);
// "Semana N del proceso": alta martes 2026-09-15 (W38) → hoy 2026-09-28 (W40) = semana 3
eq('semana del proceso (alta W38, hoy W40) = 3', isoWeeksBetween(getISOWeekKey(L('2026-09-15')), getISOWeekKey(L('2026-09-28'))) + 1, 3);

// ── 5. Entradas inválidas ────────────────────────────────────────────────────
eq('rango de clave inválida = null', isoWeekRange('banana'), null);
eq('rango de W00 = null', isoWeekRange('2026-W00'), null);
eq('shift de clave inválida = null', isoWeekShift('nope', 1), null);
eq('between con inválida = null', isoWeeksBetween('2026-W40', 'x'), null);

// ═══════════════════════════════════════════════════════════════════════════
// F3 — MODELO HÍBRIDO (getWeekNum/getWeekRange con reloj ISO)
// Semanas cerradas = rango registrado · abiertas = continuación ISO (puente).
// Extrae las funciones REALES + stubs deterministas (hoy fijo, cierres por test).
// ═══════════════════════════════════════════════════════════════════════════
{
  const hybridCode = [
    'getISOWeekKey', 'isoWeekRange', 'isoWeekShift', 'isoWeeksBetween',
    'formatLocalDate', '_addDaysStr', '_lastCierre', '_isoKeyOfStr',
    '_getWeekNumLegacy', '_getWeekRangeLegacy', 'getWeekNum', 'getWeekRange',
  ].map(extractFunction).join('\n');

  const mk = new Function(`
    const SEMANA_ISO = true;                    // flip ON (el escape se prueba aparte vía legacy)
    let cierresSemanales = [];
    let TEST_TODAY = '2026-09-29';
    function getTodayKey() { return TEST_TODAY; }
    ${hybridCode}
    return {
      setCierres: c => { cierresSemanales = c; },
      setToday:   t => { TEST_TODAY = t; },
      getWeekNum, getWeekRange, _getWeekNumLegacy, _getWeekRangeLegacy,
    };`);
  const H = mk();

  // A) Caso José (el disparador): alta martes 15/09, cierres viejos 1-2 (reloj personal)
  H.setToday('2026-09-29');
  H.setCierres([
    { semana_num: 1, fecha_inicio: '2026-09-15', fecha_fin: '2026-09-21' },
    { semana_num: 2, fecha_inicio: '2026-09-22', fecha_fin: '2026-09-28' },
  ]);
  const ALTA_J = '2026-09-15T21:41:47Z';
  eq('[híbrido] José: semana actual = 3 (contador sigue)', H.getWeekNum(ALTA_J), 3);
  eq('[híbrido] José: semana 3 = PUENTE mar 29 → dom 4-oct', H.getWeekRange(ALTA_J, 3), { start: '2026-09-29', end: '2026-10-04' });
  eq('[híbrido] José: semana 2 histórica INTACTA (22-28)', H.getWeekRange(ALTA_J, 2), { start: '2026-09-22', end: '2026-09-28' });
  eq('[híbrido] José: semana 4 = ISO completa lun 5 → dom 11', H.getWeekRange(ALTA_J, 4), { start: '2026-10-05', end: '2026-10-11' });

  // B) Usuaria nueva alta LUNES sin cierres → semana 1 completa lunes-domingo
  H.setCierres([]);
  eq('[híbrido] alta lunes: semana actual = 1', H.getWeekNum('2026-09-28T10:00:00Z'), 1);
  eq('[híbrido] alta lunes: semana 1 completa (28 → 4-oct)', H.getWeekRange('2026-09-28T10:00:00Z', 1), { start: '2026-09-28', end: '2026-10-04' });

  // C) Usuaria nueva alta JUEVES sin cierres → semana 1 PARCIAL (jue-dom), semana 2 ISO
  eq('[híbrido] alta jueves: hoy (martes sig.) = semana 2', H.getWeekNum('2026-09-24T10:00:00Z'), 2);
  eq('[híbrido] alta jueves: semana 1 parcial (24 → 27, 4 días)', H.getWeekRange('2026-09-24T10:00:00Z', 1), { start: '2026-09-24', end: '2026-09-27' });
  eq('[híbrido] alta jueves: semana 2 ISO completa (28 → 4-oct)', H.getWeekRange('2026-09-24T10:00:00Z', 2), { start: '2026-09-28', end: '2026-10-04' });

  // D) Alta lunes con historial legacy ALINEADO → transición invisible (puente = semana normal)
  H.setCierres([
    { semana_num: 1, fecha_inicio: '2026-08-31', fecha_fin: '2026-09-06' },
    { semana_num: 2, fecha_inicio: '2026-09-07', fecha_fin: '2026-09-13' },
    { semana_num: 3, fecha_inicio: '2026-09-14', fecha_fin: '2026-09-20' },
    { semana_num: 4, fecha_inicio: '2026-09-21', fecha_fin: '2026-09-27' },
  ]);
  eq('[híbrido] lunes+historial: semana actual = 5', H.getWeekNum('2026-08-31T09:00:00Z'), 5);
  eq('[híbrido] lunes+historial: semana 5 = 28 → 4-oct (sin puente raro)', H.getWeekRange('2026-08-31T09:00:00Z', 5), { start: '2026-09-28', end: '2026-10-04' });

  // E) Backlog: usuaria que no abre la app hace 3 semanas → semanas pendientes bien numeradas
  H.setToday('2026-10-14');   // miércoles, 2 ISO completas después del puente
  H.setCierres([
    { semana_num: 1, fecha_inicio: '2026-09-15', fecha_fin: '2026-09-21' },
    { semana_num: 2, fecha_inicio: '2026-09-22', fecha_fin: '2026-09-28' },
  ]);
  eq('[híbrido] backlog: semana actual = 5', H.getWeekNum(ALTA_J), 5);
  eq('[híbrido] backlog: sem 3 puente (29 → 4-oct)', H.getWeekRange(ALTA_J, 3), { start: '2026-09-29', end: '2026-10-04' });
  eq('[híbrido] backlog: sem 4 ISO (5 → 11-oct)', H.getWeekRange(ALTA_J, 4), { start: '2026-10-05', end: '2026-10-11' });
  eq('[híbrido] backlog: sem 5 ISO en curso (12 → 18-oct)', H.getWeekRange(ALTA_J, 5), { start: '2026-10-12', end: '2026-10-18' });

  // F) Legacy intacto (el escape ?semanaiso=0 usa exactamente estas)
  H.setToday('2026-09-29');
  eq('[legacy] José: semana actual = 3', H._getWeekNumLegacy(ALTA_J), 3);
  eq('[legacy] José: semana 3 = 29 → 5-oct (martes a lunes)', H._getWeekRangeLegacy(ALTA_J, 3), { start: '2026-09-29', end: '2026-10-05' });

  // G) Carrera/reloj adelantado: created_at futuro no rompe
  H.setCierres([]);
  eq('[híbrido] created_at futuro → clamp semana 1', H.getWeekNum('2026-12-01T00:00:00Z'), 1);
}

console.log('─'.repeat(50));
console.log(`Resultado: ${ok} OK · ${fail} FALLAS`);
if (fail === 0) console.log('✅ Reloj verde — ISO puro (anclas, round-trip, W53, DST) + modelo híbrido F3 (puente, parciales, backlog, históricos intactos, legacy).');
process.exit(fail === 0 ? 0 : 1);
