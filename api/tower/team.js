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

import { withAuth } from './_auth.js';
import { sb, badRequest } from './_db.js';

const ESTADOS = ['por_hacer', 'en_progreso', 'hecha', 'en_pausa', 'cancelada', 'bloqueada'];
const PRIOS   = ['alta', 'media', 'baja'];
const MEMBERS = ['beto', 'jesus', 'juli'];
const ACTIVE  = ['por_hacer', 'en_progreso'];   // los únicos estados que se "arrastran"

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHora = (s) => typeof s === 'string' && /^\d{2}:\d{2}/.test(s);

function cleanAsignados(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((m) => MEMBERS.includes(m)))];
}

export default withAuth(async (req, res, session) => {
  const method = req.method;
  const me = session?.mbr || null;

  // ---------- LISTAR ----------
  if (method === 'GET') {
    const from = String(req.query.from || '').slice(0, 10);
    const to   = String(req.query.to   || '').slice(0, 10);
    if (!isDate(from) || !isDate(to)) return badRequest(res, 'from/to (YYYY-MM-DD) requeridos');

    // Dos consultas simples (PostgREST), se mergean: evita filtros or() anidados frágiles.
    const enRango   = await sb(`/team_tasks?fecha=gte.${from}&fecha=lte.${to}&order=fecha.asc,created_at.asc`);
    const arrastrad = await sb(`/team_tasks?fecha=lt.${from}&estado=in.(${ACTIVE.join(',')})&order=fecha.asc,created_at.asc`);
    return res.status(200).json({ ok: true, tasks: [...arrastrad, ...enRango], me });
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

    const row = {
      titulo,
      fecha,
      hora:      isHora(body.hora) ? body.hora.slice(0, 5) : null,
      estado:    ESTADOS.includes(body.estado) ? body.estado : 'por_hacer',
      prioridad: PRIOS.includes(body.prioridad) ? body.prioridad : null,
      asignados: cleanAsignados(body.asignados),
      created_by: me,
    };
    const created = await sb('/team_tasks', { method: 'POST', body: row, prefer: 'return=representation' });
    return res.status(201).json({ ok: true, task: Array.isArray(created) ? created[0] : created });
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
});
