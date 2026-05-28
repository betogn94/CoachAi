// GET  /api/tower/costs               — list cost entries (optionally filtered)
// POST /api/tower/costs               — create a new manual cost entry
// DELETE /api/tower/costs?id=<uuid>   — remove an entry
//
// All routed through this single file (Vercel function-per-file model).

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

const VALID_PERIODS = new Set(['monthly', 'yearly', 'one-time']);
const KNOWN_PROVIDERS = ['vercel','supabase','resend','anthropic','godaddy','stripe','mercadopago','otro'];

export default withAuth(async (req, res, session) => {
  if (req.method === 'GET')    return list(req, res);
  if (req.method === 'POST')   return create(req, res, session);
  if (req.method === 'DELETE') return remove(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
});

async function list(req, res) {
  const params = [];
  if (req.query.tenant_id) params.push(`tenant_id=eq.${encodeURIComponent(req.query.tenant_id)}`);
  if (req.query.provider)  params.push(`provider=eq.${encodeURIComponent(req.query.provider)}`);
  if (req.query.from)      params.push(`period_start=gte.${encodeURIComponent(req.query.from)}`);
  if (req.query.to)        params.push(`period_start=lte.${encodeURIComponent(req.query.to)}`);

  const qs = params.length ? '&' + params.join('&') : '';
  const rows = await sb(
    `/tower_costs?select=*,tenants(slug,name)&order=period_start.desc,created_at.desc${qs}`
  );

  // Sum totals
  let totalUsd = 0;
  let totalShared = 0;
  let totalAttributed = 0;
  for (const r of rows) {
    const a = Number(r.amount_usd || 0);
    totalUsd += a;
    if (r.tenant_id) totalAttributed += a; else totalShared += a;
  }

  return res.status(200).json({
    ok: true,
    costs: rows,
    totals: {
      usd: round2(totalUsd),
      shared_usd: round2(totalShared),
      attributed_usd: round2(totalAttributed),
      count: rows.length,
    },
  });
}

async function create(req, res, session) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const label    = String(body.label || '').trim();
  const provider = String(body.provider || 'otro').toLowerCase().trim();
  const amount   = Number(body.amount_usd);
  const period   = String(body.billing_period || 'monthly');
  const start    = String(body.period_start || '').trim();
  const end      = body.period_end ? String(body.period_end) : null;
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const notes    = body.notes ? String(body.notes) : null;
  const recurring = body.recurring !== false;

  if (!label)                         return res.status(400).json({ ok: false, error: 'label_required' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, error: 'invalid_amount' });
  if (!VALID_PERIODS.has(period))     return res.status(400).json({ ok: false, error: 'invalid_period' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ ok: false, error: 'invalid_period_start' });
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return res.status(400).json({ ok: false, error: 'invalid_period_end' });

  const row = await sb('/tower_costs', {
    method: 'POST',
    body: {
      label,
      provider,
      amount_usd: amount,
      billing_period: period,
      period_start: start,
      period_end: end,
      tenant_id: tenantId,
      recurring,
      notes,
      created_by: session?.name || session?.sub || null,
    },
    prefer: 'return=representation',
  });

  return res.status(200).json({ ok: true, cost: Array.isArray(row) ? row[0] : row });
}

async function remove(req, res) {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'id_required' });
  await sb(`/tower_costs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.status(200).json({ ok: true });
}

function round2(n) { return Math.round(n * 100) / 100; }
