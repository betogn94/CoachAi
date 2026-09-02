// ============================================================================
// TEST DEL RESPALDO KING (Fase 4) — test-king.mjs
// ============================================================================
// Corre `node scripts/test-king.mjs`. Extrae rutinaEntrenaPecho +
// parseRutinaContenido REALES de index.html (mismo extractor que
// test-parsers.mjs) y valida la detección de "entrenar pecho" en rutinas de
// mujer King, con foco en NO dar falsos positivos con ejercicios de espalda
// que llevan "pecho" en el nombre (jalón al pecho, remo pecho apoyado).
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const INDEX_HTML = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0, inLine = false, inBlock = false, inStr = false, strCh = '';
  let inTmpl = false, inRegex = false, inClass = false, prevSig = '';
  for (; i < src.length; i++) {
    const c = src[i], c2 = src[i + 1];
    if (inLine)  { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; i++; } continue; }
    if (inStr)   { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
    if (inTmpl)  { if (c === '\\') { i++; continue; } if (c === '`') inTmpl = false; continue; }
    if (inRegex) {
      if (c === '\\') { i++; continue; }
      if (c === '[') inClass = true; else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) inRegex = false;
      continue;
    }
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
const fns = ['parseRutinaContenido', 'rutinaEntrenaPecho'].map(n => extractFunction(html, n)).join('\n\n');
const factory = new Function(`"use strict"; let lang='es'; ${fns}; return { rutinaEntrenaPecho, parseRutinaContenido };`);
const { rutinaEntrenaPecho } = factory();

let fails = 0;
const t = (name, contenido, expected) => {
  const got = rutinaEntrenaPecho(contenido);
  const ok = got === expected;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : ` — esperaba ${expected}, dio ${got}`));
  if (!ok) fails++;
};

// 1) CASO ROXANA EXACTO — día titulado "Pecho/Hombros" con ejercicios de pecho
t('día "Pecho/Hombros" con press inclinado (caso Roxana) → detecta', `RUTINA — Ana · Reloj de Arena

Día 5 · Pecho/Hombros
1. Press inclinado con mancuernas — 3×12 · pesado
2. Aperturas en pec deck — 3×15 · medio
Cardio: 20 min
Descanso: domingo`, true);

// 2) Rutina glúteo-céntrica sin pecho (plantilla King típica) → NO detecta
t('rutina glúteo/espalda/hombros sin pecho → no detecta', `RUTINA — Ana · Reloj de Arena

Día 1 · Glúteos/Cuádriceps
1. Hip thrust — 3×15 · pesado
2. Sentadilla búlgara — 3×12 · medio

Día 2 · Espalda/Hombros
1. Jalón al pecho — 3×12 · pesado
2. Remo pecho apoyado — 3×12 · medio
3. Elevaciones laterales — 3×15
Cardio: 20 min
Descanso: domingo`, false);

// 3) FALSO POSITIVO A EVITAR — día de espalda con "jalón al pecho" + "remo pecho apoyado"
t('día "Espalda/Hombros" con jalón al pecho + remo pecho apoyado → NO detecta (espalda)', `RUTINA — Ana

Día 2 · Espalda/Hombros
1. Jalón al pecho agarre abierto — 3×12 · pesado
2. Remo pecho apoyado — 3×12 · medio
3. Face pull — 3×20`, false);

// 4) Ejercicio de pecho colado en un día de otro músculo → detecta por ejercicio
t('press de banca colado en día "Hombros/Tríceps" → detecta', `RUTINA — Ana

Día 3 · Hombros/Tríceps
1. Press militar — 3×12 · pesado
2. Press de banca plano — 3×10 · pesado
3. Pushdown — 3×15`, true);

// 5) Cue "pecho arriba" en una nota de ejecución → NO detecta
t('cue "pecho arriba" en nota de ejecución → no detecta', `RUTINA — Ana

Día 1 · Glúteos/Cuádriceps
1. Hip thrust — 3×15 · pesado
   Mantené el pecho arriba y empujá desde los talones.
2. Sentadilla hack — 3×12`, false);

// 6) "crossover" y "aperturas" inequívocos → detecta
t('crossover en día de espalda mal armado → detecta', `RUTINA — Ana

Día 4 · Espalda
1. Remo sentado — 3×12
2. Crossover en polea — 3×15`, true);

// 7) rutina vacía / basura → fail-open (false)
t('string vacío → no detecta (fail-open)', '', false);

console.log(fails ? `\n❌ ${fails} FALLAS` : '\n✅ Todo verde — detección de pecho correcta, sin falsos positivos con espalda');
process.exit(fails ? 1 : 0);
