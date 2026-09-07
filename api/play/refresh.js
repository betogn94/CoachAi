// POST /api/play/refresh
// Refresca el estado de la suscripción de Google del usuario que llama. Se usa al
// abrir la app (cuando el acceso está por vencer o venció) para reflejar renovaciones
// y cancelaciones SIN depender de webhooks: busca la suscripción guardada del usuario,
// re-consulta a Google y actualiza usuarios.acceso_hasta + play_sub_state.
//
// Seguridad: guard de origen + el JWT de sesión del que llama (solo actúa sobre SU sub).

import { sb } from '../tower/_db.js';
import { isAllowedOrigin } from '../_origin.js';
import { getSubscription, normalizeState, stateGrantsAccess, extractExpiry } from './_google.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
function svcKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return k;
}

async function callerAuthId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  try {
    const ures = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: svcKey(), Authorization: 'Bearer ' + token },
    });
    if (ures.ok) { const au = await ures.json(); return au && au.id; }
  } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });

  const uid = await callerAuthId(req);
  if (!uid) return res.status(401).json({ ok: false, error: 'no_auth' });

  try {
    const users = await sb(`/usuarios?auth_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`);
    const u = users && users[0];
    if (!u) return res.status(404).json({ ok: false, error: 'no_user' });

    // La suscripción más reciente del usuario (por si resuscribió varias veces).
    const subs = await sb(`/play_subscriptions?usuario_id=eq.${encodeURIComponent(u.id)}&select=purchase_token,expiry_time&order=updated_at.desc&limit=1`);
    const row = subs && subs[0];
    if (!row || !row.purchase_token) return res.status(200).json({ ok: true, hasSub: false });

    let sub;
    try { sub = await getSubscription(row.purchase_token); }
    catch (e) {
      console.error('[play/refresh] getSubscription:', e?.message);
      return res.status(502).json({ ok: false, error: 'google_lookup_failed' });
    }

    const state = normalizeState(sub.subscriptionState);
    const expiry = extractExpiry(sub);
    const grants = stateGrantsAccess(state) && expiry && new Date(expiry) > new Date();

    await sb(`/play_subscriptions?purchase_token=eq.${encodeURIComponent(row.purchase_token)}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { state, expiry_time: expiry, latest_notification: sub, updated_at: new Date().toISOString() },
    });

    const patch = { play_sub_state: state };
    if (expiry) patch.acceso_hasta = expiry;   // futuro = adentro; pasado = bloqueado
    await sb(`/usuarios?id=eq.${encodeURIComponent(u.id)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: patch,
    });

    return res.status(200).json({ ok: true, hasSub: true, state, acceso_hasta: expiry, granted: !!grants });
  } catch (err) {
    console.error('[play/refresh] error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
