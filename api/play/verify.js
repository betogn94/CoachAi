// POST /api/play/verify
// El cliente (app Android) manda el purchaseToken después de suscribirse por Google
// Play. Acá lo VERIFICAMOS contra la Google Play Developer API y, si es una compra
// real y activa de nuestra suscripción, le damos acceso: seteamos usuarios.acceso_hasta
// = fin del período de la sub (el mismo candado que ya usa la app) + play_sub_state.
//
// Seguridad: guard de origen + el JWT de sesión del que llama (debe ser el DUEÑO de la
// cuenta). Además el purchaseToken no puede estar ya atado a OTRO usuario (anti-reuso).

import { sb } from '../tower/_db.js';
import { isAllowedOrigin } from '../_origin.js';
import {
  getSubscription, acknowledgeSubscription, normalizeState, stateGrantsAccess,
  extractExpiry, extractProduct, PLAY_SUB_PRODUCT_ID,
} from './_google.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';
function svcKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return k;
}

// Identidad REAL del que llama: su auth.uid() desde el JWT de sesión.
async function callerAuthId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  try {
    const ures = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: svcKey(), Authorization: 'Bearer ' + token },
    });
    if (ures.ok) { const au = await ures.json(); return au && au.id; }
  } catch (e) { /* null */ }
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

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const purchaseToken = String(body.purchaseToken || '').trim();
  if (!purchaseToken) return res.status(400).json({ ok: false, error: 'no_token' });

  try {
    // 1) El que llama → su fila de usuarios (dueño de la sesión).
    const rows = await sb(`/usuarios?auth_id=eq.${encodeURIComponent(uid)}&select=id,email&limit=1`);
    const u = rows && rows[0];
    if (!u) return res.status(404).json({ ok: false, error: 'no_user' });

    // 2) Anti-reuso: si el token ya está atado a OTRO usuario, rechazamos.
    const existing = await sb(`/play_subscriptions?purchase_token=eq.${encodeURIComponent(purchaseToken)}&select=usuario_id&limit=1`);
    if (existing && existing[0] && existing[0].usuario_id && existing[0].usuario_id !== u.id) {
      return res.status(409).json({ ok: false, error: 'token_bound_other_user' });
    }

    // 3) Verificar contra Google.
    let sub;
    try { sub = await getSubscription(purchaseToken); }
    catch (e) {
      console.error('[play/verify] getSubscription:', e?.message);
      return res.status(502).json({ ok: false, error: 'google_verify_failed' });
    }

    // 4) Que sea NUESTRO producto.
    const prod = extractProduct(sub);
    if (prod.productId && prod.productId !== PLAY_SUB_PRODUCT_ID) {
      return res.status(400).json({ ok: false, error: 'wrong_product' });
    }

    const state = normalizeState(sub.subscriptionState);
    const expiry = extractExpiry(sub);           // ISO o null
    const grants = stateGrantsAccess(state) && expiry && new Date(expiry) > new Date();

    // 5) Guardar/actualizar la suscripción (upsert por purchase_token).
    await sb('/play_subscriptions', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        purchase_token: purchaseToken,
        usuario_id: u.id,
        email: (u.email || '').toLowerCase(),
        product_id: prod.productId || PLAY_SUB_PRODUCT_ID,
        base_plan_id: prod.basePlanId,
        offer_id: prod.offerId,
        state,
        expiry_time: expiry,
        start_time: sub.startTime || null,
        auto_renewing: !!(sub.lineItems && sub.lineItems[0] && sub.lineItems[0].autoRenewingPlan
          && sub.lineItems[0].autoRenewingPlan.autoRenewEnabled),
        linked_purchase_token: sub.linkedPurchaseToken || null,
        latest_notification: sub,
        updated_at: new Date().toISOString(),
      },
    });

    // 6) Mover el candado de acceso del usuario.
    const patch = { play_sub_state: state };
    if (grants) patch.acceso_hasta = expiry;
    await sb(`/usuarios?id=eq.${encodeURIComponent(u.id)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: patch,
    });

    // 7) Reconocer la compra (Play la reembolsa si no se reconoce en 3 días).
    try {
      const ackState = sub.acknowledgementState;
      if (ackState === 'ACKNOWLEDGEMENT_STATE_PENDING') await acknowledgeSubscription(purchaseToken);
    } catch (e) { console.warn('[play/verify] ack:', e?.message); }

    return res.status(200).json({ ok: true, state, acceso_hasta: grants ? expiry : null, granted: !!grants });
  } catch (err) {
    console.error('[play/verify] error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
