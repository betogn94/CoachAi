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

const VIGENTE = new Set(['active', 'trialing', 'past_due', 'unpaid']);

// Busca en Stripe la suscripción recurrente VIGENTE del email. Devuelve
// { sub, customer } (la de mayor período), o null si no tiene ninguna.
// Considera vigentes: active / trialing / past_due / unpaid (todas siguen
// cobrando o por cobrar → tiene sentido poder cancelarlas).
//
// Dos caminos:
//   1) Por email del CUSTOMER (customers.list({email})).
//   2) Fallback: muchos checkouts de King crean el customer SIN email en el
//      objeto (el mail queda en la sesión/factura) → el path 1 no lo halla.
//      Resolvemos vía el stripe_payment_id (factura in_… o sub_…) que el
//      webhook ya guardó en tower_revenue. Sin esto, ni el cancelar in-app ni
//      el de Tower encuentran las subs de King.
export async function findUserSubscription(stripe, email) {
  // Path 1 — por email del customer
  try {
    const custs = await stripe.customers.list({ email, limit: 20 });
    const vigentes = [];
    for (const c of (custs?.data || [])) {
      let subs;
      try { subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 }); }
      catch (e) { continue; }
      for (const s of (subs?.data || [])) {
        if (VIGENTE.has(s.status)) vigentes.push({ sub: s, customer: c });
      }
    }
    if (vigentes.length) {
      vigentes.sort((a, b) => (b.sub.current_period_end || 0) - (a.sub.current_period_end || 0));
      return vigentes[0];
    }
  } catch (e) { /* seguimos al fallback */ }

  // Path 2 — fallback vía tower_revenue → factura/sub id
  return await subViaRevenue(stripe, email);
}

// Fallback: encuentra la sub vía el stripe_payment_id guardado en tower_revenue
// (la factura in_… del último cobro, o un sub_… directo). Devuelve { sub, customer }
// si está VIGENTE, o null. Usa el service-role para leer tower_revenue.
async function subViaRevenue(stripe, email) {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc || !email) return null;
  try {
    const filtro = encodeURIComponent(`*${email}*`);
    const url = `${SUPABASE_URL}/rest/v1/tower_revenue`
      + `?select=stripe_payment_id,created_at&source=eq.stripe`
      + `&stripe_payment_id=not.is.null&notes=ilike.${filtro}`
      + `&order=created_at.desc&limit=5`;
    const r = await fetch(url, { headers: { apikey: svc, Authorization: 'Bearer ' + svc } });
    if (!r.ok) return null;
    const rows = await r.json();
    for (const row of (rows || [])) {
      const ref = String(row.stripe_payment_id || '');
      let subId = null;
      try {
        if (ref.startsWith('sub_')) subId = ref;
        else if (ref.startsWith('in_')) {
          const inv = await stripe.invoices.retrieve(ref);
          subId = typeof inv?.subscription === 'string' ? inv.subscription : inv?.subscription?.id;
        }
      } catch (e) { continue; }
      if (!subId) continue;
      try {
        const s = await stripe.subscriptions.retrieve(subId);
        if (s && VIGENTE.has(s.status)) {
          let customer = null;
          try {
            customer = typeof s.customer === 'string' ? await stripe.customers.retrieve(s.customer) : s.customer;
          } catch (e) { /* customer opcional */ }
          return { sub: s, customer };
        }
      } catch (e) { continue; }
    }
  } catch (e) { /* noop */ }
  return null;
}
