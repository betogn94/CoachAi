// POST /api/tower/tenant_status  { slug, status }
// Kill-switch del tenant: setea tenants.status a 'active' | 'suspended'.
// 'suspended' => los usuarios del tenant ven la pantalla de pausa en la app.
// Identidad del que llama = sesión de Tower (cookie HMAC), igual que resolve_bug.

import { withAuth } from './_auth.js';

// Infra de la casa: nunca suspendible (rompería el trial / el default).
const PROTECTED = new Set(['coachai-default', 'coachaipro']);

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

  const slug   = String(body.slug || '').trim().toLowerCase();
  const status = String(body.status || '').trim().toLowerCase();
  if (!slug) return res.status(400).json({ ok: false, error: 'missing_slug' });
  if (status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ ok: false, error: 'invalid_status' });
  }
  if (status === 'suspended' && PROTECTED.has(slug)) {
    return res.status(403).json({ ok: false, error: 'tenant_protected' });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!base || !key) {
    return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
  }
  const url = `${base}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return res.status(502).json({ ok: false, error: 'supabase_error', detail: detail.slice(0, 500) });
  }
  const data = await r.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(404).json({ ok: false, error: 'tenant_not_found' });
  }
  return res.status(200).json({ ok: true, tenant: data[0] });
});
