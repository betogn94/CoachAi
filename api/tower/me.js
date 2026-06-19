// GET /api/tower/me  — returns the current session info, or 401.

import { getSession, memberFromUsername } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'unauthenticated' });
  }
  return res.status(200).json({
    ok: true,
    user: { username: session.sub, displayName: session.name, member: session.mbr || memberFromUsername(session.sub) || null },
    exp: session.exp,
  });
}
