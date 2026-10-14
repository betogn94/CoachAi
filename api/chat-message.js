// ============================================================================
// /api/chat-message — el chat del Coach IA con el CEREBRO EN EL SERVIDOR (B3, 3.4.b del port RN).
// ============================================================================
// La app nativa manda solo { mensaje, fecha } con su Bearer de Supabase. Acá se arma el system
// prompt con los datos de la usuaria (api/_chat-cerebro.js = el código REAL de index.html,
// generado por scripts/build-chat-prompt.mjs), se manda el historial saneado a Haiku, se descuenta
// del mismo tope diario que /api/chat y se guarda el turno en historial_chat con el MISMO formato
// que la PWA (el HTML de formatResponse en `mensajes`, los turnos crudos en `conversation_history`).
//
// ADITIVO: /api/chat sigue intacto para la PWA. Interruptores (rollback sin deploy):
//   CHAT_MESSAGE_ENABLED=1   → si falta o es otra cosa, el endpoint responde 404.
//   CHAT_MESSAGE_ALLOW=<auth uid>[,<auth uid>…] → mientras esté seteada, solo esas cuentas y las
//     internas (`usuarios.es_interno`) pasan (QA).
// 3.4.c — planes por chat (port de sendToAI L25108-25310): candado (un plan ACTIVO nunca se pisa →
// `plan_change_blocked` + aviso), structure gate + un pase de reformateo con la IA, clamp de kcal
// contra el target Mifflin (vara → plantilla de Jesús), upsert en planes_semanales + alertas Tower,
// y el aviso "plan listo" solo si quedó guardado de verdad.
import Anthropic from '@anthropic-ai/sdk';

import { crearCerebro } from './_chat-cerebro.js';
import { cargarContexto, fechaValida, getBackupPlan, guardarAlertasDieta, guardarPlan, guardarTurno, registrarEvento } from './_chat-contexto.js';
import { isAllowedOrigin } from './_origin.js';

export const config = { maxDuration: 60 };

// `fetch` indirecto: el test offline (scripts/test-chat-message.mjs --handler) reemplaza globalThis.fetch.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4, fetch: (...a) => globalThis.fetch(...a) });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 120);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
const MAX_MENSAJE = 2000; // maxlength del textarea de la PWA

// Mismas piezas que api/chat.js (copiadas, no importadas: /api/chat no se toca).
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
  return process.env.CHAT_MESSAGE_ENABLED === '1';
}
/** Con allowlist: pasan los uid listados y las cuentas internas (`usuarios.es_interno`, las de prueba de Beto). */
function permitido(uid, usuario) {
  const lista = String(process.env.CHAT_MESSAGE_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
  return lista.length === 0 || lista.includes(uid) || !!(usuario && usuario.es_interno === true);
}

// ─── 3.4.c — planes por chat (port de sendToAI L25108-25310) ───────────────────────────────────

// Prompts de `aiNormalizePlan` (index.html L39250), byte a byte; scripts/test-chat-message.mjs lo verifica.
export const NORMALIZAR = {
  rutina: `Sos un FORMATEADOR de rutinas de entrenamiento. Recibís una rutina en CUALQUIER formato y la devolvés con EXACTAMENTE el mismo contenido, solo reordenada al formato canónico de abajo.

PROHIBIDO ABSOLUTO: cambiar, agregar, quitar o inventar ejercicios, series, repeticiones, pesos, días, descansos o notas del coach. Si un dato no está en el original, NO lo inventes — omitilo.

FORMATO CANÓNICO:
Día 1 · [Grupo o nombre del día]
1. [Ejercicio] — [series]×[reps] · [peso/intensidad si está] · desc [tiempo si está]
2. [Ejercicio] — ...
Día 2 · [...]
Descanso: [días de descanso si se mencionan]

REGLAS:
- Cada ejercicio numerado (1. 2. 3...), uno por línea.
- El número de SERIES va ANTES de la × (ej: "4×10" = 4 series de 10 reps). Si son reps variables/piramidal mantenelas (ej: 4×12-10-8).
- Si el coach dejó una nota de ejecución/técnica, va en una línea debajo del ejercicio, tal cual.
- OBLIGATORIO: si el original menciona días de descanso/off, incluí una línea exacta "Descanso: [días]" al final. No la omitas.
- Sin introducción, sin comentarios, sin explicaciones tuyas.
Respondé SOLO con la rutina formateada.`,
  dieta: `Sos un FORMATEADOR de planes de alimentación. Recibís una dieta en CUALQUIER formato y la devolvés con EXACTAMENTE el mismo contenido, solo ordenada y legible.

PROHIBIDO ABSOLUTO: cambiar, agregar, quitar o inventar comidas, cantidades, calorías o macros. Si un dato no está, NO lo inventes.

Agrupá por día (LUNES, MARTES, ... o "Día 1, Día 2" si así viene) y dentro de cada día las comidas (Desayuno, Almuerzo, Merienda, Cena u las que haya), una por línea. Sin introducción ni comentarios. Respondé SOLO con la dieta formateada.`,
};

/** Un pase de reformateo (solo formato, nunca inventa). null si falla. */
async function normalizarPlanIA(tipo, raw) {
  try {
    const r = await client.messages.create({ model: MODEL_HAIKU, max_tokens: 4096, system: NORMALIZAR[tipo], messages: [{ role: 'user', content: raw }] });
    let txt = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    txt = txt.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    return txt || null;
  } catch (e) {
    console.warn('[chat-message] normalizar:', e?.message || e);
    return null;
  }
}

/**
 * Lo que ve la usuaria cuando el candado frenó un plan con el suyo ACTIVO. La PWA muestra el plan
 * crudo ("honest display"); acá va un aviso corto (decisión de producto de Beto 2026-10-14: el chat
 * no debe dar a entender que el plan se cambia pidiéndolo). El texto crudo queda igual en
 * `conversation_history` para que la IA conserve el contexto. Mismo HTML que las entregas.
 */
export function avisoPlanBloqueado(tipo, lang) {
  const isEs = lang !== 'en';
  const A = (fn, txt) => `<a onclick="${fn}();return false" style="cursor:pointer;color:var(--accent-bright);text-decoration:underline;font-weight:700">${txt}</a>`;
  const seccion = tipo === 'rutina' ? A('showMiEntreno', isEs ? 'Mi Entreno' : 'My Training') : A('showDiario', isEs ? 'Mi Alimentación' : 'My Nutrition');
  const title = isEs ? (tipo === 'rutina' ? '🔒 Tu rutina de esta semana ya está activa' : '🔒 Tu dieta de esta semana ya está activa') : (tipo === 'rutina' ? '🔒 Your routine for this week is already active' : '🔒 Your meal plan for this week is already active');
  const body = isEs
    ? `No la cambio desde el chat: la tenés en ${seccion}. Si necesitás un cambio de fondo, hablalo con tu entrenador o esperá el cierre de la semana.`
    : `I don't change it from the chat: you have it in ${seccion}. For a deeper change, talk to your coach or wait for the weekly wrap-up.`;
  const note = isEs
    ? `📍 Para el día a día contás conmigo: reemplazar una comida, una alternativa de ejercicio o cualquier duda.`
    : `📍 For the day-to-day I've got you: a meal swap, an exercise alternative, or any question.`;
  return `<div style="font-size:14.5px;line-height:1.65">
    <div style="font-size:15.5px;font-weight:700;color:var(--text);margin-bottom:8px">${title}</div>
    <div style="margin-bottom:8px">${body}</div>
    <div style="font-size:12.5px;color:var(--muted);margin-top:6px">${note}</div>
  </div>`;
}

export default async function handler(req, res) {
  if (!habilitado()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_origin' });

  const ident = await identifyUser(req);
  res.setHeader('x-chat-ident', ident.reason);
  if (!ident.uid) {
    // Sin identidad no hay contexto que armar: a diferencia de /api/chat no puede ser fail-open.
    if (ident.reason === 'error') return res.status(503).json({ error: 'auth_unavailable', retryable: true });
    return res.status(401).json({ error: 'auth_required', retryable: false });
  }
  const body = req.body || {};
  const mensaje = typeof body.mensaje === 'string' ? body.mensaje.trim() : '';
  const fecha = body.fecha;
  const lang = body.lang === 'en' ? 'en' : 'es';
  if (!mensaje || mensaje.length > MAX_MENSAJE) return res.status(400).json({ error: 'mensaje_invalido', retryable: false });
  if (!fechaValida(fecha)) return res.status(400).json({ error: 'fecha_invalida', retryable: false });

  let contexto;
  try {
    contexto = await cargarContexto({ authUid: ident.uid, fecha, lang });
  } catch (e) {
    console.error('[chat-message] contexto:', e?.message || e);
    return res.status(503).json({ error: 'context_unavailable', retryable: true });
  }
  if (!contexto) return res.status(404).json({ error: 'sin_perfil', retryable: false });
  if (!permitido(ident.uid, contexto.usuario)) return res.status(404).json({ error: 'not_found' });

  const cerebro = crearCerebro(contexto.ctx);
  const system = cerebro.buildSystemPrompt();
  const wp = contexto.ctx.weeklyPlans || {};
  const slotLibre = (tipo) => !!tipo && (!wp[tipo] || wp[tipo].closed);
  // sendToAI L25110: si pidió un plan y el slot está libre, la próxima respuesta es una entrega.
  const requested = cerebro.detectPlanRequest(mensaje);
  const pendingPlanDelivery = requested && slotLibre(requested) ? requested : null;
  const messages = cerebro.sanitizeTurnsForAPI([...contexto.turnos, { role: 'user', content: mensaje }]);
  if (!messages.length || messages[0].role !== 'user') return res.status(400).json({ error: 'historial_invalido', retryable: false });
  if (messages.length > 100 || system.length > 100000 || JSON.stringify(messages).length > 200000) return res.status(413).json({ error: 'payload_too_large' });

  // Mismo contador y tope que /api/chat (clave = id de auth.users). Después de validar, así un 400 no gasta.
  const used = await bumpDailyUsage(ident.uid);
  res.setHeader('x-chat-used', used === null ? 'fail' : String(used));
  if (used !== null && used > DAILY_LIMIT) {
    console.warn('[chat-message] uid', ident.uid, 'superó el tope diario:', used);
    return res.status(429).json({ error: 'daily_limit', retryable: false });
  }

  let reply;
  try {
    const response = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 4096,
      system: system.length > 4000 ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
      messages,
    });
    reply = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!reply) throw Object.assign(new Error('Empty response from API'), { status: 500 });
  } catch (error) {
    console.error('[chat-message] API Error:', error?.message || error);
    const status = Number(error?.status) || 0;
    const overloaded = status === 429 || status === 529;
    return res.status(overloaded ? 503 : 500).json({ error: overloaded ? 'overloaded' : 'ai_error', retryable: overloaded });
  }

  // Persistir el turno como lo hace la PWA (sendMessage + sendToAI): el texto crudo de la usuaria y el
  // HTML del coach en `mensajes`; los turnos crudos en `conversation_history`. Si falla, la respuesta
  // igual vuelve (la nativa la muestra) y queda logueado.
  const replyHtml = cerebro.formatResponse(reply);
  const usuario = contexto.usuario;

  // ── Entrega de plan (sendToAI L25153-25310) ──
  // Es entrega si mide >400 y (lo pidió con slot libre O la respuesta tiene forma de plan).
  const tipoFromReply = cerebro.detectPlanInReply(reply);
  const isPlanDelivery = reply.length > 400 && (pendingPlanDelivery || tipoFromReply);
  let visible = replyHtml; // lo que se pinta como mensaje del coach
  let plan = null; // { tipo, estado: 'guardado' | 'bloqueado' | 'no_guardado' }
  if (isPlanDelivery) {
    const tipo = pendingPlanDelivery || tipoFromReply; // la intención de la usuaria gana
    // CANDADO: solo con el slot libre (sin plan o cerrado). Un plan ACTIVO es intocable desde el chat.
    const slotOpen = slotLibre(tipo);
    let planText = reply;
    let hasStructure = cerebro.planReplyHasStructure(tipo, reply);
    // STRUCTURE GATE + un pase de reformateo (solo con slot libre: si el candado frena igual, no se gasta).
    if (!hasStructure && slotOpen) {
      await bumpDailyUsage(ident.uid); // el reformateo también es una llamada (en la PWA pasa por /api/chat)
      const normalized = await normalizarPlanIA(tipo, reply);
      if (normalized && cerebro.planReplyHasStructure(tipo, normalized)) { planText = normalized; hasStructure = true; }
    }
    let persisted = false;
    let contenidoGuardado = null;
    if (slotOpen && hasStructure) {
      // CLAMP DE KCAL (dieta): misma vara que el onboarding; si no llega, plantilla de Jesús al target. Fail-open.
      if (tipo === 'dieta') {
        try {
          const target = cerebro.computeDietTarget({ peso: usuario.peso, altura: usuario.altura, edad: usuario.edad, sexo: usuario.sexo, objetivo: usuario.objetivo, actividad: usuario.actividad });
          if (target) {
            const q = cerebro.evaluatePlanQuality('dieta', planText, { target });
            if (!q.ok) {
              await registrarEvento(usuario.id, 'plan_quality_fallback', { tipo, reasons: q.reasons.join(' | '), origen: 'chat' });
              const backup = await getBackupPlan('dieta', target, usuario);
              if (backup) planText = backup;
            }
          }
        } catch (e) {
          console.warn('[chat-message] clamp dieta:', e?.message || e);
        }
      }
      contenidoGuardado = tipo === 'dieta' ? cerebro.reconcileDietKcal(planText) : planText;
      const saved = await guardarPlan({ usuarioId: usuario.id, tipo, contenido: contenidoGuardado, semanaIso: cerebro.getISOWeekKey(), fecha });
      if (!saved) await registrarEvento(usuario.id, 'plan_save_failed', { tipo, reason: 'db' });
      else {
        persisted = true;
        if (tipo === 'dieta') await guardarAlertasDieta({ usuarioId: usuario.id, planId: saved.id, issues: cerebro.validateDietaConsistency(cerebro.parseDietaContenido(contenidoGuardado)) });
      }
    } else if (!slotOpen && hasStructure) {
      await registrarEvento(usuario.id, 'plan_change_blocked', { tipo });
      plan = { tipo, estado: 'bloqueado' };
    }
    // HONEST DISPLAY: "plan listo" solo si quedó guardado un plan parseable EN ESTE TURNO.
    if (persisted && contenidoGuardado && cerebro.planReplyHasStructure(tipo, contenidoGuardado)) {
      visible = cerebro.buildPlanReadyNotification(tipo);
      plan = { tipo, estado: 'guardado' };
    } else if (plan && plan.estado === 'bloqueado') {
      visible = avisoPlanBloqueado(tipo, lang);
    } else {
      await registrarEvento(usuario.id, 'plan_save_failed', { tipo, reason: 'unparseable' });
      plan = { tipo, estado: 'no_guardado' };
    }
  }

  // Persistir el turno como lo hace la PWA (sendMessage + sendToAI): el texto crudo de la usuaria y el
  // HTML del coach (o el aviso de plan) en `mensajes`; los turnos crudos en `conversation_history`.
  // Si falla, la respuesta igual vuelve (la nativa la muestra) y queda logueado.
  const hoy = contexto.hoy;
  let guardado = true;
  try {
    await guardarTurno({
      usuarioId: usuario.id,
      fecha,
      mensajes: [...((hoy && hoy.mensajes) || []), { content: mensaje, type: 'user' }, { content: visible, type: 'coach' }],
      conversation_history: [...((hoy && hoy.conversation_history) || []), { role: 'user', content: mensaje }, { role: 'assistant', content: reply }],
    });
  } catch (e) {
    guardado = false;
    console.error('[chat-message] no se pudo guardar historial_chat:', e?.message || e);
  }

  return res.status(200).json({ reply, reply_html: visible, fecha, guardado, used, plan });
}
