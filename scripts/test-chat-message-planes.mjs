// ============================================================================
// TEST-CHAT-MESSAGE-PLANES — prueba OFFLINE de los planes por chat en el servidor (3.4.c).
//   node scripts/test-chat-message-planes.mjs
// Mismo fetch falso que test-chat-message-handler.mjs. Escenarios (sendToAI L25108-25310):
//   S1 plan ACTIVO + respuesta con forma de plan → candado: nada se guarda, evento plan_change_blocked,
//      aviso "ya está activa" visible (la IA conserva el texto crudo en conversation_history).
//   S2 slot libre + "🥗 Dieta de la semana" + dieta buena → se guarda (reconciliada), alertas Tower,
//      aviso "Tu dieta de la semana está lista", botón rápido deja de corresponder.
//   S3 slot libre + dieta floja (lejos del target) → plan_quality_fallback + plantilla de Jesús al target.
//   S4 slot libre + respuesta sin estructura → un pase de reformateo (2ª llamada, cuenta en el tope) → se guarda.
//   S5 slot libre + reformateo que tampoco parsea → plan_save_failed (unparseable), texto crudo visible.
//   S6 rutina con slot libre → se guarda sin clamp (la vara de kcal es solo de dieta).
//   + los prompts de normalizar son los de aiNormalizePlan de index.html, byte a byte.
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFunction } from './build-chat-prompt.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
process.env.CHAT_MESSAGE_ENABLED = '1';
process.env.CHAT_MESSAGE_ALLOW = 'uid-beto';

const hoy = new Date().toISOString().slice(0, 10);
const usuarioRow = { id: 'u-1', nombre: 'Beto', edad: 32, sexo: 'masculino', peso: '80.00', altura: '173.00', objetivo: 'definir', nivel: 'avanzado', actividad: 'moderado', dias_entreno: ['lun', 'mie'], metodo_king: false, foco_entreno: null, es_interno: false };
// Target de Beto (computeDietTarget): 2280 kcal · P160.
const DIAS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
function dietaTexto(kcalComida) {
  const macros = (k) => `P:${Math.round(k * 0.3 / 4)}g C:${Math.round(k * 0.45 / 4)}g G:${Math.round(k * 0.25 / 9)}g`;
  return `Plan nutricional — Beto | Target: ${kcalComida * 4} kcal/día\n\n` + DIAS.map((d) => `${d}\nDes: avena 80g + banana — ${kcalComida} kcal · ${macros(kcalComida)}\nAlm: pollo 200g + arroz 150g — ${kcalComida} kcal · ${macros(kcalComida)}\nMer: yogur + nueces — ${kcalComida} kcal · ${macros(kcalComida)}\nCena: merluza 200g + papa 200g — ${kcalComida} kcal · ${macros(kcalComida)}\nTotal: ${kcalComida * 4} kcal`).join('\n\n');
}
const DIETA_BUENA = dietaTexto(570); // 2280/día
const DIETA_FLOJA = dietaTexto(350); // 1400/día → "kcal lejos del target"
const RUTINA = 'Día 1 · Pierna\n1. Sentadilla — 4×12\n2. Prensa — 3×15\n3. Peso muerto rumano — 3×12\n4. Estocadas — 3×12\n---\nDía 2 · Espalda y bíceps\n1. Jalón al pecho — 4×12\n2. Remo con mancuerna — 3×12\n3. Curl con barra — 3×12\n4. Face pull — 3×15\n---\nDía 3 · Pecho y hombros\n1. Press banca — 4×10\n2. Press inclinado — 3×12\n3. Elevaciones laterales — 3×15\n4. Fondos — 3×12\n\nCardio: 20 min caminata después de cada sesión.\nDescanso: martes, jueves, sábado y domingo.';
const SIN_ESTRUCTURA = 'Acá va tu dieta de la semana, Beto. ' + 'Comé avena a la mañana, pollo al mediodía, yogur a la tarde y pescado a la noche, siete días, variando las guarniciones. '.repeat(6);
const TEMPLATE = 'Plan nutricional — {NOMBRE} | {TARGET}\n\n' + DIAS.map((d) => `${d}\nComida 1: 2 huevos + 60g avena\nComida 2: 150g pollo + 150g arroz\nComida 3: 120g carne + ensalada\nComida 4: 150g merluza + 200g papa`).join('\n\n');

const estado = { usados: 0, upserts: [], planes: [], eventos: [], alertas: [], anthropic: [], planesRow: [], respuestas: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/auth/v1/user')) return json(200, { id: 'uid-beto' });
  if (u.includes('/rpc/chat_uso_incrementa')) { estado.usados++; return json(200, estado.usados); }
  if (u.includes('/rest/v1/usuarios')) return json(200, [usuarioRow]);
  if (u.includes('/rest/v1/planes_semanales')) {
    if (init.method === 'POST') { const b = JSON.parse(init.body); estado.planes.push({ url: u, prefer: init.headers?.Prefer, body: b }); return json(201, [{ id: 'plan-1', ...b }]); }
    return json(200, estado.planesRow);
  }
  if (u.includes('/rest/v1/plan_templates')) return json(200, [{ contenido: TEMPLATE, dias: null, kcal_base: 2000, sexo: 'masculino' }, { contenido: TEMPLATE, dias: null, kcal_base: 2700, sexo: 'masculino' }, { contenido: TEMPLATE, dias: null, kcal_base: 1405, sexo: 'femenino' }]);
  if (u.includes('/rest/v1/cierres_semanales')) return json(200, []);
  if (u.includes('/rest/v1/historial_chat')) { if (init.method === 'POST') { estado.upserts.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); } return json(200, []); }
  if (u.includes('/rest/v1/progreso_diario')) return json(200, []);
  if (u.includes('/rest/v1/beta_eventos')) { estado.eventos.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (u.includes('/rest/v1/dieta_consistency_alerts')) { estado.alertas.push({ method: init.method, url: u, body: init.body ? JSON.parse(init.body) : null }); return new Response(null, { status: init.method === 'DELETE' ? 204 : 201 }); }
  if (u.includes('api.anthropic.com')) {
    estado.anthropic.push(JSON.parse(init.body));
    const text = estado.respuestas.shift() ?? 'Hola';
    return json(200, { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text }], model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn', usage: {} });
  }
  throw new Error('fetch no simulado: ' + u);
};

let fallas = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓', m); else { fallas++; console.log('  ✗', m, extra); } };
const { default: handler, NORMALIZAR } = await import('../api/chat-message.js');
const run = async (mensaje) => {
  const out = { status: 0, headers: {}, body: null };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return out; } };
  await handler({ method: 'POST', headers: { origin: 'https://coachaipro.ai', authorization: 'Bearer tok' }, body: { mensaje, fecha: hoy } }, res);
  return out;
};
const reset = () => { estado.planes = []; estado.eventos = []; estado.alertas = []; estado.anthropic = []; estado.upserts = []; };

// Prompts de normalizar = aiNormalizePlan de index.html
// (index.html mezcla CRLF y LF; los saltos se normalizan para comparar el texto)
const src = extractFunction(readFileSync(join(RAIZ, 'index.html'), 'utf8'), 'aiNormalizePlan').replace(/\r\n/g, '\n');
ok(src.includes(NORMALIZAR.rutina) && src.includes(NORMALIZAR.dieta), 'prompts de reformateo idénticos a aiNormalizePlan (index.html)');

// S1 — plan activo + respuesta con forma de dieta → candado
console.log('S1 candado');
estado.planesRow = [{ tipo: 'dieta', contenido: DIETA_BUENA, fecha_entrega: hoy, semana_iso: 'x', updated_at: 'y', origen: 'ia' }, { tipo: 'rutina', contenido: RUTINA, fecha_entrega: hoy, semana_iso: 'x', updated_at: 'y', origen: 'ia' }];
estado.respuestas = [DIETA_BUENA];
let r = await run('🥗 Dieta de la semana');
ok(r.status === 200 && r.body.plan?.estado === 'bloqueado' && r.body.plan.tipo === 'dieta', 'plan bloqueado', JSON.stringify(r.body).slice(0, 200));
ok(estado.planes.length === 0, 'no se guardó ningún plan');
ok(estado.eventos.some((e) => e.evento === 'plan_change_blocked' && e.meta.tipo === 'dieta' && e.meta.app === 'native'), 'evento plan_change_blocked');
ok(r.body.reply_html.includes('🔒 Tu dieta de esta semana ya está activa') && estado.upserts[0].mensajes[1].content === r.body.reply_html && estado.upserts[0].conversation_history[1].content === DIETA_BUENA, 'aviso visible; el texto crudo queda en conversation_history');
ok(estado.anthropic.length === 1, 'sin reformateo cuando el candado frena igual');

// S2 — slot libre + dieta buena
console.log('S2 slot libre, dieta buena');
reset(); estado.planesRow = []; estado.respuestas = [DIETA_BUENA];
r = await run('🥗 Dieta de la semana');
ok(r.body.plan?.estado === 'guardado' && r.body.plan.tipo === 'dieta', 'plan guardado', JSON.stringify(r.body.plan));
const p = estado.planes[0];
ok(p && p.url.includes('on_conflict=usuario_id,tipo,semana_iso') && p.body.usuario_id === 'u-1' && p.body.tipo === 'dieta' && p.body.origen === 'ia' && p.body.fecha_entrega === hoy && /^\d{4}-W\d{2}$/.test(p.body.semana_iso), 'upsert en planes_semanales con la clave de saveWeeklyPlan', JSON.stringify(p?.body).slice(0, 150));
ok(p.body.contenido !== DIETA_BUENA && p.body.contenido.includes('kcal · P:') && p.body.contenido.split('\n').length === DIETA_BUENA.split('\n').length, 'contenido reconciliado (kcal = 4P+4C+9G) sin cambiar la estructura');
ok(r.body.reply_html.includes('🥗 Tu dieta de la semana está lista') && estado.upserts[0].mensajes[1].content === r.body.reply_html, 'aviso "plan listo" visible y persistido');
ok(estado.alertas[0]?.method === 'DELETE' && estado.alertas[0].url.includes('plan_id=eq.plan-1'), 'alertas Tower: limpieza del plan');
ok(!estado.eventos.some((e) => e.evento === 'plan_quality_fallback'), 'sin fallback: la dieta pasa la vara');

// S3 — slot libre + dieta floja → plantilla
console.log('S3 slot libre, dieta floja → plantilla de Jesús');
reset(); estado.respuestas = [DIETA_FLOJA];
r = await run('pasame la dieta');
ok(estado.eventos.some((e) => e.evento === 'plan_quality_fallback' && /kcal lejos del target/.test(e.meta.reasons)), 'evento plan_quality_fallback con la razón');
ok(estado.planes[0]?.body.contenido.startsWith('Plan nutricional — Beto | Target: 2280 kcal/día | P:160g') && estado.planes[0].body.contenido.includes('Comida 1: 2 huevos'), 'se guardó la plantilla masculina más cercana con nombre y target', estado.planes[0]?.body.contenido.slice(0, 80));
ok(r.body.plan?.estado === 'guardado' && r.body.reply_html.includes('está lista'), 'y la usuaria ve "plan listo"');

// S4 — sin estructura → reformateo → guardado
console.log('S4 sin estructura → reformateo');
reset(); estado.respuestas = [SIN_ESTRUCTURA, DIETA_BUENA];
const usadosAntes = estado.usados;
r = await run('🥗 Dieta de la semana');
ok(estado.anthropic.length === 2 && estado.anthropic[1].system === NORMALIZAR.dieta && estado.anthropic[1].messages[0].content === SIN_ESTRUCTURA, 'segunda llamada con el prompt de reformateo');
ok(estado.usados === usadosAntes + 2, 'el reformateo cuenta en el tope');
ok(r.body.plan?.estado === 'guardado' && estado.planes.length === 1, 'la versión reformateada se guardó');

// S5 — reformateo que tampoco parsea
console.log('S5 reformateo falla');
reset(); estado.respuestas = [SIN_ESTRUCTURA, 'sigue sin estructura ' + 'x'.repeat(500)];
r = await run('🥗 Dieta de la semana');
ok(r.body.plan?.estado === 'no_guardado' && estado.planes.length === 0, 'no se guarda nada');
ok(estado.eventos.some((e) => e.evento === 'plan_save_failed' && e.meta.reason === 'unparseable'), 'evento plan_save_failed (unparseable)');
ok(r.body.reply_html === estado.upserts[0].mensajes[1].content && r.body.reply_html.includes('Acá va tu dieta'), 'texto crudo visible (honest display)');

// S6 — rutina con slot libre
console.log('S6 rutina');
reset(); estado.respuestas = [RUTINA];
r = await run('💪 Rutina de la semana');
ok(r.body.plan?.estado === 'guardado' && estado.planes[0]?.body.tipo === 'rutina' && estado.planes[0].body.contenido === RUTINA && r.body.reply_html.includes('💪 Tu rutina de la semana está lista'), 'rutina guardada tal cual + aviso');
ok(estado.alertas.length === 0 && !estado.eventos.length, 'sin alertas ni fallback para rutina');

// S7 — respuesta casual con slot libre: no es entrega
console.log('S7 casual');
reset(); estado.respuestas = ['Tomá 2 a 3 litros de agua por día.'];
r = await run('¿Cuánta agua tomo?');
ok(r.body.plan === null && estado.planes.length === 0 && r.body.reply_html === 'Tomá 2 a 3 litros de agua por día.', 'mensaje casual intacto');

// S8 — cuenta interna sin estar en la allowlist pasa
console.log('S8 allowlist + es_interno');
process.env.CHAT_MESSAGE_ALLOW = 'otro-uid';
usuarioRow.es_interno = true; reset(); estado.respuestas = ['Hola'];
r = await run('Hola');
ok(r.status === 200, 'es_interno pasa con allowlist ajena');
usuarioRow.es_interno = false; reset(); estado.respuestas = ['Hola'];
r = await run('Hola');
ok(r.status === 404, 'no interna y fuera de la allowlist → 404');

console.log(fallas ? `\n✗ ${fallas} falla(s)` : '\n✓ planes por chat OK offline');
process.exit(fallas ? 1 : 0);
