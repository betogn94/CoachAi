// POST /api/play/rtdn?key=<secreto>
// Webhook de Real-time Developer Notifications (RTDN) de Google Play. Llega vía
// Google Pub/Sub (push) cada vez que cambia una suscripción: renovación mensual,
// cancelación, entrada en gracia, on-hold, expiración, etc. Re-consultamos el estado
// real contra Google y actualizamos play_subscriptions + el candado del usuario.
//
// Auth: es server-to-server (no hay usuario). La protegemos con un secreto en la URL
// (?key=...), que ponemos también en la config del push de Pub/Sub. Sin ese secreto → 403.
//
// Respuestas: 200 = procesado/ack (Pub/Sub no reintenta). 500 = error transitorio
// (Pub/Sub reintenta). Mensajes que no reconocemos → 200 (no-op) para no encolar reintentos.

import { sb } from '../tower/_db.js';
import {
  getSubscription, normalizeState, stateGrantsAccess, extractExpiry, extractProduct,
} from './_google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  // Secreto compartido (en la URL del push de Pub/Sub).
  const expected = process.env.PLAY_RTDN_SECRET;
  const got = (req.query && req.query.key) || '';
  if (!expected || got !== expected) return res.status(403).json({ ok: false, error: 'forbidden' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const msg = body.message || {};
    let payload = {};
    if (msg.data) {
      try { payload = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8')); }
      catch (e) { console.warn('[play/rtdn] data no decodifica'); return res.status(200).json({ ok: true, skip: 'bad_data' }); }
    }

    // Notificación de prueba (botón "enviar prueba" en Play) → ack sin hacer nada.
    if (payload.testNotification) return res.status(200).json({ ok: true, test: true });

    const sn = payload.subscriptionNotification;
    if (!sn || !sn.purchaseToken) return res.status(200).json({ ok: true, skip: 'no_sub_notif' });

    const purchaseToken = sn.purchaseToken;

    // Re-consultar el estado real.
    let sub;
    try { sub = await getSubscription(purchaseToken); }
    catch (e) {
      console.error('[play/rtdn] getSubscription:', e?.message);
      // Error transitorio de Google → 500 para que Pub/Sub reintente.
      return res.status(500).json({ ok: false, error: 'google_lookup_failed' });
    }

    const state = normalizeState(sub.subscriptionState);
    const expiry = extractExpiry(sub);
    const prod = extractProduct(sub);

    // ¿Ya conocemos este token? (lo ató /verify al comprar). Si sí, sabemos el usuario.
    const known = await sb(`/play_subscriptions?purchase_token=eq.${encodeURIComponent(purchaseToken)}&select=usuario_id,email&limit=1`);
    const row = known && known[0];

    // Upsert del registro de la suscripción.
    await sb('/play_subscriptions', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        purchase_token: purchaseToken,
        usuario_id: row ? row.usuario_id : null,
        email: row ? row.email : (sub.externalAccountIdentifiers?.obfuscatedExternalAccountId || 'unknown@rtdn'),
        product_id: prod.productId || sn.subscriptionId || 'coachai_pro_monthly',
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

    // Si sabemos el usuario, movemos su candado: acceso_hasta = fin del período,
    // play_sub_state = estado. (expiry futuro = adentro; expiry pasado = bloqueado.)
    if (row && row.usuario_id) {
      const patch = { play_sub_state: state };
      if (expiry) patch.acceso_hasta = expiry;
      try {
        await sb(`/usuarios?id=eq.${encodeURIComponent(row.usuario_id)}`, {
          method: 'PATCH', prefer: 'return=minimal', body: patch,
        });
      } catch (e) { console.warn('[play/rtdn] patch usuario:', e?.message); }
    }

    return res.status(200).json({ ok: true, state });
  } catch (err) {
    console.error('[play/rtdn] error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
