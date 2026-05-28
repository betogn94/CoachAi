// GET /api/tower/dashboard
// Aggregate counters for the Tower home page. All numbers are computed live.

import { withAuth } from './_auth.js';
import { sb, count } from './_db.js';

export default withAuth(async (req, res) => {
  const now = Date.now();
  const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Run in parallel
  const [
    tenantsTotal,
    tenantsActive,
    usersTotal,
    usersActive7d,
    bugsTotal,
    bugsLast30d,
    costsThisMonth,
  ] = await Promise.all([
    count('tenants'),
    count('tenants', 'status=eq.active'),
    count('usuarios'),
    count('usuarios', `last_active=gte.${sevenDaysAgoIso}`),
    count('feedback'),
    count('feedback', `created_at=gte.${thirtyDaysAgoIso}`),
    sumCostsThisMonth(),
  ]);

  // Traffic light distribution across tenants (simple rules for now,
  // billing-aware rules come in Fase 4).
  // Green: has at least one user active in the last 7 days.
  // Yellow: has users but none active in last 7 days, OR no users yet.
  // Red: status != 'active'.
  // Gray: status = 'archived' or 'trial'.
  const tenants = await sb('/tenants?select=id,slug,name,status,created_at');
  const tlBuckets = { green: 0, yellow: 0, red: 0, gray: 0 };

  if (tenants.length) {
    // Active counts per tenant
    const tenantIds = tenants.map(t => t.id);
    const usersPerTenant = {};
    const activePerTenant = {};
    await Promise.all(tenantIds.map(async (tid) => {
      const enc = encodeURIComponent(tid);
      const [tot, act] = await Promise.all([
        count('usuarios', `tenant_id=eq.${enc}`),
        count('usuarios', `tenant_id=eq.${enc}&last_active=gte.${sevenDaysAgoIso}`),
      ]);
      usersPerTenant[tid] = tot;
      activePerTenant[tid] = act;
    }));

    for (const t of tenants) {
      const tot = usersPerTenant[t.id] || 0;
      const act = activePerTenant[t.id] || 0;
      let color = 'gray';
      if (t.status === 'suspended') color = 'red';
      else if (t.status === 'archived' || t.status === 'trial') color = 'gray';
      else if (act > 0) color = 'green';
      else if (tot > 0) color = 'yellow';
      else color = 'gray'; // active tenant with 0 users
      tlBuckets[color]++;
    }
  }

  return res.status(200).json({
    ok: true,
    generated_at: new Date().toISOString(),
    stats: {
      tenants: { total: tenantsTotal, active: tenantsActive },
      users:   { total: usersTotal, active_7d: usersActive7d },
      bugs:    { total: bugsTotal, last_30d: bugsLast30d },
      costs:   { this_month_usd: costsThisMonth },
      traffic_light: tlBuckets,
    },
  });
});

async function sumCostsThisMonth() {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  try {
    const rows = await sb(
      `/tower_costs?select=amount_usd&period_start=gte.${start}&period_start=lt.${next}`
    );
    let total = 0;
    for (const r of rows) total += Number(r.amount_usd || 0);
    return Math.round(total * 100) / 100;
  } catch (e) {
    // If table doesn't exist yet or perms fail, don't break the dashboard.
    return 0;
  }
}
