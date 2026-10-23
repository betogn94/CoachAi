// ============================================================================
// TEST-PLAN-GENERATE — paridad y prueba OFFLINE de /api/plan-generate (3.5.f del port RN). No pega a
// ninguna API ni toca la base.
//   node scripts/test-plan-generate.mjs
// 1. api/_chat-cerebro.js al día con index.html.
// 2. El system prompt con los días/foco NUEVOS que arma el servidor es IDÉNTICO byte a byte al que arma
//    la PWA en renovGenerate (selectedDias + currentUser.foco_entreno pisados antes de prefetchPlan).
// 3. El handler con fetch falso: interruptor, auth, allowlist, origin, validación; `elegible` (las 9
//    razones + 2 positivos); `renovar`: guarda días/foco, hasta 2 intentos con esqueleto, reformateo,
//    fuera de esqueleto, vara → plantilla, fecha_entrega posterior al cierre, IA caída, tope, save fallido.
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
process.env.PLAN_GENERATE_ENABLED = '1';
process.env.PLAN_GENERATE_ALLOW = 'uid-beto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const { crearCerebro } = await import('../api/_chat-cerebro.js');
const { armarCtx, fechaMas } = await import('../api/_chat-contexto.js');
const { CONSTANTES, extractConst, extractFunction, FUNCIONES, generar } = await import('./build-chat-prompt.mjs');
const { NORMALIZAR } = await import('../api/chat-message.js');
let fallas = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓', m); else { fallas++; console.log('  ✗', m, extra); } };

// ─── 1 ───
console.log('1. api/_chat-cerebro.js vs index.html');
// Comparación sin CRLF: un checkout de Windows (worktree con autocrlf) puede convertir saltos del archivo.
const sinCrlf = (s) => s.replace(/\r\n/g, '\n');
ok(sinCrlf(readFileSync(join(RAIZ, 'api', '_chat-cerebro.js'), 'utf8')) === sinCrlf(generar()), 'el generado coincide con index.html hoy');

// ─── 2. Prompt con días/foco nuevos: PWA (globales pisados como en renovGenerate) vs servidor ───
console.log('2. prompt de la rutina renovada: PWA vs servidor');
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
const hoy = new Date().toISOString().slice(0, 10);
const base = { id: 'u-1', nombre: 'Beto', edad: 32, sexo: 'masculino', peso: '80.00', altura: '173.00', objetivo: 'definir', nivel: 'avanzado', actividad: 'moderado', dias_entreno: ['lun', 'mie'], lesiones: ['Rodilla'], metodo_king: false, foco_entreno: null, self_serve: true, role: 'user', email: 'beto@x.com', es_interno: false };
const rutinaVieja = 'Día 1 · Pierna\n1. Sentadilla — 3×12\n2. Hip thrust — 3×12\n3. Prensa — 3×12\n---\nDía 2 · Espalda\n1. Remo — 3×10\n2. Jalón — 3×12\n3. Pull-over — 3×12\nCardio: 10 min\nDescanso: miércoles';
// La situación real de la renovación: el cierre de la semana 4 terminó AYER y `autoRepeatPlans` ya clonó la
// rutina (origen heredado 'ia') con fecha_entrega HOY (posterior al cierre → no está cerrada).
const AYER = fechaMas(hoy, -1);
const planesIa = [{ tipo: 'rutina', contenido: rutinaVieja, fecha_entrega: hoy, semana_iso: '2026-W40', updated_at: '2026-10-01T10:00:00Z', origen: 'ia' }];
const historial = [{ fecha: fechaMas(hoy, -2), mensajes: [], conversation_history: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Hola Beto' }] }];
const diario = [{ fecha: fechaMas(hoy, -1), desayuno: 'avena', calorias_consumidas: 1800, proteinas_g: 140, entreno: true }];
const casosPrompt = [
  ['varón 4 días foco brazos', base, ['lun', 'mie', 'vie', 'sab'], 'brazos'],
  ['mujer 3 días foco glúteos', { ...base, nombre: 'Sofía', sexo: 'femenino', nivel: 'intermedio' }, ['mar', 'jue', 'sab'], 'gluteos'],
  ['mujer King 2 días tren superior', { ...base, nombre: 'Ana', sexo: 'femenino', metodo_king: true, self_serve: false }, ['lun', 'jue'], 'superior'],
  ['varón 5 días sin foco (antes tenía brazos)', { ...base, foco_entreno: 'brazos' }, ['lun', 'mar', 'mie', 'jue', 'vie'], null],
  ['inglés', base, ['lun', 'mie', 'vie'], 'fullbody', 'en'],
];
for (const [nombre, usuario, dias, foco, lang] of casosPrompt) {
  const entrada = { usuario, planes: planesIa, cierres: [{ semana_num: 4, fecha_fin: AYER }], historial, diario, fecha: hoy, lang: lang || 'es' };
  // PWA (renovGenerate L31393): selectedDias y currentUser pisados en memoria antes de prefetchPlan.
  const ctxPWA = armarCtx(entrada);
  ctxPWA.selectedDias = dias.slice();
  ctxPWA.currentUser = { ...ctxPWA.currentUser, dias_entreno: dias.slice(), foco_entreno: foco };
  // Servidor (accionRenovar): lo mismo sobre su ctx.
  const ctxSrv = armarCtx(entrada);
  ctxSrv.selectedDias = dias.slice();
  ctxSrv.currentUser = { ...ctxSrv.currentUser, foco_entreno: foco };
  const a = promptPWA(ctxPWA), b = crearCerebro(ctxSrv).buildSystemPrompt();
  const esq = crearCerebro(ctxSrv)._splitSemanal(usuario.sexo, dias.length);
  const en = lang === 'en';
  ok(a === b && a.length > 1000 && b.includes(`${en ? 'Day' : 'Día'} 1 · `) && b.includes(`EXACTLY ${dias.length}`.replace('EXACTLY', en ? 'EXACTLY' : 'EXACTAMENTE')) && (foco ? b.includes(en ? 'FOCUS' : 'FOCO') : true), `${nombre}: ${a.length} chars idénticos, esqueleto de ${dias.length} días`);
  if (a !== b) { let i = 0; while (a[i] === b[i]) i++; console.log('    difiere en', i, JSON.stringify(a.slice(i - 40, i + 60)), '\n    vs', JSON.stringify(b.slice(i - 40, i + 60))); }
}

// ─── 3. Handler offline ───
console.log('3. handler /api/plan-generate con fetch falso');
const cer = crearCerebro(armarCtx({ usuario: base, planes: [], cierres: [], historial: [], diario: [], fecha: hoy }));
const EJ = { gluteos: ['Hip thrust', 'Patada de glúteo', 'Puente de glúteo', 'Abducción en máquina', 'Peso muerto sumo', 'Sentadilla búlgara'], cuadriceps: ['Extensión de cuádriceps', 'Sentadilla hack', 'Prensa', 'Sentadilla frontal', 'Zancadas'], femorales: ['Curl femoral acostado', 'Curl femoral sentado', 'Peso muerto rumano', 'Buenos días'], espalda: ['Jalón al pecho', 'Remo con barra', 'Remo en polea baja', 'Pull-over', 'Dominadas asistidas'], hombros: ['Elevaciones laterales', 'Press militar', 'Pájaros', 'Elevaciones frontales'], biceps: ['Curl con barra', 'Curl martillo', 'Curl concentrado', 'Curl inclinado'], triceps: ['Extensión en polea', 'Fondos en banco', 'Press francés', 'Patada de tríceps'], pecho: ['Press plano', 'Press inclinado', 'Aperturas', 'Pec deck', 'Crossover'], trapecios: ['Encogimientos', 'Remo al mentón'], pantorrillas: ['Elevación de talones de pie', 'Elevación de talones sentado'] };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Una rutina que cumple el esqueleto de Jesús para ese sexo y días (y la vara, salvo que se le saque el cardio). */
function rutinaFixture(sexo, n, { sinCardio = false, titulo1 = null } = {}) {
  let out = '';
  cer._splitSemanal(sexo, n).forEach((d, i) => {
    out += `Día ${i + 1} · ${i === 0 && titulo1 ? titulo1 : d.titulo}\n`;
    let k = 1;
    d.musculos.forEach((m) => { const lista = EJ[norm(m.musculo)] || ['Ejercicio']; for (let j = 0; j < m.ejercicios; j++) out += `${k++}. ${lista[j % lista.length]} — 3×12 · desc 60s\n`; });
    if (!sinCardio) out += 'Cardio: 15 min caminata inclinada\n';
    out += '\n';
  });
  return out + 'Descanso: resto de los días\n';
}
const RUTINA_OK = rutinaFixture('masculino', 4);
ok(cer.planReplyHasStructure('rutina', RUTINA_OK) && !cer.validarRutinaEsqueleto(RUTINA_OK, 'masculino', 4).length && cer.evaluatePlanQuality('rutina', RUTINA_OK, { expectedDays: 4 }).ok, 'fixture: cumple estructura, esqueleto y vara');
const RUTINA_MAL_ESQ = rutinaFixture('masculino', 4, { titulo1: 'Pierna completa' });
ok(cer.planReplyHasStructure('rutina', RUTINA_MAL_ESQ) && cer.validarRutinaEsqueleto(RUTINA_MAL_ESQ, 'masculino', 4).length > 0, 'fixture: fuera de esqueleto (título del día 1 distinto)');
const RUTINA_FLOJA = rutinaFixture('masculino', 4, { sinCardio: true });
ok(!cer.evaluatePlanQuality('rutina', RUTINA_FLOJA, { expectedDays: 4 }).ok, 'fixture: cumple esqueleto pero no la vara (sin cardio)');
const SIN_ESTRUCTURA = 'Acá va tu rutina nueva: el lunes hacés pecho y tríceps con press plano, el miércoles espalda con remo…';
ok(!cer.planReplyHasStructure('rutina', SIN_ESTRUCTURA), 'fixture: sin estructura');
const PLANTILLA = 'Día 1 · Full body ({NOMBRE})\n1. Sentadilla — 3×12\n2. Remo — 3×12\n3. Press — 3×12\n4. Plancha — 3×30s\nCardio: 20 min\nDescanso: según tus días';

const S = { usuario: base, planes: planesIa, cierres: [{ semana_num: 4, fecha_fin: AYER }], replies: [], anthropic: [], usados: 0, patches: [], upserts: [], eventos: [], templates: [{ tipo: 'rutina', contenido: PLANTILLA, dias: 4, kcal_base: null, sexo: 'masculino' }], falloAnthropic: null, falloUpsert: false };
const reset = (o = {}) => Object.assign(S, { usuario: base, planes: planesIa, cierres: [{ semana_num: 4, fecha_fin: AYER }], replies: [], anthropic: [], usados: 0, patches: [], upserts: [], eventos: [], falloAnthropic: null, falloUpsert: false }, o);
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/auth/v1/user')) {
    const tok = (init.headers?.authorization || '').replace('Bearer ', '');
    return tok === 'tok-beto' ? json(200, { id: 'uid-beto' }) : tok === 'tok-otra' ? json(200, { id: 'uid-otra' }) : json(401, {});
  }
  if (u.includes('/rpc/chat_uso_incrementa')) { S.usados++; return json(200, S.usados); }
  if (u.includes('/rest/v1/usuarios')) {
    if (init.method === 'PATCH') { S.patches.push({ url: u, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
    return json(200, u.includes('uid-beto') || u.includes('uid-otra') ? [S.usuario] : []);
  }
  if (u.includes('/rest/v1/planes_semanales')) {
    if (init.method === 'POST') {
      if (S.falloUpsert) return json(500, { message: 'boom' });
      const b = JSON.parse(init.body);
      S.upserts.push({ url: u, prefer: init.headers?.Prefer, body: b });
      return json(201, [{ id: 'plan-nuevo', ...b }]);
    }
    return json(200, S.planes);
  }
  if (u.includes('/rest/v1/cierres_semanales')) return json(200, S.cierres);
  if (u.includes('/rest/v1/historial_chat')) return json(200, historial);
  if (u.includes('/rest/v1/progreso_diario')) return json(200, diario);
  if (u.includes('/rest/v1/plan_templates')) return json(200, S.templates);
  if (u.includes('/rest/v1/beta_eventos')) { S.eventos.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (u.includes('api.anthropic.com')) {
    const body = JSON.parse(init.body);
    S.anthropic.push(body);
    if (S.falloAnthropic) return json(S.falloAnthropic, { error: { type: 'overloaded_error', message: 'x' } });
    const text = S.replies.length ? S.replies.shift() : RUTINA_OK;
    return json(200, { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text }], model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn', usage: {} });
  }
  throw new Error('fetch no simulado: ' + u);
};

const { default: handler, elegibilidad, normalizarDias } = await import('../api/plan-generate.js');
const run = async (body, { token = 'tok-beto', origin = 'https://coachaipro.ai', method = 'POST' } = {}) => {
  const out = { status: 0, headers: {}, body: null };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return out; } };
  await handler({ method, headers: { origin, authorization: token ? `Bearer ${token}` : '' }, body }, res);
  return out;
};
const ev = (nombre) => S.eventos.filter((e) => e.evento === nombre);

// 3a. Guardas
process.env.PLAN_GENERATE_ENABLED = '0';
ok((await run({ accion: 'elegible', fecha: hoy })).status === 404, 'apagado (sin PLAN_GENERATE_ENABLED=1) → 404');
process.env.PLAN_GENERATE_ENABLED = '1';
ok((await run({ accion: 'elegible', fecha: hoy }, { method: 'GET' })).status === 405, 'GET → 405');
ok((await run({ accion: 'elegible', fecha: hoy }, { origin: 'https://evil.com' })).status === 403, 'origin ajeno → 403');
ok((await run({ accion: 'elegible', fecha: hoy }, { token: '' })).status === 401, 'sin token → 401');
ok((await run({ accion: 'elegible', fecha: hoy }, { token: 'tok-otra' })).status === 404, 'uid fuera de la allowlist (y no interna) → 404');
reset({ usuario: { ...base, es_interno: true } });
ok((await run({ accion: 'elegible', fecha: hoy }, { token: 'tok-otra' })).status === 200, 'cuenta interna pasa la allowlist');
reset();
ok((await run({ accion: 'x', fecha: hoy })).status === 400 && (await run({ accion: 'elegible', fecha: '2020-01-01' })).status === 400, 'acción/fecha inválidas → 400');

// 3b. Elegibilidad
const eleg = async () => (await run({ accion: 'elegible', fecha: hoy })).body;
let e = await eleg();
ok(e.elegible === true && e.semana === 4 && e.dias_actuales.join() === 'lun,mie' && e.foco_actual === null, 'self_serve + rutina ia activa + cierre 4 → elegible semana 4, con días y foco actuales');
reset({ usuario: { ...base, self_serve: false, metodo_king: true }, cierres: [{ semana_num: 7, fecha_fin: fechaMas(hoy, -10) }, { semana_num: 8, fecha_fin: fechaMas(hoy, -3) }] });
e = await eleg(); ok(e.elegible === true && e.semana === 8, 'cohorte King (metodo_king) + cierre 8 → elegible semana 8');
const negativos = [
  ['coach', { usuario: { ...base, role: 'coach' } }, 'rol'],
  ['revisor de las stores', { usuario: { ...base, email: 'Review@coachaipro.ai' } }, 'revisor'],
  ['ni self_serve ni King', { usuario: { ...base, self_serve: false } }, 'no_self_serve'],
  ['rutina del coach', { planes: [{ ...planesIa[0], origen: 'coach' }] }, 'rutina_no_ia'],
  ['rutina sin origen (legacy)', { planes: [{ ...planesIa[0], origen: null }] }, 'rutina_no_ia'],
  ['rutina cerrada por el cierre', { planes: [{ ...planesIa[0], fecha_entrega: fechaMas(hoy, -1) }] }, 'rutina_no_ia'],
  ['sin rutina', { planes: [] }, 'rutina_no_ia'],
  ['último cierre 3', { cierres: [{ semana_num: 3, fecha_fin: AYER }] }, 'sin_checkpoint'],
  ['último cierre 5 (el 4 ya pasó)', { cierres: [{ semana_num: 4, fecha_fin: fechaMas(hoy, -8) }, { semana_num: 5, fecha_fin: AYER }] }, 'sin_checkpoint'],
  ['sin cierres', { cierres: [] }, 'sin_checkpoint'],
];
for (const [nombre, estado, motivo] of negativos) {
  reset(estado);
  e = await eleg();
  ok(e.elegible === false && e.motivo === motivo && e.semana === null, `no elegible: ${nombre} → ${motivo}`, JSON.stringify(e));
}
ok(normalizarDias(['sab', 'lun', 'vie', 'mie']).join() === 'lun,mie,vie,sab' && normalizarDias([]) === null && normalizarDias(['lun', 'lun']) === null && normalizarDias(['xyz']) === null && normalizarDias(DIAS7()).length === 7, 'normalizarDias: ordena como la semana, rechaza vacío/duplicados/desconocidos');
function DIAS7() { return ['dom', 'sab', 'vie', 'jue', 'mie', 'mar', 'lun']; }

// 3c. Renovar: validaciones (sin gastar ni escribir)
reset({ usuario: { ...base, self_serve: false } });
let r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun'], foco: 'brazos' });
ok(r.status === 409 && r.body.motivo === 'no_self_serve', 'renovar no elegible → 409 con motivo');
reset();
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 3, dias: ['lun'], foco: 'brazos' });
ok(r.status === 409 && r.body.motivo === 'semana_distinta' && r.body.semana === 4, 'renovar con otra semana_num → 409 semana_distinta (dice cuál es)');
ok((await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: [], foco: 'brazos' })).status === 400 && (await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'lun'] })).status === 400 && (await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lunes'] })).status === 400, 'dias inválidos → 400');
ok((await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun'], foco: 'abdomen' })).status === 400, 'foco inválido → 400');
ok(S.usados === 0 && S.patches.length === 0 && S.upserts.length === 0 && S.anthropic.length === 0 && S.eventos.length === 0, 'las validaciones no gastan ni escriben nada');

// 3d. Renovar: camino feliz
reset();
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['sab', 'lun', 'vie', 'mie'], foco: 'brazos' });
ok(r.status === 200 && r.body.ok === true && r.body.fuente === 'ia' && r.body.semana === 4 && r.body.dias.join() === 'lun,mie,vie,sab' && r.body.foco === 'brazos' && r.body.plan.id === 'plan-nuevo' && r.body.used === 1, 'camino feliz: 200, fuente ia, días ordenados, used 1', JSON.stringify(r.body));
ok(S.patches.length === 1 && S.patches[0].url.includes('id=eq.u-1') && JSON.stringify(S.patches[0].body) === JSON.stringify({ dias_entreno: ['lun', 'mie', 'vie', 'sab'], foco_entreno: 'brazos' }), 'usuarios ← dias_entreno + foco_entreno (solo esas 2 columnas)');
const up = S.upserts[0];
ok(S.upserts.length === 1 && up.url.includes('on_conflict=usuario_id,tipo,semana_iso') && /merge-duplicates/.test(up.prefer) && up.body.tipo === 'rutina' && up.body.contenido === RUTINA_OK && up.body.origen === 'ia' && up.body.semana_iso === cer.getISOWeekKey() && up.body.fecha_entrega === hoy, 'planes_semanales ← upsert rutina origen ia, semana ISO de hoy, fecha_entrega = hoy (el cierre terminó ayer)');
const ll = S.anthropic[0];
ok(S.anthropic.length === 1 && ll.model === 'claude-haiku-4-5-20251001' && ll.system[0].cache_control?.type === 'ephemeral' && ll.system[0].text.includes('Día 1 · Pecho/Tríceps') && ll.system[0].text.includes('FOCO') && ll.messages[0].content === '💪 Rutina de la semana', 'Haiku: 1 llamada, prompt cacheado con el esqueleto de 4 días y el foco, mensaje "💪 Rutina de la semana"');
ok(ev('renov_new').length === 1 && ev('renov_new')[0].meta.dias_old === 'lun,mie' && ev('renov_new')[0].meta.dias_new === 'lun,mie,vie,sab' && ev('renov_ok').length === 1 && ev('renov_ok')[0].meta.fuente === 'ia' && S.eventos.every((x) => x.meta.app === 'native') && ev('renov_fail').length === 0, 'eventos renov_new + renov_ok (app: native)');

// 3e. Sin foco; el cierre terminó HOY (la clienta cerró el domingo a la noche) → fecha_entrega = mañana
reset({ cierres: [{ semana_num: 4, fecha_fin: hoy }], planes: [{ ...planesIa[0], fecha_entrega: fechaMas(hoy, 1) }], usuario: { ...base, foco_entreno: 'brazos' } });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'ninguno' });
ok(r.status === 200 && r.body.foco === null && S.patches[0].body.foco_entreno === null && S.upserts[0].body.fecha_entrega === fechaMas(hoy, 1) && ev('renov_new')[0].meta.foco === 'ninguno', '"ninguno" → foco_entreno null; el cierre terminó hoy → fecha_entrega = cierre + 1 (si no nacería cerrada)');

// 3f. Esqueleto: falla el 1ro, pasa el 2do
reset({ replies: [RUTINA_MAL_ESQ, RUTINA_OK] });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 200 && r.body.fuente === 'ia' && S.anthropic.length === 2 && S.upserts[0].body.contenido === RUTINA_OK && r.body.used === 2 && ev('rutina_fuera_esqueleto').length === 0, 'fuera de esqueleto → segundo intento → se guarda el que cumple (used 2)');

// 3g. Las dos fuera de esqueleto → se guarda la primera y queda el evento
reset({ replies: [RUTINA_MAL_ESQ, RUTINA_MAL_ESQ] });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 200 && r.body.fuente === 'ia_fuera_esqueleto' && S.upserts[0].body.contenido === RUTINA_MAL_ESQ && ev('rutina_fuera_esqueleto').length === 1 && /titulo/.test(ev('rutina_fuera_esqueleto')[0].meta.reasons), 'ninguna cumple el esqueleto → la primera que parseó + evento rutina_fuera_esqueleto');

// 3h. Sin estructura → reformateo con NORMALIZAR.rutina
reset({ replies: [SIN_ESTRUCTURA, RUTINA_OK] });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
// El reformateo se guarda recortado (.trim(), como aiNormalizePlan L39466 quita las vallas ``` y los bordes).
ok(r.status === 200 && r.body.fuente === 'ia' && S.anthropic.length === 2 && S.anthropic[1].system === NORMALIZAR.rutina && S.anthropic[1].messages[0].content === SIN_ESTRUCTURA && S.upserts[0].body.contenido === RUTINA_OK.trim() && r.body.used === 2, 'sin estructura → un pase de reformateo (prompt de aiNormalizePlan) → se guarda el normalizado', JSON.stringify({ status: r.status, fuente: r.body.fuente, llamadas: S.anthropic.length, sistemaOk: S.anthropic[1]?.system === NORMALIZAR.rutina, used: r.body.used, contenidoOk: S.upserts[0]?.body.contenido === RUTINA_OK.trim() }));

// 3i. Vara de calidad → plantilla de Jesús
reset({ replies: [RUTINA_FLOJA, RUTINA_FLOJA] });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 200 && r.body.fuente === 'plantilla' && S.upserts[0].body.contenido.includes('Full body (Beto)') && ev('plan_quality_fallback').length === 1 && /cardio/.test(ev('plan_quality_fallback')[0].meta.reasons) && ev('plan_quality_fallback')[0].meta.origen === 'renovacion', 'no pasa la vara → plantilla con el nombre + evento plan_quality_fallback');

// 3j. IA saturada → 503, la rutina vieja sigue
reset({ falloAnthropic: 529 });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 503 && r.body.error === 'overloaded' && r.body.retryable === true && S.upserts.length === 0 && ev('renov_fail').length === 1 && S.patches.length === 1, 'IA saturada (529) → 503 retryable, sin tocar la rutina (las preferencias sí quedan, como la PWA)');

// 3k. IA con otro error → plantilla (nunca sin plan)
reset({ falloAnthropic: 500 });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 200 && r.body.fuente === 'plantilla' && ev('plan_quality_fallback')[0].meta.reasons === 'no se genero', 'IA con error 500 → "no se genero" → plantilla');

// 3l. Sin plantilla y sin plan → 500 sin_plan
reset({ falloAnthropic: 500, templates: [] });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 500 && r.body.error === 'sin_plan' && S.upserts.length === 0 && ev('renov_fail').length === 1, 'sin IA y sin plantilla → 500 sin_plan + renov_fail');
S.templates = [{ tipo: 'rutina', contenido: PLANTILLA, dias: 4, kcal_base: null, sexo: 'masculino' }];

// 3m. Tope diario
reset({ usados: 120 });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 429 && r.body.error === 'daily_limit' && S.anthropic.length === 0 && S.patches.length === 0, 'tope diario superado → 429 antes de gastar o escribir');

// 3n. Guardado fallido
reset({ falloUpsert: true });
r = await run({ accion: 'renovar', fecha: hoy, semana_num: 4, dias: ['lun', 'mie', 'vie', 'sab'], foco: 'brazos' });
ok(r.status === 500 && r.body.error === 'save_failed' && ev('renov_fail')[0].meta.reason === 'save', 'upsert falla → 500 save_failed + renov_fail');

// 3o. elegibilidad pura
ok(elegibilidad({ usuario: base, weeklyPlans: { rutina: { closed: false, origen: 'ia' } }, cierres: [{ semana_num: 12, fecha_fin: hoy }], cerebro: cer }).semana === 12, 'elegibilidad(): cierre 12 → semana 12');

console.log(fallas ? `\n✗ ${fallas} falla(s)` : '\n✓ todo idéntico / correcto');
process.exit(fallas ? 1 : 0);
