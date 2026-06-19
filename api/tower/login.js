// POST /api/tower/login  { username, password }
// On success, sets HttpOnly session cookie and returns { ok:true, user }.

import { checkCredentials, signSession, setSessionCookie, clearSessionCookie, SESSION_TTL_MS, isTeamOnly } from './_auth.js';

export default async function handler(req, res) {
  // DELETE = logout. Consolidado en este endpoint (antes /api/tower/logout) para
  // no superar el límite de 12 Serverless Functions del plan Hobby de Vercel.
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Body parsing (Vercel parses JSON automatically when content-type is set,
  // but be defensive).
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  // Soft rate-limit: a tiny artificial delay to dampen brute force without
  // adding infra. ~250ms is invisible to humans, painful for bots.
  await new Promise(r => setTimeout(r, 250));

  const user = checkCredentials(username, password);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  }

  const exp = Date.now() + SESSION_TTL_MS;
  const token = signSession({
    sub: user.username,
    name: user.displayName,
    mbr: user.member,
    iat: Date.now(),
    exp,
  });
  setSessionCookie(res, token);

  return res.status(200).json({
    ok: true,
    user: { username: user.username, displayName: user.displayName, member: user.member, teamOnly: isTeamOnly(user.member) },
  });
}
