// GET  /api/tower/costs               — list cost entries with monthly amortization
// POST /api/tower/costs               — create a new manual cost entry
// DELETE /api/tower/costs?id=<uuid>   — remove an entry

import { withAuth } from './_auth.js';
import { sb } from './_db.js';
import { monthlyContribution, installmentsProgress, sumMonthly, currentMonthUtc } from './_cost_math.js';

const VALID_PERIODS = new Set(['monthly', 'yearly', 'one-time']);

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

  const { year, month } = currentMonthUtc();

  // Enrich each row with monthly contribution + installments progress
  const enriched = rows.map(r => {
    const monthly_usd = monthlyContribution(r, year, month);
    const progress = installmentsProgress(r, year, month);
    return {
      ...r,
      monthly_usd: Math.round(monthly_usd * 100) / 100,
      installments_progress: progress, // null for non-installment
      active_this_month: monthly_usd > 0,
    };
  });

  // Totals across raw amounts AND monthly projection
  let totalUsd = 0;
  let totalShared = 0;
  let totalAttributed = 0;
  for (const r of rows) {
    const a = Number(r.amount_usd || 0);
    totalUsd += a;
    if (r.tenant_id) totalAttributed += a; else totalShared += a;
  }
  const monthlyProjected = sumMonthly(rows, year, month);
  const monthlySharedOnly = sumMonthly(rows.filter(r => !r.tenant_id), year, month);
  const monthlyAttributedOnly = sumMonthly(rows.filter(r => !!r.tenant_id), year, month);

  return res.status(200).json({
    ok: true,
    costs: enriched,
    current_month: { year, month },
    totals: {
      // Raw lifetime totals (sum of everything ever paid/owed)
      usd: round2(totalUsd),
      shared_usd: round2(totalShared),
      attributed_usd: round2(totalAttributed),
      count: rows.length,
      // What this month actually costs (the useful number)
      monthly_projected_usd: monthlyProjected,
      monthly_shared_usd: monthlySharedOnly,
      monthly_attributed_usd: monthlyAttributedOnly,
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
  const installments = Math.max(1, parseInt(body.installments, 10) || 1);
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
  if (installments > 1 && period !== 'one-time') {
    return res.status(400).json({ ok: false, error: 'installments_only_one_time' });
  }

  const row = await sb('/tower_costs', {
    method: 'POST',
    body: {
      label,
      provider,
      amount_usd: amount,
      billing_period: period,
      installments,
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
