// POST /api/delete-account
// Borra la cuenta de una clienta y TODOS sus datos — requisito de Apple (guía
// 5.1.1v) y Google. Centralizado en el servidor con el service role para que sea
// confiable sin importar el estado del RLS: borra el storage (fotos), las tablas
// hijas que NO cascadean (o no tienen FK), y la fila de `usuarios` (que cascadea
// el resto). `tower_revenue` queda con usuario_id NULL (se conserva el ingreso
// para contabilidad, desvinculado de la persona).
//
// Seguridad (modelo actual, pre-auth-real): guard de origen (solo la app) + match
// usuario_id <-> email contra la base. Queda a la PAR del login actual (por email,
// sin password). Cuando entre el auth real (Fase C) se suma verificar auth.uid().

import { sb } from './tower/_db.js';
import { isAllowedOrigin } from './_origin.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
function svcKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return k;
}

// Borra todas las fotos del usuario del bucket progress-photos. Las fotos viven
// bajo el prefijo `<usuario_id>/...`. Best-effort: si falla, no aborta el borrado.
async function deleteUserPhotos(usuarioId) {
  const base = SUPABASE_URL + '/storage/v1';
  const headers = { apikey: svcKey(), Authorization: 'Bearer ' + svcKey(), 'Content-Type': 'application/json' };
  try {
    const listRes = await fetch(base + '/object/list/progress-photos', {
      method: 'POST', headers,
      body: JSON.stringify({ prefix: usuarioId + '/', limit: 1000 }),
    });
    if (!listRes.ok) return;
    const items = await listRes.json();
    if (!Array.isArray(items) || !items.length) return;
    const prefixes = items.filter(o => o && o.name).map(o => usuarioId + '/' + o.name);
    if (!prefixes.length) return;
    await fetch(base + '/object/progress-photos', {
      method: 'DELETE', headers, body: JSON.stringify({ prefixes }),
    });
  } catch (e) { console.warn('[delete-account] photos:', e?.message); }
}

// Borra la identidad de Supabase Auth si la clienta ya estaba vinculada (OTP).
async function deleteAuthUser(authId) {
  if (!authId) return;
  try {
    await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(authId), {
      method: 'DELETE',
      headers: { apikey: svcKey(), Authorization: 'Bearer ' + svcKey() },
    });
  } catch (e) { console.warn('[delete-account] auth user:', e?.message); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const usuarioId = String(body.usuario_id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!usuarioId || !email) {
    return res.status(400).json({ ok: false, error: 'faltan_datos' });
  }

  try {
    // Verificar que id <-> email matcheen una fila real (evita borrar a otra persona).
    const rows = await sb(`/usuarios?id=eq.${encodeURIComponent(usuarioId)}&select=id,email,auth_id&limit=1`);
    const u = rows && rows[0];
    if (!u || String(u.email || '').toLowerCase() !== email) {
      return res.status(404).json({ ok: false, error: 'no_match' });
    }
    const enc = encodeURIComponent(usuarioId);

    // 1) Storage (fotos).
    await deleteUserPhotos(usuarioId);

    // 2) Hijas que NO cascadean (beta_eventos/entreno_semanal/feedback bloquearían
    //    el delete) o sin FK (user_logros quedaría huérfana).
    for (const t of ['beta_eventos', 'entreno_semanal', 'feedback', 'user_logros']) {
      try { await sb(`/${t}?usuario_id=eq.${enc}`, { method: 'DELETE', prefer: 'return=minimal' }); }
      catch (e) { console.warn(`[delete-account] ${t}:`, e?.message); }
    }

    // 3) La concesión de acceso (allowlist) por email — wipe completo.
    try { await sb(`/beta_invitados?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', prefer: 'return=minimal' }); }
    catch (e) { console.warn('[delete-account] beta_invitados:', e?.message); }

    // 4) La fila de usuarios → cascadea el resto (planes, comidas, fotos_progreso,
    //    medidas, chat, push, etc.). tower_revenue queda con usuario_id NULL.
    await sb(`/usuarios?id=eq.${enc}`, { method: 'DELETE', prefer: 'return=minimal' });

    // 5) Best-effort: identidad de Supabase Auth.
    await deleteAuthUser(u.auth_id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[delete-account] error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
