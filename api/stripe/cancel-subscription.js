// POST /api/stripe/cancel-subscription
// Cancela la suscripción del usuario LOGUEADO con cancel_at_period_end=true:
// mantiene el acceso hasta el fin del período que YA pagó y no se le cobra más.
// El email se deriva de su JWT de sesión (nunca de un campo del cliente), así
// nadie puede cancelar la suscripción de otra persona.
//
// Al fin del período, Stripe dispara customer.subscription.deleted → el webhook
// marca suscripcion_cancelada_at y el acceso caduca solo (modelo ya existente).

import { isAllowedOrigin } from '../_origin.js';
import { getStripe, emailFromToken, findUserSubscription } from './_subs.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });

  const email = await emailFromToken(req);
  if (!email) return res.status(401).json({ ok: false, error: 'no_auth' });

  try {
    const stripe = getStripe();
    const found = await findUserSubscription(stripe, email);
    if (!found) return res.status(404).json({ ok: false, error: 'no_subscription' });

    const s = found.sub;
    // Ya estaba marcada para cancelar → idempotente, devolvemos el estado.
    if (s.cancel_at_period_end) {
      return res.status(200).json({
        ok: true, alreadyCancelled: true,
        accesoHasta: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      });
    }

    const updated = await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
    console.log('[cancel-subscription] cancelada (fin de período):', s.id, 'para', email);
    return res.status(200).json({
      ok: true,
      accesoHasta: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null,
    });
  } catch (e) {
    console.error('[cancel-subscription]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
