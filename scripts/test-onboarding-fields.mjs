// ============================================================================
// TEST-ONBOARDING-FIELDS — ¿el NIVEL y la DURACIÓN cambian el plan de la IA?
// ============================================================================
// Genera la MISMA rutina variando UN solo dato por vez (todo lo demás fijo) y
// mide si el output cambia: # ejercicios, intensificadores, etc. Si no cambia,
// el campo no aporta al plan y puede salir del onboarding.
//
// Uso: node scripts/test-onboarding-fields.mjs [reps]
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const PROD = 'https://coachaipro.ai/api/chat';
const ORIGIN = 'https://coachaipro.ai';
const reps = parseInt(process.argv[2] || '2', 10);

// — extractores (mismos que test-generation.mjs) —
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  let i = src.indexOf('{', start);
  const stack = [{ kind: 'code', depth: 1, prevSig: '' }]; i++;
  for (; i < src.length; i++) {
    const top = stack[stack.length - 1]; const c = src[i], c2 = src[i + 1];
    if (top.kind === 'tmpl') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && c2 === '{') { stack.push({ kind: 'code', depth: 1, prevSig: '' }); i++; continue; }
      continue;
    }
    if (top.inLine) { if (c === '\n') top.inLine = false; continue; }
    if (top.inBlock) { if (c === '*' && c2 === '/') { top.inBlock = false; i++; } continue; }
    if (top.inStr) { if (c === '\\') { i++; continue; } if (c === top.strCh) top.inStr = false; continue; }
    if (top.inRegex) { if (c === '\\') { i++; continue; } if (c === '[') top.inClass = true; else if (c === ']') top.inClass = false; else if (c === '/' && !top.inClass) top.inRegex = false; continue; }
    if (c === '/' && c2 === '/') { top.inLine = true; i++; continue; }
    if (c === '/' && c2 === '*') { top.inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { top.inStr = true; top.strCh = c; continue; }
    if (c === '`') { stack.push({ kind: 'tmpl' }); continue; }
    if (c === '/') { if (top.prevSig === '' || '=(,:;[!&|?{}+-*%~^<>'.includes(top.prevSig)) { top.inRegex = true; continue; } }
    if (c === '{') top.depth++;
    else if (c === '}') { top.depth--; if (top.depth === 0) { stack.pop(); if (stack.length === 0) return src.slice(start, i + 1); continue; } }
    if (!/\s/.test(c)) top.prevSig = c;
  }
}
function extractTemplate(src, name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*`').exec(src);
  const startTick = m.index + m[0].length - 1;
  const endTick = src.indexOf('`', startTick + 1);
  return src.slice(startTick + 1, endTick);
}

const fnSrc = ['parseRutinaContenido', 'parseDietaContenido', 'buildSystemPrompt'].map(n => extractFunction(html, n)).join('\n\n');
const METODO_RELOJ_ARENA_ES = extractTemplate(html, 'METODO_RELOJ_ARENA_ES');
const METODO_V_MASCULINO_ES = extractTemplate(html, 'METODO_V_MASCULINO_ES');

function buildPrompt(profile) {
  const elMap = profile.dom;
  const document = { getElementById: (id) => ({ value: elMap[id] ?? '' }), querySelectorAll: () => [] };
  const ctx = {
    document, selections: profile.selections, selectedDias: profile.selectedDias,
    selectedComidas: profile.selectedComidas, weeklyPlans: { dieta: null, rutina: null },
    allChatHistory: [], lang: 'es', METODO_RELOJ_ARENA_ES, METODO_V_MASCULINO_ES,
    getISOWeekKey: () => '', buildDiarioSummary: () => '', buildHistorySummary: () => '', console,
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, '"use strict";' + fnSrc + '; return { buildSystemPrompt, parseRutinaContenido };');
  return fn(...names.map(n => ctx[n]));
}

// — perfil base: mujer, definir, 4 días, gym — todo fijo salvo lo que variamos —
function mkProfile(nivel, duracion) {
  return {
    selections: { objetivo: 'definir', nivel },
    selectedDias: ['Lunes', 'Martes', 'Jueves', 'Viernes'],
    selectedComidas: '4',
    dom: {
      'f-nombre': 'Sofía', 'f-edad': '30', 'f-sexo': 'femenino', 'f-peso': '65', 'f-altura': '165',
      'f-actividad': 'moderado', 'f-duracion': duracion, 'f-lugar': 'gimnasio',
      'f-nodislike': '', 'f-cuello': '', 'f-cintura-form': '', 'f-cadera-form': '',
    },
  };
}

async function callProd(system, userMsg) {
  const r = await fetch(PROD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN }, body: JSON.stringify({ system, model: 'haiku', messages: [{ role: 'user', content: userMsg }] }) });
  const txt = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + txt.slice(0, 150));
  const j = JSON.parse(txt);
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// intensificadores que usa el método de Jesús
const INTENS_RE = /drop\s*set|rest[\s-]*pause|cluster|negativ|tiempo bajo tensi|TUT|superseri|superset|pausa muerta|parciales|myo[\s-]*reps|rest[\s-]*pause/gi;

function metrics(tools, text) {
  const days = (tools.parseRutinaContenido(text) || []).filter(d => !d.isRest && d.exercises && d.exercises.length);
  const totalEx = days.reduce((a, d) => a + d.exercises.length, 0);
  const intens = (text.match(INTENS_RE) || []).length;
  return { dias: days.length, totalEx, avgEx: days.length ? +(totalEx / days.length).toFixed(1) : 0, intens };
}

// — cells —
const cells = [];
// Test NIVEL (duración fija 60min)
for (const nivel of ['principiante', 'intermedio', 'avanzado']) cells.push({ grupo: 'NIVEL', label: nivel, prof: mkProfile(nivel, '60min') });
// Test DURACIÓN (nivel fijo intermedio)
for (const dur of ['30min', '60min', '90min']) cells.push({ grupo: 'DURACION', label: dur, prof: mkProfile('intermedio', dur) });

const line = '─'.repeat(70);
console.log(line + `\nTEST onboarding: ¿NIVEL y DURACIÓN cambian la rutina? · reps=${reps}\n` + line);

const agg = {};
for (const cell of cells) {
  const tools = buildPrompt(cell.prof);
  const prompt = tools.buildSystemPrompt();
  for (let r = 0; r < reps; r++) {
    let m;
    try { const text = await callProd(prompt, '💪 Rutina de la semana'); m = metrics(tools, text); }
    catch (e) { console.log(`  ${cell.grupo} ${cell.label} rep${r}: ERROR ${e.message}`); continue; }
    const key = cell.grupo + '·' + cell.label;
    agg[key] = agg[key] || { dias: [], totalEx: [], intens: [] };
    agg[key].dias.push(m.dias); agg[key].totalEx.push(m.totalEx); agg[key].intens.push(m.intens);
    console.log(`  ${cell.grupo.padEnd(9)} ${cell.label.padEnd(13)} rep${r}: ${m.dias} dias · ${m.totalEx} ejs (${m.avgEx}/dia) · ${m.intens} intensificadores`);
  }
}

const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0;
console.log('\n' + line + '\nPROMEDIOS\n' + line);
for (const grupo of ['NIVEL', 'DURACION']) {
  console.log(`\n▸ ${grupo}:`);
  for (const key of Object.keys(agg).filter(k => k.startsWith(grupo))) {
    const a = agg[key];
    console.log(`   ${key.split('·')[1].padEnd(13)} → ${avg(a.totalEx)} ejercicios · ${avg(a.intens)} intensificadores · ${avg(a.dias)} dias`);
  }
}
console.log('\n(Si los promedios son casi iguales entre variantes → el campo NO cambia el plan.)');
