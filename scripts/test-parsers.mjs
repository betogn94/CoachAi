// ============================================================================
// RED DE REGRESIÓN DE PARSERS — test-parsers.mjs
// ============================================================================
// Corre `node scripts/test-parsers.mjs` (o `npm run test:parsers`).
//
// Extrae las funciones de parsing REALES desde index.html en tiempo de test
// (sin tocar ni duplicar el archivo único) y las corre sobre un corpus que
// codifica:
//   1. Cada formato real de plan (dieta + rutina) que entrega la IA / Studio.
//   2. Cada BUG que arreglamos, como guard de no-regresión:
//        - rutina con headers en **negrita** DEBE parsear (bug Beto 2026-06-08)
//        - rutina/dieta con header markdown ## o ** DEBE parsear
//        - disculpa inline "LUNES: ej | ej | ej" DEBE rechazarse (bug Vicky)
//        - mensaje de chat que "menciona" un plan DEBE rechazarse
//
// Si tocás parseRutinaContenido / parseDietaContenido / planReplyHasStructure
// y rompés cualquiera de estos casos, este test lo caza en dev ANTES del deploy.
//
// Corpus real opcional: si existe scripts/plan-corpus.local.json (gitignored),
// también valida esos planes reales. Forma: [{ tipo, contenido }].
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, '..', 'index.html');

// ----------------------------------------------------------------------------
// Extractor: localiza `function NAME(` y devuelve el texto completo de la
// función con un brace-matcher que ignora llaves dentro de comentarios,
// strings, template literals y regex literals (donde aparecen {3,} etc.).
// ----------------------------------------------------------------------------
function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré la función ${name} en index.html`);
  let i = src.indexOf('{', start);
  if (i === -1) throw new Error(`No encontré el cuerpo de ${name}`);

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

    // not inside any literal/comment
    if (c === '/' && c2 === '/') { inLine = true; i++; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '`') { inTmpl = true; continue; }
    if (c === '/') {
      // regex literal vs division: regex if the previous significant char is an
      // operator/opener. No real divisions exist in these parser functions.
      if (prevSig === '' || '=(,:;[!&|?{}+-*%~^<>'.includes(prevSig)) { inRegex = true; continue; }
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }

    if (!/\s/.test(c)) prevSig = c;
  }
  throw new Error(`Llaves desbalanceadas extrayendo ${name}`);
}

// ----------------------------------------------------------------------------
// Cargar y compilar los parsers desde el index.html vivo.
// ----------------------------------------------------------------------------
const html = readFileSync(INDEX_HTML, 'utf8');
const fns = ['parseRutinaContenido', 'parseDietaContenido', 'planReplyHasStructure']
  .map(n => extractFunction(html, n))
  .join('\n\n');

// `lang` es el único global que usan (parseRutinaContenido para la etiqueta
// "Descanso"/"Rest"). Lo stubeamos. Las funciones se ven entre sí por hoisting.
const factory = new Function(`
  "use strict";
  let lang = 'es';
  ${fns}
  return { parseRutinaContenido, parseDietaContenido, planReplyHasStructure };
`);
const { parseRutinaContenido, parseDietaContenido, planReplyHasStructure } = factory();

// ----------------------------------------------------------------------------
// CORPUS SINTÉTICO — mirror de los 4 formatos reales + cada bug arreglado.
// expect = true  → debe reconocerse como plan estructurado (parsea con contenido)
// expect = false → debe rechazarse (no pisa un plan bueno)
// ----------------------------------------------------------------------------
const RUTINA = [
  { expect: true, name: 'bold + día con paréntesis + intensif + emoji (Reloj de Arena)', text:
`💪 RUTINA — Reloj de Arena · lun, mié, vie · gimnasio

**Día 1 (Lunes) · Glúteos/Cuádriceps**
1. Hip thrust — 3×15 · pesado · desc 90s
   Apoyá espalda en banco, empujá desde talones.
   Intens set 3: pausa muerta — 3s en la contracción.
2. Sentadilla búlgara — 3×12 · pesado · desc 90s

**Día 2 (Miércoles) · Espalda/Hombros**
1. Jalón al pecho — 3×12 · pesado · desc 90s

🛋️ **Descanso:** martes, jueves, sábado, domingo
🏃 **CARDIO:** todos los días 30 min caminata` },

  { expect: true, name: 'día plano + intensif + emoji rest/cardio (Silueta en V)', text:
`💪 RUTINA — Beto · Silueta en V · Lun-Dom

Día 1 · Pecho/Tríceps
1. Press inclinado con mancuernas — 3×15 · pesado · desc 90s
   Controlá la bajada en 2s.
2. Aperturas en máquina — 2×15 · medio · desc 60s

Día 2 · Espalda/Hombros
1. Jalón al pecho — 3×15 · pesado · desc 90s

🛋️ Descanso: ninguno
🏃 CARDIO: post entreno 25 min caminata` },

  { expect: true, name: 'BUG BETO: headers en negrita **Día 1 · Lunes · ...**', text:
`💪 RUTINA — Beto

**Día 1 · Lunes · Pecho/Tríceps**
1. Press inclinado — 3×15 · 20kg · desc 90s
**Día 2 · Martes · Espalda**
1. Remo — 3×12 · pesado · desc 90s` },

  { expect: true, name: 'header por día de semana "LUNES — Push"', text:
`LUNES — Pecho/Tríceps
1. Press banca — 4×8 · pesado · desc 90s
MARTES — Espalda
1. Remo — 4×10 · pesado · desc 90s` },

  { expect: true, name: 'Jesús: sin marcador + separador "—" + "series x reps"', text:
`Día 1 · Pierna
Sentadilla — 4 series x 8 reps — descanso 90s
Prensa — 3 series x 12 reps — descanso 60s
Día 2 · Empuje
Press banca — 4 series x 10 reps — descanso 90s` },

  { expect: true, name: 'header markdown ## Día (debe tolerarse como el parser)', text:
`## Día 1 · Pecho
1. Press banca — 4×10 · desc 90s
## Día 2 · Espalda
1. Remo — 4×12 · desc 90s` },

  { expect: false, name: 'BUG VICKY: disculpa inline "LUNES: ej 4x10 | ej 4x12 | ..."', text:
`LUNES: press banca 4x10 | sentadilla 4x12 | remo 4x10` },

  { expect: false, name: 'mensaje de chat que solo menciona la rutina', text:
`¡Listo! Tu rutina de la semana ya está cargada 💪 Andá a Mi Entreno para verla y registrar tus pesos.` },

  { expect: false, name: 'string vacío', text: '' },
];

const DIETA = [
  { expect: true, name: 'plano LUNES + Target + Des/Alm (Beto)', text:
`🥗 Plan nutricional — Beto | Target: 2320 kcal/día | P:174g C:232g G:77g

LUNES
Des: Avena 50g + leche 200ml — 435kcal · P:10g C:68g G:10g
Alm: Pollo 200g + arroz 150g — 585kcal · P:48g C:42g G:17g
MARTES
Des: Huevos 3 enteros — 450kcal
Alm: Carne magra 200g + papa 250g — 580kcal` },

  { expect: true, name: 'BUG VICKY-style: **LUNES** + **Total** en negrita', text:
`🥗 Plan — Vicky | Target: 1650 kcal/día | P:132g C:165g G:55g

**LUNES**
Des: Avena 50g + leche 200ml — 380kcal · P:11g C:68g G:6g
Alm: Pollo 180g + arroz 150g — 480kcal · P:42g C:42g G:12g
**Total: 1650kcal · P:113g C:185g G:36g**` },

  { expect: true, name: 'template 1 día (LUNES) → expande a 7', text:
`LUNES
Desayuno: Avena 50g + leche 200ml — 400kcal
Almuerzo: Pollo 200g + arroz 150g — 600kcal
Cena: Merluza 200g + papa 200g — 400kcal` },

  { expect: true, name: 'Jesús: Comida N + macros', text:
`LUNES
Comida 1: 3 claras + 250g yogurt — 350kcal
Comida 2: Pollo 200g + arroz 150g — 600kcal
Comida 3: Merluza 200g + papa 200g — 450kcal` },

  { expect: false, name: 'mensaje de chat que solo menciona la dieta', text:
`¡Tu dieta ya está lista 🥗 Revisala en Mi Alimentación y cargá tus comidas del día!` },

  { expect: false, name: 'prosa que menciona "cena" sin ser plan', text:
`Para la cena de hoy comé algo liviano y proteico, descansá bien.` },

  { expect: false, name: 'string vacío', text: '' },
];

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];

function check(tipo, c) {
  let got;
  try { got = planReplyHasStructure(tipo, c.text); }
  catch (e) { got = `THREW: ${e.message}`; }
  const ok = got === c.expect;
  if (ok) { pass++; }
  else { fail++; failures.push({ tipo, name: c.name, expect: c.expect, got }); }
  const icon = ok ? '✓' : '✗';
  const tag = c.expect ? 'parsea ' : 'rechaza';
  console.log(`  ${icon} [${tipo} ${tag}] ${c.name}`);
}

console.log('\n🧪 RED DE REGRESIÓN DE PARSERS\n');
console.log('RUTINA:');
RUTINA.forEach(c => check('rutina', c));
console.log('\nDIETA:');
DIETA.forEach(c => check('dieta', c));

// Corpus real opcional (gitignored)
const LOCAL = join(__dirname, 'plan-corpus.local.json');
if (existsSync(LOCAL)) {
  console.log('\nCORPUS REAL (plan-corpus.local.json):');
  let real;
  try { real = JSON.parse(readFileSync(LOCAL, 'utf8')); } catch { real = []; }
  real.forEach((p, idx) => {
    // Los planes reales entregados deben SIEMPRE reconocerse como estructurados.
    check(p.tipo, { expect: true, name: `real #${idx + 1} (${(p.contenido || '').slice(0, 40)}…)`, text: p.contenido || '' });
  });
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${pass} OK · ${fail} FALLA${fail === 1 ? '' : 'S'}`);
if (fail) {
  console.log('\n❌ FALLAS:');
  for (const f of failures) {
    console.log(`  · [${f.tipo}] ${f.name}\n      esperaba ${f.expect}, obtuvo ${f.got}`);
  }
  process.exit(1);
}
console.log('✅ Todo verde — los parsers reconocen todos los formatos y rechazan los rotos.\n');
