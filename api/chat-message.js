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
//   CHAT_MESSAGE_ALLOW=<auth uid>[,<auth uid>…] → mientras esté seteada, solo esas cuentas (QA).
// Alcance de esta versión: mensaje de texto. Si la respuesta tiene forma de plan NO se guarda plan
// (candado + structure gate + clamp de kcal + plan_change_blocked llegan en 3.4.c): se devuelve
// cruda, como hace la PWA cuando no persiste ("honest display").
import Anthropic from '@anthropic-ai/sdk';

import { crearCerebro } from './_chat-cerebro.js';
import { cargarContexto, fechaValida, guardarTurno } from './_chat-contexto.js';
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
function permitido(uid) {
  const lista = String(process.env.CHAT_MESSAGE_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
  return lista.length === 0 || lista.includes(uid);
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
  if (!permitido(ident.uid)) return res.status(404).json({ error: 'not_found' });

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

  const cerebro = crearCerebro(contexto.ctx);
  const system = cerebro.buildSystemPrompt();
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
  const hoy = contexto.hoy;
  let guardado = true;
  try {
    await guardarTurno({
      usuarioId: contexto.usuario.id,
      fecha,
      mensajes: [...((hoy && hoy.mensajes) || []), { content: mensaje, type: 'user' }, { content: replyHtml, type: 'coach' }],
      conversation_history: [...((hoy && hoy.conversation_history) || []), { role: 'user', content: mensaje }, { role: 'assistant', content: reply }],
    });
  } catch (e) {
    guardado = false;
    console.error('[chat-message] no se pudo guardar historial_chat:', e?.message || e);
  }

  // Informativo (3.4.c decide qué hacer): ¿la respuesta tiene forma de plan?
  const planTipo = reply.length > 400 ? cerebro.detectPlanInReply(reply) : null;
  return res.status(200).json({ reply, reply_html: replyHtml, fecha, guardado, used, plan: planTipo || null });
}
