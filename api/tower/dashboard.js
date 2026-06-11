// GET /api/tower/dashboard            — aggregate counters for the Tower home
// GET /api/tower/dashboard?view=metrics — full metrics panel (activos, suscripciones,
//                                         MRR, cierres, inactivos + series para gráficos)
// Un solo archivo (límite de 12 funciones en Vercel Hobby). Las queries pesadas
// del panel de métricas solo corren cuando se pide ?view=metrics, así el home
// sigue siendo liviano.

import { withAuth } from './_auth.js';
import { sb, count } from './_db.js';
import { sumMonthly, currentMonthUtc } from './_cost_math.js';

export default withAuth(async (req, res) => {
  if (req.query && req.query.view === 'metrics') {
    return handleMetrics(req, res);
  }

  const now = Date.now();
  const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Run in parallel
  const [
    tenantsTotal,
    tenantsActive,
    usersTotal,
    usersActive7d,
    // Tower's "bugs" headline numbers are now SCOPED TO OPEN bugs only —
    // matches what Studio shows per-cliente. Resolved bugs (resolved_at IS
    // NOT NULL) are kept in DB as history but don't drive the dashboard
    // counter (otherwise Tower would scream "30 bugs" forever even after
    // everything's been fixed).
    bugsTotal,
    bugsLast30d,
    monthlyProjected,
  ] = await Promise.all([
    count('tenants'),
    count('tenants', 'status=eq.active'),
    count('usuarios'),
    count('usuarios', `last_active=gte.${sevenDaysAgoIso}`),
    count('feedback', 'resolved_at=is.null'),
    count('feedback', `resolved_at=is.null&created_at=gte.${thirtyDaysAgoIso}`),
    computeMonthlyProjected(),
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
      costs:   { monthly_projected_usd: monthlyProjected },
      traffic_light: tlBuckets,
    },
  });
});

async function computeMonthlyProjected() {
  try {
    // Pull ALL active-window cost rows and let the math helper figure out
    // which contribute to this month. We can't pre-filter on the DB because
    // a cost from a year ago might still be in its installment window.
    const rows = await sb('/tower_costs?select=amount_usd,billing_period,installments,period_start,period_end');
    const { year, month } = currentMonthUtc();
    return sumMonthly(rows, year, month);
  } catch (e) {
    return 0;
  }
}

// ── Panel de métricas (?view=metrics) ────────────────────────────────────────
// Aporte mensual al MRR (igual que revenue.js): mensual recurrente = monto;
// anual recurrente = monto/12; único o no-recurrente = 0.
function monthlyMRR(r) {
  if (!r.recurring) return 0;
  const a = Number(r.amount || 0);
  if (r.billing_period === 'mensual') return a;
  if (r.billing_period === 'anual')   return a / 12;
  return 0;
}
function round2(n) { return Math.round(n * 100) / 100; }

// ISO week key 'YYYY-Www' a partir de 'YYYY-MM-DD'.
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const day = (d.getUTCDay() + 6) % 7;        // lun=0..dom=6
  d.setUTCDate(d.getUTCDate() - day + 3);      // jueves de esta semana
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function handleMetrics(req, res) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const d7  = new Date(now - 7 * dayMs).toISOString();
  const d30 = new Date(now - 30 * dayMs).toISOString();
  const todayDate = new Date().toISOString().slice(0, 10);
  const monthStart = todayDate.slice(0, 7) + '-01';

  const [
    activeToday, active7d, active30d,
    cierresTotal, cierresMonth,
    tenants,
    stripeRows,
    revenueRecurring,
    inactiveUsers,
    sessionEvents,
    cierresAll,
    revenueAll,
  ] = await Promise.all([
    count('usuarios', `last_active=gte.${todayIso}`),
    count('usuarios', `last_active=gte.${d7}`),
    count('usuarios', `last_active=gte.${d30}`),
    count('cierres_semanales'),
    count('cierres_semanales', `created_at=gte.${monthStart}T00:00:00Z`),
    sb('/tenants?select=id,slug,name'),
    sb('/tower_revenue?select=usuario_id,period_end&source=eq.stripe&recurring=eq.true'),
    sb('/tower_revenue?select=amount,currency,recurring,billing_period&recurring=eq.true'),
    sb(`/usuarios?select=nombre,email,role,last_active,tenants(slug,name)&or=(last_active.lt.${d7},last_active.is.null)&order=last_active.asc.nullsfirst&limit=200`),
    sb(`/beta_eventos?select=usuario_id,created_at&evento=eq.session_start&created_at=gte.${d30}&limit=10000`),
    sb('/cierres_semanales?select=fecha_fin,created_at&limit=2000'),
    sb('/tower_revenue?select=amount,currency,recurring,billing_period,period_start,created_at&recurring=eq.true&limit=2000'),
  ]);

  // Suscripciones Stripe activas: usuarios distintos con cobertura vigente
  // (sin period_end = lo tomamos como vigente; con fecha = debe ser >= hoy).
  const activeSubs = new Set();
  for (const r of stripeRows) {
    if (r.usuario_id && (!r.period_end || r.period_end >= todayDate)) activeSubs.add(r.usuario_id);
  }

  // MRR total por moneda
  const mrr = {};
  for (const r of revenueRecurring) {
    const cur = r.currency || 'ARS';
    mrr[cur] = (mrr[cur] || 0) + monthlyMRR(r);
  }
  for (const k in mrr) mrr[k] = round2(mrr[k]);

  // Usuarios por tenant (total + activos 7d)
  const usersByTenant = [];
  await Promise.all(tenants.map(async (t) => {
    const enc = encodeURIComponent(t.id);
    const [tot, act] = await Promise.all([
      count('usuarios', `tenant_id=eq.${enc}`),
      count('usuarios', `tenant_id=eq.${enc}&last_active=gte.${d7}`),
    ]);
    usersByTenant.push({ tenant: t.name || t.slug, total: tot, active_7d: act });
  }));
  usersByTenant.sort((a, b) => b.total - a.total);

  // Serie: activos por día (session_start, usuarios distintos por día, últimos 30)
  const byDay = {};
  for (const e of sessionEvents) {
    const day = (e.created_at || '').slice(0, 10);
    if (!day || !e.usuario_id) continue;
    (byDay[day] = byDay[day] || new Set()).add(e.usuario_id);
  }
  const activeOverTime = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
    activeOverTime.push({ date: d, count: byDay[d] ? byDay[d].size : 0 });
  }

  // Serie: cierres por semana (ISO week)
  const weekCounts = {};
  for (const c of cierresAll) {
    const d = c.fecha_fin || (c.created_at || '').slice(0, 10);
    const wk = d ? isoWeek(d) : null;
    if (wk) weekCounts[wk] = (weekCounts[wk] || 0) + 1;
  }
  const cierresByWeek = Object.keys(weekCounts).sort().map(week => ({ week, count: weekCounts[week] }));

  // Serie: MRR por mes
  const monthMrr = {};
  for (const r of revenueAll) {
    const month = (r.period_start || (r.created_at || '').slice(0, 10)).slice(0, 7);
    if (!month) continue;
    const cur = r.currency || 'ARS';
    monthMrr[month] = monthMrr[month] || {};
    monthMrr[month][cur] = (monthMrr[month][cur] || 0) + monthlyMRR(r);
  }
  const mrrByMonth = Object.keys(monthMrr).sort().map(month => {
    const v = monthMrr[month];
    for (const k in v) v[k] = round2(v[k]);
    return { month, ...v };
  });

  const inactive = inactiveUsers.map(u => ({
    nombre: u.nombre || '—',
    email: u.email || '',
    role: u.role || 'user',
    last_active: u.last_active || null,
    tenant: u.tenants ? (u.tenants.name || u.tenants.slug) : '—',
  }));

  return res.status(200).json({
    ok: true,
    generated_at: new Date().toISOString(),
    metrics: {
      active: { today: activeToday, last_7d: active7d, last_30d: active30d },
      subscriptions_active: activeSubs.size,
      mrr,
      cierres: { total: cierresTotal, this_month: cierresMonth },
      inactive_count: inactive.length,
      inactive_users: inactive,
    },
    charts: {
      active_over_time: activeOverTime,
      users_by_tenant: usersByTenant,
      cierres_by_week: cierresByWeek,
      mrr_by_month: mrrByMonth,
    },
  });
}
