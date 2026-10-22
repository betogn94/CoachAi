// ============================================================================
// TEST-CIERRE-SEMANA — paridad y prueba OFFLINE de /api/cierre-semana (3.5.e del port RN). No pega a
// ninguna API ni toca la base.
//   node scripts/test-cierre-semana.mjs
// 1. api/_chat-cerebro.js al día con index.html.
// 2. El prompt del análisis semanal (system + mensaje con las fotos) que arma el servidor es IDÉNTICO
//    byte a byte al de generateWeeklyAnalysis de la PWA corriendo con sus globales, en varios casos.
// 3. El reloj de semanas y las stats del cerebro == las mismas funciones de index.html con sus globales.
// 4. El handler con fetch falso: interruptor, auth, allowlist, origin, autocerrar (inserta solo semanas
//    terminadas y nunca pisa; refresca stats; clona planes con fecha posterior al cierre), analizar (4 fotos
//    firmadas, upsert del cierre, logros, ajuste de dieta con clamp), regenerar (rate-limit), errores.
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
process.env.CIERRE_SEMANA_ENABLED = '1';
process.env.CIERRE_SEMANA_ALLOW = 'uid-beto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const { crearCerebro } = await import('../api/_chat-cerebro.js');
const { extractFunction, generar } = await import('./build-chat-prompt.mjs');
let fallas = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓', m); else { fallas++; console.log('  ✗', m, extra); } };

// ─── 1 ───
console.log('1. api/_chat-cerebro.js vs index.html');
ok(readFileSync(join(RAIZ, 'api', '_chat-cerebro.js'), 'utf8') === generar(), 'el generado coincide con index.html hoy');

// ─── 2. Prompt del análisis: PWA (globales reales) vs servidor (ctx) ───
console.log('2. prompt de generateWeeklyAnalysis: PWA vs servidor');
const NOMBRES_PWA = ['generateWeeklyAnalysis'];
const srcPWA = NOMBRES_PWA.map((n) => extractFunction(html, n)).join('\n');
function promptPWA({ currentUser, alimHeader, cierresSemanales, firmadas }, args) {
  let capturado = null;
  const fetchFalso = async (_u, o) => { capturado = JSON.parse(o.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x'.repeat(60) }] }) }; };
  const fn = new Function('currentUser', '_alimHeader', 'cierresSemanales', 'fetch', 'aiAuthHeaders', '_signPhotosForAI', `"use strict"; ${srcPWA}\n return generateWeeklyAnalysis;`)(currentUser, alimHeader, cierresSemanales, fetchFalso, async () => ({}), async (p) => firmadas(p));
  return fn(...args).then(() => capturado);
}
async function promptServidor(ctx, args) {
  let capturado = null;
  const c = crearCerebro({ ...ctx, fetchIA: async (_u, o) => { capturado = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x'.repeat(60) }] }) }; } });
  await c.generateWeeklyAnalysis(...args);
  return capturado;
}
const firmar = async (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ? v + '?token=firmado' : null]));
const statsFull = { trained: 3, avgCal: 1850, avgProt: 145, avgCarbs: 180, avgFat: 60, totalLogs: 5, dias: 7, parcial: false, wLogs: [] };
const statsParcial = { trained: 1, avgCal: null, avgProt: null, avgCarbs: null, avgFat: null, totalLogs: 2, dias: 4, parcial: true, wLogs: [] };
const cu = { peso: '80.00', altura: '173.00', dias_entreno: ['lun', 'mie', 'vie', 'jue'], metodo_king: false };
const hdr = { targetKcal: 2560, targetProt: 156, targetCarbs: 324, targetFat: 71 };
const cierresHist = [{ semana_num: 1, stats: { trained: 2, avgCal: 1700, avgProt: 120 } }, { semana_num: 2, stats: { trained: 3 } }];
const F4 = { inicioFrente: 'https://x.supabase.co/storage/v1/object/public/progress-photos/u/if.jpg', inicioEspalda: 'https://x.supabase.co/storage/v1/object/public/progress-photos/u/ie.jpg', semanaFrente: 'https://x.supabase.co/storage/v1/object/public/progress-photos/u/sf.jpg', semanaEspalda: 'https://x.supabase.co/storage/v1/object/public/progress-photos/u/se.jpg' };
const casos = [
  ['4 fotos, semana completa, con historial', { currentUser: cu, alimHeader: hdr, cierresSemanales: cierresHist }, ['Beto', 3, statsFull, 'definir', 'es', F4, null]],
  ['3 fotos (sin inicio espalda), semana 1', { currentUser: cu, alimHeader: hdr, cierresSemanales: [] }, ['Beto', 1, statsFull, 'definir', 'es', { ...F4, inicioEspalda: null }, null]],
  ['sin fotos, sin dieta, sin días', { currentUser: { peso: null, altura: null, dias_entreno: null }, alimHeader: null, cierresSemanales: [] }, ['Sofía', 2, statsFull, '', 'es', {}, null]],
  ['semana parcial de 4 días', { currentUser: cu, alimHeader: hdr, cierresSemanales: [] }, ['Beto', 1, statsParcial, 'definir', 'es', F4, null]],
  ['inglés', { currentUser: cu, alimHeader: hdr, cierresSemanales: cierresHist }, ['Ann', 3, statsFull, 'ganar_musculo', 'en', F4, null]],
  ['firma legacy (fotoUrl, fotoInicialUrl)', { currentUser: cu, alimHeader: hdr, cierresSemanales: [] }, ['Beto', 2, statsFull, 'definir', 'es', F4.semanaFrente, F4.inicioFrente]],
];
for (const [nombre, g, args] of casos) {
  const a = await promptPWA({ ...g, firmadas: firmar }, args);
  const b = await promptServidor({ currentUser: g.currentUser, alimHeader: g.alimHeader, cierresSemanales: g.cierresSemanales, firmarFotos: firmar, ahora: Date.UTC(2026, 9, 22, 12) }, args);
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  ok(sa === sb && sa.length > 500 && a.model === 'haiku', `${nombre}: ${sa.length} chars idénticos`);
  if (sa !== sb) { let i = 0; while (sa[i] === sb[i]) i++; console.log('    difiere en', i, JSON.stringify(sa.slice(i - 60, i + 60)), '\n    vs', JSON.stringify(sb.slice(i - 60, i + 60))); }
}
{
  const b = await promptServidor({ currentUser: cu, alimHeader: hdr, cierresSemanales: [], firmarFotos: firmar, ahora: Date.UTC(2026, 9, 22, 12) }, casos[0][2]);
  const imgs = b.messages[0].content.filter((x) => x.type === 'image');
  ok(imgs.length === 4 && imgs.every((x) => x.source.type === 'url' && /token=firmado/.test(x.source.url)) && imgs[0].source.url.includes('/if.jpg') && imgs[3].source.url.includes('/se.jpg'), 'las 4 fotos van firmadas, en el orden inicio F/E, semana F/E');
}

// ─── 3. Reloj + stats: cerebro vs funciones de index.html con sus globales ───
console.log('3. reloj de semanas y stats');
const NOMBRES_RELOJ = ['formatLocalDate', 'getTodayKey', 'getISOWeekKey', 'isoWeekRange', 'isoWeekShift', 'isoWeeksBetween', '_addDaysStr', '_lastCierre', '_isoKeyOfStr', '_getWeekNumLegacy', '_getWeekRangeLegacy', 'getWeekNum', 'getWeekRange', 'computeWeekStats'];
const srcReloj = NOMBRES_RELOJ.map((n) => extractFunction(html, n)).join('\n');
function relojPWA(ahora, cierres, trained) {
  const RealDate = globalThis.Date;
  class D extends RealDate { constructor(...a) { if (a.length) super(...a); else super(ahora); } static now() { return ahora; } static UTC(...a) { return RealDate.UTC(...a); } static parse(s) { return RealDate.parse(s); } }
  return new Function('Date', 'SEMANA_ISO', 'cierresSemanales', '_trainedDatesSet', `"use strict"; ${srcReloj}\n return { getWeekNum, getWeekRange, computeWeekStats };`)(D, true, cierres, new Set(trained));
}
let okReloj = 0, fallasReloj = 0;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
for (const [alta, cierres, trained, diario] of [
  ['2026-10-15T12:45:51Z', [{ semana_num: 1, fecha_inicio: '2026-10-15', fecha_fin: '2026-10-18' }], ['2026-10-19', '2026-10-21'], [{ fecha: '2026-10-20', entreno: false, calorias_consumidas: 1280 }]],
  ['2026-09-09T17:46:30Z', [], [], []],
  ['2026-08-03', [{ semana_num: 1, fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09' }, { semana_num: 2, fecha_inicio: '2026-08-10', fecha_fin: '2026-08-16' }], ['2026-08-12'], [{ fecha: '2026-08-11', entreno: true }]],
]) {
  for (const hoy of [new Date(2026, 9, 22, 12), new Date(2026, 9, 25, 23), new Date(2026, 10, 2, 1)]) {
    const ahora = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
    const a = relojPWA(ahora, cierres, trained), b = crearCerebro({ ahora, cierresSemanales: cierres, trainedDates: trained });
    const na = a.getWeekNum(alta), nb = b.getWeekNum(alta);
    if (na !== nb) fallasReloj++; else okReloj++;
    for (let w = 1; w <= na + 1; w++) {
      const ra = a.getWeekRange(alta, w), rb = b.getWeekRange(alta, w);
      if (JSON.stringify(ra) !== JSON.stringify(rb)) fallasReloj++; else okReloj++;
      if (JSON.stringify(a.computeWeekStats(diario, ra)) !== JSON.stringify(b.computeWeekStats(diario, rb))) fallasReloj++; else okReloj++;
    }
  }
}
ok(fallasReloj === 0 && okReloj > 40, `getWeekNum / getWeekRange / computeWeekStats idénticos (${okReloj} comparaciones)`);

// ─── 4. Handler offline ───
console.log('4. handler /api/cierre-semana (fetch falso)');
const hoyUtc = new Date().toISOString().slice(0, 10);
const mas = (n) => new Date(Date.UTC(+hoyUtc.slice(0, 4), +hoyUtc.slice(5, 7) - 1, +hoyUtc.slice(8, 10) + n)).toISOString().slice(0, 10);
const UID = 'u-1';
const DIETA = 'Plan nutricional — Beto | Target: 1500 kcal/día | P:120g C:150g G:50g\n\nLUNES\nDesayuno: avena 60g — 300kcal · P:10g C:50g G:5g\nAlmuerzo: pollo 200g + arroz 100g — 600kcal · P:50g C:60g G:10g\nCena: pescado 200g — 600kcal · P:60g C:40g G:35g\nTotal: 1500 kcal\n\nMARTES\nDesayuno: huevos 3 — 300kcal · P:20g C:5g G:20g\nAlmuerzo: carne 200g + papa 200g — 600kcal · P:50g C:60g G:15g\nCena: atún + ensalada — 600kcal · P:50g C:50g G:15g\nTotal: 1500 kcal';
const RUTINA = 'Día 1 · Pierna\n1. Sentadilla — 3×12\n2. Hip thrust — 3×12\nDía 2 · Espalda\n1. Remo — 3×10\nDescanso: miércoles';
const E = {};
function reset(o = {}) {
  Object.assign(E, {
    usados: 0, anthropic: [], cierresUpserts: [], planesUpserts: [], planesPatch: [], statsPatch: [], logros: [], eventos: [], firmas: [],
    usuario: { id: UID, nombre: 'Beto', edad: 32, sexo: 'masculino', peso: '80.00', altura: '173.00', objetivo: 'definir', nivel: 'avanzado', actividad: 'moderado', dias_entreno: ['lun', 'mie', 'vie'], metodo_king: false, foco_entreno: null, role: 'user', created_at: mas(-20) + 'T12:00:00+00:00' },
    planes: [], cierres: [], diario: [], entrenados: [], fotosInicio: [{ vista: 'frente', url_foto: `https://x.supabase.co/storage/v1/object/public/progress-photos/${UID}/2026-10-22-frente-1.jpg` }, { vista: 'espalda', url_foto: `https://x.supabase.co/storage/v1/object/public/progress-photos/${UID}/2026-10-22-espalda-1.jpg` }],
    primerPlan: [{ fecha_entrega: mas(-19) }], regenEventos: [], respuestaIA: (payload) => 'Análisis de prueba. '.repeat(10), falloAnthropic: null, falloCierre: false, falloStorage: false,
    ...o,
  });
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/auth/v1/user')) { const tok = (init.headers?.authorization || '').replace('Bearer ', ''); return tok === 'tok-beto' ? json(200, { id: 'uid-beto' }) : tok === 'tok-otra' ? json(200, { id: 'uid-otra' }) : json(401, {}); }
  if (u.includes('/rpc/chat_uso_incrementa')) { E.usados++; return json(200, E.usados); }
  if (u.includes('/rest/v1/usuarios')) return json(200, u.includes('uid-beto') ? [E.usuario] : []);
  if (u.includes('/rest/v1/planes_semanales')) {
    if (init.method === 'POST') { E.planesUpserts.push({ url: u, prefer: init.headers?.Prefer, body: JSON.parse(init.body) }); return json(201, [{ id: 'p-new', ...JSON.parse(init.body) }]); }
    if (init.method === 'PATCH') { E.planesPatch.push({ url: u, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
    if (u.includes('order=fecha_entrega.asc')) return json(200, E.primerPlan);
    return json(200, E.planes);
  }
  if (u.includes('/rest/v1/cierres_semanales')) {
    if (init.method === 'POST') {
      if (E.falloCierre) return new Response('boom', { status: 500 });
      const body = JSON.parse(init.body);
      E.cierresUpserts.push({ url: u, prefer: init.headers?.Prefer, body });
      if (/ignore-duplicates/.test(init.headers?.Prefer || '')) { const have = new Set(E.cierres.map((c) => c.semana_num)); return json(201, body.filter((r) => !have.has(r.semana_num)).map((r) => ({ semana_num: r.semana_num }))); }
      return json(201, [{ id: 'c-new', ...body }]);
    }
    if (init.method === 'PATCH') { E.statsPatch.push({ url: u, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
    return json(200, E.cierres);
  }
  if (u.includes('/rest/v1/progreso_diario')) return json(200, E.diario);
  if (u.includes('/rest/v1/dias_entrenados')) return json(200, E.entrenados);
  if (u.includes('/rest/v1/fotos_progreso')) return json(200, E.fotosInicio);
  if (u.includes('/rest/v1/user_logros')) { const body = JSON.parse(init.body); E.logros.push(body); return json(201, body.map((r) => ({ logro_key: r.logro_key }))); }
  if (u.includes('/rest/v1/beta_eventos')) { if (init.method === 'POST') { E.eventos.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); } return json(200, E.regenEventos); }
  if (u.includes('/storage/v1/object/sign/')) { if (E.falloStorage) return new Response('x', { status: 400 }); E.firmas.push(u); return json(200, { signedURL: '/object/sign/progress-photos/' + u.split('/object/sign/progress-photos/')[1] + '?token=T' }); }
  if (u.includes('api.anthropic.com')) {
    const payload = JSON.parse(init.body);
    E.anthropic.push(payload);
    if (E.falloAnthropic) return json(E.falloAnthropic, { error: { type: 'overloaded_error', message: 'x' } });
    return json(200, { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text: E.respuestaIA(payload) }], model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn', usage: {} });
  }
  throw new Error('fetch no simulado: ' + u);
};
const { default: handler } = await import('../api/cierre-semana.js');
const run = async (body, { token = 'tok-beto', origin = 'https://coachaipro.ai', method = 'POST' } = {}) => {
  const out = { status: 0, headers: {}, body: null };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return out; } };
  await handler({ method, headers: { origin, authorization: token ? `Bearer ${token}` : '' }, body }, res);
  return out;
};
const FOTOS = { frente: `https://x.supabase.co/storage/v1/object/public/progress-photos/${UID}/${hoyUtc}-frente-9.jpg`, espalda: `https://x.supabase.co/storage/v1/object/public/progress-photos/${UID}/${hoyUtc}-espalda-9.jpg` };

// Guardias
reset();
process.env.CIERRE_SEMANA_ENABLED = '0';
let r = await run({ accion: 'autocerrar', fecha: hoyUtc });
ok(r.status === 404, 'interruptor apagado → 404');
process.env.CIERRE_SEMANA_ENABLED = '1';
r = await run({ accion: 'autocerrar', fecha: hoyUtc }, { token: null });
ok(r.status === 401 && r.headers['x-chat-ident'] === 'missing', 'sin token → 401');
r = await run({ accion: 'autocerrar', fecha: hoyUtc }, { token: 'tok-otra' });
ok(r.status === 404, 'uid fuera de la allowlist → 404');
r = await run({ accion: 'autocerrar', fecha: hoyUtc }, { origin: 'https://evil.com' });
ok(r.status === 403, 'origin ajeno → 403');
r = await run({ accion: 'nada', fecha: hoyUtc });
ok(r.status === 400 && r.body.error === 'accion_invalida', 'acción desconocida → 400');
r = await run({ accion: 'autocerrar', fecha: '2020-01-01' });
ok(r.status === 400 && r.body.error === 'fecha_invalida', 'fecha lejana → 400');

// autocerrar: alta hace 20 días, sin cierres, planes cerrados por el autocierre → clon
reset({ planes: [{ tipo: 'dieta', contenido: DIETA, fecha_entrega: mas(-19), semana_iso: '2026-W40', updated_at: 'x', origen: 'ia' }, { tipo: 'rutina', contenido: 'Plan nutricional pegado\n---\nRUTINA\n' + RUTINA, fecha_entrega: mas(-19), semana_iso: '2026-W40', updated_at: 'x', origen: 'coach' }], diario: [{ fecha: mas(-15), entreno: true, calorias_consumidas: 1400 }, { fecha: mas(-14), entreno: false, calorias_consumidas: 1600 }] });
r = await run({ accion: 'autocerrar', fecha: hoyUtc });
{
  const ins = E.cierresUpserts[0];
  const semanasOk = ins && ins.body.every((row) => row.fecha_fin < hoyUtc && row.fecha_fin >= mas(-19) && /^\d{4}-W\d{2}$/.test(row.semana_iso) && row.stats && 'trained' in row.stats && 'parcial' in row.stats && row.usuario_id === UID);
  ok(r.status === 200 && ins && /ignore-duplicates/.test(ins.prefer) && ins.body.length >= 2 && semanasOk && r.body.autocerradas.length === ins.body.length, `autocerrar: inserta ${ins ? ins.body.length : 0} semanas terminadas (solo INSERT, ignoreDuplicates, stats + semana_iso)`, JSON.stringify(r.body));
  ok(ins.body[0].semana_num === 1 && ins.body[0].fecha_inicio === mas(-20), 'la semana 1 arranca el día del alta');
  ok(E.anthropic.length === 0, 'sin análisis previo no se llama a la IA');
  const cl = E.planesUpserts;
  const rut = cl.find((x) => x.body.tipo === 'rutina'), die = cl.find((x) => x.body.tipo === 'dieta');
  const maxEnd = ins.body.map((x) => x.fecha_fin).sort().pop();
  const esperada = maxEnd >= hoyUtc ? mas(1) : hoyUtc;
  ok(rut && die && rut.body.fecha_entrega === esperada && die.body.fecha_entrega === esperada && rut.body.origen === 'coach' && die.body.origen === 'ia' && rut.body.contenido.startsWith('RUTINA') && die.body.contenido === DIETA && /merge-duplicates/.test(rut.prefer) && rut.url.includes('on_conflict=usuario_id,tipo,semana_iso'), 'reabre el ciclo: clona rutina (sin dieta pegada, origen coach) y dieta (origen ia) con fecha posterior al cierre', JSON.stringify(cl.map((x) => x.body)));
  ok(r.body.planes.rutina === 'clonada' && r.body.planes.dieta === 'clonada' && E.eventos.filter((e) => e.evento === 'plan_auto_repeated').length === 2 && E.eventos.some((e) => e.evento === 'cierre_auto'), 'respuesta + eventos cierre_auto y plan_auto_repeated');
}
// idempotente: la semana 1 cerró ayer (la 2 arranca hoy) y el plan es de hoy → nada que cerrar ni clonar
reset({ cierres: [{ id: 'c1', semana_num: 1, fecha_inicio: mas(-7), fecha_fin: mas(-1), semana_iso: 'x', analisis: 'ya', stats: { trained: 1, totalLogs: 1 } }], planes: [{ tipo: 'dieta', contenido: DIETA, fecha_entrega: hoyUtc, semana_iso: 'w', updated_at: 'x', origen: 'ia' }] });
E.usuario.created_at = mas(-7) + 'T10:00:00Z';
r = await run({ accion: 'autocerrar', fecha: hoyUtc });
ok(r.status === 200 && r.body.autocerradas.length === 0 && E.cierresUpserts.length === 0 && E.planesUpserts.length === 0 && r.body.planes.dieta === 'sin_cambios', 'autocerrar idempotente: sin semanas terminadas ni planes cerrados no escribe nada');
// statsfix: cierre pendiente con datos retro → PATCH solo si mejora
reset({ cierres: [{ id: 'c1', semana_num: 1, fecha_inicio: mas(-10), fecha_fin: mas(-4), semana_iso: 'x', analisis: null, stats: { trained: 0, totalLogs: 0 } }], diario: [{ fecha: mas(-8), entreno: true }, { fecha: mas(-7), entreno: false, calorias_consumidas: 1200 }] });
E.usuario.created_at = mas(-10) + 'T10:00:00Z';
r = await run({ accion: 'autocerrar', fecha: hoyUtc });
ok(r.body.stats_refrescadas.length === 1 && E.statsPatch[0].url.includes('analisis=is.null') && E.statsPatch[0].body.stats.trained === 1 && E.statsPatch[0].body.stats.totalLogs === 2, 'statsfix: recomputa un cierre pendiente con datos retro (PATCH con analisis IS NULL)');
// coach → no hace nada
reset(); E.usuario.role = 'coach';
r = await run({ accion: 'autocerrar', fecha: hoyUtc });
ok(r.status === 200 && r.body.autocerradas.length === 0 && E.cierresUpserts.length === 0, 'una coach no autocierra');

// analizar: semana 1 (alta hace 20 días, rango 1), fotos propias, dieta cerrada → clon + ajuste
const dietaAjustada = DIETA.replace(/300kcal/g, '320kcal').replace(/1500 kcal/g, '1540 kcal');
const dietaDesviada = DIETA.replace(/600kcal/g, '1200kcal').replace(/1500 kcal/g, '2700 kcal').replace('Target: 1500', 'Target: 2700');
// Alta un LUNES de hace 3 semanas → la semana 1 es completa (lun-dom) y las stats esperadas son exactas.
const dowHoy = new Date(hoyUtc + 'T12:00:00Z').getUTCDay() || 7;
const lunes = mas(-(dowHoy - 1) - 21);
const L = (n) => mas(-(dowHoy - 1) - 21 + n);
let llamada = 0;
const conAltaLunes = (o) => { reset(o); E.usuario.created_at = lunes + 'T10:00:00+00:00'; E.primerPlan = [{ fecha_entrega: lunes }]; };
conAltaLunes({ planes: [{ tipo: 'dieta', contenido: DIETA, fecha_entrega: lunes, semana_iso: 'w', updated_at: 'x', origen: 'ia' }], diario: [{ fecha: L(0), entreno: true, calorias_consumidas: 1400, proteinas_g: 120 }, { fecha: L(1), entreno: true, calorias_consumidas: 1500, proteinas_g: 130 }, { fecha: L(2), entreno: true, calorias_consumidas: 1500 }, { fecha: L(3), entreno: false, calorias_consumidas: 1500 }, { fecha: L(4), entreno: false, calorias_consumidas: 1500 }, { fecha: L(5), entreno: false, calorias_consumidas: 1500 }], respuestaIA: () => (++llamada === 1 ? 'Análisis de la semana. '.repeat(10) : dietaAjustada) });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
{
  const an = E.anthropic[0];
  const imgs = an ? an.messages[0].content.filter((x) => x.type === 'image') : [];
  ok(r.status === 200 && r.body.guardado === true && r.body.analisis.startsWith('Análisis') && r.body.analisis_html.includes('Análisis'), 'analizar: 200 con el análisis y su HTML', JSON.stringify(r.body).slice(0, 300));
  ok(an && an.model === 'claude-haiku-4-5-20251001' && imgs.length === 4 && imgs.every((x) => /token=T/.test(x.source.url)) && imgs[0].source.url.includes('frente-1.jpg') && imgs[2].source.url.includes('frente-9.jpg') && E.firmas.length === 4, 'Haiku recibe las 4 fotos firmadas con la service key (inicio F/E + semana F/E)');
  ok(/Entrenos cumplidos: 3\/3 planeados/.test(an.messages[0].content.at(-1).text) && /Calorías consumidas: 1483 kcal\/día prom \(target 1500/.test(an.messages[0].content.at(-1).text), 'las stats del prompt salen de la BASE (3/3 entrenos, 1483 kcal prom vs target 1500)', an.messages[0].content.at(-1).text.slice(0, 600));
  const up = E.cierresUpserts.find((x) => /merge-duplicates/.test(x.prefer));
  ok(up && up.url.includes('on_conflict=usuario_id,semana_num') && up.body.semana_num === 1 && up.body.fecha_inicio === lunes && up.body.fecha_fin === L(6) && up.body.foto_url === FOTOS.frente && up.body.foto_url_espalda === FOTOS.espalda && up.body.analisis === r.body.analisis && up.body.stats.trained === 3 && up.body.stats.totalLogs === 6 && /^\d{4}-W\d{2}$/.test(up.body.semana_iso), 'upsert de cierres_semanales con la fila de la PWA (fotos, análisis, stats, semana_iso)', JSON.stringify(up && up.body).slice(0, 300));
  ok(E.planesUpserts.length === 1 && E.planesUpserts[0].body.tipo === 'dieta' && E.anthropic.length === 2 && E.planesPatch.length === 1 && E.planesPatch[0].body.contenido === dietaAjustada && r.body.planes.dieta === 'ajustada', 'reabre el ciclo: clona la dieta y la ajusta con la IA (dentro del ±15 %) → PATCH');
  ok(E.usados === 2, 'descuenta 2 del tope (análisis + ajuste), sin doble conteo');
  const lg = E.logros[0];
  ok(lg && lg.some((x) => x.logro_key === 'primer_cierre') && lg.some((x) => x.logro_key === 'semana_perfecta_1') && lg.every((x) => x.celebrado === false && x.notificado === false) && r.body.logros.includes('primer_cierre'), 'logros: primer_cierre + semana_perfecta_1 (3/3 entrenos, 6 logs) con celebrado=false', JSON.stringify(lg));
  ok(E.eventos.some((e) => e.evento === 'cierre_analizado') && !E.eventos.some((e) => e.evento === 'cierre_regenerado') && E.eventos.some((e) => e.evento === 'diet_auto_adjusted'), 'eventos cierre_analizado + diet_auto_adjusted');
}
// ajuste clampeado (>15 %) → no pisa la dieta
llamada = 0;
conAltaLunes({ planes: [{ tipo: 'dieta', contenido: DIETA, fecha_entrega: lunes, semana_iso: 'w', updated_at: 'x', origen: 'ia' }], respuestaIA: () => (++llamada === 1 ? 'Análisis. '.repeat(10) : dietaDesviada) });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 200 && E.planesPatch.length === 0 && r.body.planes.dieta === 'clonada' && E.eventos.some((e) => e.evento === 'diet_adjust_clamped'), 'ajuste de dieta desviado > 15 % → clampeado (queda el clon)');
// sin logros para la semana no perfecta
ok(!E.logros.some((l) => l.some((x) => x.logro_key.startsWith('semana_perfecta'))) && E.logros[0].some((x) => x.logro_key === 'primer_cierre'), 'sin 6 logs no hay semana_perfecta; primer_cierre sí');
// validaciones de analizar
reset();
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: { frente: FOTOS.frente.replace(UID, 'otra-usuaria'), espalda: FOTOS.espalda } });
ok(r.status === 403 && r.body.error === 'foto_ajena', 'foto de otra carpeta → 403');
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: { frente: FOTOS.frente } });
ok(r.status === 400 && r.body.error === 'fotos_requeridas', 'falta una foto → 400');
// Cierre pendiente (autocierre) que YA tiene las fotos → analizar sin mandar fotos las toma del cierre (como Regenerar en la PWA).
reset({ cierres: [{ id: 'c1', semana_num: 1, fecha_inicio: mas(-20), fecha_fin: mas(-14), semana_iso: 'x', analisis: null, stats: { trained: 1, totalLogs: 1 }, foto_url: FOTOS.frente, foto_url_espalda: FOTOS.espalda }] });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1 });
ok(r.status === 200 && E.cierresUpserts[0].body.foto_url === FOTOS.frente && E.anthropic[0].messages[0].content.filter((x) => x.type === 'image').length === 4, 'sin fotos en el body, usa las del cierre (que no tenía análisis)');
reset();
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 99, fotos: FOTOS });
ok(r.status === 400 && r.body.error === 'semana_invalida' && E.anthropic.length === 0 && E.usados === 0, 'semana futura → 400 sin gastar');
// sin regeneración: una semana con análisis responde 409 sin gastar (decisión Beto 2026-10-22)
const cierreHecho = { id: 'c1', semana_num: 1, fecha_inicio: mas(-20), fecha_fin: mas(-14), semana_iso: 'x', analisis: 'hecho', stats: { trained: 1, totalLogs: 1 }, foto_url: FOTOS.frente, foto_url_espalda: FOTOS.espalda };
reset({ cierres: [cierreHecho] });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 409 && r.body.error === 'ya_analizado' && E.anthropic.length === 0 && E.usados === 0 && E.cierresUpserts.length === 0, 'semana ya analizada → 409 ya_analizado, sin gastar ni escribir');
// …pero si quedó SIN análisis (falló la IA o el guardado), se puede volver a pedir
reset({ cierres: [{ ...cierreHecho, analisis: null }] });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1 });
ok(r.status === 200 && r.body.guardado === true && E.anthropic.length === 1, 'cierre sin análisis (reintento tras un fallo) → se analiza');
// errores
reset({ falloAnthropic: 529 });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 503 && r.body.retryable === true && E.cierresUpserts.length === 0, 'Anthropic saturado → 503 retryable, no se guarda nada');
reset({ falloCierre: true });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 200 && r.body.guardado === false && r.body.fila && r.body.fila.analisis && r.body.planes === null, 'el upsert falla → 200 con guardado:false y la fila (reintento sin volver a llamar a la IA)');
reset({ falloStorage: true });
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 200 && typeof E.anthropic[0].messages[0].content === 'string', 'si no se pueden firmar las fotos, el análisis sale sin imágenes, solo texto (como la PWA)');
reset(); E.usados = 120;
r = await run({ accion: 'analizar', fecha: hoyUtc, semana_num: 1, fotos: FOTOS });
ok(r.status === 429 && r.body.error === 'daily_limit' && E.anthropic.length === 0, 'tope diario → 429 sin llamar a la IA');

console.log(fallas ? `\n✗ ${fallas} falla(s)` : '\n✓ cierre semanal OK offline');
process.exit(fallas ? 1 : 0);
