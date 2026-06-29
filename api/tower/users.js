// GET /api/tower/users?tenant=<slug>
// Returns the users of a single tenant with adherence + traffic-light metrics.
// Excludes physical metrics (peso, altura, etc) — Tower only cares about
// operational data, per requirements.

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

function computeUserTrafficLight(u, stats) {
  // Reds: never logged anything, or inactive >14d
  const lastAct = u.last_active ? new Date(u.last_active).getTime() : 0;
  const daysSince = lastAct ? Math.floor((Date.now() - lastAct) / 86400000) : 999;

  if (stats.openBugs > 0)                  return { color: 'red',    reason: `${stats.openBugs} bug abierto` };
  if (daysSince > 14)                       return { color: 'red',    reason: `Sin actividad hace ${daysSince}d` };
  if (daysSince > 7)                        return { color: 'yellow', reason: `Sin actividad hace ${daysSince}d` };
  if (stats.adherence != null && stats.adherence < 0.5) return { color: 'yellow', reason: `Adherencia ${Math.round(stats.adherence * 100)}%` };
  if (daysSince <= 2 && (stats.adherence == null || stats.adherence >= 0.7)) return { color: 'green', reason: 'Activa' };
  return { color: 'green', reason: 'OK' };
}

export default withAuth(async (req, res) => {
  const slug = String(req.query.tenant || '').trim();
  if (!slug) {
    return res.status(400).json({ ok: false, error: 'missing_tenant' });
  }

  const tenantRows = await sb(`/tenants?select=id,slug,name,status&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  const tenant = tenantRows[0];
  if (!tenant) {
    return res.status(404).json({ ok: false, error: 'tenant_not_found' });
  }

  // Only operational fields — no peso/altura/cintura/etc.
  const users = await sb(
    `/usuarios?select=id,email,nombre,telefono,last_active,session_count,created_at,dias_entreno&tenant_id=eq.${encodeURIComponent(tenant.id)}&order=last_active.desc.nullslast`
  );

  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  const enriched = await Promise.all(users.map(async (u) => {
    const enc = encodeURIComponent(u.id);
    // Bugs reported by this user
    // Bug rows include the resolution columns added in the
    // add_feedback_resolution_columns migration. openBugs below filters by
    // resolved_at IS NULL so the traffic light + count only react to bugs
    // still in the backlog. Resolved bugs are returned for the per-user
    // history view (Tower's bugs block shows them crossed out).
    const bugRows = await sb(`/feedback?select=id,mensaje,created_at,resolved_at,resolved_by,resolution_note&usuario_id=eq.${enc}&order=created_at.desc`);
    const openBugCount = bugRows.filter(b => !b.resolved_at).length;
    // Last 30 days of progreso_diario for adherence (entreno + dentro_del_plan)
    const diario = await sb(
      `/progreso_diario?select=fecha,entreno,dentro_del_plan&usuario_id=eq.${enc}&fecha=gte.${thirtyDaysAgo}`
    );
    // Days actually trained
    const trained = await sb(
      `/dias_entrenados?select=fecha&usuario_id=eq.${enc}&fecha=gte.${thirtyDaysAgo}`
    );
    // Last 5 events for activity heat
    const events = await sb(
      `/beta_eventos?select=evento,created_at&usuario_id=eq.${enc}&order=created_at.desc&limit=5`
    );

    // Adherence proxy: of the last 30 days, fraction with dentro_del_plan=true
    const planRows = diario.filter(d => typeof d.dentro_del_plan === 'boolean');
    const adherence = planRows.length
      ? planRows.filter(d => d.dentro_del_plan).length / planRows.length
      : null;

    // Days trained in last 30d
    const daysTrainedSet = new Set(trained.map(t => t.fecha));
    diario.forEach(d => { if (d.entreno) daysTrainedSet.add(d.fecha); });
    const daysTrained30d = daysTrainedSet.size;

    // Target frequency from dias_entreno (length of array)
    const weeklyTarget = Array.isArray(u.dias_entreno) ? u.dias_entreno.length : null;

    const stats = {
      adherence,
      daysTrained30d,
      weeklyTarget,
      openBugs: openBugCount,
      lastEvent: events[0]?.evento || null,
      lastEventAt: events[0]?.created_at || null,
    };
    const tl = computeUserTrafficLight(u, stats);

    return {
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      telefono: u.telefono,
      last_active: u.last_active,
      session_count: u.session_count || 0,
      created_at: u.created_at,
      stats,
      traffic_light: tl,
      bugs: bugRows.map(b => ({
        id: b.id,
        mensaje: b.mensaje,
        created_at: b.created_at,
        resolved_at: b.resolved_at || null,
        resolved_by: b.resolved_by || null,
        resolution_note: b.resolution_note || null,
      })),
    };
  }));

  return res.status(200).json({
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status || 'active' },
    users: enriched,
    generated_at: new Date().toISOString(),
  });
});
