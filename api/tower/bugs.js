// GET /api/tower/bugs  → Centro de ALERTAS unificado (cross-tenant, solo Tower).
// Junta en UNA lista normalizada, cada item con su alumno + tenant:
//   - bug         → bugs reportados por usuarios (tabla `feedback`)            [resolvable]
//   - dieta       → alertas de consistencia de dietas (`dieta_consistency_alerts`) [resolvable]
//   - plan_error  → fallos de guardado/lectura de planes rutina+dieta
//                   (`beta_eventos`: plan_save_failed / plan_unparseable_on_load) [informativo]
// Filtro opcional por tenant: ?tenant=<slug>
//
// El resolver de cada item lo hace el front contra el endpoint que corresponde
// según `source` (resolve_bug para bugs, dieta_alerts para dietas). Los
// plan_error son informativos (no se resuelven, son log de eventos).

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

// Embed anidado: el alumno + su tenant. Las 3 fuentes tienen usuario_id → usuarios.
const U = 'usuarios(nombre,email,tenant_id,tenants(slug,name))';

export default withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const tenantFilter = String(req.query.tenant || '').trim();

  const who = (u) => {
    u = u || {};
    const t = u.tenants || {};
    return {
      alumno_nombre: u.nombre || null,
      alumno_email:  u.email  || null,
      tenant_slug:   t.slug   || null,
      tenant_nombre: t.name   || null,
    };
  };

  const items = [];

  // 1) Bugs reportados (feedback). Abiertos = resolved_at IS NULL.
  try {
    const bugs = await sb(`/feedback?select=id,mensaje,nombre,created_at,usuario_id,${U}&resolved_at=is.null&order=created_at.desc&limit=300`);
    for (const b of (bugs || [])) {
      const w = who(b.usuarios);
      // Si el bug no tiene cuenta vinculada, usamos el nombre que dejó al reportar.
      if (!w.alumno_nombre && b.nombre) w.alumno_nombre = b.nombre;
      items.push({
        id: b.id, source: 'bug', tipo: 'Bug reportado', severidad: 'warning',
        ...w, detalle: (b.mensaje || '').slice(0, 600), fecha: b.created_at, resolvable: true,
      });
    }
  } catch (_) { /* fuente opcional → no rompe el resto */ }

  // 2) Alertas de dietas (dieta_consistency_alerts). Abiertas = resolved=false.
  try {
    const da = await sb(`/dieta_consistency_alerts?select=id,issue_type,severity,details,source,created_at,usuario_id,${U}&resolved=eq.false&order=created_at.desc&limit=300`);
    for (const a of (da || [])) {
      items.push({
        id: a.id, source: 'dieta', tipo: 'Alerta de dieta', severidad: a.severity || 'warning',
        ...who(a.usuarios), detalle: dietaDetalle(a), fecha: a.created_at, resolvable: true,
      });
    }
  } catch (_) {}

  // 3) Errores de guardado/lectura de planes (beta_eventos). Informativos.
  try {
    const ev = await sb(`/beta_eventos?select=id,evento,meta,created_at,usuario_id,${U}&evento=in.(plan_save_failed,plan_unparseable_on_load)&order=created_at.desc&limit=300`);
    for (const e of (ev || [])) {
      const m = e.meta || {};
      const tipo = e.evento === 'plan_unparseable_on_load' ? 'Plan ilegible al cargar' : 'Error al guardar plan';
      const det = [m.tipo ? `tipo: ${m.tipo}` : null, m.reason ? `motivo: ${m.reason}` : null]
        .filter(Boolean).join(' · ') || e.evento;
      items.push({
        id: e.id, source: 'plan_error', tipo, severidad: 'error',
        ...who(e.usuarios), detalle: det, fecha: e.created_at, resolvable: false,
      });
    }
  } catch (_) {}

  let out = items;
  if (tenantFilter) out = items.filter(i => i.tenant_slug === tenantFilter);
  out.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  const counts = { total: out.length, by_source: {}, by_severity: {} };
  for (const i of out) {
    counts.by_source[i.source]      = (counts.by_source[i.source]      || 0) + 1;
    counts.by_severity[i.severidad] = (counts.by_severity[i.severidad] || 0) + 1;
  }

  let tenants = [];
  try { tenants = await sb('/tenants?select=slug,name&order=name'); } catch (_) {}

  return res.status(200).json({ ok: true, alerts: out, counts, tenants, generated_at: new Date().toISOString() });
});

function dietaDetalle(a) {
  const d = a.details || {};
  if (a.issue_type === 'macros_math')   return `${d.dayName} · ${d.mealName}: anunciado ${d.kcal} kcal, macros suman ${d.computed} kcal (${d.deltaPct}% diff)`;
  if (a.issue_type === 'meal_kcal_low') return `${d.dayName} · ${d.mealName}: anunciado ${d.kcal} kcal pero las porciones suman ≥ ${d.expectedMinKcal} kcal`;
  if (a.issue_type === 'day_total')     return `${d.dayName}: total ${d.sumKcal} kcal vs target ${d.targetKcal} kcal (${d.deltaPct}% diff)`;
  return `${a.issue_type || 'alerta'} ${JSON.stringify(d).slice(0, 120)}`;
}
