// Cron de notificaciones (Fase 2). Lo dispara Vercel Cron cada ~30 min (ver
// vercel.json). En cada corrida, para cada clienta SUSCRIPTA, evalúa en SU hora
// local si le toca alguna notificación basada en horario y se la manda.
//
// Por ahora implementa SOLO la #1 "Buen día" (~9am local). Las demás (cardio,
// cierre del día, cierre de semana) se suman acá, con el mismo patrón.
//
// Auth: Vercel manda `Authorization: Bearer ${CRON_SECRET}` (si la env var está
// puesta). Para PROBAR a mano: GET ?secret=<CRON_SECRET>&test=buen_dia&usuario_id=<id>
// fuerza el envío a ese usuario ignorando hora + anti-duplicados.
//
// Anti-duplicados: antes de mandar, insertamos en notification_log
// (usuario_id, tipo, fecha-local). El UNIQUE actúa de candado: si ya existe
// (409), no re-enviamos. "Insertar primero" evita doble-envío si el cron corre
// dos veces en la misma ventana horaria.

import webpush from 'web-push';

const SUPABASE_URL  = 'https://vmvhlgzwufkardaruutt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdmhsZ3p3dWZrYXJkYXJ1dXR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzA4NjcsImV4cCI6MjA5Mjg0Njg2N30.x9-lV9xi3Kdu_zpHcGC0PC80-GiXpc1WD4lnAuFI_iM';
const VAPID_PUBLIC  = 'BMU0PM_rgcq81HVt8F1Qma0AwbjoHeja5yv6LfadmumHa2Z_IJNmLHuLBsQsrxw13Kso2Krgz7UrU1-ZhsN4WIo';
const VAPID_SUBJECT = 'mailto:support.coachaipro@gmail.com';

const SB_HEADERS = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' };

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  return r.json();
}
async function sbDelete(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: SB_HEADERS });
}
// Inserta una fila de log. Devuelve true si la creó (201), false si ya existía
// (409 = duplicado → ya se mandó hoy). Es el candado anti-duplicados.
async function claimLog(usuario_id, tipo, fecha) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/notification_log`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ usuario_id, tipo, fecha }),
  });
  return r.status === 201;
}

const _accentRe = new RegExp('[\\u0300-\\u036f]', 'g');
const stripAccents = (s) => String(s || '').normalize('NFD').replace(_accentRe, '').toLowerCase();

// Hora/fecha/día local de una clienta según su timezone IANA.
function localParts(tz) {
  const now = new Date();
  let fecha, hour;
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
    const p = {}; for (const x of f.formatToParts(now)) p[x.type] = x.value;
    fecha = `${p.year}-${p.month}-${p.day}`;
    hour = parseInt(p.hour, 10) % 24;
  } catch (e) { return null; }
  let weekday;
  try { weekday = stripAccents(new Intl.DateTimeFormat('es-ES', { timeZone: tz, weekday: 'long' }).format(now)); }
  catch (e) { weekday = ''; }
  return { fecha, hour, weekday };
}

// Manda un payload a TODAS las suscripciones de una clienta. Limpia las muertas.
async function pushToUser(usuario_id, payload) {
  const subs = await sbGet(`push_subscriptions?usuario_id=eq.${usuario_id}&select=endpoint,p256dh,auth`);
  if (!Array.isArray(subs) || !subs.length) return 0;
  let sent = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sbDelete(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
      }
    }
  }
  return sent;
}

// ── Mensajes ────────────────────────────────────────────────────────────────
function buildBuenDia(nombre, isTrainingDay, dayOfMonth) {
  const n = nombre ? ', ' + String(nombre).split(' ')[0] : '';
  const greets = [`¡Buen día${n}! 🌞`, `¡Arriba${n}! 💪`, `¡Buenos días${n}! ✨`, `¡A darle${n}! 🔥`];
  const title = greets[dayOfMonth % greets.length];
  const body = isTrainingDay
    ? 'Hoy entrenás 💪 No te olvides de registrar tus comidas y tu entreno.'
    : 'Hoy descansás 🌿 No te olvides de registrar tus comidas.';
  return { title, body, url: '/', tag: 'buen-dia' };
}

// ¿Hoy entrena? Compara el día de la semana contra dias_entreno. Robusto a los
// dos formatos: abreviaturas de 3 letras ('lun','mar','jue'...) Y nombres
// completos ('lunes','jueves'...) — reduce ambos a las primeras 3 letras sin
// acentos. (Bug 2026-06-18: el onboarding guarda abreviaturas, no nombres.)
function isTrainingDay(dias, weekday) {
  if (!Array.isArray(dias)) return false;
  const w3 = stripAccents(weekday).slice(0, 3);
  return dias.map(d => stripAccents(d).slice(0, 3)).includes(w3);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'cron_secret_not_configured' });
  const authed = req.headers.authorization === `Bearer ${secret}`;
  const testSecretOk = req.query && req.query.secret === secret;
  if (!authed && !testSecretOk) return res.status(401).json({ error: 'unauthorized' });

  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'vapid_not_configured' });
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);

  const testTipo = req.query && req.query.test;
  const testUid  = req.query && req.query.usuario_id;

  try {
    // ── MODO TEST: forzar un tipo a un usuario, ignorando hora + dedup ──
    if (testTipo && testUid) {
      const u = (await sbGet(`usuarios?id=eq.${testUid}&select=id,nombre,dias_entreno,timezone`))[0];
      if (!u) return res.status(404).json({ error: 'user_not_found' });
      const lp = localParts(u.timezone || 'America/Argentina/Buenos_Aires');
      const training = isTrainingDay(u.dias_entreno, lp.weekday);
      let payload;
      if (testTipo === 'buen_dia') payload = buildBuenDia(u.nombre, training, new Date().getDate());
      else return res.status(400).json({ error: 'unknown_test_tipo' });
      const sent = await pushToUser(u.id, payload);
      return res.status(200).json({ ok: true, mode: 'test', tipo: testTipo, sent, training, payload });
    }

    // ── MODO CRON: barrer clientas suscriptas y evaluar condiciones ──
    const subs = await sbGet('push_subscriptions?select=usuario_id');
    const uids = [...new Set((subs || []).map(s => s.usuario_id))].filter(Boolean);
    if (!uids.length) return res.status(200).json({ ok: true, processed: 0, sent: [] });

    const users = await sbGet(`usuarios?id=in.(${uids.join(',')})&select=id,nombre,role,es_interno,timezone,dias_entreno`);
    const sentLog = [];

    for (const u of users) {
      if (u.role !== 'user' || u.es_interno === true) continue;
      if (!u.timezone) continue;                       // sin timezone aún → la captamos cuando abra la app
      const lp = localParts(u.timezone);
      if (!lp) continue;
      const quiet = lp.hour < 8 || lp.hour >= 22;      // silencio nocturno (transversal)
      if (quiet) continue;

      // #1 BUEN DÍA — ~9am local, SIEMPRE (distingue entreno/descanso)
      if (lp.hour === 9) {
        if (await claimLog(u.id, 'buen_dia', lp.fecha)) {
          const training = isTrainingDay(u.dias_entreno, lp.weekday);
          const n = await pushToUser(u.id, buildBuenDia(u.nombre, training, new Date(lp.fecha + 'T12:00:00').getDate()));
          sentLog.push({ uid: u.id.slice(0, 8), tipo: 'buen_dia', sent: n });
        }
      }
    }

    return res.status(200).json({ ok: true, processed: users.length, sent: sentLog });
  } catch (e) {
    console.error('[cron-notifications] error', e);
    return res.status(500).json({ error: e.message || 'unknown' });
  }
}
