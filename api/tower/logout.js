// POST /api/tower/logout  — clears the session cookie.

import { clearSessionCookie } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
