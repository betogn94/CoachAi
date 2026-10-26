// Contexto de la usuaria para el cerebro del chat (3.4.b / B3): lo que la PWA tiene en memoria al
// chatear (perfil en el formulario, planes de la semana, historial, diario) pero leído del lado del
// servidor con la service key. SOLO lee datos de la usuaria autenticada (resuelta por auth_id) y
// escribe únicamente su fila de historial_chat del día.
//
// Mapeo perfil → formulario de la PWA (lo que `buildSystemPrompt` lee del DOM): el login de una
// usuaria que vuelve (index.html ~L21707) llena nombre/edad/sexo/peso/altura/actividad, objetivo/
// nivel y días desde `usuarios`; los chips (lesiones/dieta/alergias), lugar, comidas y "no le gusta"
// quedan en blanco en la PWA porque solo se setean durante el onboarding. Acá se llenan desde las
// columnas de `usuarios` cuando existen (mejora deliberada: una vegana recibe las REGLAS SUPREMAS
// también desde la nativa) y caen a los mismos defaults de la PWA cuando no.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vmvhlgzwufkardaruutt.supabase.co';

function key() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var missing');
  return k;
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/** 'YYYY-MM-DD' ± n días (aritmética en UTC, sin DST). */
export function fechaMas(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Fecha válida 'YYYY-MM-DD' y a lo sumo 1 día de distancia del hoy UTC del servidor (la del teléfono). */
export function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  const hoyUtc = new Date().toISOString().slice(0, 10);
  return fecha === hoyUtc || fecha === fechaMas(hoyUtc, -1) || fecha === fechaMas(hoyUtc, 1);
}

const COLS_USUARIO = 'id,nombre,edad,sexo,peso,altura,cuello,cintura,cadera,objetivo,nivel,actividad,dias_entreno,lugar_entreno,lesiones,restricciones_dieta,alergias,comidas_dia,no_le_gusta,metodo_king,foco_entreno,es_interno';

const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const str = (v) => (v == null ? '' : String(v));

/** Planes vigentes con `.closed`, igual que `loadCurrentWeekPlans` (index.html L20330). */
export function armarWeeklyPlans(planes, cierres) {
  const ends = (cierres || []).map((c) => (c.fecha_fin || '').slice(0, 10)).filter(Boolean).sort();
  const maxCierreEnd = ends.length ? ends[ends.length - 1] : null;
  const result = { dieta: null, rutina: null };
  (planes || []).forEach((p) => {
    if (!result[p.tipo]) {
      const planDate = (p.fecha_entrega || '').slice(0, 10);
      const closed = !!(maxCierreEnd && planDate && maxCierreEnd >= planDate);
      result[p.tipo] = { ...p, closed };
    }
  });
  return result;
}

/** El `ctx` de `crearCerebro` a partir de las filas de la base (puro, testeable). */
export function armarCtx({ usuario, planes, cierres, historial, diario, fecha, lang = 'es' }) {
  const u = usuario || {};
  const [y, m, d] = fecha.split('-').map(Number);
  return {
    form: {
      'f-nombre': str(u.nombre),
      'f-edad': str(u.edad),
      'f-sexo': str(u.sexo),
      'f-peso': str(u.peso),
      'f-altura': str(u.altura),
      'f-actividad': str(u.actividad),
      // El <select> de la PWA arranca en "gimnasio_completo" (selected) y nunca se re-llena al volver.
      'f-lugar': str(u.lugar_entreno) || 'gimnasio_completo',
      'f-nodislike': str(u.no_le_gusta),
      'f-cuello': str(u.cuello),
      'f-cintura-form': str(u.cintura),
      'f-cadera-form': str(u.cadera),
    },
    chips: { lesiones: arr(u.lesiones), dieta: arr(u.restricciones_dieta), alergias: arr(u.alergias) },
    selections: { objetivo: str(u.objetivo), nivel: str(u.nivel) },
    selectedDias: arr(u.dias_entreno),
    selectedComidas: str(u.comidas_dia),
    weeklyPlans: armarWeeklyPlans(planes, cierres),
    allChatHistory: historial || [],
    // launchCoach: las últimas 7 FILAS (no 7 días), más reciente primero.
    recentChatHistory: (historial || []).slice(-7).slice().reverse(),
    recentDiario: diario || [],
    currentUser: { metodo_king: u.metodo_king === true, foco_entreno: u.foco_entreno || null },
    lang,
    ahora: Date.UTC(y, m - 1, d, 12),
  };
}

/** Turnos previos para la API: últimas 7 filas, a lo sumo 40 turnos (launchCoach MAX_TURNS). */
export function turnosPrevios(historial) {
  const merged = [];
  for (const day of (historial || []).slice(-7)) if (Array.isArray(day.conversation_history)) merged.push(...day.conversation_history);
  return merged.slice(-40);
}

/** Lee TODO lo que el cerebro necesita para la usuaria del token. null si no tiene ficha. */
export async function cargarContexto({ authUid, fecha, lang }) {
  const filas = await sb(`/usuarios?auth_id=eq.${encodeURIComponent(authUid)}&select=${COLS_USUARIO}&limit=1`);
  const usuario = filas && filas[0];
  if (!usuario) return null;
  const uid = usuario.id;
  const desde = fechaMas(fecha, -90);
  const [planes, cierres, historial, diario] = await Promise.all([
    sb(`/planes_semanales?usuario_id=eq.${uid}&select=tipo,contenido,fecha_entrega,semana_iso,updated_at,origen&order=updated_at.desc`),
    sb(`/cierres_semanales?usuario_id=eq.${uid}&select=fecha_fin`),
    sb(`/historial_chat?usuario_id=eq.${uid}&select=fecha,mensajes,conversation_history&order=fecha.asc`),
    sb(`/progreso_diario?usuario_id=eq.${uid}&fecha=gte.${desde}&select=fecha,desayuno,almuerzo,merienda,cena,calorias_consumidas,proteinas_g,carbos_g,grasas_g,entreno,ejercicios_realizados,notas_entreno&order=fecha.asc`),
  ]);
  const ctx = armarCtx({ usuario, planes, cierres, historial, diario, fecha, lang });
  const hoy = (historial || []).find((r) => r.fecha === fecha) || null;
  return { usuario, ctx, historial: historial || [], hoy, turnos: turnosPrevios(historial) };
}

// ─── 3.4.c — planes entregados por chat (lo que `sendToAI` L25153-25290 hacía en el cliente) ───

/**
 * Plantilla de Jesús más apropiada (port de `getBackupPlan` L20931): mismo sexo si hay, dieta por kcal
 * más cercano, rutina por días; inyecta el nombre y (dieta) el Target. null si no hay o falla.
 */
export async function getBackupPlan(tipo, target, usuario, expectedDays) {
  try {
    const data = await sb(`/plan_templates?tipo=eq.${tipo}&select=contenido,dias,kcal_base,sexo`);
    if (!data || !data.length) return null;
    const sexo = usuario && usuario.sexo;
    const sameSex = data.filter((t) => t.sexo === sexo);
    const pool = sameSex.length ? sameSex : data;
    let tpl;
    if (tipo === 'rutina') {
      const want = expectedDays || 4;
      tpl = pool.reduce((a, b) => (Math.abs((b.dias || 4) - want) < Math.abs((a.dias || 4) - want) ? b : a));
    } else {
      const want = (target && target.kcal) || 1400;
      tpl = pool.reduce((a, b) => (Math.abs((b.kcal_base || 1400) - want) < Math.abs((a.kcal_base || 1400) - want) ? b : a));
    }
    let c = tpl.contenido;
    c = c.replace(/\{NOMBRE\}/g, ((usuario && usuario.nombre) || '').trim() || 'vos');
    if (tipo === 'dieta') {
      const tgtStr = target
        ? `Target: ${target.kcal} kcal/día | P:${target.prot}g C:${target.carbs}g G:${target.fat}g`
        : (tpl.kcal_base ? `Target: ${tpl.kcal_base} kcal/día` : '');
      c = tgtStr ? c.replace(/\{TARGET\}/g, tgtStr) : c.replace(/\s*\|?\s*\{TARGET\}/g, '');
    } else {
      c = c.replace(/\s*\|?\s*\{TARGET\}/g, '');
    }
    return c;
  } catch (e) {
    console.warn('[chat-message] getBackupPlan:', e?.message || e);
    return null;
  }
}

/** Upsert del plan de la semana (misma clave que `saveWeeklyPlan` L20438: usuario_id + tipo + semana_iso). Devuelve la fila o null. */
export async function guardarPlan({ usuarioId, tipo, contenido, semanaIso, fecha, origen = 'ia' }) {
  try {
    const rows = await sb(`/planes_semanales?on_conflict=usuario_id,tipo,semana_iso`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { usuario_id: usuarioId, tipo, semana_iso: semanaIso, fecha_entrega: fecha, contenido, origen, updated_at: new Date().toISOString() },
    });
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[chat-message] guardarPlan:', e?.message || e);
    return null;
  }
}

/** `trackEvent` de la PWA: fila en beta_eventos (best-effort, nunca rompe el chat). */
export async function registrarEvento(usuarioId, evento, meta) {
  try {
    await sb('/beta_eventos', { method: 'POST', prefer: 'return=minimal', body: { usuario_id: usuarioId, evento, meta: { ...(meta || {}), app: 'native' } } });
  } catch (e) {
    console.warn('[chat-message] beta_eventos', evento, e?.message || e);
  }
}

/** Alertas de consistencia de la dieta para Tower (saveWeeklyPlan L20454): limpia las no resueltas del plan y escribe las nuevas. */
export async function guardarAlertasDieta({ usuarioId, planId, issues }) {
  try {
    await sb(`/dieta_consistency_alerts?plan_id=eq.${planId}&source=eq.ai&resolved=is.false`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!issues || !issues.length) return;
    await sb('/dieta_consistency_alerts', { method: 'POST', prefer: 'return=minimal', body: issues.map((i) => ({ usuario_id: usuarioId, plan_id: planId, source: 'ai', severity: i.severity, issue_type: i.type, details: i })) });
  } catch (e) {
    console.warn('[chat-message] dieta_consistency_alerts:', e?.message || e);
  }
}

// ─── 3.5.f — generación de planes en el servidor (/api/plan-generate: la renovación de rutina) ───

/**
 * Igual que `cargarContexto` (el prompt necesita historial y diario para salir idéntico al de la PWA)
 * + lo que la elegibilidad de la renovación lee de `currentUser` (rol, email, self_serve) y los
 * cierres con su `semana_num` (cadencia 4/8/12).
 */
export async function cargarContextoPlan({ authUid, fecha, lang }) {
  const filas = await sb(`/usuarios?auth_id=eq.${encodeURIComponent(authUid)}&select=${COLS_USUARIO},role,email,created_at,self_serve&limit=1`);
  const usuario = filas && filas[0];
  if (!usuario) return null;
  const uid = usuario.id;
  const desde = fechaMas(fecha, -90);
  const [planes, cierres, historial, diario] = await Promise.all([
    sb(`/planes_semanales?usuario_id=eq.${uid}&select=tipo,contenido,fecha_entrega,semana_iso,updated_at,origen&order=updated_at.desc`),
    sb(`/cierres_semanales?usuario_id=eq.${uid}&select=semana_num,fecha_fin&order=semana_num.asc`),
    sb(`/historial_chat?usuario_id=eq.${uid}&select=fecha,mensajes,conversation_history&order=fecha.asc`),
    sb(`/progreso_diario?usuario_id=eq.${uid}&fecha=gte.${desde}&select=fecha,desayuno,almuerzo,merienda,cena,calorias_consumidas,proteinas_g,carbos_g,grasas_g,entreno,ejercicios_realizados,notas_entreno&order=fecha.asc`),
  ]);
  const ctx = armarCtx({ usuario, planes, cierres, historial, diario, fecha, lang });
  return { usuario, ctx, planes: planes || [], cierres: cierres || [] };
}

/** `renovGenerate` L31397: los días y el foco elegidos en el wizard, a `usuarios` (solo esas 2 columnas). */
export async function actualizarPreferenciasRutina(usuarioId, dias, foco) {
  await sb(`/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { dias_entreno: dias, foco_entreno: foco } });
}

// ─── 3.6.x — primeros planes en el servidor (/api/plan-generate: primeros_estado + primeros) ───

/** `get_my_migration` con la service key: los planes precargados por el coach en la invitación (o null). */
export async function leerMigracion(email) {
  if (!email) return null;
  const filas = await sb(`/beta_invitados?email=ilike.${encodeURIComponent(String(email).trim())}&select=pre_rutina,pre_dieta,migrada_de_coach&limit=1`);
  return (filas && filas[0]) || null;
}

/** `migrateClientPreloadedPlans` L24482: inserta los planes del coach; ignoreDuplicates = idempotente si se repite la llamada. */
export async function insertarPlanesMigrados(rows) {
  if (!rows.length) return [];
  const ins = await sb(`/planes_semanales?on_conflict=usuario_id,tipo,semana_iso`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: rows });
  return ins || [];
}

/** `clear_my_migration`: one-shot, para que una segunda entrada no re-inserte. */
export async function limpiarMigracion(email) {
  await sb(`/beta_invitados?email=ilike.${encodeURIComponent(String(email).trim())}`, { method: 'PATCH', prefer: 'return=minimal', body: { pre_rutina: null, pre_dieta: null } });
}

/** Alertas de una dieta MIGRADA (`source='migration'`, L24494): solo inserta, no limpia (la dieta del coach no tiene alertas previas). */
export async function insertarAlertasDieta({ usuarioId, planId, issues, source }) {
  if (!issues || !issues.length) return;
  try {
    await sb('/dieta_consistency_alerts', { method: 'POST', prefer: 'return=minimal', body: issues.map((i) => ({ usuario_id: usuarioId, plan_id: planId, source, severity: i.severity, issue_type: i.type, details: i })) });
  } catch (e) {
    console.warn('[plan-generate] dieta_consistency_alerts (migración):', e?.message || e);
  }
}

// ─── 3.5.e — el cierre semanal en el servidor (lo que ejecutarCierreSemana / autoCloseEndedWeeks /
// autoRepeatPlans / autoAdjustDiet / checkAndAwardLogros hacían en el cliente) ───

const COLS_CIERRE = 'id,semana_num,fecha_inicio,fecha_fin,semana_iso,analisis,stats,foto_url,foto_url_espalda';

/** Igual que `cargarContexto` + lo que el cierre necesita (cierres completos, dias_entrenados, fotos de inicio, primer plan, rol y alta). */
export async function cargarContextoCierre({ authUid, fecha, lang }) {
  const filas = await sb(`/usuarios?auth_id=eq.${encodeURIComponent(authUid)}&select=${COLS_USUARIO},role,created_at&limit=1`);
  const usuario = filas && filas[0];
  if (!usuario) return null;
  const uid = usuario.id;
  const desde = fechaMas(fecha, -90);
  const [planes, cierres, diario, entrenados, fotosInicio, primerPlan] = await Promise.all([
    sb(`/planes_semanales?usuario_id=eq.${uid}&select=tipo,contenido,fecha_entrega,semana_iso,updated_at,origen&order=updated_at.desc`),
    sb(`/cierres_semanales?usuario_id=eq.${uid}&select=${COLS_CIERRE}&order=semana_num.asc`),
    sb(`/progreso_diario?usuario_id=eq.${uid}&fecha=gte.${desde}&select=fecha,desayuno,almuerzo,merienda,cena,calorias_consumidas,proteinas_g,carbos_g,grasas_g,entreno&order=fecha.asc`),
    sb(`/dias_entrenados?usuario_id=eq.${uid}&select=fecha&order=fecha.desc&limit=1000`),
    sb(`/fotos_progreso?usuario_id=eq.${uid}&tipo=eq.inicio&select=vista,url_foto,fecha&order=fecha.asc`),
    sb(`/planes_semanales?usuario_id=eq.${uid}&select=fecha_entrega&order=fecha_entrega.asc&limit=1`),
  ]);
  const ctx = armarCtx({ usuario, planes, cierres, historial: [], diario, fecha, lang });
  // Lo que el cierre lee de `currentUser` además de lo del chat.
  ctx.currentUser = { ...ctx.currentUser, peso: usuario.peso || null, altura: usuario.altura || null, dias_entreno: Array.isArray(usuario.dias_entreno) ? usuario.dias_entreno : null, created_at: usuario.created_at || null };
  ctx.cierresSemanales = cierres || [];
  ctx.trainedDates = (entrenados || []).map((r) => String(r.fecha).slice(0, 10));
  const inicios = fotosInicio || [];
  // Mismas elecciones que ejecutarCierreSemana L29440-L29446 (frente = vista 'frente' o legacy sin vista).
  const inicioFrente = (inicios.find((f) => f.vista === 'frente') || inicios.find((f) => !f.vista) || inicios[0] || {}).url_foto || null;
  const inicioEspalda = (inicios.find((f) => f.vista === 'espalda') || {}).url_foto || null;
  const activityStart = primerPlan && primerPlan[0] && primerPlan[0].fecha_entrega ? String(primerPlan[0].fecha_entrega).slice(0, 10) : null;
  return { usuario, ctx, planes: planes || [], cierres: cierres || [], diario: diario || [], fotosInicio: { frente: inicioFrente, espalda: inicioEspalda }, activityStart };
}

/** PWA `_photoPathFromUrl`: la ruta dentro del bucket a partir de una URL pública o firmada. */
export function rutaFoto(u) {
  if (!u) return null;
  const m = String(u).match(/\/progress-photos\/(.+?)(\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** URL firmada (1 h) de una ruta del bucket privado, con la service key. null si falla (la IA recibe menos fotos, como en la PWA). */
export async function firmarFoto(ruta, expiresIn = 3600) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/progress-photos/${ruta.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch (e) {
    console.warn('[cierre-semana] firmar foto:', e?.message || e);
    return null;
  }
}

/** Upsert del cierre (misma clave que la PWA: usuario_id + semana_num). Devuelve la fila. */
export async function guardarCierre(row) {
  const rows = await sb(`/cierres_semanales?on_conflict=usuario_id,semana_num`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: row });
  return (rows && rows[0]) || null;
}

/** Cierres VACÍOS del autocierre (`autoCloseEndedWeeks`): solo inserta, nunca pisa (ignoreDuplicates). Devuelve los semana_num insertados. */
export async function insertarCierresVacios(rows) {
  if (!rows.length) return [];
  const ins = await sb(`/cierres_semanales?on_conflict=usuario_id,semana_num&select=semana_num`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: rows });
  return (ins || []).map((r) => r.semana_num);
}

/** `refreshPendingCierreStats`: solo filas SIN análisis (si un análisis se completó en paralelo, no se pisa). */
export async function actualizarStatsCierre(id, stats) {
  await sb(`/cierres_semanales?id=eq.${id}&analisis=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { stats } });
}

/** `autoAdjustDiet`: la dieta ajustada pisa el clon de la semana. */
export async function actualizarContenidoDieta(usuarioId, semanaIso, contenido) {
  await sb(`/planes_semanales?usuario_id=eq.${usuarioId}&tipo=eq.dieta&semana_iso=eq.${encodeURIComponent(semanaIso)}`, { method: 'PATCH', prefer: 'return=minimal', body: { contenido, updated_at: new Date().toISOString() } });
}

/** Las 2 medallas del cierre (LOGROS_CATALOG L32748-L32749), como las otorga `checkAndAwardLogros`: celebrado=false (la nativa celebra en 3.6). */
const LOGROS_CIERRE = {
  primer_cierre: { titulo: 'Primer cierre', descripcion: 'Cerraste tu primera semana. ¡Arrancó el viaje!', icon: 'trophy' },
  semana_perfecta: { titulo: 'Semana perfecta', descripcion: 'Cumpliste todos tus entrenos y tus comidas en una semana.', icon: 'star' },
};
export function logrosDelCierre(cierres, target) {
  const keys = [];
  if ((cierres || []).length >= 1) keys.push('primer_cierre');
  if (target > 0) for (const c of cierres || []) {
    const perfect = c.stats && c.stats.trained != null && c.stats.trained >= target && (c.stats.totalLogs || 0) >= 6;
    if (perfect) keys.push('semana_perfecta_' + (c.semana_num != null ? c.semana_num : c.id));
  }
  return keys;
}
/** Upsert ignoreDuplicates por (usuario_id, logro_key); devuelve las keys que realmente se insertaron. */
export async function otorgarLogros(usuarioId, keys) {
  if (!keys.length) return [];
  const rows = keys.map((k) => {
    const c = LOGROS_CIERRE[k.startsWith('semana_perfecta_') ? 'semana_perfecta' : k];
    return { usuario_id: usuarioId, logro_key: k, titulo: c.titulo, descripcion: c.descripcion, icon: c.icon, notificado: false, celebrado: false };
  });
  try {
    const ins = await sb(`/user_logros?on_conflict=usuario_id,logro_key&select=logro_key`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: rows });
    return (ins || []).map((r) => r.logro_key);
  } catch (e) {
    console.warn('[cierre-semana] user_logros:', e?.message || e);
    return [];
  }
}

/** Upsert de la fila del día (misma clave que `saveChatToSupabase`: usuario_id + fecha). */
export async function guardarTurno({ usuarioId, fecha, mensajes, conversation_history }) {
  await sb(`/historial_chat?on_conflict=usuario_id,fecha`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { usuario_id: usuarioId, fecha, mensajes, conversation_history },
  });
}
