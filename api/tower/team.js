// /api/tower/team — Tablero de trabajo del Team (Beto, Jesús, Juli).
// Un solo endpoint para todo el CRUD (frugal con el límite de funciones):
//   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD
//            → tareas de la semana [from,to] + las ACTIVAS viejas (fecha<from) que se arrastran
//   POST   { titulo, fecha, hora?, prioridad?, asignados[], estado? }   → crea
//   PATCH  ?id=...  { titulo?, estado?, prioridad?, hora?, asignados?, fecha?, addNota? }
//   DELETE ?id=...
//
// Guardado por withAuth (sesión de Tower). Usa service-role (saltea RLS): la
// tabla team_tasks está bloqueada para la anon key, solo Tower entra acá.

import { withAuth, memberFromUsername, TEAM_OWNERS, TEAM_MEMBERS, TEAM_MEMBER_LABEL } from './_auth.js';
import { sb, badRequest } from './_db.js';
import webpush from 'web-push';

const ESTADOS = ['por_hacer', 'en_progreso', 'hecha', 'en_pausa', 'cancelada', 'bloqueada'];
const PRIOS   = ['alta', 'media', 'baja'];
const RECORDATORIOS = [0, 15, 30, 60];   // minutos antes de la hora (null = sin recordatorio)
const MEMBERS = TEAM_MEMBERS;                    // lista única (incluye a Aylen) desde _auth.js
const ACTIVE  = ['por_hacer', 'en_progreso'];   // los únicos estados que se "arrastran"

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHora = (s) => typeof s === 'string' && /^\d{2}:\d{2}/.test(s);

function cleanAsignados(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((m) => MEMBERS.includes(m)))];
}

// ---------- Push (notificaciones del Team) ----------
const MEMBER_LABEL = TEAM_MEMBER_LABEL;
const VAPID_PUBLIC = 'BMU0PM_rgcq81HVt8F1Qma0AwbjoHeja5yv6LfadmumHa2Z_IJNmLHuLBsQsrxw13Kso2Krgz7UrU1-ZhsN4WIo';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support.coachaipro@gmail.com';
let _vapidReady = false;
function ensureVapid() {
  if (_vapidReady) return true;
  const pk = process.env.VAPID_PRIVATE_KEY;
  if (!pk) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, pk);
  _vapidReady = true;
  return true;
}
// Manda un push a todos los dispositivos de los members dados. Limpia subs muertas (404/410).
async function pushToMembers(members, payload) {
  const list = [...new Set((members || []).filter((m) => MEMBERS.includes(m)))];
  if (!list.length || !ensureVapid()) return;
  let subs = [];
  try { subs = await sb(`/team_push_subscriptions?member=in.(${list.join(',')})&select=endpoint,p256dh,auth`); }
  catch (_) { return; }
  await Promise.all((subs || []).map((s) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload))
      .catch(async (err) => {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await sb(`/team_push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }).catch(() => {});
        }
      })
  ));
}

export default withAuth(async (req, res, session) => {
  const method = req.method;
  // `mbr` viene en sesiones nuevas; para las viejas (token firmado antes de existir
  // `mbr`) lo derivamos del username → no hace falta re-loguear.
  const me = session?.mbr || memberFromUsername(session?.sub) || null;

  // ---------- SUSCRIPCIÓN PUSH (activar/desactivar notificaciones del Team) ----------
  if (req.query.push) {
    let pb = req.body;
    if (typeof pb === 'string') { try { pb = JSON.parse(pb); } catch { pb = {}; } }
    pb = pb || {};
    if (method === 'POST') {
      if (!me) return badRequest(res, 'sesión sin member — cerrá sesión y volvé a entrar');
      const sub = pb.subscription || pb;
      const endpoint = sub && sub.endpoint;
      const keys = (sub && sub.keys) || {};
      if (!endpoint || !keys.p256dh || !keys.auth) return badRequest(res, 'subscription inválida');
      await sb('/team_push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        body: { member: me, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) },
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      // Push de confirmación SOLO en activación explícita (no en el re-sync silencioso).
      if (!pb.silent) {
        await pushToMembers([me], { title: '🔔 Notificaciones activadas', body: 'Vas a recibir los avisos de tus tareas del Team.', url: '/tower/' });
      }
      return res.status(200).json({ ok: true });
    }
    if (method === 'DELETE') {
      const endpoint = String(pb.endpoint || '');
      if (endpoint) await sb(`/team_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // ---------- LISTAR ----------
  if (method === 'GET') {
    const from = String(req.query.from || '').slice(0, 10);
    const to   = String(req.query.to   || '').slice(0, 10);
    if (!isDate(from) || !isDate(to)) return badRequest(res, 'from/to (YYYY-MM-DD) requeridos');

    // Visibilidad: los DUEÑOS (beto/jesus) ven todo; el resto solo las tareas donde
    // están asignados (propias + compartidas). Filtrado en el SERVER (seguro).
    const isOwner = TEAM_OWNERS.includes(me);
    const mine = isOwner ? '' : `&asignados=cs.{${me || '__none__'}}`;
    // Dos consultas simples (PostgREST), se mergean: evita filtros or() anidados frágiles.
    const enRango   = await sb(`/team_tasks?fecha=gte.${from}&fecha=lte.${to}${mine}&order=fecha.asc,created_at.asc`);
    const arrastrad = await sb(`/team_tasks?fecha=lt.${from}&estado=in.(${ACTIVE.join(',')})${mine}&order=fecha.asc,created_at.asc`);
    return res.status(200).json({ ok: true, tasks: [...arrastrad, ...enRango], me, owner: isOwner });
  }

  // body para POST/PATCH
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ---------- CREAR ----------
  if (method === 'POST') {
    const titulo = String(body.titulo || '').trim();
    const fecha  = String(body.fecha || '').slice(0, 10);
    if (!titulo) return badRequest(res, 'titulo requerido');
    if (!isDate(fecha)) return badRequest(res, 'fecha (YYYY-MM-DD) requerida');

    let asignados = cleanAsignados(body.asignados);
    // Un MIEMBRO (no dueño) que no asigna a nadie → se agrega a sí mismo, así no
    // crea una tarea que después no podría ver.
    if (!asignados.length && me && !TEAM_OWNERS.includes(me)) asignados = [me];
    const row = {
      titulo,
      fecha,
      hora:      isHora(body.hora) ? body.hora.slice(0, 5) : null,
      estado:    ESTADOS.includes(body.estado) ? body.estado : 'por_hacer',
      prioridad: PRIOS.includes(body.prioridad) ? body.prioridad : null,
      recordatorio_min: RECORDATORIOS.includes(body.recordatorio_min) ? body.recordatorio_min : null,
      asignados,
      created_by: me,
    };
    const created = await sb('/team_tasks', { method: 'POST', body: row, prefer: 'return=representation' });
    const task = Array.isArray(created) ? created[0] : created;
    // Aviso de asignación: push a los asignados (menos quien la creó).
    const notify = row.asignados.filter((m) => m !== me);
    if (notify.length) {
      const quien = MEMBER_LABEL[me] || 'Alguien';
      await pushToMembers(notify, { title: '📋 Nueva tarea', body: `${quien} te asignó: ${titulo}`, url: '/tower/' }).catch(() => {});
    }
    return res.status(201).json({ ok: true, task });
  }

  // ---------- EDITAR ----------
  if (method === 'PATCH') {
    const id = String(req.query.id || '');
    if (!id) return badRequest(res, 'id requerido');

    const patch = {};
    if (typeof body.titulo === 'string' && body.titulo.trim()) patch.titulo = body.titulo.trim();
    if (ESTADOS.includes(body.estado)) {
      patch.estado = body.estado;
      patch.completed_at = body.estado === 'hecha' ? new Date().toISOString() : null;
    }
    if (body.prioridad === null) patch.prioridad = null;
    else if (PRIOS.includes(body.prioridad)) patch.prioridad = body.prioridad;
    if (body.hora === null) patch.hora = null;
    else if (isHora(body.hora)) patch.hora = body.hora.slice(0, 5);
    if (Array.isArray(body.asignados)) patch.asignados = cleanAsignados(body.asignados);
    if (isDate(body.fecha)) patch.fecha = body.fecha;
    if (body.recordatorio_min === null) patch.recordatorio_min = null;
    else if (RECORDATORIOS.includes(body.recordatorio_min)) patch.recordatorio_min = body.recordatorio_min;
    // Si cambió el día, la hora o el recordatorio → reseteamos el control de envío
    // para que el recordatorio se vuelva a disparar con los datos nuevos.
    if (patch.fecha !== undefined || patch.hora !== undefined || patch.recordatorio_min !== undefined) patch.recordatorio_sent_for = null;

    // Agregar una nota al hilo (lee las actuales, hace append).
    if (body.addNota && String(body.addNota).trim()) {
      const cur = await sb(`/team_tasks?id=eq.${id}&select=notas`);
      const notas = (cur && cur[0] && Array.isArray(cur[0].notas)) ? cur[0].notas : [];
      notas.push({ autor: me, texto: String(body.addNota).trim(), ts: new Date().toISOString() });
      patch.notas = notas;
    }

    if (!Object.keys(patch).length) return badRequest(res, 'nada para actualizar');
    patch.updated_at = new Date().toISOString();
    const updated = await sb(`/team_tasks?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return res.status(200).json({ ok: true, task: Array.isArray(updated) ? updated[0] : updated });
  }

  // ---------- BORRAR ----------
  if (method === 'DELETE') {
    const id = String(req.query.id || '');
    if (!id) return badRequest(res, 'id requerido');
    await sb(`/team_tasks?id=eq.${id}`, { method: 'DELETE' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}, { allowTeamOnly: true });
