// GET /api/tower/tenants
// List all tenants with computed metrics: user counts, active users,
// traffic light, last activity timestamp, capacity (from limits.users_cap).

import { withAuth } from './_auth.js';
import { sb, count } from './_db.js';

const KNOWN_SUBDOMAINS = {
  // Fallback display value if `domain` column is null
  'coachai-default': 'coachaipro.ai',
  'jesus': 'king.coachaipro.ai',
};

function computeTrafficLight(t, totalUsers, activeUsers, capacity) {
  if (t.status === 'suspended') return { color: 'red',    reason: 'Suspendido' };
  if (t.status === 'archived')  return { color: 'gray',   reason: 'Archivado' };
  if (t.status === 'trial')     return { color: 'yellow', reason: 'En trial' };
  // status === 'active'
  if (capacity && totalUsers >= capacity)            return { color: 'red',    reason: `Cupo lleno (${totalUsers}/${capacity})` };
  if (capacity && totalUsers >= Math.floor(capacity * 0.9)) return { color: 'yellow', reason: `Cupo casi lleno (${totalUsers}/${capacity})` };
  if (totalUsers === 0)                              return { color: 'gray',   reason: 'Sin usuarios todavía' };
  if (activeUsers === 0)                             return { color: 'yellow', reason: 'Sin actividad últimos 7d' };
  return { color: 'green', reason: `${activeUsers} activos / ${totalUsers}` };
}

export default withAuth(async (req, res) => {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const tenants = await sb(
    '/tenants?select=id,slug,name,status,plan,domain,branding_config,limits,created_at&order=created_at'
  );

  const rows = await Promise.all(tenants.map(async (t) => {
    const enc = encodeURIComponent(t.id);
    const [totalUsers, activeUsers, lastActiveRows] = await Promise.all([
      count('usuarios', `tenant_id=eq.${enc}`),
      count('usuarios', `tenant_id=eq.${enc}&last_active=gte.${sevenDaysAgoIso}`),
      sb(`/usuarios?select=last_active&tenant_id=eq.${enc}&order=last_active.desc.nullslast&limit=1`),
    ]);
    const lastActivity = lastActiveRows[0]?.last_active || null;
    const capacity = t.limits?.users_cap ?? null;
    const tier = t.limits?.tier || (t.slug === 'jesus' ? 'cofounder' : 'default');
    const isCofounder = tier === 'cofounder';
    const tl = computeTrafficLight(t, totalUsers, activeUsers, capacity);

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      tier,
      is_cofounder: isCofounder,
      domain: t.domain || KNOWN_SUBDOMAINS[t.slug] || null,
      is_whitelabel: t.slug !== 'coachai-default',
      brand: {
        accent: t.branding_config?.colors?.accent || null,
        logo:   t.branding_config?.logo || null,
      },
      users: {
        total: totalUsers,
        active_7d: activeUsers,
        capacity, // null = unlimited
      },
      last_activity: lastActivity,
      traffic_light: tl,
      created_at: t.created_at,
    };
  }));

  return res.status(200).json({
    ok: true,
    generated_at: new Date().toISOString(),
    tenants: rows,
  });
});
