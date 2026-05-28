// Shared auth utilities for Tower endpoints.
// No external deps — uses Node built-in crypto (HMAC-SHA256 signed cookies).

import crypto from 'crypto';

const COOKIE_NAME = 'tower_session';
const SESSION_DAYS = 7;

function getSecret() {
  const s = process.env.TOWER_JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('TOWER_JWT_SECRET missing or too short (>=16 chars)');
  }
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

export function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map(s => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

export function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    `Max-Age=${maxAge}`,
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}

export function getSession(req) {
  const token = readCookie(req, COOKIE_NAME);
  return verifySession(token);
}

/**
 * Higher-order wrapper that guards an endpoint behind a valid Tower session.
 * Usage:
 *   export default withAuth(async (req, res, session) => { ... });
 */
export function withAuth(handler) {
  return async function guarded(req, res) {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'unauthenticated' });
    }
    try {
      return await handler(req, res, session);
    } catch (err) {
      console.error('[tower] handler error:', err);
      return res.status(500).json({
        ok: false,
        error: 'server_error',
        detail: String(err?.message || err),
      });
    }
  };
}

// Returns { username, displayName } if user/pass match an env-configured admin.
// Uses timing-safe comparison to avoid leaking which field is wrong.
export function checkCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (!username || !password) return null;

  const admins = [
    { env: 'BETO', display: 'Beto' },
    { env: 'JESUS', display: 'Jesús' },
  ];

  for (const a of admins) {
    const envUser = process.env[`TOWER_USER_${a.env}`];
    const envPass = process.env[`TOWER_PASS_${a.env}`];
    if (!envUser || !envPass) continue;
    if (!safeEqStr(username, envUser)) continue;
    if (!safeEqStr(password, envPass)) continue;
    return { username: envUser, displayName: a.display };
  }
  return null;
}

function safeEqStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // do a dummy compare to keep timing roughly constant
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
