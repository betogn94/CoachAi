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
import { TEAM_MEMBERS } from './tower/_auth.js';   // lista única de members (incluye a Aylen)

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

// Lee los minutos de cardio de la rutina (la línea que contiene "cardio", ej.
// "🏃 Cardio: 30 min, 4 días"). Devuelve {has, minutes}. has=false si la rutina
// NO tiene cardio → no mandamos el recordatorio. minutes=null si hay cardio pero
// sin un "N min" parseable → mensaje genérico.
function parseCardioMinutes(rutina) {
  if (!rutina) return { has: false, minutes: null };
  const line = String(rutina).split('\n').find(l => /cardio/i.test(l));
  if (!line) return { has: false, minutes: null };
  const m = line.match(/(\d+)\s*min/i);
  return { has: true, minutes: m ? parseInt(m[1], 10) : null };
}

function buildCardio(minutes) {
  const body = minutes
    ? `Hoy toca ${minutes} min de cardio. ¡Dale que se puede! 💪`
    : 'No te olvides de hacer tu cardio hoy. 💪';
  return { title: '🏃 ¡No te olvides tu cardio!', body, url: '/', tag: 'cardio' };
}

// "Cierre del día" según lo que falte registrar (array 'comidas'/'entreno').
function buildCierreDia(missing) {
  let body;
  if (missing.includes('comidas') && missing.includes('entreno'))
    body = '¿Cómo te fue hoy? No te olvides de registrar tus comidas y tu entreno. 📝';
  else if (missing.includes('comidas'))
    body = 'Te faltó registrar tus comidas de hoy. 📝';
  else
    body = 'Te faltó registrar tu entreno de hoy. 📝';
  return { title: '🌙 ¿Registraste tu día?', body, url: '/', tag: 'cierre-dia' };
}

// Semana del usuario basada en created_at (NO ISO), igual que getWeekNum del app:
// semana 1 = [alta, alta+6], semana N = [alta+(N-1)*7, +6]. Devuelve
// {weekNum, dayInWeek} (dayInWeek 0=primer día .. 6=último día) en la tz del user.
function userWeek(createdAt, tz, todayLocal) {
  let createdLocal;
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = {}; for (const x of f.formatToParts(new Date(createdAt))) p[x.type] = x.value;
    createdLocal = `${p.year}-${p.month}-${p.day}`;
  } catch (e) { return null; }
  const daysSince = Math.floor((Date.parse(todayLocal + 'T00:00:00Z') - Date.parse(createdLocal + 'T00:00:00Z')) / 86400000);
  if (!isFinite(daysSince) || daysSince < 0) return null;
  return { weekNum: Math.floor(daysSince / 7) + 1, dayInWeek: daysSince % 7 };
}

function buildCierreSemana() {
  return {
    title: '📊 ¡Terminaste tu semana!',
    body: 'Cerrala para ver tu progreso y recibir tu plan nuevo. 💪',
    url: '/', tag: 'cierre-semana',
  };
}

// ── TEAM (Tower): recordatorios de tareas ────────────────────────────────────
// Las tablas del Team tienen RLS bloqueada para la anon key → se leen/escriben
// con el SERVICE-ROLE. Todo el equipo (Beto/Jesús/Juli) está en Argentina, así
// que la hora de las tareas se interpreta en esa zona.
const TEAM_TZ = 'America/Argentina/Buenos_Aires';
const SB_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_SVC_HEADERS = () => ({ apikey: SB_SVC_KEY, Authorization: 'Bearer ' + SB_SVC_KEY, 'Content-Type': 'application/json' });
async function sbSvcGet(path) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB_SVC_HEADERS() }); return r.json(); }
async function sbSvcPatch(path, body) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...SB_SVC_HEADERS(), Prefer: 'return=minimal' }, body: JSON.stringify(body) }); }
async function sbSvcDelete(path) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: SB_SVC_HEADERS() }); }

// Hora actual en Argentina como {fecha, min} (min = minutos desde medianoche).
function argNowParts() {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = {}; for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
    return { fecha: `${p.year}-${p.month}-${p.day}`, min: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
  } catch (e) { return null; }
}
// Manda un push a todos los dispositivos de los members dados. Limpia muertas.
async function pushToTeamMembers(members, payload) {
  const list = [...new Set((members || []).filter(m => TEAM_MEMBERS.includes(m)))];
  if (!list.length) return 0;
  const subs = await sbSvcGet(`team_push_subscriptions?member=in.(${list.join(',')})&select=endpoint,p256dh,auth`);
  if (!Array.isArray(subs) || !subs.length) return 0;
  let sent = 0; const body = JSON.stringify(payload);
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); sent++; }
    catch (err) { if (err.statusCode === 404 || err.statusCode === 410) await sbSvcDelete(`team_push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`); }
  }
  return sent;
}
function buildTeamReminder(titulo, min, hora) {
  const h = String(hora).slice(0, 5);
  const cuando = min === 0 ? `Ahora (${h})` : `En ${min} min (${h})`;
  return { title: '⏰ Recordatorio', body: `${cuando}: ${titulo}`, url: '/tower/' };
}
// Barre las tareas con recordatorio que caen en la ventana actual y las manda.
// Dedup: `recordatorio_sent_for` = la fecha para la que ya se mandó (claim ANTES
// de enviar → sin duplicados; si se reprograma a otra fecha, vuelve a disparar).
// Ventana de 30 min (≥ intervalo del cron de 15) → no se pierde aunque drifte.
async function runTeamReminders(sentLog) {
  try {
    const arg = argNowParts();
    if (!arg) return;
    const tasks = await sbSvcGet(`team_tasks?fecha=eq.${arg.fecha}&estado=in.(por_hacer,en_progreso)&hora=not.is.null&recordatorio_min=not.is.null&select=id,titulo,hora,recordatorio_min,asignados,recordatorio_sent_for`);
    if (!Array.isArray(tasks)) return;
    for (const t of tasks) {
      if (t.recordatorio_sent_for === arg.fecha) continue;            // ya enviado hoy
      const hm = String(t.hora).slice(0, 5).split(':');
      const horaMin = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
      if (!isFinite(horaMin)) continue;
      const remMin = horaMin - t.recordatorio_min;
      if (!(arg.min >= remMin && arg.min < remMin + 30)) continue;    // fuera de ventana
      await sbSvcPatch(`team_tasks?id=eq.${t.id}`, { recordatorio_sent_for: arg.fecha }); // claim (anti-duplicado)
      const recips = (Array.isArray(t.asignados) && t.asignados.length) ? t.asignados : TEAM_MEMBERS;
      const n = await pushToTeamMembers(recips, buildTeamReminder(t.titulo, t.recordatorio_min, t.hora));
      sentLog.push({ team_task: t.id.slice(0, 8), tipo: 'team_reminder', sent: n });
    }
  } catch (e) { console.error('[cron] team reminders', e); }
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
      else if (testTipo === 'cardio') {
        const rut = (await sbGet(`planes_semanales?usuario_id=eq.${u.id}&tipo=eq.rutina&select=contenido&order=fecha_entrega.desc&limit=1`))[0];
        const cardio = parseCardioMinutes(rut && rut.contenido);
        payload = buildCardio(cardio.minutes);
      }
      else if (testTipo === 'cierre_dia') {
        const pd = (await sbGet(`progreso_diario?usuario_id=eq.${u.id}&fecha=eq.${lp.fecha}&select=calorias_consumidas,entreno`))[0];
        const missing = [];
        if (!(pd && Number(pd.calorias_consumidas) > 0)) missing.push('comidas');
        if (training && !(pd && pd.entreno !== null && pd.entreno !== undefined)) missing.push('entreno');
        // En test mostramos el mensaje aunque no falte nada (sample = ambos).
        payload = buildCierreDia(missing.length ? missing : ['comidas', 'entreno']);
      }
      else if (testTipo === 'cierre_semana') payload = buildCierreSemana();
      else return res.status(400).json({ error: 'unknown_test_tipo' });
      const sent = await pushToUser(u.id, payload);
      return res.status(200).json({ ok: true, mode: 'test', tipo: testTipo, sent, training, payload });
    }

    // ── MODO CRON ──
    const sentLog = [];

    // (A) RECORDATORIOS DEL TEAM (Tower) — Argentina, en cada corrida.
    await runTeamReminders(sentLog);

    // (B) Notificaciones de clientas — cada una evaluada en SU timezone.
    const subs = await sbGet('push_subscriptions?select=usuario_id');
    const uids = [...new Set((subs || []).map(s => s.usuario_id))].filter(Boolean);
    const users = uids.length
      ? await sbGet(`usuarios?id=in.(${uids.join(',')})&select=id,nombre,role,es_interno,timezone,dias_entreno,created_at`)
      : [];

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

      // #2 CARDIO — ~17:00 local, SOLO días de entreno, con los minutos de la rutina
      if (lp.hour === 17 && isTrainingDay(u.dias_entreno, lp.weekday)) {
        const rut = (await sbGet(`planes_semanales?usuario_id=eq.${u.id}&tipo=eq.rutina&select=contenido&order=fecha_entrega.desc&limit=1`))[0];
        const cardio = parseCardioMinutes(rut && rut.contenido);
        if (cardio.has && await claimLog(u.id, 'cardio', lp.fecha)) {
          const n = await pushToUser(u.id, buildCardio(cardio.minutes));
          sentLog.push({ uid: u.id.slice(0, 8), tipo: 'cardio', sent: n });
        }
      }

      // #3 CIERRE DEL DÍA — ~21:00 local, SOLO si le faltó registrar algo hoy.
      // Comidas: siempre se esperan. Entreno: solo si hoy es día de entreno.
      if (lp.hour === 21) {
        const pd = (await sbGet(`progreso_diario?usuario_id=eq.${u.id}&fecha=eq.${lp.fecha}&select=calorias_consumidas,entreno`))[0];
        const missing = [];
        if (!(pd && Number(pd.calorias_consumidas) > 0)) missing.push('comidas');
        if (isTrainingDay(u.dias_entreno, lp.weekday) && !(pd && pd.entreno !== null && pd.entreno !== undefined)) missing.push('entreno');
        if (missing.length && await claimLog(u.id, 'cierre_dia', lp.fecha)) {
          const n = await pushToUser(u.id, buildCierreDia(missing));
          sentLog.push({ uid: u.id.slice(0, 8), tipo: 'cierre_dia', sent: n });
        }
      }

      // #4 CERRÁ TU SEMANA — ~20:00 del ÚLTIMO día de su semana (dayInWeek 6) y,
      // como catch-up, el día siguiente (dayInWeek 0). Solo si NO cerró esa semana.
      // (Se limita solo a esos 2 días → máx 2 avisos, no hostiga.)
      if (lp.hour === 20 && u.created_at) {
        const w = userWeek(u.created_at, u.timezone, lp.fecha);
        let targetWeek = null;
        if (w && w.dayInWeek === 6) targetWeek = w.weekNum;                       // último día
        else if (w && w.dayInWeek === 0 && w.weekNum > 1) targetWeek = w.weekNum - 1; // día siguiente
        if (targetWeek) {
          const cierre = (await sbGet(`cierres_semanales?usuario_id=eq.${u.id}&semana_num=eq.${targetWeek}&select=id&limit=1`))[0];
          if (!cierre && await claimLog(u.id, 'cierre_semana', lp.fecha)) {
            const n = await pushToUser(u.id, buildCierreSemana());
            sentLog.push({ uid: u.id.slice(0, 8), tipo: 'cierre_semana', sent: n });
          }
        }
      }
    }

    return res.status(200).json({ ok: true, processed: users.length, sent: sentLog });
  } catch (e) {
    console.error('[cron-notifications] error', e);
    return res.status(500).json({ error: e.message || 'unknown' });
  }
}
