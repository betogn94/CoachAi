// ============================================================================
// TEST-CHAT-MESSAGE — paridad OFFLINE del cerebro en el servidor (3.4.b / B3). No pega a ninguna API.
//   node scripts/test-chat-message.mjs
// 1. api/_chat/cerebro-pwa.mjs está al día con index.html (lo que corre en Vercel = lo que corre la PWA).
// 2. Con los MISMOS datos, el prompt del servidor (crearCerebro(ctx)) es IDÉNTICO byte a byte al de
//    la PWA (buildSystemPrompt real corriendo con un DOM stub, como test-generation.mjs) para varios
//    perfiles: mujer King, varón con foco, vegana, inglés, planes activos / cerrados / sin planes.
// 3. armarCtx mapea las columnas de `usuarios` a lo que la PWA tendría en el formulario (defaults
//    incluidos) y turnosPrevios replica el MAX_TURNS=40 de launchCoach.
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crearCerebro } from '../api/_chat/cerebro-pwa.mjs';
import { armarCtx, armarWeeklyPlans, fechaMas, fechaValida, turnosPrevios } from '../api/_chat/contexto.mjs';
import { CONSTANTES, extractConst, extractFunction, FUNCIONES, generar } from './build-chat-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
let fallas = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { fallas++; console.log('  ✗', msg); } };

// 1. Generado al día
console.log('1. cerebro-pwa.mjs vs index.html');
ok(readFileSync(join(RAIZ, 'api', '_chat', 'cerebro-pwa.mjs'), 'utf8') === generar(), 'el archivo generado coincide con lo que sale de index.html hoy');

// 2. PWA real con DOM stub (globals como los tiene la PWA en memoria) vs servidor
console.log('2. prompt PWA (DOM stub) vs prompt servidor (ctx)');
const src = [...CONSTANTES.map((c) => extractConst(html, c)), ...FUNCIONES.map((n) => extractFunction(html, n))].join('\n');
function promptPWA(ctx) {
  const names = ['document', 'window', 'lang', 'selections', 'selectedDias', 'selectedComidas', 'weeklyPlans', 'allChatHistory', 'recentChatHistory', 'recentDiario', 'currentUser', 'Date'];
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(ctx.ahora); } static now() { return ctx.ahora; } }
  const vals = [
    { getElementById: (id) => ({ value: ctx.form[id] ?? '' }), querySelectorAll: (sel) => (sel.includes('lesiones') ? ctx.chips.lesiones : sel.includes('dieta') ? ctx.chips.dieta : ctx.chips.alergias).map((t) => ({ textContent: t })) },
    undefined, ctx.lang, ctx.selections, ctx.selectedDias, ctx.selectedComidas, ctx.weeklyPlans, ctx.allChatHistory, ctx.recentChatHistory, ctx.recentDiario, ctx.currentUser, FixedDate,
  ];
  return new Function(...names, `"use strict"; ${src}\n return buildSystemPrompt();`)(...vals);
}
const base = {
  nombre: 'Sofía', edad: 30, sexo: 'femenino', peso: '65.00', altura: '165.00', objetivo: 'definir', nivel: 'intermedio', actividad: 'moderado',
  dias_entreno: ['lun', 'mar', 'jue', 'vie'], lugar_entreno: null, lesiones: null, restricciones_dieta: null, alergias: null, comidas_dia: null, no_le_gusta: null, metodo_king: false, foco_entreno: null,
};
const dieta = 'Plan nutricional — Sofía | Target: 1500 kcal\nLUNES\nDesayuno: avena 300kcal\nAlmuerzo: pollo 500kcal\nMARTES\nDesayuno: huevos 300kcal';
const rutina = 'Día 1 · Pierna\n1. Sentadilla — 3×12\n2. Hip thrust — 3×12\n---\nDía 2 · Espalda\n1. Remo — 3×10\nDescanso: miércoles';
const planes = [{ tipo: 'dieta', contenido: dieta, fecha_entrega: '2026-10-12', semana_iso: '2026-W42', updated_at: '2026-10-12T10:00:00Z', origen: 'ia' }, { tipo: 'rutina', contenido: rutina, fecha_entrega: '2026-10-12', semana_iso: '2026-W42', updated_at: '2026-10-12T10:00:00Z', origen: 'coach' }];
const historial = [
  { fecha: '2026-10-01', mensajes: [{ content: 'hola', type: 'coach' }], conversation_history: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Hola Sofía' }] },
  { fecha: '2026-10-13', mensajes: [{ content: 'x', type: 'user' }], conversation_history: [{ role: 'user', content: '¿Qué como hoy?' }, { role: 'assistant', content: 'Pollo' }] },
];
const diario = [{ fecha: '2026-10-12', desayuno: 'avena', almuerzo: null, merienda: null, cena: 'pollo', calorias_consumidas: 1400, proteinas_g: 110, entreno: true, ejercicios_realizados: null }, { fecha: '2026-10-13', desayuno: null, entreno: false }];
const casos = [
  ['mujer default, planes activos', { usuario: base, planes, cierres: [], historial, diario, fecha: '2026-10-14' }],
  ['mujer King (metodo_king) sin planes', { usuario: { ...base, metodo_king: true }, planes: [], cierres: [], historial: [], diario: [], fecha: '2026-10-14' }],
  ['varón con foco brazos, planes cerrados', { usuario: { ...base, nombre: 'Beto', sexo: 'masculino', nivel: 'avanzado', foco_entreno: 'brazos' }, planes, cierres: [{ fecha_fin: '2026-10-12' }], historial, diario, fecha: '2026-10-14' }],
  ['vegana con lesión de rodilla y alergia', { usuario: { ...base, restricciones_dieta: ['Vegano'], lesiones: ['Rodilla'], alergias: ['Huevo'], comidas_dia: '4', no_le_gusta: 'pescado', lugar_entreno: 'casa_mancuernas', cuello: 34, cintura: 70, cadera: 95 }, planes: [], cierres: [], historial, diario, fecha: '2026-10-14' }],
  ['inglés', { usuario: base, planes, cierres: [], historial, diario, fecha: '2026-10-14', lang: 'en' }],
  ['sin perfil completo (nulls)', { usuario: { nombre: null, edad: null, sexo: null, peso: null, altura: null, objetivo: null, nivel: null, actividad: null, dias_entreno: null }, planes: [], cierres: [], historial: [], diario: [], fecha: '2026-01-01' }],
];
for (const [nombre, entrada] of casos) {
  const ctx = armarCtx(entrada);
  const a = promptPWA(ctx), b = crearCerebro(ctx).buildSystemPrompt();
  ok(a === b && a.length > 1000, `${nombre}: ${a.length} chars idénticos`);
  if (a !== b) { let i = 0; while (a[i] === b[i]) i++; console.log('    difiere en', i, JSON.stringify(a.slice(i - 40, i + 60)), '\n    vs', JSON.stringify(b.slice(i - 40, i + 60))); }
}

// 3. Mapeo usuarios → formulario + helpers
console.log('3. armarCtx / turnosPrevios / fechas');
const c4 = armarCtx(casos[3][1]);
ok(c4.form['f-lugar'] === 'casa_mancuernas' && c4.form['f-nodislike'] === 'pescado' && c4.form['f-cuello'] === '34' && c4.chips.dieta[0] === 'Vegano' && c4.selectedComidas === '4', 'columnas de usuarios → campos y chips');
const c0 = armarCtx(casos[0][1]);
ok(c0.form['f-lugar'] === 'gimnasio_completo' && c0.form['f-nodislike'] === '' && c0.chips.dieta.length === 0 && c0.selectedComidas === '' && c0.form['f-peso'] === '65.00', 'defaults de la PWA cuando las columnas son null');
ok(c0.recentChatHistory[0].fecha === '2026-10-13' && c0.recentChatHistory.length === 2 && c0.allChatHistory.length === 2, 'recentChatHistory = últimas filas, más reciente primero');
const cer = crearCerebro(c0);
ok(cer.getISOWeekKey() === '2026-W42' && cer.formatLocalDate(new Date()) === '2026-10-14', 'el "hoy" del cerebro es la fecha del teléfono (ISO W42, 2026-10-14)');
ok(crearCerebro(armarCtx({ ...casos[0][1], fecha: '2026-01-01' })).getISOWeekKey() === '2026-W01', 'fecha 2026-01-01 → W01');
const wp = armarWeeklyPlans(planes, [{ fecha_fin: '2026-10-12' }]);
ok(wp.dieta.closed === true && wp.rutina.closed === true && armarWeeklyPlans(planes, []).dieta.closed === false, 'closed = cierre con fecha_fin ≥ fecha_entrega');
const muchos = Array.from({ length: 10 }, (_, i) => ({ fecha: `2026-10-${String(i + 1).padStart(2, '0')}`, conversation_history: Array.from({ length: 10 }, (_, j) => ({ role: j % 2 ? 'assistant' : 'user', content: `${i}-${j}` })) }));
const t = turnosPrevios(muchos);
ok(t.length === 40 && t[0].content === '6-0' && t[39].content === '9-9', 'turnosPrevios: últimas 7 filas, tope 40 turnos');
ok(cer.sanitizeTurnsForAPI([...t, { role: 'user', content: 'nuevo' }]).slice(-1)[0].content === 'nuevo', 'el mensaje nuevo queda último tras sanear');
const hoyUtc = new Date().toISOString().slice(0, 10);
ok(fechaValida(hoyUtc) && fechaValida(fechaMas(hoyUtc, -1)) && fechaValida(fechaMas(hoyUtc, 1)) && !fechaValida(fechaMas(hoyUtc, 2)) && !fechaValida('14/10/2026') && !fechaValida(''), 'fechaValida: hoy ±1 día, formato estricto');
ok(fechaMas('2026-03-01', -1) === '2026-02-28' && fechaMas('2025-12-31', 1) === '2026-01-01', 'fechaMas cruza meses y años');

console.log(fallas ? `\n✗ ${fallas} falla(s)` : '\n✓ todo idéntico / correcto');
process.exit(fallas ? 1 : 0);
