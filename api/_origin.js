// Shared origin allowlist + check for the PUBLIC API endpoints (/api/chat,
// /api/send-invite). The browser always sends an `Origin` header on POST
// requests (same-origin included), so requiring an allowed Origin blocks
// cross-site abuse and naive scripts WITHOUT breaking the app's own calls.
//
// Honest scope: a determined attacker can still spoof the Origin header from a
// non-browser client (curl). This is defense-in-depth, not a hard wall — the
// real fix is proper auth (planned) + an Anthropic spend cap at the account
// level. But it stops the easy/casual abuse vectors at zero risk to clients.
//
// Per-tenant subdomains: Studio invites + the PWA launch from these origins.
// Add a new entry here every time a tenant gets its own subdomain (king.* was
// the first; future ones follow the same pattern).
export const ALLOWED_ORIGINS = [
  'https://coachaipro.ai',
  'https://www.coachaipro.ai',
  'https://coachaipro.com',
  'https://www.coachaipro.com',
  'https://king.coachaipro.ai',
  'https://coach-ai-pearl.vercel.app',
];

// Exact-match on Origin (no `startsWith`, which would let
// `https://coachaipro.ai.evil.com` through). Falls back to Referer with a
// trailing-slash guard so the same suffix trick can't bypass it there either.
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return ALLOWED_ORIGINS.includes(origin);
  const referer = req.headers.referer || req.headers.referrer || '';
  if (referer) return ALLOWED_ORIGINS.some(o => referer === o || referer.startsWith(o + '/'));
  return false;
}
