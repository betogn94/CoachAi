// ============================================================================
// BUILD-CHAT-PROMPT — mueve el "cerebro" del chat (3.4.b / B3) de index.html al servidor
// SIN reescribirlo: extrae del index.html vivo las funciones y constantes REALES que arman el
// system prompt (buildSystemPrompt + métodos + reglas), los detectores de planes, el saneado de
// turnos y formatResponse, y las envuelve en `crearCerebro(ctx)` (api/_chat-cerebro.js).
//
//   node scripts/build-chat-prompt.mjs          → regenera api/_chat-cerebro.js
//   node scripts/build-chat-prompt.mjs --check  → falla si el archivo commiteado no coincide
//                                                  con lo que sale de index.html HOY (paridad)
//
// Mientras la PWA viva, la fuente de verdad del prompt sigue siendo index.html y este archivo
// es DERIVADO (regenerar tras cada cambio de prompt). Cuando la PWA se apague, el generado pasa
// a ser la fuente. NO toca index.html.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const SALIDA = join(RAIZ, 'api', '_chat-cerebro.js');

// Scanner con stack (copia de test-generation.mjs): templates anidados, strings, comentarios, regex.
export function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`No encontré function ${name}`);
  let i = src.indexOf('{', start);
  const stack = [{ kind: 'code', depth: 1, prevSig: '' }];
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
    if (top.inLine) { if (c === '\n') top.inLine = false; continue; }
    if (top.inBlock) { if (c === '*' && c2 === '/') { top.inBlock = false; i++; } continue; }
    if (top.inStr) { if (c === '\\') { i++; continue; } if (c === top.strCh) top.inStr = false; continue; }
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

// `const NAME = \`...\`;` (template sin ${}) o `const NAME = /regex/;` (una línea).
export function extractConst(src, name) {
  const m = new RegExp(`\\nconst\\s+${name}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`No encontré const ${name}`);
  const start = m.index + 1;
  const i = m.index + m[0].length;
  if (src[i] === '`') {
    const end = src.indexOf('`', i + 1);
    if (end === -1) throw new Error(`Backtick sin cerrar en ${name}`);
    return src.slice(start, end + 1) + ';';
  }
  // Fin de la sentencia: ";" seguido de salto de línea (index.html mezcla LF y CRLF).
  const rel = src.slice(i).search(/;\r?\n/);
  if (rel === -1) throw new Error(`Sin fin de sentencia en ${name}`);
  return src.slice(start, i + rel + 1);
}

// Lo que arma el prompt + lo que decide qué hacer con la respuesta (clausura cerrada: probada con
// un sandbox que registra identificadores libres — no falta ninguno).
export const FUNCIONES = [
  'buildSystemPrompt', 'buildHistorySummary', 'buildDiarioSummary', 'kingEsCohorte', '_koMapaPromptBlock', '_koNormArq',
  '_bloqueRestriccionDieta', '_focoPromptBlock', 'countUniqueDays', 'getISOWeekKey', 'formatLocalDate',
  'parseDietaContenido', 'parseRutinaContenido', 'sanitizeTurnsForAPI', 'detectPlanRequest', 'detectPlanInReply',
  'planReplyHasStructure', 'formatResponse', 'computeDietTarget',
];
export const CONSTANTES = [
  'METODO_RELOJ_ARENA_ES', 'METODO_V_MASCULINO_ES', 'REGLAS_KING_MUJER_ES', 'REGLAS_KING_DIETA_ES',
  'REGLAS_VEGANAS_ES', 'REGLAS_VEGETARIANAS_ES', 'REGLAS_VEGANAS_EN', 'REGLAS_VEGETARIANAS_EN', 'DAY_REGEX',
];

export function generar() {
  const cuerpo = [...CONSTANTES.map((c) => extractConst(html, c)), ...FUNCIONES.map((n) => extractFunction(html, n))].join('\n\n');
  return `// ============================================================================
// GENERADO por scripts/build-chat-prompt.mjs desde index.html — NO EDITAR A MANO.
// Regenerar: node scripts/build-chat-prompt.mjs · Verificar: node scripts/build-chat-prompt.mjs --check
// ============================================================================
// El "cerebro" del chat de la PWA (buildSystemPrompt + métodos Babot + reglas King/veganas +
// detectores de planes + saneado de turnos + formatResponse), tal cual viven en index.html, con
// las variables globales y el DOM que leen reemplazados por \`ctx\`:
//   ctx.form          { 'f-nombre', 'f-edad', 'f-sexo', 'f-peso', 'f-altura', 'f-actividad', 'f-lugar',
//                       'f-nodislike', 'f-cuello', 'f-cintura-form', 'f-cadera-form' } (strings)
//   ctx.chips         { lesiones: string[], dieta: string[], alergias: string[] } (texto de los chips)
//   ctx.selections    { objetivo, nivel } · ctx.selectedDias string[] · ctx.selectedComidas string
//   ctx.weeklyPlans   { dieta, rutina } como loadCurrentWeekPlans (con .closed)
//   ctx.allChatHistory  filas de historial_chat (para isReturningUser)
//   ctx.recentChatHistory  últimas 7 filas, más reciente primero (como launchCoach)
//   ctx.recentDiario  progreso_diario asc (buildDiarioSummary toma los últimos 7)
//   ctx.currentUser   { metodo_king, foco_entreno }
//   ctx.lang          'es' | 'en'
//   ctx.ahora         ms del "hoy" de la usuaria (mediodía UTC de su fecha local): fija new Date()
//                     sin argumentos para getISOWeekKey / formatLocalDate.
// Funciones: ${FUNCIONES.join(', ')}
// Constantes: ${CONSTANTES.join(', ')}

export function crearCerebro(ctx) {
  const document = {
    getElementById: (id) => ({ value: (ctx.form && ctx.form[id] != null) ? String(ctx.form[id]) : '' }),
    querySelectorAll: (sel) => {
      const grupo = /lesiones-chips/.test(sel) ? 'lesiones' : /dieta-chips/.test(sel) ? 'dieta' : /alergia-chips/.test(sel) ? 'alergias' : null;
      return ((grupo && ctx.chips && ctx.chips[grupo]) || []).map((t) => ({ textContent: String(t) }));
    },
  };
  const window = undefined; // _koMapaPromptBlock pregunta typeof window (el Mapa King es solo del onboarding)
  const RealDate = globalThis.Date;
  // "Hoy" es el de la usuaria (ctx.ahora), no el reloj UTC del servidor.
  class Date extends RealDate { constructor(...a) { if (a.length) super(...a); else super(ctx.ahora != null ? ctx.ahora : RealDate.now()); } static now() { return ctx.ahora != null ? ctx.ahora : RealDate.now(); } }
  const lang = ctx.lang || 'es';
  const selections = ctx.selections || { objetivo: '', nivel: '' };
  const selectedDias = Array.isArray(ctx.selectedDias) ? ctx.selectedDias : [];
  const selectedComidas = ctx.selectedComidas || '';
  const weeklyPlans = ctx.weeklyPlans || { dieta: null, rutina: null };
  const allChatHistory = Array.isArray(ctx.allChatHistory) ? ctx.allChatHistory : [];
  const recentChatHistory = Array.isArray(ctx.recentChatHistory) ? ctx.recentChatHistory : [];
  const recentDiario = Array.isArray(ctx.recentDiario) ? ctx.recentDiario : [];
  const currentUser = ctx.currentUser || null;

// (cuerpo VERBATIM, sin re-indentar: un espacio de más adentro de un template literal cambia el prompt)
${cuerpo}

  return { ${FUNCIONES.join(', ')} };
}
`;
}

// Solo como script (importado desde los tests no escribe nada).
const esScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const check = process.argv.includes('--check');
const nuevo = esScript ? generar() : null;
if (!esScript) {
  // nada
} else if (check) {
  const actual = existsSync(SALIDA) ? readFileSync(SALIDA, 'utf8') : '';
  if (actual !== nuevo) {
    console.error(`✗ ${SALIDA} está DESACTUALIZADO respecto de index.html → node scripts/build-chat-prompt.mjs`);
    process.exit(1);
  }
  console.log('✓ api/_chat-cerebro.js coincide con index.html');
} else {
  mkdirSync(dirname(SALIDA), { recursive: true });
  writeFileSync(SALIDA, nuevo);
  console.log(`✓ escrito ${SALIDA} (${nuevo.split('\n').length} líneas)`);
}
