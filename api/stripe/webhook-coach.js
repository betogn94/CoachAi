// POST /api/stripe/webhook-coach?tenant=<slug>
// Webhook para la cuenta de Stripe PROPIA de un coach (hoy: Team Areté / Lucas).
// Es un archivo APARTE del webhook de Jesús/King (webhook.js) a propósito: ese
// no se toca, y acá todo queda encerrado en UN tenant.
//
// Qué hace (solo acceso, sin Tower — el MRR de Tower suma todo sin filtrar por
// tenant y estos cobros lo inflarían):
//   - checkout.session.completed → alta (beta_invitados del tenant) + acceso +
//                                  email de invitación
//   - invoice.paid               → renueva acceso_hasta (cobro recurrente)
//   - customer.subscription.updated/deleted → marca/limpia la baja (visibilidad)
//   - invoice.payment_failed     → telemetría
//
// Candados:
//   1. Firma de Stripe con el secreto de ESE tenant (STRIPE_WEBHOOK_SECRET_<SLUG>).
//   2. Solo productos declarados como "incluye la app" en
//      tenants.branding_config.stripe_app.precios ({ <price_id|product_id>:
//      { nombre, dias? } }). Lo que no esté → se ignora (el coach vende otras
//      cosas por la misma cuenta y NO deben dar acceso ni mandar invitaciones).
//   3. Todas las escrituras filtran por tenant: jamás toca una alumna de otro
//      coach aunque tenga el mismo email. Si el email ya es de otro tenant →
//      no se mueve, se registra un evento para resolverlo a mano.

import Stripe from 'stripe';
import { sb } from '../tower/_db.js';

export const config = { api: { bodyParser: false } };

const APP_URL = 'https://coachaipro.ai';
// Tenants habilitados. Agregar uno = sumarlo acá + sus 2 env vars + su mapa de precios.
const TENANTS_HABILITADOS = new Set(['arete']);
const VIGENTE = new Set(['active', 'trialing', 'past_due', 'unpaid']);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

const envKey = (slug) => slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const slug = String(req.query?.tenant || '').toLowerCase();
  if (!TENANTS_HABILITADOS.has(slug)) return res.status(404).json({ error: 'unknown_tenant' });

  const secretKey = process.env[`STRIPE_SECRET_KEY_${envKey(slug)}`];
  const whSecret  = process.env[`STRIPE_WEBHOOK_SECRET_${envKey(slug)}`];
  if (!secretKey || !whSecret) {
    console.error(`[stripe-coach:${slug}] faltan STRIPE_SECRET_KEY_${envKey(slug)} / STRIPE_WEBHOOK_SECRET_${envKey(slug)}`);
    return res.status(500).json({ error: 'stripe_not_configured' });
  }
  const stripe = new Stripe(secretKey);

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], whSecret);
  } catch (err) {
    console.error(`[stripe-coach:${slug}] firma inválida:`, err?.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    const tenant = await loadTenant(slug);
    if (!tenant) throw new Error('tenant no encontrado: ' + slug);
    const ctx = { stripe, slug, tenant };
    const o = event.data.object;
    if (event.type === 'checkout.session.completed') await onCheckout(ctx, o);
    else if (event.type === 'invoice.paid') await onInvoicePaid(ctx, o);
    else if (event.type === 'customer.subscription.updated') await onSubUpdated(ctx, o);
    else if (event.type === 'customer.subscription.deleted') await onSubDeleted(ctx, o);
    else if (event.type === 'invoice.payment_failed') await evento(ctx, 'pago_fallido', { email: (o.customer_email || '').toLowerCase() || null, invoice: o.id, intento: o.attempt_count || null });
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[stripe-coach:${slug}] error procesando`, event.type, err?.message || err);
    return res.status(500).json({ error: 'processing_error' }); // Stripe reintenta; todo es idempotente
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function loadTenant(slug) {
  const rows = await sb(`/tenants?slug=eq.${encodeURIComponent(slug)}&select=id,slug,branding_config&limit=1`);
  return rows?.[0] || null;
}

// Mapa de productos que incluyen la app. Clave = price_id o product_id.
function preciosApp(tenant) {
  const p = tenant?.branding_config?.stripe_app?.precios;
  return p && typeof p === 'object' ? p : {};
}

// Devuelve { cfg, priceId, productId, recurring } del primer ítem que esté en
// el mapa, o null si ninguno incluye la app.
// Modo "toda la cuenta" (stripe_app.todos_los_productos=true): todo lo que se
// vende por esa cuenta incluye la app; los pagos únicos dan stripe_app.dias_pago_unico.
// El mapa por precio, si está, tiene prioridad (permite excepciones).
function matchApp(tenant, prices) {
  const mapa = preciosApp(tenant);
  const sa = tenant?.branding_config?.stripe_app || {};
  for (const pr of prices) {
    if (!pr) continue;
    const productId = typeof pr.product === 'string' ? pr.product : pr.product?.id || null;
    const excluido = v => v === false || (v && v.app === false);
    if (excluido(mapa[pr.id]) || (productId && excluido(mapa[productId]))) continue; // excepción explícita
    let cfg = mapa[pr.id] || (productId && mapa[productId]) || null;
    if (!cfg && sa.todos_los_productos === true) cfg = { nombre: 'cuenta completa', dias: sa.dias_pago_unico };
    if (cfg) return { cfg, priceId: pr.id, productId, recurring: !!pr.recurring };
  }
  return null;
}

async function evento(ctx, nombre, meta) {
  try {
    await sb('/beta_eventos', {
      method: 'POST',
      body: { evento: 'stripe_coach_' + nombre, meta: { tenant: ctx.slug, ...meta } },
      prefer: 'return=minimal',
    });
  } catch (e) { /* telemetría best-effort */ }
}

function addDaysUnix(unix, dias) { return unix + Math.round(dias * 86400); }

// Fin del período pagado de una subscription (misma cascada que webhook.js:
// current_period_end a veces llega vacío en el instante del evento).
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
    const rec = item.price?.recurring || {};
    const n = rec.interval_count || 1;
    const d = new Date(start * 1000);
    if (rec.interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + n);
    else if (rec.interval === 'week') d.setUTCDate(d.getUTCDate() + 7 * n);
    else if (rec.interval === 'day') d.setUTCDate(d.getUTCDate() + n);
    else d.setUTCMonth(d.getUTCMonth() + n);
    return Math.floor(d.getTime() / 1000);
  } catch (e) {
    console.warn('[stripe-coach] no se pudo recuperar subscription', subId, ':', e?.message);
    return null;
  }
}

async function subPrices(stripe, subRef) {
  const subId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subId) return [];
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    return (sub?.items?.data || []).map(i => i.price).filter(Boolean);
  } catch (e) { return []; }
}

// Email del customer de una sub: customer.email → última factura.
async function subEmail(stripe, sub) {
  try {
    let c = sub.customer;
    if (typeof c === 'string') c = await stripe.customers.retrieve(c);
    if (c && !c.deleted && c.email) return String(c.email).toLowerCase();
  } catch (e) { /* seguimos */ }
  try {
    let inv = sub.latest_invoice;
    if (typeof inv === 'string') inv = await stripe.invoices.retrieve(inv);
    if (inv?.customer_email) return String(inv.customer_email).toLowerCase();
  } catch (e) { /* noop */ }
  return null;
}

// ¿Este email es alumna/invitada de ESTE tenant? (para no tocar a nadie más)
async function invitadoDe(ctx, email) {
  const rows = await sb(`/beta_invitados?email=eq.${encodeURIComponent(email)}&select=email,tenant_slug&limit=1`);
  return rows?.[0] || null;
}

// Setea acceso_hasta SOLO dentro del tenant (invitada + usuaria).
async function setAcceso(ctx, email, hastaIso, extra = {}) {
  const e = encodeURIComponent(email);
  await sb(`/beta_invitados?email=eq.${e}&tenant_slug=eq.${encodeURIComponent(ctx.slug)}`,
    { method: 'PATCH', body: { acceso_hasta: hastaIso, ...extra }, prefer: 'return=minimal' });
  await sb(`/usuarios?email=eq.${e}&tenant_id=eq.${encodeURIComponent(ctx.tenant.id)}`,
    { method: 'PATCH', body: { acceso_hasta: hastaIso, ...extra }, prefer: 'return=minimal' });
}

// Nunca acorta un acceso ya otorgado (ej. el coach le dio días extra a mano).
async function accesoActual(ctx, email) {
  const rows = await sb(`/beta_invitados?email=eq.${encodeURIComponent(email)}&tenant_slug=eq.${encodeURIComponent(ctx.slug)}&select=acceso_hasta&limit=1`);
  const v = rows?.[0]?.acceso_hasta;
  return v ? new Date(v).getTime() : 0;
}

// ── Eventos ─────────────────────────────────────────────────────────────

async function onCheckout(ctx, session) {
  if (session.payment_status && session.payment_status === 'unpaid') return; // pago diferido aún no confirmado
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const nombre = session.customer_details?.name || null;

  let prices = [];
  try {
    const items = await ctx.stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });
    prices = (items?.data || []).map(li => li.price).filter(Boolean);
  } catch (e) { console.warn('[stripe-coach] line items:', e?.message); }
  const m = matchApp(ctx.tenant, prices);
  if (!m) {
    await evento(ctx, 'ignorado', { motivo: 'producto_sin_app', session: session.id, precios: prices.map(p => p.id), email: email || null });
    return;
  }
  if (!email) { await evento(ctx, 'sin_email', { session: session.id }); return; }

  const previo = await invitadoDe(ctx, email);
  if (previo && previo.tenant_slug !== ctx.slug) {
    // El email ya pertenece a otro coach: no lo movemos solos.
    await evento(ctx, 'conflicto_tenant', { email, tenant_actual: previo.tenant_slug, session: session.id });
    console.warn(`[stripe-coach:${ctx.slug}] ${email} ya es de ${previo.tenant_slug} — no se toca`);
    return;
  }

  // Hasta cuándo: sub → fin del período; pago único → dias del producto (default 30).
  const ahora = Math.floor(Date.now() / 1000);
  let end = null;
  if (session.subscription) end = await subPeriodEnd(ctx.stripe, session.subscription);
  if (!end) {
    const dias = Number(m.cfg.dias) > 0 ? Number(m.cfg.dias) : 30;
    end = addDaysUnix(ahora, dias);
  }
  let hastaMs = end * 1000;
  if (previo) hastaMs = Math.max(hastaMs, await accesoActual(ctx, email));
  const hasta = new Date(hastaMs).toISOString();

  if (!previo) {
    await sb('/beta_invitados', {
      method: 'POST',
      body: {
        email, nombre, tenant_slug: ctx.slug, invitado_por: 'stripe',
        notas: `Alta automática vía Stripe (${m.cfg.nombre || m.priceId})`,
        acceso_hasta: hasta,
      },
      prefer: 'return=minimal',
    });
  }
  await setAcceso(ctx, email, hasta, { suscripcion_cancelada_at: null });
  await evento(ctx, 'alta', { email, producto: m.cfg.nombre || m.priceId, price: m.priceId, product: m.productId, monto: (session.amount_total || 0) / 100, hasta, nueva: !previo });

  if (!previo) {
    try {
      const r = await fetch(`${APP_URL}/api/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({ email, nombre, tenantSlug: ctx.slug, invitadoPor: 'stripe' }),
      });
      if (!r.ok) console.error('[stripe-coach] send-invite respondió', r.status);
    } catch (e) { console.error('[stripe-coach] invitación:', e?.message); }
  }
}

async function onInvoicePaid(ctx, invoice) {
  const subRef = invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
  if (!subRef) return; // los pagos únicos los resuelve el checkout
  const email = (invoice.customer_email || '').toLowerCase();
  if (!email) return;
  // La línea trae el price viejo (l.price) o, en la API nueva, l.pricing.price_details.
  const prices = (invoice.lines?.data || []).map(l => {
    if (l?.price) return l.price;
    const pd = l?.pricing?.price_details;
    return pd ? { id: pd.price, product: pd.product } : null;
  }).filter(Boolean);
  let m = matchApp(ctx.tenant, prices);
  if (!m) m = matchApp(ctx.tenant, await subPrices(ctx.stripe, subRef));
  if (!m) return; // sub de otro producto del coach
  const previo = await invitadoDe(ctx, email);
  if (!previo || previo.tenant_slug !== ctx.slug) return; // el alta la hace el checkout; otro tenant no se toca

  const end = await subPeriodEnd(ctx.stripe, subRef) || invoice.lines?.data?.[0]?.period?.end || null;
  if (!end) { console.warn('[stripe-coach] invoice sin período:', invoice.id); return; }
  const hastaMs = Math.max(end * 1000, await accesoActual(ctx, email));
  await setAcceso(ctx, email, new Date(hastaMs).toISOString());
}

async function onSubUpdated(ctx, sub) {
  const email = await subEmail(ctx.stripe, sub);
  if (!email) return;
  const previo = await invitadoDe(ctx, email);
  if (!previo || previo.tenant_slug !== ctx.slug) return;
  if (!matchApp(ctx.tenant, (sub.items?.data || []).map(i => i.price))) return;
  if (sub.cancel_at_period_end) await marcarBaja(ctx, email, sub.canceled_at);
  else if (VIGENTE.has(sub.status)) await limpiarBaja(ctx, email);
}

async function onSubDeleted(ctx, sub) {
  const email = await subEmail(ctx.stripe, sub);
  if (!email) { await evento(ctx, 'cancelacion_sin_email', { sub: sub.id }); return; }
  const previo = await invitadoDe(ctx, email);
  if (!previo || previo.tenant_slug !== ctx.slug) return;
  if (!matchApp(ctx.tenant, (sub.items?.data || []).map(i => i.price))) return;
  await marcarBaja(ctx, email, sub.canceled_at || sub.ended_at);
}

// La baja NO corta el acceso: vence solo al final de lo pagado (mismo modelo que King).
async function marcarBaja(ctx, email, tsUnix) {
  const body = { suscripcion_cancelada_at: tsUnix ? new Date(tsUnix * 1000).toISOString() : new Date().toISOString() };
  const e = encodeURIComponent(email);
  await sb(`/beta_invitados?email=eq.${e}&tenant_slug=eq.${encodeURIComponent(ctx.slug)}&suscripcion_cancelada_at=is.null`, { method: 'PATCH', body, prefer: 'return=minimal' });
  await sb(`/usuarios?email=eq.${e}&tenant_id=eq.${encodeURIComponent(ctx.tenant.id)}&suscripcion_cancelada_at=is.null`, { method: 'PATCH', body, prefer: 'return=minimal' });
  await evento(ctx, 'baja', { email });
}
async function limpiarBaja(ctx, email) {
  const body = { suscripcion_cancelada_at: null };
  const e = encodeURIComponent(email);
  await sb(`/beta_invitados?email=eq.${e}&tenant_slug=eq.${encodeURIComponent(ctx.slug)}&suscripcion_cancelada_at=not.is.null`, { method: 'PATCH', body, prefer: 'return=minimal' });
  await sb(`/usuarios?email=eq.${e}&tenant_id=eq.${encodeURIComponent(ctx.tenant.id)}&suscripcion_cancelada_at=not.is.null`, { method: 'PATCH', body, prefer: 'return=minimal' });
}
