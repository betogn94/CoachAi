// GET    /api/tower/revenue              — list revenue entries + totals (por moneda, MRR, por medio de pago)
// POST   /api/tower/revenue              — create a manual revenue entry
// DELETE /api/tower/revenue?id=<uuid>    — remove an entry
//
// Espeja costs.js. Ingresos cargados a mano desde Tower. Stripe-ready: source y
// stripe_payment_id existen para que un webhook futuro inserte en la misma tabla.

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

const VALID_PERIODS  = new Set(['mensual', 'anual', 'unico']);
const VALID_METHODS  = new Set(['transferencia', 'efectivo', 'mercadopago', 'tarjeta', 'stripe', 'otro']);
const VALID_CONCEPTS = new Set(['suscripcion', 'paquete', 'whitelabel', 'otro']);
const VALID_PAYERS   = new Set(['usuario', 'tenant']);
const VALID_CURRENCY = new Set(['ARS', 'USD']);

export default withAuth(async (req, res, session) => {
  if (req.method === 'GET')    return list(req, res);
  if (req.method === 'POST')   return create(req, res, session);
  if (req.method === 'DELETE') return remove(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
});

// Aporte mensual al MRR: mensual recurrente = monto; anual recurrente = monto/12;
// único o no-recurrente = 0 (es ingreso puntual, no recurrente).
function monthlyMRR(r) {
  if (!r.recurring) return 0;
  const a = Number(r.amount || 0);
  if (r.billing_period === 'mensual') return a;
  if (r.billing_period === 'anual')   return a / 12;
  return 0;
}

async function list(req, res) {
  const params = [];
  if (req.query.tenant_id) params.push(`tenant_id=eq.${encodeURIComponent(req.query.tenant_id)}`);
  if (req.query.from)      params.push(`period_start=gte.${encodeURIComponent(req.query.from)}`);
  if (req.query.to)        params.push(`period_start=lte.${encodeURIComponent(req.query.to)}`);
  const qs = params.length ? '&' + params.join('&') : '';

  const rows = await sb(
    `/tower_revenue?select=*,tenants(slug,name),usuarios(nombre,email)&order=period_start.desc,created_at.desc${qs}`
  );

  // Mes actual (UTC)
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;

  // Totales separados POR MONEDA (no se mezclan ARS y USD).
  const byCurrency = {}; // { ARS: {lifetime, month, mrr}, USD: {...} }
  const byMethod = {};   // { transferencia: {ARS:x, USD:y}, ... }  — ingreso del mes por medio de pago
  const ensure = (cur) => (byCurrency[cur] = byCurrency[cur] || { lifetime: 0, month: 0, mrr: 0 });

  for (const r of rows) {
    const cur = (r.currency || 'ARS');
    const a = Number(r.amount || 0);
    const c = ensure(cur);
    c.lifetime += a;
    c.mrr += monthlyMRR(r);
    if ((r.period_start || '') >= monthStart) {
      c.month += a;
      const pm = r.payment_method || 'otro';
      byMethod[pm] = byMethod[pm] || {};
      byMethod[pm][cur] = (byMethod[pm][cur] || 0) + a;
    }
  }
  for (const cur in byCurrency) {
    byCurrency[cur].lifetime = round2(byCurrency[cur].lifetime);
    byCurrency[cur].month    = round2(byCurrency[cur].month);
    byCurrency[cur].mrr      = round2(byCurrency[cur].mrr);
  }

  return res.status(200).json({
    ok: true,
    revenue: rows,
    current_month: { year: y, month: m },
    totals: { by_currency: byCurrency, by_method: byMethod, count: rows.length },
  });
}

async function create(req, res, session) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const payer_type = String(body.payer_type || 'usuario').toLowerCase().trim();
  const concept    = String(body.concept || 'suscripcion').toLowerCase().trim();
  const amount     = Number(body.amount);
  const currency   = String(body.currency || 'ARS').toUpperCase().trim();
  const method     = String(body.payment_method || 'transferencia').toLowerCase().trim();
  const period     = String(body.billing_period || 'mensual').toLowerCase().trim();
  const recurring  = body.recurring !== false;
  const start      = String(body.period_start || '').trim();
  const end        = body.period_end ? String(body.period_end) : null;
  const tenantId   = body.tenant_id ? String(body.tenant_id) : null;
  const usuarioId  = body.usuario_id ? String(body.usuario_id) : null;
  const clienteNom = body.cliente_nombre ? String(body.cliente_nombre).trim() : null;
  const paqueteUsr = (body.paquete_usuarios != null && body.paquete_usuarios !== '')
    ? parseInt(body.paquete_usuarios, 10) : null;
  const notes      = body.notes ? String(body.notes) : null;

  if (!VALID_PAYERS.has(payer_type))          return res.status(400).json({ ok: false, error: 'invalid_payer_type' });
  if (!VALID_CONCEPTS.has(concept))           return res.status(400).json({ ok: false, error: 'invalid_concept' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, error: 'invalid_amount' });
  if (!VALID_CURRENCY.has(currency))          return res.status(400).json({ ok: false, error: 'invalid_currency' });
  if (!VALID_METHODS.has(method))             return res.status(400).json({ ok: false, error: 'invalid_method' });
  if (!VALID_PERIODS.has(period))             return res.status(400).json({ ok: false, error: 'invalid_period' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start))      return res.status(400).json({ ok: false, error: 'invalid_period_start' });
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return res.status(400).json({ ok: false, error: 'invalid_period_end' });

  const row = await sb('/tower_revenue', {
    method: 'POST',
    body: {
      payer_type, concept, amount, currency,
      payment_method: method, billing_period: period, recurring,
      period_start: start, period_end: end,
      tenant_id: tenantId, usuario_id: usuarioId, cliente_nombre: clienteNom,
      paquete_usuarios: paqueteUsr,
      source: 'manual',
      notes,
      created_by: session?.name || session?.sub || null,
    },
    prefer: 'return=representation',
  });

  return res.status(200).json({ ok: true, revenue: Array.isArray(row) ? row[0] : row });
}

async function remove(req, res) {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'id_required' });
  await sb(`/tower_revenue?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.status(200).json({ ok: true });
}

function round2(n) { return Math.round(n * 100) / 100; }
