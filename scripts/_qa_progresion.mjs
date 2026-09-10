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

console.log(fails ? `\n✗ ${fails} FALLAS` : '\n✓ TODO VERDE');
process.exit(fails ? 1 : 0);
