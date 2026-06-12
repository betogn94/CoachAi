// POST /api/stripe/webhook
// Recibe eventos de la cuenta Stripe del coach (Jesús/KING). Flujo automático
// para suscripción mensual:
//   - invoice.paid                → registra el ingreso del mes en tower_revenue
//   - checkout.session.completed  → da de alta al cliente (beta_invitados),
//                                   le setea el acceso y le envía la invitación
//
// Seguridad: verifica la firma de Stripe (STRIPE_WEBHOOK_SECRET) sobre el cuerpo
// CRUDO. Idempotente: dedup por el id de Stripe (un reintento no duplica
// ingresos) y por email+tenant (no re-invita).

import Stripe from 'stripe';
import { sb } from '../tower/_db.js';

// Stripe necesita el cuerpo SIN parsear para validar la firma.
export const config = { api: { bodyParser: false } };

const APP_URL = 'https://coachaipro.ai';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Normaliza la moneda de Stripe ('ars'/'usd', minúscula) a nuestro enum 'ARS'/'USD'.
function normalizeCurrency(stripeCur) {
  const c = String(stripeCur || '').toUpperCase();
  return (c === 'ARS' || c === 'USD') ? c : 'ARS';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const whSecret  = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !whSecret) {
    console.error('[stripe] faltan STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'stripe_not_configured' });
  }
  const stripe = new Stripe(secretKey);

  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    console.error('[stripe] firma inválida:', err?.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    if (event.type === 'invoice.paid') {
      await handleInvoicePaid(event.data.object, stripe);
    } else if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object, stripe);
    } else if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event.data.object, stripe);
    }
    // Cualquier otro evento: 200 OK para que Stripe no reintente.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe] error procesando', event.type, err?.message || err);
    // 500 → Stripe reintenta; la idempotencia evita duplicados.
    return res.status(500).json({ error: 'processing_error' });
  }
}

// Resolver tenant_id desde slug (cache simple por proceso). Default: jesus.
const _tenantCache = {};
async function tenantIdBySlug(slug) {
  const s = slug || 'jesus';
  if (_tenantCache[s]) return _tenantCache[s];
  const rows = await sb(`/tenants?slug=eq.${encodeURIComponent(s)}&select=id&limit=1`);
  const id = rows?.[0]?.id || null;
  if (id) _tenantCache[s] = id;
  return id;
}

// Suma N meses (default 1) a un timestamp UNIX y devuelve UNIX.
function addMonthsUnix(unixStart, count) {
  const d = new Date(unixStart * 1000);
  d.setUTCMonth(d.getUTCMonth() + (count || 1));
  return Math.floor(d.getTime() / 1000);
}

// Fin del período cubierto (UNIX seconds) de una subscription. La fuente directa
// es items.data[0].current_period_end; PERO ese campo a veces NO está poblado en
// el instante en que llega el webhook (race del lado de Stripe — nos pasó con 2
// de las 3 primeras ventas: el ingreso entró pero acceso_hasta quedó null). En
// ese caso caemos a current_period_start + el intervalo del plan, que SÍ está
// disponible. Devuelve null solo si no hay ni una fecha de inicio (el caller
// aplica su propio fallback final).
async function subPeriodEnd(stripe, subRef) {
  const subId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const item = sub?.items?.data?.[0];
    if (!item) return null;
    if (item.current_period_end) return item.current_period_end;
    const start = item.current_period_start || sub.created;
    if (!start) return null;
    const interval = item.plan?.interval || item.price?.recurring?.interval || 'month';
    if (interval === 'year') {
      const d = new Date(start * 1000); d.setUTCFullYear(d.getUTCFullYear() + 1);
      return Math.floor(d.getTime() / 1000);
    }
    return addMonthsUnix(start, 1);
  } catch (e) {
    console.warn('[stripe] no se pudo recuperar subscription', subId, ':', e?.message);
    return null;
  }
}

// Comisión real de Stripe del cobro, en unidades mayores (ej: 1.15 = US$1,15).
// Vive en el balance_transaction del charge; en la API nueva se llega vía
// subscription → latest_invoice → payment_intent → latest_charge →
// balance_transaction (confirmado en la doc de Stripe). Best-effort: devuelve
// null si no se puede resolver o si el fee aún es 0 (cuentas con "standalone
// fees" lo calculan ~36h después → se queda pendiente, no guardamos un 0 falso).
async function subStripeFee(stripe, subRef) {
  const subId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subId, {
      expand: ['latest_invoice.payment_intent.latest_charge.balance_transaction'],
    });
    const bt = sub?.latest_invoice?.payment_intent?.latest_charge?.balance_transaction;
    if (bt && typeof bt === 'object' && typeof bt.fee === 'number' && bt.fee > 0) {
      return bt.fee / 100;
    }
    return null;
  } catch (e) {
    console.warn('[stripe] no se pudo obtener el fee:', e?.message);
    return null;
  }
}

// Cada cobro mensual (incluido el primero) → 1 ingreso en tower_revenue.
async function handleInvoicePaid(invoice, stripe) {
  const stripeId = invoice.id; // único por factura
  const email = invoice.customer_email || null;

  // Fin del período que ESTE pago cubre. Preferimos lines[].period.end del
  // payload; si no viene expandido en el evento, lo recuperamos de la
  // subscription. NUNCA usamos invoice.period_end (es el período YA facturado,
  // pasado, y bloquearía al cliente apenas paga).
  let periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
  if (!periodEnd) {
    const subRef = invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
    periodEnd = await subPeriodEnd(stripe, subRef);
    if (!periodEnd) console.warn('[stripe] invoice sin período resoluble; no se extiende acceso:', stripeId);
  }
  // Extender acceso ANTES del dedup del ingreso (idempotente). Refresca el
  // acceso en cada cobro recurrente (mes 2+), cuando la fila ya existe.
  await extendAccess(email, periodEnd);

  // Idempotencia del ingreso: si ya registramos esta factura, no duplicar.
  const existing = await sb(`/tower_revenue?stripe_payment_id=eq.${encodeURIComponent(stripeId)}&select=id&limit=1`);
  if (existing && existing.length) return;

  // El tenant_slug viaja en la metadata del precio/producto (lo setea el coach al
  // crear el producto). Default 'jesus' mientras haya un solo coach.
  const lineMeta = invoice.lines?.data?.[0]?.metadata || {};
  const slug = invoice.metadata?.tenant_slug || lineMeta.tenant_slug || 'jesus';
  const tenantId = await tenantIdBySlug(slug);

  const amount = (invoice.amount_paid || 0) / 100;
  const currency = normalizeCurrency(invoice.currency);
  const name  = invoice.customer_name || email || 'Cliente Stripe';
  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  // Comisión real de Stripe (best-effort; null si aún no está disponible).
  const subRefFee = invoice.parent?.subscription_details?.subscription || invoice.subscription || null;
  const stripeFee = await subStripeFee(stripe, subRefFee);

  await sb('/tower_revenue', {
    method: 'POST',
    body: {
      payer_type: 'usuario',
      tenant_id: tenantId,
      cliente_nombre: name,
      concept: 'suscripcion',
      amount,
      currency,
      payment_method: 'stripe',
      billing_period: 'mensual',
      recurring: true,
      period_start: periodStart,
      source: 'stripe',
      stripe_payment_id: stripeId,
      stripe_fee: stripeFee,
      created_by: 'stripe-webhook',
      notes: email ? `Stripe · ${email}` : 'Stripe',
    },
    prefer: 'return=minimal',
  });
}

// Setea acceso_hasta del cliente (por email) en usuarios Y beta_invitados.
async function extendAccess(email, periodEndUnix) {
  if (!email || !periodEndUnix) return;
  const e = String(email).toLowerCase();
  const hasta = new Date(periodEndUnix * 1000).toISOString();
  try {
    await sb(`/usuarios?email=eq.${encodeURIComponent(e)}`, { method: 'PATCH', body: { acceso_hasta: hasta }, prefer: 'return=minimal' });
  } catch (err) { console.warn('[stripe] extendAccess usuarios:', err?.message); }
  try {
    await sb(`/beta_invitados?email=eq.${encodeURIComponent(e)}`, { method: 'PATCH', body: { acceso_hasta: hasta }, prefer: 'return=minimal' });
  } catch (err) { console.warn('[stripe] extendAccess invitados:', err?.message); }
}

// Primera compra → alta del cliente (beta_invitados) + acceso + email de invitación.
async function handleCheckoutCompleted(session, stripe) {
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const name  = session.customer_details?.name || null;
  if (!email) return;
  const slug = session.metadata?.tenant_slug || 'jesus';

  // Acceso seteado ACÁ, en el alta. CLAVE: checkout.session.completed e
  // invoice.paid llegan casi simultáneos y SIN orden garantizado; si invoice.paid
  // llega primero, su extendAccess no encuentra la fila (todavía no existe) y el
  // acceso queda sin fecha (= permanente, un cliente que paga 1 vez no debería
  // tener acceso eterno). Resolviendo el período acá nos independizamos del orden.
  let end = await subPeriodEnd(stripe, session.subscription);
  // Último recurso: si NO se pudo resolver el período (race extrema o falta la
  // subscription en el evento), damos ~1 mes desde ahora. JAMÁS dejamos al
  // cliente sin fecha (null = acceso eterno: alguien que paga 1 vez tendría
  // acceso para siempre). El próximo cobro (invoice.paid) ajusta al período real.
  if (!end) end = addMonthsUnix(Math.floor(Date.now() / 1000), 1);
  const accesoHasta = new Date(end * 1000).toISOString();

  // Idempotencia: si ya está en beta_invitados (mismo email+tenant), solo
  // refrescamos acceso_hasta; si no, lo creamos ya con acceso_hasta.
  const existing = await sb(
    `/beta_invitados?email=eq.${encodeURIComponent(email)}&tenant_slug=eq.${encodeURIComponent(slug)}&select=email&limit=1`
  );
  if (!existing || !existing.length) {
    await sb('/beta_invitados', {
      method: 'POST',
      body: {
        email,
        nombre: name,
        tenant_slug: slug,
        invitado_por: 'stripe',
        notas: 'Alta automática vía pago Stripe',
        ...(accesoHasta ? { acceso_hasta: accesoHasta } : {}),
      },
      prefer: 'return=minimal',
    });
  } else if (accesoHasta) {
    // Re-suscripción: refresca el acceso y LIMPIA una marca de cancelación previa
    // (si volvió, ya no está cancelado).
    await sb(
      `/beta_invitados?email=eq.${encodeURIComponent(email)}&tenant_slug=eq.${encodeURIComponent(slug)}`,
      { method: 'PATCH', body: { acceso_hasta: accesoHasta, suscripcion_cancelada_at: null }, prefer: 'return=minimal' }
    );
  }
  // Si el cliente ya onboardeó (existe en usuarios), también lo actualizamos.
  if (accesoHasta) {
    try {
      await sb(`/usuarios?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: { acceso_hasta: accesoHasta, suscripcion_cancelada_at: null }, prefer: 'return=minimal' });
    } catch (e) { console.warn('[stripe] acceso_hasta usuarios:', e?.message); }
  }

  // Disparar el email de invitación reutilizando /api/send-invite (llave interna
  // server-to-server para saltar el chequeo de origin).
  try {
    const r = await fetch(`${APP_URL}/api/send-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({ email, nombre: name, tenantSlug: slug, invitadoPor: 'stripe' }),
    });
    if (!r.ok) console.error('[stripe] send-invite respondió', r.status);
  } catch (e) {
    console.error('[stripe] no se pudo disparar el email de invitación:', e?.message);
  }
}

// Cancelación de suscripción → registramos la fecha SOLO para visibilidad (churn).
// NO tocamos acceso_hasta: el cliente mantiene acceso hasta el fin del período
// que ya pagó y se bloquea solo al vencer (modelo "hasta fin del período pagado").
// Si más adelante se re-suscribe, handleCheckoutCompleted limpia esta marca.
async function handleSubscriptionDeleted(subscription, stripe) {
  let email = null;
  try {
    const custId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (custId) {
      const cust = await stripe.customers.retrieve(custId);
      email = (cust?.email || '').toLowerCase() || null;
    }
  } catch (e) { console.warn('[stripe] no se pudo recuperar el customer en cancelación:', e?.message); }
  if (!email) { console.warn('[stripe] cancelación sin email resoluble:', subscription?.id); return; }

  const enc = encodeURIComponent(email);
  const canceladaAt = new Date().toISOString();
  try {
    await sb(`/usuarios?email=eq.${enc}`, { method: 'PATCH', body: { suscripcion_cancelada_at: canceladaAt }, prefer: 'return=minimal' });
  } catch (err) { console.warn('[stripe] cancel usuarios:', err?.message); }
  try {
    await sb(`/beta_invitados?email=eq.${enc}`, { method: 'PATCH', body: { suscripcion_cancelada_at: canceladaAt }, prefer: 'return=minimal' });
  } catch (err) { console.warn('[stripe] cancel invitados:', err?.message); }
}
