// QA de la feature Progresión de fuerza — sintaxis + unit tests de las funciones
// nuevas extraídas del index.html VIVO. Uso: node scripts/_qa_progresion.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
let fails = 0;
const ok = (cond, name, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + name + (extra && !cond ? ` → ${extra}` : ''));
  if (!cond) fails++;
};

// ── 1) Sintaxis de TODOS los <script> inline ──
console.log('1) Sintaxis de scripts inline');
const dir = mkdtempSync(join(tmpdir(), 'qa-prog-'));
let i = 0, m;
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
while ((m = re.exec(html)) !== null) {
  const code = m[1];
  if (!code.trim()) continue;
  i++;
  const f = join(dir, `s${i}.js`);
  writeFileSync(f, code);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { ok(false, `script inline #${i}`, String(e.stderr).slice(0, 300)); continue; }
}
ok(true, `${i} scripts parsean sin errores`);

// ── 2) Extraer funciones nuevas + deps (brace matcher de check-plan) ──
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
  throw new Error(`unbalanced ${name}`);
}
const names = ['_entNormName', 'parseSeriesCount', '_progWeekLabel', '_progSlotsForWeek',
               '_progBestForWeek', '_progFmtKg', '_progChartSvg'];
const fns = names.map(n => extractFunction(html, n)).join('\n\n');
const api = new Function(`"use strict"; ${fns}\n return { ${names.join(', ')} };`)();

console.log('2) Unit tests');
// _progWeekLabel: lunes de 2026-W37 = 7 de septiembre
ok(api._progWeekLabel('2026-W37') === '7/9', `_progWeekLabel 2026-W37 → 7/9 (dio ${api._progWeekLabel('2026-W37')})`);
ok(api._progWeekLabel('2026-W01') === '29/12', `_progWeekLabel 2026-W01 → 29/12 (dio ${api._progWeekLabel('2026-W01')})`);
ok(api._progWeekLabel('garbage') === '', '_progWeekLabel inválido → ""');

// _progBestForWeek: máximo del slot, sin contaminarse con e10 ni valores basura
const wk = { weights: { d1e0s1: '17.5', d1e0s2: '20', d1e0s3: 'abc', d1e10s1: '99', d1e1s1: '40', d0e0s1: '22,5' } };
ok(api._progBestForWeek(wk, ['d1e0']) === 20, 'best d1e0 = 20 (ignora e10=99 y "abc")');
ok(api._progBestForWeek(wk, ['d0e0']) === 22.5, 'coma decimal "22,5" → 22.5');
ok(api._progBestForWeek({ weights: { d1e0s1: '0' } }, ['d1e0']) === null, 'todo en 0 → null');

// _progSlotsForWeek con snapshot: match por nombre en cualquier slot
const wkSnap = { weights: { d0e0s1: '30' }, ex: { d0e0: { n: 'Press Plano con Barra', s: 3 }, d2e1: { n: 'press plano con barra', s: 3 } } };
const slots = api._progSlotsForWeek(wkSnap, null, 'd9e9', 'press plano con barra');
ok(Array.isArray(slots) && slots.length === 2 && slots.includes('d0e0') && slots.includes('d2e1'),
   `snapshot: 2 slots por nombre (dio ${JSON.stringify(slots)})`);
ok(api._progSlotsForWeek(wkSnap, null, 'd9e9', 'sentadilla hack') === null, 'snapshot sin match → null');

// legacy: calza toda la estructura → slot actual; una key fuera → null
const mapping = { days: [
  { isRest: false, exercises: [{ name: 'A', detail: '3×12 · pesado' }, { name: 'B', detail: '4×15' }] },
  { isRest: true },
  { isRest: false, exercises: [{ name: 'C', detail: '2×12' }] },
]};
const wkLegacyOk = { weights: { d0e0s1: '10', d0e0s3: '12', d0e1s4: '20', d2e0s2: '30' } };
ok(JSON.stringify(api._progSlotsForWeek(wkLegacyOk, mapping, 'd0e0', 'a')) === '["d0e0"]', 'legacy que calza → slot actual');
const wkLegacyBad = { weights: { d0e0s1: '10', d0e1s5: '20' } }; // s5 > 4 series de B
ok(api._progSlotsForWeek(wkLegacyBad, mapping, 'd0e0', 'a') === null, 'legacy con key fuera de estructura → null');
const wkLegacyRest = { weights: { d1e0s1: '10' } }; // d1 es descanso
ok(api._progSlotsForWeek(wkLegacyRest, mapping, 'd0e0', 'a') === null, 'legacy apuntando a día de descanso → null');

// _progChartSvg: sin NaN, con burbuja del último valor; casos n=1 y n=12
const mk = (n) => Array.from({ length: n }, (_, i) => ({ label: `${i + 1}/9`, val: 40 + i * 2.5 }));
for (const n of [1, 2, 12]) {
  const svg = api._progChartSvg(mk(n));
  ok(svg.includes('<svg') && !svg.includes('NaN') && svg.includes('kg'), `chart n=${n} sin NaN`);
}
ok(api._progChartSvg([{ label: 'x', val: 50 }, { label: 'y', val: 50 }]).includes('polyline'), 'chart valores iguales (min=max) no explota');
ok(api._progFmtKg(47.5) === '47.5' && api._progFmtKg(50) === '50', '_progFmtKg 47.5/50');

// ── 3) Récord personal: semántica de _prCheck (vara histórica vs silenciosa) ──
console.log('3) Récord personal (_prCheck)');
const prCheckSrc = extractFunction(html, '_prCheck');
const entNormSrc = extractFunction(html, '_entNormName');
function mkPr(baseline) {
  const env = { celebrated: [], tracked: [] };
  const fn = new Function('env', `"use strict";
    ${entNormSrc}
    const PR_ENABLED = true;
    const currentUser = { id: 'u1' };
    const entrenoWeekKey = () => '2026-W37';
    const _prBaseline = env.baseline;
    const buildTrainingDayMapping = () => ({ days: [
      { isRest: false, exercises: [{ name: 'Press inclinado con mancuernas', detail: '3×12' }] }
    ]});
    const trackEvent = (n, d) => env.tracked.push([n, d]);
    const _prCelebrate = (name, v, prev) => env.celebrated.push({ name, v, prev });
    ${prCheckSrc}
    return _prCheck;`)(Object.assign(env, { baseline }));
  return { fn, env };
}
// a) historia real 20 → 22.5 festeja y sube la vara
let t1 = mkPr({ uid: 'u1', wk: '2026-W37', loading: false, map: { 'press inclinado con mancuernas': { v: 20, hist: true } } });
t1.fn(0, 0, 1, '22.5', null);
ok(t1.env.celebrated.length === 1 && t1.env.celebrated[0].v === 22.5 && t1.env.celebrated[0].prev === 20, 'PR real festeja (20→22.5)');
ok(t1.env.baseline.map['press inclinado con mancuernas'].v === 22.5, 'la vara sube a 22.5');
t1.fn(0, 0, 2, '22.5', null);
ok(t1.env.celebrated.length === 1, 'repetir 22.5 NO re-festeja');
t1.fn(0, 0, 3, '21', null);
ok(t1.env.celebrated.length === 1, 'peso menor no festeja');
// b) sin historia previa (hist:false) → sube vara en silencio
let t2 = mkPr({ uid: 'u1', wk: '2026-W37', loading: false, map: { 'press inclinado con mancuernas': { v: 20, hist: false } } });
t2.fn(0, 0, 1, '25', null);
ok(t2.env.celebrated.length === 0 && t2.env.baseline.map['press inclinado con mancuernas'].v === 25, 'sin historia: silencio + vara sube');
// c) ejercicio sin entrada en baseline → la crea silenciosa
let t3 = mkPr({ uid: 'u1', wk: '2026-W37', loading: false, map: {} });
t3.fn(0, 0, 1, '30', null);
ok(t3.env.celebrated.length === 0 && t3.env.baseline.map['press inclinado con mancuernas'].v === 30, 'primer registro: vara silenciosa');
// d) baseline cargando o valor basura → no-op sin explotar
let t4 = mkPr({ uid: 'u1', wk: '2026-W37', loading: true, map: {} });
t4.fn(0, 0, 1, '50', null);
ok(t4.env.celebrated.length === 0, 'loading → no-op');
let t5 = mkPr({ uid: 'u1', wk: '2026-W37', loading: false, map: {} });
t5.fn(0, 0, 1, 'abc', null); t5.fn(0, 0, 1, '', null); t5.fn(9, 9, 1, '50', null);
ok(t5.env.celebrated.length === 0, 'basura / día inexistente → no-op');
// e) coma decimal también en el check
let t6 = mkPr({ uid: 'u1', wk: '2026-W37', loading: false, map: { 'press inclinado con mancuernas': { v: 20, hist: true } } });
t6.fn(0, 0, 1, '22,5', null);
ok(t6.env.celebrated.length === 1 && t6.env.celebrated[0].v === 22.5, 'coma decimal "22,5" festeja como 22.5');

console.log(fails ? `\n✗ ${fails} FALLAS` : '\n✓ TODO VERDE');
process.exit(fails ? 1 : 0);
