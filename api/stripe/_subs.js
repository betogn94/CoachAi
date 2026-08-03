// Helpers compartidos para el estado y la cancelación de suscripciones.
// Mismo espíritu de seguridad que /api/delete-account: NUNCA confiamos en un email
// que manda el cliente — derivamos el email del JWT de sesión OTP verificado, y
// solo operamos sobre la suscripción de ESE email.

import Stripe from 'stripe';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  return new Stripe(key);
}

// Verifica el token de sesión (Authorization: Bearer <access_token>) llamando a
// Supabase Auth. Devuelve el email autenticado en minúsculas, o null. Así el
// que llama SOLO puede tocar su propia suscripción, no la de otro.
export async function emailFromToken(req) {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !svc) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: svc, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.email ? String(u.email).toLowerCase() : null;
  } catch (e) { return null; }
}

// Busca en Stripe la suscripción recurrente VIGENTE del email. Devuelve
// { sub, customer } (la de mayor período), o null si no tiene ninguna.
// Considera vigentes: active / trialing / past_due / unpaid (todas siguen
// cobrando o por cobrar → tiene sentido poder cancelarlas).
export async function findUserSubscription(stripe, email) {
  const VIGENTE = new Set(['active', 'trialing', 'past_due', 'unpaid']);
  let custs;
  try { custs = await stripe.customers.list({ email, limit: 20 }); }
  catch (e) { throw e; }
  const vigentes = [];
  for (const c of (custs?.data || [])) {
    let subs;
    try { subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 }); }
    catch (e) { continue; }
    for (const s of (subs?.data || [])) {
      if (VIGENTE.has(s.status)) vigentes.push({ sub: s, customer: c });
    }
  }
  if (!vigentes.length) return null;
  vigentes.sort((a, b) => (b.sub.current_period_end || 0) - (a.sub.current_period_end || 0));
  return vigentes[0];
}
