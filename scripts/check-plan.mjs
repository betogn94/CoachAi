// ============================================================================
// CHECK-PLAN — preview de migración por consola (espejo del preview de Studio)
// ============================================================================
// Uso:
//   node scripts/check-plan.mjs rutina <archivo.txt>
//   node scripts/check-plan.mjs dieta  <archivo.txt>
//   echo "..." | node scripts/check-plan.mjs rutina -        # lee de stdin
//
// Extrae los parsers REALES desde index.html (en vivo) y muestra exactamente
// lo que Mi Entreno / Mi Alimentación van a detectar, + si planReplyHasStructure
// lo aceptaría como plan estructurado. Sirve para validar CADA plan migrado
// ANTES de pegarlo en Studio, sin abrir el navegador.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, '..', 'index.html');

// — extractor (idéntico al de test-parsers): brace-matcher que ignora llaves en
//   comentarios/strings/templates/regex —
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
const fns = ['parseRutinaContenido', 'parseDietaContenido', 'planReplyHasStructure']
  .map(n => extractFunction(html, n)).join('\n\n');
const { parseRutinaContenido, parseDietaContenido, planReplyHasStructure } =
  new Function(`"use strict"; let lang='es'; ${fns}
    return { parseRutinaContenido, parseDietaContenido, planReplyHasStructure };`)();

// — entrada —
const tipo = process.argv[2];
const file = process.argv[3];
if (!['rutina', 'dieta'].includes(tipo) || !file) {
  console.error('Uso: node scripts/check-plan.mjs <rutina|dieta> <archivo|->');
  process.exit(2);
}
const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');

console.log(`\n${'='.repeat(60)}\nCHECK ${tipo.toUpperCase()} — ${file}\n${'='.repeat(60)}`);

if (tipo === 'rutina') {
  const days = parseRutinaContenido(text);
  const training = days.filter(d => !d.isRest);
  const rest = days.filter(d => d.isRest);
  const totalEx = training.reduce((n, d) => n + (d.exercises?.length || 0), 0);
  const empty = training.filter(d => !d.exercises?.length);
  training.forEach((d, i) => {
    console.log(`\n▸ Día ${i + 1}: ${d.label}  (${d.exercises.length} ej.)`);
    d.exercises.forEach((e, j) => {
      console.log(`   ${j + 1}. ${e.name}${e.detail ? '  —  ' + e.detail : ''}`);
      if (e.note) console.log(`        ↳ ${e.note}`);
    });
  });
  if (rest.length) console.log(`\n🛋️  Descanso: ${rest.map(d => d.label).join(' · ')}`);
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Detectado: ${training.length} días entreno · ${rest.length} descanso · ${totalEx} ejercicios`);
  if (empty.length) console.log(`⚠ ${empty.length} día(s) SIN ejercicios: ${empty.map(d => d.label).join(', ')}`);
  console.log(`Gate planReplyHasStructure: ${planReplyHasStructure('rutina', text) ? '✓ ACEPTADO' : '✗ RECHAZADO'}`);
} else {
  const { header, days } = parseDietaContenido(text);
  if (header) console.log(`\nTarget: ${header.targetKcal} kcal · P:${header.targetProt} C:${header.targetCarbs} G:${header.targetFat}`);
  days.forEach(d => {
    console.log(`\n▸ ${d.dayName}  (${d.meals.length} comidas${d.totalKcal ? `, total ${d.totalKcal}kcal` : ''})`);
    d.meals.forEach(m => console.log(`   ${m.emoji} ${m.name}: ${m.content}${m.kcal ? `  [${m.kcal}kcal]` : ''}`));
  });
  const withMeals = days.filter(d => d.meals.length);
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Detectado: ${days.length} días · ${withMeals.length} con comidas`);
  console.log(`Gate planReplyHasStructure: ${planReplyHasStructure('dieta', text) ? '✓ ACEPTADO' : '✗ RECHAZADO'}`);
}
console.log('');
