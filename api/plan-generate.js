// ============================================================================
// /api/plan-generate — generación de planes con el CEREBRO EN EL SERVIDOR (3.5.f del port RN).
// ============================================================================
// Hoy una sola cosa: la RENOVACIÓN DE RUTINA cada 4 semanas (docs/renovacion-rutina.md; en la PWA
// `maybeOfferRenovacion` L31273 → wizard → `renovGenerate` L31381 → `prefetchPlan('rutina')` L20995).
// El nombre es genérico porque el onboarding nativo (3.6.x) va a generar sus planes iniciales por acá.
// Propuesta aprobada: docs/port-rn/propuesta-plan-generate-2026-10-23.md.
//
// ADITIVO: no toca /api/chat, /api/chat-message, /api/cierre-semana ni la PWA. Interruptores:
//   PLAN_GENERATE_ENABLED=1   → si falta, el endpoint responde 404 (la nativa no ofrece nada).
//   PLAN_GENERATE_ALLOW=<auth uid>[,…] → mientras esté seteada, solo esas cuentas y las internas pasan.
//
// Acciones (POST con Bearer de Supabase):
//   { accion:'elegible', fecha }  → { elegible, motivo, semana, dias_actuales, foco_actual }. Sin IA ni escrituras.
//   { accion:'renovar',  fecha, semana_num, dias:['lun',…], foco } → guarda días+foco en `usuarios`, genera la
//     rutina (estructura → esqueleto de Jesús → reformateo → vara de calidad → plantilla), la guarda pisando
//     el clon de esta semana (`fecha_entrega` posterior al último cierre) y responde { ok, plan, fuente }.
// La ELEGIBILIDAD vive acá (= `_renovElegible` + la cadencia): el servidor es la única verdad.
//
// 3.6.x — PRIMEROS PLANES del onboarding nativo (propuesta aprobada: docs/port-rn/propuesta-primeros-planes-2026-10-26.md):
//   { accion:'primeros_estado', fecha } → migra los planes precargados por el coach si los hay
//     (`migrateClientPreloadedPlans` L24448) y responde { faltan:['rutina'|'dieta'…], migrada }. Sin IA.
//   { accion:'primeros', tipo, fecha } → genera UN plan como `prefetchPlan` L20995 (la nativa pide los dos en
//     paralelo, cada uno con sus 60 s). Candado: si el tipo ya tiene plan vigente → { ya_existia } sin gastar.
import Anthropic from '@anthropic-ai/sdk';

import { crearCerebro } from './_chat-cerebro.js';
import {
  actualizarPreferenciasRutina,
  cargarContextoPlan,
  fechaValida,
  getBackupPlan,
  guardarAlertasDieta,
  guardarPlan,
  insertarAlertasDieta,
  insertarPlanesMigrados,
  leerMigracion,
  limpiarMigracion,
  registrarEvento,
} from './_chat-contexto.js';
import { isAllowedOrigin } from './_origin.js';
// Los prompts del reformateo son los de `aiNormalizePlan`, verificados byte a byte por test:chat-message.
import { NORMALIZAR } from './chat-message.js';

export const config = { maxDuration: 60 };

// `fetch` indirecto: el test offline (scripts/test-plan-generate.mjs) reemplaza globalThis.fetch.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, fetch: (...a) => globalThis.fetch(...a) });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 120);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
// La función tiene 60 s (el plan de Vercel no garantiza más): una llamada nueva a la IA solo arranca
// si llevamos menos de esto; la que esté en vuelo recibe el tiempo que queda como timeout.
const ARRANCAR_IA_HASTA_MS = 28000;
const LIMITE_TOTAL_MS = 55000;

export const REVIEW_LOGIN_EMAIL = 'review@coachaipro.ai'; // index.html L19266
export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
export const FOCOS = ['gluteos', 'superior', 'fullbody', 'brazos', 'ninguno'];
export const TIPOS_PLAN = ['rutina', 'dieta'];
export const ACCIONES = ['elegible', 'renovar', 'primeros_estado', 'primeros'];

/** El mensaje del botón rápido que la PWA manda para cada plan (`prefetchPlan` L20998). */
export function mensajePlan(tipo, lang) {
  if (tipo === 'rutina') return lang === 'en' ? '💪 Weekly Routine' : '💪 Rutina de la semana';
  return lang === 'en' ? '🥗 Weekly Diet' : '🥗 Dieta de la semana';
}

/** El gate de `proceedAfterAuth` L21767: sin esto el prompt sale con IMC=Infinity y nombre vacío. */
export function perfilCompleto(u) {
  return !!(u && u.objetivo && u.nivel && u.peso && u.altura && u.edad && u.sexo);
}

/** ¿Tiene un plan VIGENTE de ese tipo? (`has(t)` de startPlanPrefetch L21117: con fila y no cerrado). */
function planVigente(weeklyPlans, tipo) {
  const p = weeklyPlans && weeklyPlans[tipo];
  return !!(p && !p.closed);
}

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
  return process.env.PLAN_GENERATE_ENABLED === '1';
}
function permitido(uid, usuario) {
  const lista = String(process.env.PLAN_GENERATE_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
  return lista.length === 0 || lista.includes(uid) || !!(usuario && usuario.es_interno === true);
}

/**
 * `_renovElegible` L31262 + la cadencia de `maybeOfferRenovacion` L31284, con los datos de la base.
 * Solo clientas self-serve (o cohorte King) con la rutina vigente generada por la IA (`origen='ia'`,
 * el toque del coach gana) y cuyo último cierre es la semana 4, 8, 12…
 */
export function elegibilidad({ usuario, weeklyPlans, cierres, cerebro }) {
  if (usuario.role && usuario.role !== 'user') return { elegible: false, motivo: 'rol', semana: null };
  if (String(usuario.email || '').trim().toLowerCase() === REVIEW_LOGIN_EMAIL) return { elegible: false, motivo: 'revisor', semana: null };
  if (!(usuario.self_serve === true || usuario.metodo_king === true)) return { elegible: false, motivo: 'no_self_serve', semana: null };
  const r = weeklyPlans && weeklyPlans.rutina;
  if (!(r && !r.closed && r.origen === 'ia')) return { elegible: false, motivo: 'rutina_no_ia', semana: null };
  const last = cerebro._lastCierre(cierres);
  if (!last || last.semana_num < 4 || last.semana_num % 4 !== 0) return { elegible: false, motivo: 'sin_checkpoint', semana: null };
  return { elegible: true, motivo: null, semana: last.semana_num };
}

/** `dias` del wizard: 1 a 7 valores distintos de `lun…dom`, devueltos en el orden de la semana (como `_RENOV_DIA_ORDER`). null si no vale. */
export function normalizarDias(dias) {
  if (!Array.isArray(dias) || !dias.length || dias.length > 7) return null;
  const set = new Set(dias.map((d) => String(d).trim().toLowerCase()));
  if (set.size !== dias.length || [...set].some((d) => !DIAS.includes(d))) return null;
  return DIAS.filter((d) => set.has(d));
}

/** Las llamadas a Haiku con el presupuesto de tiempo de la función; `cobrar` descuenta el tope diario por llamada real. */
function armarLlamadas(t0, cobrar) {
  const hayTiempo = () => Date.now() - t0 < ARRANCAR_IA_HASTA_MS;
  const timeout = () => Math.max(5000, LIMITE_TOTAL_MS - (Date.now() - t0));
  const texto = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const llamar = async (sys, msg) => {
    await cobrar();
    const r = await client.messages.create(
      { model: MODEL_HAIKU, max_tokens: 4096, system: sys.length > 4000 ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }] : sys, messages: [{ role: 'user', content: msg }] },
      { timeout: timeout() },
    );
    return texto(r);
  };
  // Un pase de reformateo (solo formato, nunca inventa): `aiNormalizePlan` L39466 recorta las vallas ``` y los bordes.
  const normalizar = async (tipo, raw) => {
    await cobrar();
    const n = await client.messages.create({ model: MODEL_HAIKU, max_tokens: 4096, system: NORMALIZAR[tipo], messages: [{ role: 'user', content: raw }] }, { timeout: timeout() });
    return texto(n).replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim() || null;
  };
  return { llamar, normalizar, hayTiempo };
}

/**
 * El loop de `prefetchPlan` L21013 (compartido por `renovar` y `primeros`): hasta 2 intentos con
 * `buildSystemPrompt()` y el mensaje del botón. Válido = estructura (+ kcal/macros si es dieta, `dietaHasMacros`
 * L21003); la rutina además tiene que respetar el esqueleto de Jesús, si no se pide otra y, si ninguna cumple,
 * queda la primera que parseó (`rutina_fuera_esqueleto`). Sin estructura → un pase de reformateo. Lanza si la
 * IA falla con status (el caller decide 503 u "no se generó").
 */
async function generarPlanIA({ tipo, cerebro, usuario, nDias, lang, llamar, normalizar, hayTiempo }) {
  const system = cerebro.buildSystemPrompt();
  const mensaje = mensajePlan(tipo, lang);
  const sexo = usuario.sexo || '';
  const valido = (txt) => cerebro.planReplyHasStructure(tipo, txt) && (tipo !== 'dieta' || cerebro.dietaHasMacros(txt));
  let planText = null, fueraEsqueleto = null, splitReasons = [], fuente = 'ia';
  for (let attempt = 0; attempt < 2 && !planText && (attempt === 0 || hayTiempo()); attempt++) {
    const reply = await llamar(system, mensaje);
    if (!reply) continue;
    if (valido(reply)) {
      if (tipo === 'rutina') {
        const r = cerebro.validarRutinaEsqueleto(reply, sexo, nDias);
        if (!r.length) { planText = reply; break; }
        if (!fueraEsqueleto) { fueraEsqueleto = reply; splitReasons = r; }
        continue;
      }
      planText = reply;
      break;
    }
    if (!hayTiempo()) continue;
    let normalized = null;
    try { normalized = await normalizar(tipo, reply); } catch (e) { console.warn('[plan-generate] normalizar:', e?.message || e); }
    if (normalized && valido(normalized)) { planText = normalized; break; }
    // Si sigue mal, el loop regenera de cero (segundo intento).
  }
  if (!planText && fueraEsqueleto) {
    planText = fueraEsqueleto;
    fuente = 'ia_fuera_esqueleto';
    await registrarEvento(usuario.id, 'rutina_fuera_esqueleto', { reasons: splitReasons.join(' | ').slice(0, 500) });
  }
  return { planText, fuente };
}

/**
 * Vara de calidad + plantilla de Jesús (`prefetchPlan` L21045-L21074): kcal/proteína contra el target Mifflin de la
 * usuaria (dieta), días/ejercicios/cardio y sin pecho para mujeres (rutina). Si no llega o no se generó → plantilla
 * con el nombre y el target. Devuelve null si tampoco hay plantilla.
 */
async function varaYPlantilla({ tipo, planText, fuente, cerebro, usuario, nDias, origen }) {
  const target = cerebro.computeDietTarget({ peso: usuario.peso, altura: usuario.altura, edad: usuario.edad, sexo: usuario.sexo, objetivo: usuario.objetivo, actividad: usuario.actividad });
  let reasons = [];
  if (!planText) reasons = ['no se genero'];
  else {
    const q = cerebro.evaluatePlanQuality(tipo, planText, { target, expectedDays: nDias, noChest: usuario.sexo === 'femenino' });
    if (!q.ok) reasons = q.reasons;
  }
  if (reasons.length) {
    await registrarEvento(usuario.id, 'plan_quality_fallback', { tipo, reasons: reasons.join(' | '), origen });
    const backup = await getBackupPlan(tipo, target, usuario, nDias);
    if (backup) return { planText: backup, fuente: 'plantilla' };
  }
  return { planText, fuente };
}

async function accionRenovar({ res, usuario, ctx, cierres, cerebroBase, uid, body, lang }) {
  const t0 = Date.now();
  const eleg = elegibilidad({ usuario, weeklyPlans: ctx.weeklyPlans, cierres, cerebro: cerebroBase });
  if (!eleg.elegible) return res.status(409).json({ error: 'no_elegible', motivo: eleg.motivo, retryable: false });
  if (Number(body.semana_num) !== eleg.semana) return res.status(409).json({ error: 'no_elegible', motivo: 'semana_distinta', semana: eleg.semana, retryable: false });
  const dias = normalizarDias(body.dias);
  if (!dias) return res.status(400).json({ error: 'dias_invalidos', retryable: false });
  if (body.foco != null && !FOCOS.includes(body.foco)) return res.status(400).json({ error: 'foco_invalido', retryable: false });
  const foco = body.foco && body.foco !== 'ninguno' ? body.foco : null; // renovGenerate L31388
  const week = eleg.semana;

  // Tope diario ANTES de gastar (cada llamada real a la IA descuenta, como cuando la PWA pasa por /api/chat).
  let used = await bumpDailyUsage(uid);
  res.setHeader('x-chat-used', used === null ? 'fail' : String(used));
  if (used !== null && used > DAILY_LIMIT) return res.status(429).json({ error: 'daily_limit', retryable: false });
  let llamadas = 0;
  const cobrar = async () => { if (llamadas++ > 0) used = (await bumpDailyUsage(uid)) ?? used; };

  const diasOld = (Array.isArray(usuario.dias_entreno) ? usuario.dias_entreno : []).join(',');
  await registrarEvento(usuario.id, 'renov_new', { week, dias_old: diasOld, dias_new: dias.join(','), foco: foco || 'ninguno' });

  // 1) Preferencias a `usuarios` y al contexto ANTES de generar: el prompt lee los días y el foco nuevos
  //    (renovGenerate L31391). Si la escritura falla, igual se genera (la PWA también sigue).
  try { await actualizarPreferenciasRutina(usuario.id, dias, foco); } catch (e) { console.warn('[plan-generate] persist prefs:', e?.message || e); }
  ctx.selectedDias = dias.slice();
  ctx.currentUser = { ...ctx.currentUser, foco_entreno: foco };
  const cerebro = crearCerebro(ctx);

  // 2) prefetchPlan('rutina') L21013: hasta 2 intentos; estructura → esqueleto; sin estructura → reformateo.
  let planText = null, fuente = 'ia';
  try {
    ({ planText, fuente } = await generarPlanIA({ tipo: 'rutina', cerebro, usuario, nDias: dias.length, lang, ...armarLlamadas(t0, cobrar) }));
  } catch (error) {
    // La IA saturada corta todo: la rutina vieja sigue activa, la nativa reintenta después.
    const status = Number(error?.status) || 0;
    console.error('[plan-generate] API Error:', error?.message || error);
    if (status === 429 || status === 529) {
      await registrarEvento(usuario.id, 'renov_fail', { week, reason: 'overloaded' });
      return res.status(503).json({ error: 'overloaded', retryable: true });
    }
    // Otro error de la IA = "no se generó" → sigue a la plantilla, como la PWA.
  }

  // 3) Vara de calidad + plantilla de Jesús (prefetchPlan L21045-L21074). expectedDays = los días NUEVOS.
  ({ planText, fuente } = await varaYPlantilla({ tipo: 'rutina', planText, fuente, cerebro, usuario, nDias: dias.length, origen: 'renovacion' }));
  if (!planText) {
    await registrarEvento(usuario.id, 'renov_fail', { week, reason: 'rutina inválida y sin plantilla de backup' });
    return res.status(500).json({ error: 'sin_plan', retryable: true });
  }

  // 4) Guardar pisando el clon de ESTA semana (upsert usuario_id+tipo+semana_iso). fecha_entrega SIEMPRE
  //    posterior al último cierre (renovGenerate L31412): si no, nacería cerrada y el clon la pisaría.
  const ends = cierres.map((c) => (c.fecha_fin || '').slice(0, 10)).filter(Boolean).sort();
  const maxEnd = ends.length ? ends[ends.length - 1] : null;
  const hoy = cerebro.getTodayKey();
  const fechaEntrega = maxEnd && maxEnd >= hoy ? cerebro._addDaysStr(maxEnd, 1) : hoy;
  const saved = await guardarPlan({ usuarioId: usuario.id, tipo: 'rutina', contenido: planText, semanaIso: cerebro.getISOWeekKey(), fecha: fechaEntrega, origen: 'ia' });
  if (!saved) {
    await registrarEvento(usuario.id, 'renov_fail', { week, reason: 'save' });
    return res.status(500).json({ error: 'save_failed', retryable: true });
  }
  await registrarEvento(usuario.id, 'renov_ok', { week, dias: dias.length, foco: foco || 'ninguno', fuente });
  return res.status(200).json({ ok: true, semana: week, dias, foco, fuente, plan: { id: saved.id, semana_iso: saved.semana_iso, fecha_entrega: saved.fecha_entrega }, used });
}

// ─── 3.6.x — primeros planes ───

/** Guardas comunes de `startPlanPrefetch` L21091 + el gate de perfil completo. null = pasa. */
function guardaPrimeros(usuario) {
  if (usuario.role && usuario.role !== 'user') return 'rol';
  if (!perfilCompleto(usuario)) return 'perfil_incompleto';
  return null;
}

/** `migrateClientPreloadedPlans` L24448 en el servidor. Devuelve el nombre del coach si migró algo, si no null. */
async function migrarPrecargados({ usuario, ctx, cerebro }) {
  const inv = await leerMigracion(usuario.email);
  if (!inv || (!inv.pre_rutina && !inv.pre_dieta)) return null;
  const semanaIso = cerebro.getISOWeekKey();
  const hoy = cerebro.getTodayKey();
  const rows = [];
  if (inv.pre_rutina) rows.push({ usuario_id: usuario.id, tipo: 'rutina', semana_iso: semanaIso, fecha_entrega: hoy, contenido: inv.pre_rutina, origen: 'coach' });
  if (inv.pre_dieta) rows.push({ usuario_id: usuario.id, tipo: 'dieta', semana_iso: semanaIso, fecha_entrega: hoy, contenido: inv.pre_dieta, origen: 'coach' });
  const ins = await insertarPlanesMigrados(rows);
  // Capa 2 (L24485): la dieta del coach se valida para Tower con source='migration'. No bloquea.
  const dietaRow = ins.find((r) => r.tipo === 'dieta');
  if (dietaRow) {
    try {
      await insertarAlertasDieta({ usuarioId: usuario.id, planId: dietaRow.id, issues: cerebro.validateDietaConsistency(cerebro.parseDietaContenido(inv.pre_dieta)), source: 'migration' });
    } catch (e) { console.warn('[plan-generate] validador migración:', e?.message || e); }
  }
  // One-shot: con las filas ya en la base, los pre_* se limpian (una segunda entrada no re-inserta).
  await limpiarMigracion(usuario.email);
  // Lo recién insertado pasa a ser el plan vigente para `faltan` (fecha_entrega hoy → no cerrado).
  for (const r of ins) if (!planVigente(ctx.weeklyPlans, r.tipo)) ctx.weeklyPlans[r.tipo] = { ...r, closed: false };
  if (!ins.length) return null;
  await registrarEvento(usuario.id, 'client_migrated', { from: inv.migrada_de_coach });
  return inv.migrada_de_coach || 'tu coach';
}

async function accionPrimerosEstado({ res, usuario, ctx, cerebroBase }) {
  const g = guardaPrimeros(usuario);
  if (g) return res.status(409).json({ error: g, retryable: false });
  let migrada = null;
  try {
    migrada = await migrarPrecargados({ usuario, ctx, cerebro: cerebroBase });
  } catch (e) {
    // Como la PWA (`migration check failed` → null): sin migración se sigue; la nativa genera lo que falte.
    console.warn('[plan-generate] migración:', e?.message || e);
  }
  const faltan = TIPOS_PLAN.filter((t) => !planVigente(ctx.weeklyPlans, t));
  return res.status(200).json({ ok: true, faltan, migrada });
}

async function accionPrimeros({ res, usuario, ctx, cerebroBase, uid, body, lang }) {
  const t0 = Date.now();
  const g = guardaPrimeros(usuario);
  if (g) return res.status(409).json({ error: g, retryable: false });
  const tipo = body.tipo;
  if (!TIPOS_PLAN.includes(tipo)) return res.status(400).json({ error: 'tipo_invalido', retryable: false });
  // Candado: un plan vigente (de la IA o del coach) nunca se pisa; el reintento es gratis.
  const vigente = ctx.weeklyPlans[tipo];
  if (vigente && !vigente.closed) return res.status(200).json({ ok: true, tipo, ya_existia: true, fuente: null, plan: { id: vigente.id || null, semana_iso: vigente.semana_iso, fecha_entrega: vigente.fecha_entrega } });

  let used = await bumpDailyUsage(uid);
  res.setHeader('x-chat-used', used === null ? 'fail' : String(used));
  if (used !== null && used > DAILY_LIMIT) return res.status(429).json({ error: 'daily_limit', retryable: false });
  let llamadas = 0;
  const cobrar = async () => { if (llamadas++ > 0) used = (await bumpDailyUsage(uid)) ?? used; };
  await registrarEvento(usuario.id, 'plan_prefetch_start', { tipos: tipo });

  const cerebro = cerebroBase;
  // `selectedDias.length` L21010: los días del onboarding (esqueleto y vara); con 1 día no hay esqueleto, como la PWA.
  const nDias = Array.isArray(usuario.dias_entreno) ? usuario.dias_entreno.length : 0;
  let planText = null, fuente = 'ia';
  try {
    ({ planText, fuente } = await generarPlanIA({ tipo, cerebro, usuario, nDias, lang, ...armarLlamadas(t0, cobrar) }));
  } catch (error) {
    const status = Number(error?.status) || 0;
    console.error('[plan-generate] API Error:', error?.message || error);
    if (status === 429 || status === 529) {
      await registrarEvento(usuario.id, 'primeros_fail', { tipo, reason: 'overloaded' });
      return res.status(503).json({ error: 'overloaded', retryable: true });
    }
  }
  ({ planText, fuente } = await varaYPlantilla({ tipo, planText, fuente, cerebro, usuario, nDias, origen: 'onboarding' }));
  if (!planText) {
    await registrarEvento(usuario.id, 'primeros_fail', { tipo, reason: `${tipo} inválido y sin plantilla de backup` });
    return res.status(500).json({ error: 'sin_plan', retryable: true });
  }
  // `saveWeeklyPlan` L20463: la dieta se guarda con las kcal reconciliadas; semana ISO y fecha_entrega de hoy
  // (sin cierres todavía) → nace vigente.
  const contenido = tipo === 'dieta' ? cerebro.reconcileDietKcal(planText) : planText;
  const saved = await guardarPlan({ usuarioId: usuario.id, tipo, contenido, semanaIso: cerebro.getISOWeekKey(), fecha: cerebro.getTodayKey(), origen: 'ia' });
  if (!saved) {
    await registrarEvento(usuario.id, 'primeros_fail', { tipo, reason: 'save' });
    return res.status(500).json({ error: 'save_failed', retryable: true });
  }
  if (tipo === 'dieta') await guardarAlertasDieta({ usuarioId: usuario.id, planId: saved.id, issues: cerebro.validateDietaConsistency(cerebro.parseDietaContenido(contenido)) });
  await registrarEvento(usuario.id, 'first_plans_autogen', { tipos: tipo, fuente });
  return res.status(200).json({ ok: true, tipo, fuente, plan: { id: saved.id, semana_iso: saved.semana_iso, fecha_entrega: saved.fecha_entrega }, used });
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
  if (!ACCIONES.includes(accion)) return res.status(400).json({ error: 'accion_invalida', retryable: false });
  if (!fechaValida(fecha)) return res.status(400).json({ error: 'fecha_invalida', retryable: false });

  let contexto;
  try {
    contexto = await cargarContextoPlan({ authUid: ident.uid, fecha, lang });
  } catch (e) {
    console.error('[plan-generate] contexto:', e?.message || e);
    return res.status(503).json({ error: 'context_unavailable', retryable: true });
  }
  if (!contexto) return res.status(404).json({ error: 'sin_perfil', retryable: false });
  const { usuario, ctx, cierres } = contexto;
  if (!permitido(ident.uid, usuario)) return res.status(404).json({ error: 'not_found' });
  const cerebroBase = crearCerebro(ctx);

  try {
    if (accion === 'elegible') {
      const eleg = elegibilidad({ usuario, weeklyPlans: ctx.weeklyPlans, cierres, cerebro: cerebroBase });
      return res.status(200).json({ ...eleg, dias_actuales: Array.isArray(usuario.dias_entreno) ? usuario.dias_entreno : [], foco_actual: usuario.foco_entreno || null });
    }
    if (accion === 'primeros_estado') return await accionPrimerosEstado({ res, usuario, ctx, cerebroBase });
    if (accion === 'primeros') return await accionPrimeros({ res, usuario, ctx, cerebroBase, uid: ident.uid, body, lang });
    return await accionRenovar({ res, usuario, ctx, cierres, cerebroBase, uid: ident.uid, body, lang });
  } catch (e) {
    console.error('[plan-generate]', accion, e?.message || e);
    return res.status(500).json({ error: 'internal', retryable: true });
  }
}
