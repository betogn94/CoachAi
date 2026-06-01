// POST /api/tower/resolve_bug  { id, note? }
// Marks a feedback row as resolved by the currently logged-in Tower admin.
// Same shape as Studio's resolve flow, but the admin identity comes from
// the Tower session (HMAC-signed cookie) instead of the Supabase user.

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

export default withAuth(async (req, res, session) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const id   = String(body.id || '').trim();
  const note = body.note != null ? String(body.note).trim().slice(0, 500) : '';
  if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

  // resolved_by = Tower username from session (sub = username, name = display)
  const resolvedBy = `tower:${session.sub || 'unknown'}`;
  const nowIso = new Date().toISOString();

  // PostgREST PATCH via the helper. We don't have an explicit `update` in
  // _db.js, so we hit the REST endpoint directly with the service-role key.
  // sb() handles GETs; build the PATCH ourselves with the same env vars.
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!base || !key) {
    return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
  }
  const url = `${base}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      resolved_at:     nowIso,
      resolved_by:     resolvedBy,
      resolution_note: note || null,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return res.status(502).json({ ok: false, error: 'supabase_error', detail: detail.slice(0, 500) });
  }
  const data = await r.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(404).json({ ok: false, error: 'bug_not_found' });
  }
  return res.status(200).json({ ok: true, bug: data[0] });
});
