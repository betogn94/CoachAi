// ============================================================================
// TEST-GENERATION — harness OFFLINE contra PROD para validar el prompt de
// generación de planes (dieta/rutina) antes de tocar el flujo en vivo.
// ============================================================================
// Qué hace:
//   1. Extrae de index.html el buildSystemPrompt REAL + los métodos Babot + los
//      parsers + la vara de calidad (evaluatePlanQuality/computeDietTarget).
//   2. Corre buildSystemPrompt con stubs del DOM → prompt IDÉNTICO al de prod.
//   3. (Opcional) splicea un bloque few-shot en el prompt (variante B).
//   4. Pega a https://coachaipro.ai/api/chat (PROD, tiene la key) con el mensaje
//      que dispara la generación, parsea la respuesta y la pasa por la vara.
//   5. Reporta % que pasa la vara + razones, por perfil y por variante.
//
// Uso:
//   node scripts/test-generation.mjs            → baseline (sin few-shot)
//   node scripts/test-generation.mjs fewshot    → con el few-shot spliceado
//   node scripts/test-generation.mjs ab [reps]  → A/B: baseline vs few-shot
//
// NO toca index.html. NO deploya nada. Solo lee + llama a prod + reporta.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, '..', 'index.html');
const html = readFileSync(INDEX_HTML, 'utf8');

const PROD = 'https://coachaipro.ai/api/chat';
const ORIGIN = 'https://coachaipro.ai';

// — scanner con stack: maneja templates anidados (`${ ... ` ... ` ... }`),
//   strings, comentarios y regex. Cada frame 'code' lleva su propio estado. —
function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`No encontré function ${name}`);
  let i = src.indexOf('{', start);
  const stack = [{ kind: 'code', depth: 1, prevSig: '' }]; // contamos esta llave
  i++;
  for (; i < src.length; i++) {
    const top = stack[stack.length - 1];
    const c = src[i], c2 = src[i + 1];
    if (top.kind === 'tmpl') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && c2 === '{') { stack.push({ kind: 'code', depth: 1, prevSig: '' }); i++; continue; }
      continue;
    }
    // frame de código
    if (top.inLine)  { if (c === '\n') top.inLine = false; continue; }
    if (top.inBlock) { if (c === '*' && c2 === '/') { top.inBlock = false; i++; } continue; }
    if (top.inStr)   { if (c === '\\') { i++; continue; } if (c === top.strCh) top.inStr = false; continue; }
    if (top.inRegex) { if (c === '\\') { i++; continue; } if (c === '[') top.inClass = true; else if (c === ']') top.inClass = false; else if (c === '/' && !top.inClass) top.inRegex = false; continue; }
    if (c === '/' && c2 === '/') { top.inLine = true; i++; continue; }
    if (c === '/' && c2 === '*') { top.inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { top.inStr = true; top.strCh = c; continue; }
    if (c === '`') { stack.push({ kind: 'tmpl' }); continue; }
    if (c === '/') { if (top.prevSig === '' || '=(,:;[!&|?{}+-*%~^<>'.includes(top.prevSig)) { top.inRegex = true; continue; } }
    if (c === '{') { top.depth++; }
    else if (c === '}') {
      top.depth--;
      if (top.depth === 0) { stack.pop(); if (stack.length === 0) return src.slice(start, i + 1); continue; }
    }
    if (!/\s/.test(c)) top.prevSig = c;
  }
  throw new Error(`Llaves desbalanceadas en ${name}`);
}

// — extractor de template literal estático: const NAME = `...`; (sin ${} ni ` internos) —
function extractTemplate(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\``);
  const m = re.exec(src);
  if (!m) throw new Error(`No encontré const ${name}`);
  const startTick = m.index + m[0].length - 1; // posición del backtick de apertura
  const endTick = src.indexOf('`', startTick + 1);
  if (endTick === -1) throw new Error(`Backtick sin cerrar en ${name}`);
  return src.slice(startTick + 1, endTick);
}

// — armamos el sandbox con las piezas REALES de index.html —
const fnSrc = ['parseRutinaContenido', 'parseDietaContenido', 'computeDietTarget', 'evaluatePlanQuality', 'dietaHasMacros', 'planReplyHasStructure', 'buildSystemPrompt']
  .map(n => extractFunction(html, n)).join('\n\n');
const METODO_RELOJ_ARENA_ES = extractTemplate(html, 'METODO_RELOJ_ARENA_ES');
const METODO_V_MASCULINO_ES = extractTemplate(html, 'METODO_V_MASCULINO_ES');

// stub mínimo del DOM + globals que buildSystemPrompt lee
function makeSandbox(profile) {
  const elMap = profile.dom;
  const document = {
    getElementById: (id) => ({ value: elMap[id] ?? '' }),
    querySelectorAll: () => [],
  };
  const ctx = {
    document,
    selections: profile.selections,
    selectedDias: profile.selectedDias,
    selectedComidas: profile.selectedComidas,
    weeklyPlans: { dieta: null, rutina: null },
    allChatHistory: [],
    lang: 'es',
    METODO_RELOJ_ARENA_ES, METODO_V_MASCULINO_ES,
    getISOWeekKey: () => '',
    buildDiarioSummary: () => '',
    buildHistorySummary: () => '',
    console,
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, `"use strict";
    ${fnSrc}
    return {
      buildSystemPrompt,
      parseRutinaContenido, parseDietaContenido,
      computeDietTarget, evaluatePlanQuality,
      dietaHasMacros, planReplyHasStructure,
    };`);
  return fn(...names.map(n => ctx[n]));
}

// ============================================================================
// PERFILES de prueba (representativos de la base real — mayoría mujeres)
// ============================================================================
const mkProfile = (o) => ({
  label: o.label,
  selections: { objetivo: o.objetivo, nivel: o.nivel },
  selectedDias: o.dias,
  selectedComidas: String(o.comidas),
  dom: {
    'f-nombre': o.nombre, 'f-edad': String(o.edad), 'f-sexo': o.sexo,
    'f-peso': String(o.peso), 'f-altura': String(o.altura), 'f-actividad': o.actividad,
    'f-duracion': o.duracion || '60 minutos', 'f-lugar': o.lugar || 'gimnasio',
    'f-nodislike': o.nodislike || '', 'f-cuello': '', 'f-cintura-form': '', 'f-cadera-form': '',
  },
});

const PROFILES = [
  mkProfile({ label: 'P1 Sofía · F definir 4d gym', nombre: 'Sofía', edad: 30, sexo: 'femenino', peso: 65, altura: 165, actividad: 'moderado', objetivo: 'definir', nivel: 'intermedio', dias: ['Lunes', 'Martes', 'Jueves', 'Viernes'], comidas: 4 }),
  mkProfile({ label: 'P2 Caro · F volumen 5d gym', nombre: 'Caro', edad: 26, sexo: 'femenino', peso: 58, altura: 168, actividad: 'activo', objetivo: 'volumen', nivel: 'intermedio', dias: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], comidas: 4 }),
  mkProfile({ label: 'P3 Marta · F definir 3d ppal', nombre: 'Marta', edad: 45, sexo: 'femenino', peso: 78, altura: 160, actividad: 'leve', objetivo: 'definir', nivel: 'principiante', dias: ['Lunes', 'Miércoles', 'Viernes'], comidas: 4 }),
  mkProfile({ label: 'P4 Diego · M definir 4d gym', nombre: 'Diego', edad: 34, sexo: 'masculino', peso: 85, altura: 178, actividad: 'moderado', objetivo: 'definir', nivel: 'intermedio', dias: ['Lunes', 'Martes', 'Jueves', 'Viernes'], comidas: 4 }),
  mkProfile({ label: 'P5 Luli · F definir 4d casa', nombre: 'Luli', edad: 29, sexo: 'femenino', peso: 70, altura: 170, actividad: 'moderado', objetivo: 'definir', nivel: 'intermedio', dias: ['Lunes', 'Martes', 'Jueves', 'Viernes'], comidas: 4, lugar: 'casa' }),
];

// ============================================================================
// FEW-SHOT (variante B) — se splicea en el prompt baseline por anchors.
// Se carga desde scripts/fewshot-block.mjs para iterarlo sin tocar el harness.
// ============================================================================
let FEWSHOT = null;
try { FEWSHOT = (await import('./fewshot-block.mjs')).default; } catch (e) { /* baseline only */ }

function applyFewshot(prompt) {
  if (!FEWSHOT || !Array.isArray(FEWSHOT.insertions)) return prompt;
  let p = prompt;
  for (const ins of FEWSHOT.insertions) {
    if (!p.includes(ins.anchor)) { console.log(`⚠️  anchor no encontrado: "${ins.anchor.slice(0, 40)}"`); continue; }
    p = p.replace(ins.anchor, ins.text + '\n\n' + ins.anchor); // inserta ANTES del anchor
  }
  return p;
}

// ============================================================================
// Llamada a PROD
// ============================================================================
async function callProd(system, userMsg) {
  const r = await fetch(PROD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
    body: JSON.stringify({ system, model: 'haiku', messages: [{ role: 'user', content: userMsg }] }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return text;
}

// — réplica de aiNormalizePlan (formateador IA, segunda llamada) contra prod —
const NORM_SYS_RUTINA = `Sos un FORMATEADOR de rutinas de entrenamiento. Recibís una rutina en CUALQUIER formato y la devolvés con EXACTAMENTE el mismo contenido, solo reordenada al formato canónico de abajo.

PROHIBIDO ABSOLUTO: cambiar, agregar, quitar o inventar ejercicios, series, repeticiones, pesos, días, descansos o notas del coach. Si un dato no está en el original, NO lo inventes — omitilo.

FORMATO CANÓNICO:
Día 1 · [Grupo o nombre del día]
1. [Ejercicio] — [series]×[reps] · [peso/intensidad si está] · desc [tiempo si está]
2. [Ejercicio] — ...
Día 2 · [...]
Descanso: [días de descanso si se mencionan]

REGLAS:
- Cada ejercicio numerado (1. 2. 3...), uno por línea.
- El número de SERIES va ANTES de la × (ej: "4×10" = 4 series de 10 reps). Si son reps variables/piramidal mantenelas (ej: 4×12-10-8).
- Si el coach dejó una nota de ejecución/técnica, va en una línea debajo del ejercicio, tal cual.
- OBLIGATORIO: si el original menciona días de descanso/off, incluí una línea exacta "Descanso: [días]" al final. No la omitas.
- Sin introducción, sin comentarios, sin explicaciones tuyas.
Respondé SOLO con la rutina formateada.`;
const NORM_SYS_DIETA = `Sos un FORMATEADOR de planes de alimentación. Recibís una dieta en CUALQUIER formato y la devolvés con EXACTAMENTE el mismo contenido, solo ordenada y legible.

PROHIBIDO ABSOLUTO: cambiar, agregar, quitar o inventar comidas, cantidades, calorías o macros. Si un dato no está, NO lo inventes.

Agrupá por día (LUNES, MARTES, ... o "Día 1, Día 2" si así viene) y dentro de cada día las comidas (Desayuno, Almuerzo, Merienda, Cena u las que haya), una por línea. Sin introducción ni comentarios. Respondé SOLO con la dieta formateada.`;

async function aiNormalizeProd(tipo, raw) {
  const system = tipo === 'rutina' ? NORM_SYS_RUTINA : NORM_SYS_DIETA;
  let txt = await callProd(system, raw);
  txt = txt.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  return txt || null;
}

// — pipeline COMPLETO de prefetchPlan: generar → validar → normalizar → reintento → vara —
async function generatePlan(job) {
  const { tools, prompt, tipo, msg, target, expDays } = job;
  const valid = (txt) => {
    if (!tools.planReplyHasStructure(tipo, txt)) return false;
    if (tipo === 'dieta') return tools.dietaHasMacros(txt);
    return true;
  };
  let planText = null, usedNormalize = false, attempts = 0, asked = false;
  for (let attempt = 0; attempt < 2 && !planText; attempt++) {
    attempts++;
    const reply = await callProd(prompt, msg);
    if (!reply) continue;
    // ¿pidió en vez de generar? (sin estructura de plan, sin día/Target)
    if (!tools.planReplyHasStructure(tipo, reply)) asked = true;
    if (valid(reply)) { planText = reply; break; }
    const normalized = await aiNormalizeProd(tipo, reply);
    if (normalized && valid(normalized)) { planText = normalized; usedNormalize = true; break; }
  }
  const opts = tipo === 'dieta' ? { target } : { expectedDays: expDays };
  const q = planText ? tools.evaluatePlanQuality(tipo, planText, opts) : { ok: false, reasons: ['no se genero'] };
  return { ...job, planText, q, usedNormalize, attempts, asked };
}

// pool de concurrencia simple
async function pool(items, n, worker) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await worker(items[i], i); }
      catch (e) { out[i] = { error: e.message }; }
    }
  }));
  return out;
}

// ============================================================================
// RUN
// ============================================================================
const mode = process.argv[2] || 'baseline';     // baseline | fewshot | ab
const reps = parseInt(process.argv[3] || '1', 10);
const tipoFilter = process.argv[4] || '';        // '' | 'dieta' | 'rutina'
const line = '─'.repeat(72);

// construye la lista de jobs: cada perfil × {dieta, rutina} × reps × variante(s)
function buildJobs(variants) {
  const jobs = [];
  for (const prof of PROFILES) {
    const tools = makeSandbox(prof);
    const basePrompt = tools.buildSystemPrompt();
    const target = tools.computeDietTarget({
      peso: prof.dom['f-peso'], altura: prof.dom['f-altura'], edad: prof.dom['f-edad'],
      sexo: prof.dom['f-sexo'], actividad: prof.dom['f-actividad'], objetivo: prof.selections.objetivo,
    });
    const expDays = prof.selectedDias.length;
    for (const variant of variants) {
      const prompt = variant === 'B' ? applyFewshot(basePrompt) : basePrompt;
      for (let r = 0; r < reps; r++) {
        if (tipoFilter !== 'rutina') jobs.push({ prof, tools, prompt, variant, target, expDays, tipo: 'dieta', msg: '🥗 Dieta de la semana', rep: r });
        if (tipoFilter !== 'dieta') jobs.push({ prof, tools, prompt, variant, target, expDays, tipo: 'rutina', msg: '💪 Rutina de la semana', rep: r });
      }
    }
  }
  return jobs;
}

const variants = mode === 'ab' ? ['A', 'B'] : (mode === 'fewshot' ? ['B'] : ['A']);
if ((mode === 'fewshot' || mode === 'ab') && !FEWSHOT) {
  console.log('⚠️  No hay scripts/fewshot-block.mjs — no puedo correr la variante B. Crealo primero.');
  process.exit(1);
}
const jobs = buildJobs(variants);
console.log(line);
console.log(`TEST-GENERATION contra PROD · modo=${mode} · reps=${reps} · ${jobs.length} generaciones`);
console.log(`Perfiles: ${PROFILES.length} · variantes: ${variants.join('+')}`);
console.log(line);

const results = await pool(jobs, 4, (job) => generatePlan(job));

// — reporte —
const agg = {};
for (const res of results) {
  if (res.error) { console.log(`  ⚠️  error: ${res.error}`); continue; }
  const key = `${res.variant}·${res.tipo}`;
  agg[key] = agg[key] || { ok: 0, fail: 0, reasons: {}, normalize: 0, asked: 0, retried: 0 };
  if (res.q.ok) agg[key].ok++;
  else { agg[key].fail++; res.q.reasons.forEach(r => { const k = r.replace(/\d+(\.\d+)?/g, 'N'); agg[key].reasons[k] = (agg[key].reasons[k] || 0) + 1; }); }
  if (res.usedNormalize) agg[key].normalize++;
  if (res.asked) agg[key].asked++;
  if (res.attempts > 1) agg[key].retried++;
}

console.log('\nDETALLE por generación (✅/❌ = pasa la vara TRAS pipeline completo):');
for (const res of results) {
  if (res.error) { console.log(`  ⚠️  ${res.error}`); continue; }
  const tag = `${res.variant} ${res.prof.label.split(' · ')[0].padEnd(3)} ${res.tipo.padEnd(6)}`;
  const flags = [res.asked ? 'preguntó' : '', res.usedNormalize ? 'normalizó' : '', res.attempts > 1 ? `${res.attempts} intentos` : ''].filter(Boolean).join('/');
  const verdict = res.q.ok ? '✅' : '❌ ' + res.q.reasons.join(' · ');
  const extra = res.tipo === 'dieta' && res.target ? ` (target ${res.target.kcal}/${res.target.prot}g)` : '';
  console.log(`  ${tag}${extra}  ${verdict}${flags ? '   [' + flags + ']' : ''}`);
}

console.log('\n' + line + '\nRESUMEN — % que pasa la vara TRAS pipeline real (lo que evita el backup)\n' + line);
for (const key of Object.keys(agg).sort()) {
  const a = agg[key];
  const tot = a.ok + a.fail;
  const pct = tot ? Math.round((a.ok / tot) * 100) : 0;
  console.log(`  ${key.padEnd(12)} ${a.ok}/${tot} pasan (${pct}%)  · normalizó ${a.normalize} · preguntó ${a.asked} · reintentó ${a.retried}`);
  for (const [r, c] of Object.entries(a.reasons).sort((x, y) => y[1] - x[1])) console.log(`        · ${r} ×${c}`);
}
console.log(line);

// guarda los textos finales para inspección manual
import { writeFileSync } from 'node:fs';
const dump = results.filter(r => !r.error).map(r => ({ variant: r.variant, perfil: r.prof.label, tipo: r.tipo, rep: r.rep, ok: r.q.ok, reasons: r.q.reasons, usedNormalize: r.usedNormalize, asked: r.asked, attempts: r.attempts, target: r.target, text: r.planText }));
writeFileSync(join(__dirname, '..', 'tmp-generation-dump.json'), JSON.stringify(dump, null, 2));
console.log(`\n(Planes finales en tmp-generation-dump.json — ${dump.length})`);
