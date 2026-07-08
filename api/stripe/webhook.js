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

// Price del Mapa Estético King ($19.99, one-time). Red de seguridad del guard:
// si el checkout NO trae metadata.product (ej. se recreó el producto y se perdió
// la etiqueta), igual lo reconocemos por este price → no da acceso + se registra.
const MAPA_PRICE_ID = 'price_1TpbZ80MxxlML2QQivc7CdyI';
// Prices del pago ÚNICO del Foundation (el "plan de por vida"). Lo usamos para
// reconocer su invoice aunque un cupón lo deje en $0 → se registra como
// 'foundation' (único), no como suscripción recurrente que inflaría el MRR.
// Los precios de Stripe NO se editan → cada cambio de monto crea un price nuevo;
// reconocemos TODOS los históricos para que tanto los pagos viejos como los nuevos
// se clasifiquen igual. (Además hay red de seguridad: cualquier línea sin
// recurrencia también cuenta como Foundation, ver isFoundation abajo.)
const FOUNDATION_PRICE_IDS = new Set([
  'price_1To8sh0MxxlML2QQ4oTM4AIQ', // $297   — original (congelado)
  'price_1TqhUi0MxxlML2QQI8m0zg2j', // $99.32 — nuevo (2026-07-07)
]);

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

  // El acceso se extiende SOLO desde invoices de SUSCRIPCIÓN. La renovación mensual
  // mueve acceso_hasta al nuevo período (lines[].period.end; si no viene expandido,
  // lo sacamos de la subscription — NUNCA invoice.period_end, que es el período ya
  // facturado y bloquearía al cliente).
  // ⚠️ El invoice one-time del Foundation (mode:payment + invoice_creation) tiene
  // period.end = AHORA. Si lo usáramos, pisaría el acceso (+1 mes) que ya otorgó
  // checkout.session.completed → el cliente quedaría bloqueado al instante. Por eso
  // sólo extendemos cuando hay subscription; el acceso del Foundation lo dan el
  // checkout (hoy, +1 mes) + la sub de CoachAI (día 30 en adelante).
  const subRef = invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
  if (subRef) {
    let periodEnd = invoice.lines?.data?.[0]?.period?.end || await subPeriodEnd(stripe, subRef);
    if (!periodEnd) console.warn('[stripe] invoice de sub sin período resoluble:', stripeId);
    // Extender acceso ANTES del dedup del ingreso (idempotente). Refresca el acceso
    // en cada cobro recurrente (mes 2+), cuando la fila ya existe.
    await extendAccess(email, periodEnd);
  }

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

  // ¿Es el pago del FOUNDATION ($297)? Su invoice inicial trae una línea one-time
  // (price SIN recurring, el pago de por vida). Los cobros recurrentes ($19.99/mes)
  // y las suscripciones directas NO tienen línea one-time. Así los separamos en
  // Tower: Foundation = ingreso único; suscripción = recurrente (cuenta al MRR).
  const lines = invoice.lines?.data || [];
  // Log de diagnóstico (por si la estructura del invoice cambiara con cupones/API).
  try { console.log('[stripe] invoice lines:', JSON.stringify(lines.map(l => ({ price: l && l.price && l.price.id, rec: !!(l && l.price && l.price.recurring), amt: l && l.amount })))); } catch (e) {}
  // Foundation, 3 señales (OR):
  //  1) línea con el price one-time del Foundation (robusto aunque un cupón lo deje en $0).
  //  2) cualquier línea SIN recurring (el pago único de por vida).
  //  3) RESPALDO del bundle mode:payment (2026-07): el invoice del día 0 lo genera
  //     `invoice_creation` en el checkout de Foundation y trae metadata.product=
  //     'foundation_king' + NO tiene subscription. Así lo cazamos aunque la línea
  //     venga como "custom" sin el objeto price. Scopeado a invoices SIN subscription
  //     → jamás pisa un cobro recurrente (esos siempre traen subscription).
  const _subRef = invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
  const isFoundation =
    lines.some(l =>
      (l && l.price && FOUNDATION_PRICE_IDS.has(l.price.id)) ||
      (l && l.price && !l.price.recurring)
    ) ||
    (!_subRef && (invoice.metadata?.product === 'foundation_king'));

  await sb('/tower_revenue', {
    method: 'POST',
    body: {
      payer_type: 'usuario',
      tenant_id: tenantId,
      cliente_nombre: name,
      concept: isFoundation ? 'foundation' : 'suscripcion',
      amount,
      currency,
      payment_method: 'stripe',
      billing_period: isFoundation ? 'unico' : 'mensual',
      recurring: !isFoundation,
      period_start: periodStart,
      source: 'stripe',
      stripe_payment_id: stripeId,
      stripe_fee: stripeFee,
      created_by: 'stripe-webhook',
      notes: (isFoundation ? 'Foundation · ' : 'Stripe · ') + (email || 'sin email'),
    },
    prefer: 'return=minimal',
  });
}

// Mapa Estético ($19.99 one-time): ingreso puntual (NO da acceso). Llega como
// checkout.session.completed (mode:payment), sin invoice.paid → lo registramos acá.
async function recordMapaRevenue(session) {
  const stripeId = session.id;
  // Idempotencia: un reintento de Stripe no duplica el ingreso.
  const existing = await sb(`/tower_revenue?stripe_payment_id=eq.${encodeURIComponent(stripeId)}&select=id&limit=1`);
  if (existing && existing.length) return;

  const slug = session.metadata?.tenant_slug || 'jesus';
  const tenantId = await tenantIdBySlug(slug);
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase() || null;
  const name  = session.customer_details?.name || email || 'Cliente Stripe';
  const amount = (session.amount_total || 0) / 100;
  const currency = normalizeCurrency(session.currency);
  const periodStart = session.created
    ? new Date(session.created * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  await sb('/tower_revenue', {
    method: 'POST',
    body: {
      payer_type: 'usuario',
      tenant_id: tenantId,
      cliente_nombre: name,
      concept: 'mapa_estetico',
      amount,
      currency,
      payment_method: 'stripe',
      billing_period: 'unico',
      recurring: false,
      period_start: periodStart,
      source: 'stripe',
      stripe_payment_id: stripeId,
      created_by: 'stripe-webhook',
      notes: email ? `Mapa Estético · ${email}` : 'Mapa Estético',
    },
    prefer: 'return=minimal',
  });
  console.log('[stripe] Mapa King registrado:', amount, currency, email || '(sin email)');
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

// ¿Es el checkout del Mapa Estético? Primero por metadata (lo primario); si el
// metadata.product NO viene (se recreó el producto y se perdió), red de seguridad
// por el price. Si trae OTRO product declarado (ej. foundation) → no es Mapa, sin
// llamada extra a Stripe.
async function isMapaCheckout(session, stripe) {
  const prod = session.metadata?.product;
  if (prod === 'mapa_estetico_king') return true;
  if (prod) return false;   // declara otro producto → confiamos, no es el Mapa
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    return (items?.data || []).some(li => li && li.price && li.price.id === MAPA_PRICE_ID);
  } catch (e) { console.warn('[stripe] no se pudieron leer line items del checkout:', e?.message); return false; }
}

// Price del producto "CoachAI Pro King clásico" ($19.99/mes recurrente): marca King
// (tenant jesus) pero SIN el Método King. Se reconoce por su price → la invitación
// nace con metodo_king=false y el RPC de alta la crea FUERA de la cohorte King.
const COACHAI_CLASICO_PRICE_ID = 'price_1TqlNC0MxxlML2QQc31yqj2p';
async function checkoutEsClasico(session, stripe) {
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    return (items?.data || []).some(li => li && li.price && li.price.id === COACHAI_CLASICO_PRICE_ID);
  } catch (e) { console.warn('[stripe] no se pudieron leer line items (clasico):', e?.message); return false; }
}

// Primera compra → alta del cliente (beta_invitados) + acceso + email de invitación.
async function handleCheckoutCompleted(session, stripe) {
  // Guard King Mapa: el Mapa Estético ($19.99) es SOLO el diagnóstico → NO da acceso a
  // la app (a diferencia del Foundation, que SÍ lo da). Este webhook otorga acceso a
  // cualquier checkout completado, así que salteamos explícitamente el Mapa por su
  // metadata. El Foundation (`foundation_king`) y las suscripciones directas siguen normal.
  if (await isMapaCheckout(session, stripe)) {
    // El Mapa NO da acceso a la app, pero SÍ es un ingreso → lo registramos.
    console.log('[stripe] checkout de Mapa King (registra ingreso, no da acceso):', session.id);
    try { await recordMapaRevenue(session); } catch (e) { console.error('[stripe] mapa revenue:', e?.message); }
    return;
  }
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

  // ¿Es el producto "King clásico"? Si sí, la invitación nace metodo_king=false →
  // el RPC de alta la crea en King PERO sin la cohorte del Método. Foundation y
  // suscripciones directas quedan sin marcar (NULL) → el RPC les da método por tenant.
  const esClasico = await checkoutEsClasico(session, stripe);

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
        ...(esClasico ? { metodo_king: false } : {}),
      },
      prefer: 'return=minimal',
    });
  } else if (accesoHasta) {
    // Re-suscripción: refresca el acceso y LIMPIA una marca de cancelación previa
    // (si volvió, ya no está cancelado).
    await sb(
      `/beta_invitados?email=eq.${encodeURIComponent(email)}&tenant_slug=eq.${encodeURIComponent(slug)}`,
      { method: 'PATCH', body: { acceso_hasta: accesoHasta, suscripcion_cancelada_at: null, ...(esClasico ? { metodo_king: false } : {}) }, prefer: 'return=minimal' }
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
