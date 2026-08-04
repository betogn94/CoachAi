// POST /api/tower/cancel_subscription  { email }
// Acción de ADMIN (desde Tower, sesión HMAC): cancela la suscripción de una clienta
// por email. Cancela con cancel_at_period_end=true → mantiene acceso hasta el fin del
// período que ya pagó y no se le cobra más. Reusa la lógica de /api/stripe (_subs.js).
// Sirve para gestionar bajas cuando la clienta no puede/quiere darse de baja sola.

import { withAuth } from './_auth.js';
import { getStripe, findUserSubscription } from '../stripe/_subs.js';

export default withAuth(async (req, res, session) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'invalid_email' });

  try {
    const stripe = getStripe();
    const found = await findUserSubscription(stripe, email);
    if (!found) {
      // No tiene suscripción recurrente en Stripe → nada que cancelar (ej. paga manual por link).
      console.log('[tower/cancel_subscription] sin sub para', email, '(ni por email ni por tower_revenue)');
      return res.status(200).json({ ok: true, cancelled: false, reason: 'no_subscription' });
    }
    const s = found.sub;
    const accesoHasta = s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null;
    if (s.cancel_at_period_end) {
      return res.status(200).json({ ok: true, cancelled: true, alreadyCancelled: true, accesoHasta });
    }
    const updated = await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
    console.log('[tower/cancel_subscription] cancelada', s.id, 'para', email, 'por', session?.email || 'tower');
    return res.status(200).json({
      ok: true, cancelled: true,
      accesoHasta: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : accesoHasta,
    });
  } catch (e) {
    console.error('[tower/cancel_subscription]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
