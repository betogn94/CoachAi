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

const COLS_USUARIO = 'id,nombre,edad,sexo,peso,altura,cuello,cintura,cadera,objetivo,nivel,actividad,dias_entreno,lugar_entreno,lesiones,restricciones_dieta,alergias,comidas_dia,no_le_gusta,metodo_king,foco_entreno';

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

/** Upsert de la fila del día (misma clave que `saveChatToSupabase`: usuario_id + fecha). */
export async function guardarTurno({ usuarioId, fecha, mensajes, conversation_history }) {
  await sb(`/historial_chat?on_conflict=usuario_id,fecha`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { usuario_id: usuarioId, fecha, mensajes, conversation_history },
  });
}
