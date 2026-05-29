// GET /api/tower/dieta_alerts
// Returns dieta consistency alerts grouped by user/plan. Supports:
//   ?resolved=false (default) → only open issues
//   ?resolved=all              → both resolved + unresolved
//   ?severity=error            → filter by severity
// POST /api/tower/dieta_alerts  → mark a list of alert IDs as resolved
//   body: { ids: [...], resolved: true|false }

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

export default withAuth(async (req, res, session) => {
  if (req.method === 'GET')  return list(req, res);
  if (req.method === 'POST') return updateResolved(req, res, session);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
});

async function list(req, res) {
  const params = [];
  const resolved = req.query.resolved;
  if (resolved !== 'all') {
    params.push(`resolved=eq.${resolved === 'true' ? 'true' : 'false'}`);
  }
  if (req.query.severity) {
    params.push(`severity=eq.${encodeURIComponent(req.query.severity)}`);
  }
  if (req.query.source) {
    params.push(`source=eq.${encodeURIComponent(req.query.source)}`);
  }
  const qs = params.length ? '&' + params.join('&') : '';
  const rows = await sb(
    `/dieta_consistency_alerts?select=id,usuario_id,plan_id,source,severity,issue_type,details,resolved,resolved_at,created_at,usuarios(nombre,email,tenant_id),planes_semanales(fecha_entrega,semana_iso)&order=created_at.desc${qs}`
  );

  // Group counts for dashboard chips
  const counts = {
    total: rows.length,
    by_severity: { warning: 0, error: 0 },
    by_type: {},
    by_source: { ai: 0, migration: 0, manual: 0 },
  };
  for (const r of rows) {
    counts.by_severity[r.severity] = (counts.by_severity[r.severity] || 0) + 1;
    counts.by_type[r.issue_type]   = (counts.by_type[r.issue_type]   || 0) + 1;
    counts.by_source[r.source]     = (counts.by_source[r.source]     || 0) + 1;
  }

  return res.status(200).json({
    ok: true,
    alerts: rows,
    counts,
    generated_at: new Date().toISOString(),
  });
}

async function updateResolved(req, res, session) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ ok: false, error: 'ids_required' });
  const resolved = body.resolved !== false; // default true

  const patch = { resolved, resolved_at: resolved ? new Date().toISOString() : null };
  // PostgREST: PATCH with id=in.(...) is the idiomatic batch update
  const inList = ids.map(id => encodeURIComponent(id)).join(',');
  await sb(`/dieta_consistency_alerts?id=in.(${inList})`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=minimal',
  });
  return res.status(200).json({ ok: true, updated: ids.length });
}
