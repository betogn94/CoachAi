// ============================================================================
// /api/cierre-semana — el CIERRE SEMANAL en el servidor (3.5.e del port RN). Propuesta aprobada por Beto
// 2026-10-22: docs/port-rn/propuesta-cierre-semana-2026-10-22.md.
// ============================================================================
// Lo que la PWA hace en el teléfono al cerrar una semana (ejecutarCierreSemana L29339) y al abrirse
// (autoCloseEndedWeeks L28113, refreshPendingCierreStats L28161, autoRepeatPlans L20541, autoAdjustDiet
// L20669, checkAndAwardLogros L33029), acá con el MISMO código: las funciones del cierre viven en
// api/_chat-cerebro.js, GENERADO desde index.html (el prompt del análisis es byte a byte el de la PWA).
//
// ADITIVO: /api/chat y la PWA siguen intactos. Interruptores (rollback sin deploy):
//   CIERRE_SEMANA_ENABLED=1   → si falta o es otra cosa, 404.
//   CIERRE_SEMANA_ALLOW=<auth uid>[,…] → mientras esté seteada, solo esas cuentas + `usuarios.es_interno`.
//
// Acciones (body.accion):
//   'autocerrar' → cierra en frío las semanas terminadas sin cierre (solo INSERT), refresca stats de
//                  pendientes (solo si mejoran) y reabre el ciclo (clon de rutina y dieta + ajuste de la
//                  dieta si hay análisis). Sin IA salvo el ajuste. Idempotente: la nativa la llama al abrir.
//   'analizar'   → { semana_num, fotos: { frente, espalda } } (las 2 fotos de la semana YA subidas por la
//                  nativa a su carpeta del bucket): stats del lado del servidor, análisis de Haiku con las
//                  4 fotos firmadas, upsert del cierre, reabrir el ciclo y logros. Sobre una semana que ya
//                  tiene análisis = REGENERAR, con rate-limit real (60 s por semana, 5 por día).
// Cada llamada a la IA descuenta del mismo tope diario que el chat (chat_uso_incrementa).
import Anthropic from '@anthropic-ai/sdk';

import { crearCerebro } from './_chat-cerebro.js';
import { actualizarContenidoDieta, actualizarStatsCierre, armarWeeklyPlans, cargarContextoCierre, fechaValida, firmarFoto, guardarCierre, guardarPlan, insertarCierresVacios, logrosDelCierre, otorgarLogros, regeneracionesRecientes, registrarEvento, rutaFoto } from './_chat-contexto.js';
import { isAllowedOrigin } from './_origin.js';

export const config = { maxDuration: 60 };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4, fetch: (...a) => globalThis.fetch(...a) });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 120);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
const REGEN_MIN_GAP_MS = 60 * 1000;
const REGEN_DAILY_CAP = 5;

// Mismas piezas que api/chat-message.js (copiadas, no importadas).
async function identifyUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { uid: null, reason: 'missing' };
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` } });
    if (!r.ok) return { uid: null, reason: 'invalid' };
    const u = await r.json();
    return u && u.id ? { uid: u.id, reason: 'ok' } : { uid: null, reason: 'invalid' };
  } catch (e) {
    return { uid: null, reason: 'error' };
  }
}
async function bumpDailyUsage(uid) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/chat_uso_incrementa`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_uid: uid }),
    });
    if (!r.ok) return null;
    const n = await r.json();
    return Number.isFinite(Number(n)) ? Number(n) : null;
  } catch (e) {
    return null;
  }
}
function habilitado() {
  return process.env.CIERRE_SEMANA_ENABLED === '1';
}
function permitido(uid, usuario) {
  const lista = String(process.env.CIERRE_SEMANA_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
  return lista.length === 0 || lista.includes(uid) || !!(usuario && usuario.es_interno === true);
}

/**
 * El `fetch('/api/chat')` de generateWeeklyAnalysis / adjustDietViaAI, resuelto con el SDK: mismo modelo y
 * max_tokens que api/chat.js. Las imágenes van como las manda la PWA ({type:'image', source:{type:'url'}}).
 */
function fetchIA(uid, { primeraCubierta = false } = {}) {
  let llamadas = 0;
  return async (_url, opts) => {
    const payload = JSON.parse(opts.body);
    // Cada llamada cuenta, como cuando la PWA pasa por /api/chat. En `analizar` el handler ya descontó
    // la primera (el chequeo del tope antes de gastar); las siguientes (ajuste de dieta) se descuentan acá.
    if (!(primeraCubierta && llamadas === 0)) await bumpDailyUsage(uid);
    llamadas++;
    try {
      const r = await client.messages.create({ model: MODEL_HAIKU, max_tokens: 4096, system: payload.system, messages: payload.messages });
      const body = { content: (r.content || []).filter((b) => b.type === 'text').map((b) => ({ type: 'text', text: b.text })) };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    } catch (error) {
      const status = Number(error?.status) || 500;
      console.error('[cierre-semana] API Error:', error?.message || error);
      return { ok: false, status, json: async () => ({ error: String(error?.message || error) }), text: async () => String(error?.message || error) };
    }
  };
}

/** Lo que la PWA guarda en `cierres_semanales.stats` (ejecutarCierreSemana L29503 / autoCloseEndedWeeks L28134). */
const statsJson = (s) => ({ trained: s.trained, avgCal: s.avgCal, avgProt: s.avgProt, totalLogs: s.totalLogs, dias: s.dias, parcial: s.parcial });
const dayAfter = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10); };

/**
 * `autoRepeatPlans` (L20541) + `autoAdjustDiet` (L20669), con la fila de cierres YA actualizada:
 * clona a la semana ISO actual los planes cerrados (rutina sin dieta pegada; hereda `origen`) con
 * fecha_entrega posterior al último cierre, y si clonó la dieta y hay un análisis, la ajusta con la IA
 * (por default igual; clamp ±15 % de kcal contra el target vigente). Devuelve el estado de cada plan.
 */
async function reabrirCiclo({ cerebro, usuario, planes, cierres, analisisReciente }) {
  const out = { rutina: 'sin_cambios', dieta: 'sin_cambios' };
  if (usuario.role && usuario.role !== 'user') return out;
  const wp = armarWeeklyPlans(planes, cierres);
  const wkNow = cerebro.getISOWeekKey();
  const tipos = ['rutina', 'dieta'].filter((t) => wp[t] && wp[t].closed && wp[t].contenido && wp[t].semana_iso);
  if (!tipos.length) return out;
  const ends = cierres.map((c) => (c.fecha_fin || '').slice(0, 10)).filter(Boolean).sort();
  const maxCierreEnd = ends.length ? ends[ends.length - 1] : null;
  const hoy = cerebro.getTodayKey();
  const fechaEntrega = maxCierreEnd && maxCierreEnd >= hoy ? dayAfter(maxCierreEnd) : hoy;
  let dietaClonada = null;
  for (const tipo of tipos) {
    let contenido = wp[tipo].contenido;
    if (tipo === 'rutina') contenido = cerebro.stripLeadingDietFromRutina(contenido);
    const saved = await guardarPlan({ usuarioId: usuario.id, tipo, contenido, semanaIso: wkNow, fecha: fechaEntrega, origen: wp[tipo].origen || null });
    if (!saved) { console.error('[cierre-semana] auto-repeat upsert error', tipo); continue; }
    out[tipo] = 'clonada';
    if (tipo === 'dieta') dietaClonada = contenido;
    await registrarEvento(usuario.id, 'plan_auto_repeated', { tipo, from: wp[tipo].semana_iso, to: wkNow });
  }
  // Ajuste fino de la dieta recién clonada (solo con análisis; la rutina queda IDÉNTICA = progresión).
  if (dietaClonada && analisisReciente) {
    try {
      const adjusted = await cerebro.adjustDietViaAI(dietaClonada, analisisReciente, usuario.objetivo);
      if (!adjusted) { await registrarEvento(usuario.id, 'diet_adjust_failed', { semana: wkNow }); return out; }
      if (adjusted.trim() === dietaClonada.trim()) return out;
      const prevP = cerebro.parseDietaContenido(dietaClonada);
      const refK = (prevP && prevP.header && prevP.header.targetKcal) || cerebro.dietaAvgDayKcal(prevP);
      const adjP = cerebro.parseDietaContenido(adjusted);
      const adjK = cerebro.dietaAvgDayKcal(adjP) || (adjP && adjP.header && adjP.header.targetKcal);
      if (refK && adjK && Math.abs(adjK - refK) / refK > 0.15) {
        await registrarEvento(usuario.id, 'diet_adjust_clamped', { semana: wkNow, refK, adjK });
        return out;
      }
      await actualizarContenidoDieta(usuario.id, wkNow, adjusted);
      out.dieta = 'ajustada';
      await registrarEvento(usuario.id, 'diet_auto_adjusted', { semana: wkNow });
    } catch (e) {
      console.error('[cierre-semana] autoAdjustDiet:', e?.message || e);
      await registrarEvento(usuario.id, 'diet_adjust_failed', { semana: wkNow, err: e && e.message });
    }
  }
  return out;
}

/** `autoCloseEndedWeeks` + `refreshPendingCierreStats` + `reabrirCicloPostCierre`. */
async function accionAutocerrar({ cerebro, usuario, ctx, planes, cierres, activityStart }) {
  const createdAt = usuario.created_at || new Date().toISOString();
  const hoy = cerebro.getTodayKey();
  const res = { autocerradas: [], stats_refrescadas: [], planes: { rutina: 'sin_cambios', dieta: 'sin_cambios' } };
  if (usuario.role && usuario.role !== 'user') return res;
  let lista = cierres;
  if (activityStart) {
    const currentWeek = cerebro.getWeekNum(createdAt);
    const closed = new Set(lista.map((c) => c.semana_num));
    const rows = [];
    for (let w = 1; w < currentWeek; w++) {
      if (closed.has(w)) continue;
      const range = cerebro.getWeekRange(createdAt, w);
      if (range.end >= hoy) continue;
      if (range.end < activityStart) continue;
      const stats = cerebro.computeWeekStats(ctx.recentDiario, range);
      rows.push({ usuario_id: usuario.id, semana_num: w, fecha_inicio: range.start, fecha_fin: range.end, semana_iso: cerebro._isoKeyOfStr(range.end), stats: statsJson(stats) });
    }
    if (rows.length) {
      try {
        res.autocerradas = await insertarCierresVacios(rows);
        if (res.autocerradas.length) {
          await registrarEvento(usuario.id, 'cierre_auto', { semanas: res.autocerradas.join(',') });
          lista = [...lista, ...rows.filter((r) => res.autocerradas.includes(r.semana_num)).map((r) => ({ ...r, id: null, analisis: null }))].sort((a, b) => a.semana_num - b.semana_num);
        }
      } catch (e) {
        console.warn('[cierre-semana] auto-cierre falló:', e?.message || e);
      }
    }
  }
  // STATS FIX: cierres sin análisis con datos retro cargados después (solo si mejoran).
  if (ctx.recentDiario.length) {
    const horizon = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    for (const c of lista) {
      if (c.analisis != null || !c.id) continue;
      if (!c.fecha_inicio || !c.fecha_fin || c.fecha_fin < horizon) continue;
      const s = cerebro.computeWeekStats(ctx.recentDiario, { start: c.fecha_inicio, end: c.fecha_fin });
      const old = c.stats || {};
      if (!(s.trained > (old.trained || 0) || s.totalLogs > (old.totalLogs || 0))) continue;
      try {
        await actualizarStatsCierre(c.id, statsJson(s));
        c.stats = statsJson(s);
        res.stats_refrescadas.push(c.semana_num);
        await registrarEvento(usuario.id, 'cierre_stats_refresh', { semana: c.semana_num, trained: s.trained, logs: s.totalLogs });
      } catch (e) {
        console.warn('[cierre-semana] statsfix semana', c.semana_num, e?.message || e);
      }
    }
  }
  // Reabrir el ciclo (con el último análisis que exista, como autoAdjustDiet).
  const ultimo = [...lista].filter((c) => c.fecha_fin).sort((a, b) => (a.fecha_fin < b.fecha_fin ? 1 : -1))[0];
  res.planes = await reabrirCiclo({ cerebro, usuario, planes, cierres: lista, analisisReciente: (ultimo && ultimo.analisis) || null });
  return res;
}

/** `ejecutarCierreSemana` (sin la subida de fotos, que hace la nativa) / `regenerarAnalisisSemana`. */
async function accionAnalizar({ req, res, cerebro, usuario, ctx, planes, cierres, fotosInicio, uid, body, lang }) {
  const semanaNum = Number(body.semana_num);
  const createdAt = usuario.created_at || new Date().toISOString();
  const currentWeek = cerebro.getWeekNum(createdAt);
  if (!Number.isInteger(semanaNum) || semanaNum < 1 || semanaNum > currentWeek) return res.status(400).json({ error: 'semana_invalida', retryable: false });
  const existente = cierres.find((c) => c.semana_num === semanaNum) || null;
  // Sin fotos en el body, valen las que ya tiene el cierre (regenerarAnalisisSemana L29658 usa cierre.foto_url).
  const fotos = body.fotos && (body.fotos.frente || body.fotos.espalda) ? body.fotos : existente && existente.foto_url && existente.foto_url_espalda ? { frente: existente.foto_url, espalda: existente.foto_url_espalda } : {};
  const rutas = { frente: rutaFoto(fotos.frente), espalda: rutaFoto(fotos.espalda) };
  if (!rutas.frente || !rutas.espalda) return res.status(400).json({ error: 'fotos_requeridas', retryable: false });
  // Las fotos tienen que ser de SU carpeta del bucket (nunca de otra usuaria).
  if (!rutas.frente.startsWith(usuario.id + '/') || !rutas.espalda.startsWith(usuario.id + '/')) return res.status(403).json({ error: 'foto_ajena', retryable: false });

  const regenerar = !!(existente && existente.analisis);
  if (regenerar) {
    const recientes = await regeneracionesRecientes(usuario.id);
    if (recientes.length >= REGEN_DAILY_CAP) return res.status(429).json({ error: 'regen_daily', cap: REGEN_DAILY_CAP, retryable: false });
    const ultima = recientes.find((r) => r.meta && Number(r.meta.semana) === semanaNum);
    if (ultima) {
      const hace = Date.now() - Date.parse(ultima.created_at);
      if (hace < REGEN_MIN_GAP_MS) return res.status(429).json({ error: 'regen_cooldown', waitSec: Math.ceil((REGEN_MIN_GAP_MS - hace) / 1000), retryable: true });
    }
  }

  const range = cerebro.getWeekRange(createdAt, semanaNum);
  const stats = cerebro.computeWeekStats(ctx.recentDiario, range);

  // Tope diario ANTES de gastar (el fetchIA también descuenta cada llamada real).
  const used = await bumpDailyUsage(uid);
  res.setHeader('x-chat-used', used === null ? 'fail' : String(used));
  if (used !== null && used > DAILY_LIMIT) return res.status(429).json({ error: 'daily_limit', retryable: false });

  let analisis = null;
  try {
    analisis = await cerebro.generateWeeklyAnalysis((usuario.nombre || '').trim(), semanaNum, stats, usuario.objetivo || '', lang, { inicioFrente: fotosInicio.frente, inicioEspalda: fotosInicio.espalda, semanaFrente: fotos.frente, semanaEspalda: fotos.espalda }, null);
  } catch (e) {
    console.error('[cierre-semana] análisis:', e?.message || e);
    const overloaded = /_(429|529)/.test(String(e?.message || ''));
    return res.status(overloaded ? 503 : 500).json({ error: overloaded ? 'overloaded' : 'ai_error', retryable: overloaded });
  }
  if (!analisis) return res.status(500).json({ error: 'ai_error', retryable: true });

  const fila = { usuario_id: usuario.id, semana_num: semanaNum, fecha_inicio: range.start, fecha_fin: range.end, semana_iso: cerebro._isoKeyOfStr(range.end), foto_url: fotos.frente, foto_url_espalda: fotos.espalda || null, analisis, stats: statsJson(stats) };
  let guardado;
  try {
    guardado = await guardarCierre(fila);
  } catch (e) {
    // Como la PWA: el análisis igual vuelve (la nativa lo muestra y ofrece reintentar el guardado sin volver a llamar a la IA).
    console.error('[cierre-semana] no se pudo guardar el cierre:', e?.message || e);
    return res.status(200).json({ semana_num: semanaNum, analisis, analisis_html: cerebro.formatResponse(analisis), stats: fila.stats, guardado: false, fila, planes: null, logros: [] });
  }
  await registrarEvento(usuario.id, regenerar ? 'cierre_regenerado' : 'cierre_analizado', { semana: semanaNum });

  // Reabrir el ciclo con la lista de cierres ya actualizada y los logros del cierre.
  const listaCierres = [...cierres.filter((c) => c.semana_num !== semanaNum), { ...fila, id: guardado && guardado.id }].sort((a, b) => a.semana_num - b.semana_num);
  const planesEstado = await reabrirCiclo({ cerebro, usuario, planes, cierres: listaCierres, analisisReciente: analisis });
  let logros = [];
  if (!usuario.role || usuario.role === 'user') logros = await otorgarLogros(usuario.id, logrosDelCierre(listaCierres, cerebro.getWeeklyTrainingTarget()));
  if (logros.length) await registrarEvento(usuario.id, 'logros_awarded', { keys: logros.join(','), silent: false });

  return res.status(200).json({ semana_num: semanaNum, analisis, analisis_html: cerebro.formatResponse(analisis), stats: fila.stats, guardado: true, regenerado: regenerar, planes: planesEstado, logros, used });
}

export default async function handler(req, res) {
  if (!habilitado()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_origin' });

  const ident = await identifyUser(req);
  res.setHeader('x-chat-ident', ident.reason);
  if (!ident.uid) {
    if (ident.reason === 'error') return res.status(503).json({ error: 'auth_unavailable', retryable: true });
    return res.status(401).json({ error: 'auth_required', retryable: false });
  }
  const body = req.body || {};
  const accion = body.accion;
  const fecha = body.fecha;
  const lang = body.lang === 'en' ? 'en' : 'es';
  if (accion !== 'autocerrar' && accion !== 'analizar') return res.status(400).json({ error: 'accion_invalida', retryable: false });
  if (!fechaValida(fecha)) return res.status(400).json({ error: 'fecha_invalida', retryable: false });

  let contexto;
  try {
    contexto = await cargarContextoCierre({ authUid: ident.uid, fecha, lang });
  } catch (e) {
    console.error('[cierre-semana] contexto:', e?.message || e);
    return res.status(503).json({ error: 'context_unavailable', retryable: true });
  }
  if (!contexto) return res.status(404).json({ error: 'sin_perfil', retryable: false });
  const { usuario, ctx, planes, cierres, fotosInicio, activityStart } = contexto;
  if (!permitido(ident.uid, usuario)) return res.status(404).json({ error: 'not_found' });

  // El cerebro con lo que el cierre necesita: el header de la dieta vigente (lo que la PWA tiene en
  // _alimHeader), las fotos firmadas con la service key y la IA por el SDK.
  const cerebroBase = crearCerebro(ctx);
  const dietaVigente = ctx.weeklyPlans && ctx.weeklyPlans.dieta && ctx.weeklyPlans.dieta.contenido;
  try { ctx.alimHeader = dietaVigente ? cerebroBase.parseDietaContenido(dietaVigente).header || null : null; } catch (e) { ctx.alimHeader = null; }
  ctx.firmarFotos = async (p) => {
    const out = {};
    for (const k of ['inicioFrente', 'inicioEspalda', 'semanaFrente', 'semanaEspalda']) {
      const r = rutaFoto(p[k]);
      out[k] = r ? await firmarFoto(r) : null;
    }
    return out;
  };
  ctx.fetchIA = fetchIA(ident.uid, { primeraCubierta: accion === 'analizar' });
  const cerebro = crearCerebro(ctx);

  try {
    if (accion === 'autocerrar') return res.status(200).json(await accionAutocerrar({ cerebro, usuario, ctx, planes, cierres, activityStart }));
    return await accionAnalizar({ req, res, cerebro, usuario, ctx, planes, cierres, fotosInicio, uid: ident.uid, body, lang });
  } catch (e) {
    console.error('[cierre-semana]', accion, e?.message || e);
    return res.status(500).json({ error: 'internal', retryable: true });
  }
}
