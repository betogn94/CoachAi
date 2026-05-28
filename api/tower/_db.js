// Server-side Supabase helper for Tower endpoints.
// Uses fetch + PostgREST with the service-role key — bypasses RLS.
// NEVER expose this helper or its env vars to the browser.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';

function getKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var missing');
  return k;
}

/**
 * Generic PostgREST call.
 *
 * @param {string} path  e.g. '/tenants?select=*&order=created_at'
 * @param {object} [opts]
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} [opts.method='GET']
 * @param {any}    [opts.body]
 * @param {string} [opts.prefer]  PostgREST Prefer header (e.g. 'return=representation')
 * @param {object} [opts.headers]
 */
export async function sb(path, opts = {}) {
  const method = opts.method || 'GET';
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: getKey(),
    Authorization: `Bearer ${getKey()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    ...(opts.headers || {}),
  };
  const init = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Supabase ${res.status}: ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  // 204 No Content
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/**
 * Run raw SQL via the Supabase RPC `query` function (if exposed) — NOT used by
 * default. We prefer typed PostgREST calls for safety.
 */

/**
 * Convenience: SELECT count(*) on a table (optionally with filters).
 * @param {string} table
 * @param {string} [filter] PostgREST filter, e.g. 'tenant_id=eq.xxx'
 */
export async function count(table, filter = '') {
  const path = `/${table}?select=id${filter ? '&' + filter : ''}`;
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: getKey(),
      Authorization: `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase count(${table}) ${res.status}: ${text}`);
  }
  // PostgREST returns total in Content-Range: "0-0/N"
  const range = res.headers.get('content-range') || '';
  const total = parseInt(range.split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

/**
 * Standard error response for endpoints.
 */
export function badRequest(res, msg) {
  return res.status(400).json({ ok: false, error: msg || 'bad_request' });
}
export function serverError(res, err) {
  console.error('[tower] server error:', err);
  return res.status(500).json({ ok: false, error: 'server_error', detail: String(err?.message || err) });
}
