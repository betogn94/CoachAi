// POST /api/stripe/subscription-status
// Devuelve el estado de suscripción del usuario LOGUEADO (deriva el email de su
// JWT de sesión, nunca de un campo del cliente). Solo lectura.
//
// Respuesta:
//   { plan: 'premium', status, renovacion (ISO), cancelAtPeriodEnd, trialing }  → tiene sub recurrente
//   { plan: 'none' }                                                             → no tiene sub recurrente en Stripe

import { isAllowedOrigin } from '../_origin.js';
import { getStripe, emailFromToken, findUserSubscription } from './_subs.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_origin' });

  const email = await emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'no_auth' });

  try {
    const stripe = getStripe();
    const found = await findUserSubscription(stripe, email);
    if (!found) return res.status(200).json({ plan: 'none' });
    const s = found.sub;
    return res.status(200).json({
      plan: 'premium',
      status: s.status,
      renovacion: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      trialing: s.status === 'trialing',
    });
  } catch (e) {
    console.error('[subscription-status]', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
}
