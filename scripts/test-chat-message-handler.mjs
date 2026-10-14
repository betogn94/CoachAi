// ============================================================================
// TEST-CHAT-MESSAGE-HANDLER — prueba OFFLINE del handler /api/chat-message (3.4.b / B3).
//   node scripts/test-chat-message-handler.mjs
// Supabase (auth, REST, RPC del tope) y Anthropic se simulan con un fetch falso: no pega a ninguna
// API ni toca la base. Verifica interruptor, allowlist, origin, auth, validación, tope diario, la
// llamada a Haiku (prompt cacheado), el upsert de historial_chat con el formato de la PWA y los errores.
// Node no parsea ESM en api/*.js (Vercel sí): el handler se copia a un .mjs temporal dentro de api/.
// ============================================================================
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(RAIZ, 'api', '_chat', '_handler-test-copia.mjs');
const ORIGEN_TMP = join(RAIZ, 'api', '_chat', '_origin-copia.mjs');
writeFileSync(TMP, readFileSync(join(RAIZ, 'api', 'chat-message.js'), 'utf8').replace("'./_chat/cerebro-pwa.mjs'", "'./cerebro-pwa.mjs'").replace("'./_chat/contexto.mjs'", "'./contexto.mjs'").replace("'./_origin.js'", "'./_origin-copia.mjs'"));
copyFileSync(join(RAIZ, 'api', '_origin.js'), ORIGEN_TMP);

process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
process.env.CHAT_MESSAGE_ENABLED = '1';
process.env.CHAT_MESSAGE_ALLOW = 'uid-beto';

const hoy = new Date().toISOString().slice(0, 10);
const estado = { usados: 0, upserts: [], anthropic: [], hoyRow: null, falloAnthropic: null };
const usuarioRow = { id: 'u-1', nombre: 'Beto', edad: 32, sexo: 'masculino', peso: '80.00', altura: '173.00', objetivo: 'definir', nivel: 'avanzado', actividad: 'moderado', dias_entreno: ['lun', 'mie'], metodo_king: false, foco_entreno: 'brazos' };
const REPLY = '**Hola Beto!** ¿Cómo va?\n- Tip 1';
const REPLY_HTML = '<strong>Hola Beto!</strong> ¿Cómo va?<br><ul><li>Tip 1</li></ul>'; // = formatResponse(REPLY) de la PWA

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/auth/v1/user')) {
    const tok = (init.headers?.authorization || '').replace('Bearer ', '');
    return tok === 'tok-beto' ? json(200, { id: 'uid-beto' }) : tok === 'tok-otra' ? json(200, { id: 'uid-otra' }) : json(401, {});
  }
  if (u.includes('/rpc/chat_uso_incrementa')) { estado.usados++; return json(200, estado.usados); }
  if (u.includes('/rest/v1/usuarios')) return json(200, u.includes('uid-beto') ? [usuarioRow] : []);
  if (u.includes('/rest/v1/planes_semanales')) return json(200, [{ tipo: 'rutina', contenido: 'Día 1 · Pierna\n1. Sentadilla — 3×12', fecha_entrega: hoy, semana_iso: 'x', updated_at: 'y', origen: 'coach' }]);
  if (u.includes('/rest/v1/cierres_semanales')) return json(200, []);
  if (u.includes('/rest/v1/historial_chat')) {
    if (init.method === 'POST') { estado.upserts.push({ url: u, prefer: init.headers?.Prefer, body: JSON.parse(init.body) }); return new Response(null, { status: 201 }); }
    return json(200, estado.hoyRow ? [estado.hoyRow] : []);
  }
  if (u.includes('/rest/v1/progreso_diario')) return json(200, [{ fecha: hoy, desayuno: 'avena', entreno: true }]);
  if (u.includes('api.anthropic.com')) {
    estado.anthropic.push(JSON.parse(init.body));
    if (estado.falloAnthropic) return json(estado.falloAnthropic, { error: { type: 'overloaded_error', message: 'x' } });
    return json(200, { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text: REPLY }], model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn', usage: {} });
  }
  throw new Error('fetch no simulado: ' + u);
};

let fallas = 0;
const ok = (c, m, extra = '') => { if (c) console.log('  ✓', m); else { fallas++; console.log('  ✗', m, extra); } };
try {
  const { default: handler } = await import(pathToFileURL(TMP).href);
  const run = async (body, { token = 'tok-beto', origin = 'https://coachaipro.ai', method = 'POST' } = {}) => {
    const out = { status: 0, headers: {}, body: null };
    const res = { setHeader: (k, v) => (out.headers[k] = v), status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return out; } };
    await handler({ method, headers: { origin, authorization: token ? `Bearer ${token}` : '' }, body }, res);
    return out;
  };

  let r = await run({ mensaje: 'Hola', fecha: hoy });
  ok(r.status === 200 && r.body.reply === REPLY && r.body.reply_html === REPLY_HTML && r.body.guardado === true && r.body.used === 1 && r.body.plan === null, 'camino feliz: 200 con reply, reply_html, used, guardado', JSON.stringify(r));
  const ll = estado.anthropic[0];
  ok(ll.model === 'claude-haiku-4-5-20251001' && Array.isArray(ll.system) && ll.system[0].cache_control?.type === 'ephemeral' && ll.system[0].text.includes('Beto') && ll.system[0].text.includes('PREFERENCIA DE FOCO') && ll.messages.length === 1 && ll.messages[0].role === 'user' && ll.messages[0].content === 'Hola', 'Anthropic: Haiku, prompt cacheado con el perfil, 1 turno user');
  const up = estado.upserts[0];
  ok(up && up.url.includes('on_conflict=usuario_id,fecha') && /merge-duplicates/.test(up.prefer) && up.body.usuario_id === 'u-1' && up.body.fecha === hoy && up.body.mensajes.length === 2 && up.body.mensajes[0].type === 'user' && up.body.mensajes[0].content === 'Hola' && up.body.mensajes[1].type === 'coach' && up.body.mensajes[1].content === REPLY_HTML && up.body.conversation_history.length === 2 && up.body.conversation_history[1].role === 'assistant' && up.body.conversation_history[1].content === REPLY, 'historial_chat: upsert por (usuario_id, fecha) con el formato de la PWA', JSON.stringify(up));

  estado.hoyRow = { fecha: hoy, mensajes: [{ content: 'previo', type: 'coach' }], conversation_history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] };
  r = await run({ mensaje: 'Segundo', fecha: hoy });
  ok(estado.upserts[1].body.mensajes.length === 3 && estado.upserts[1].body.conversation_history.length === 4 && estado.anthropic[1].messages.length === 3 && estado.anthropic[1].messages[2].content === 'Segundo', 'segundo mensaje: suma a la fila del día y manda los turnos previos');

  r = await run({ mensaje: 'x', fecha: hoy }, { token: 'tok-otra' });
  ok(r.status === 404, 'uid fuera de la allowlist → 404');
  r = await run({ mensaje: 'x', fecha: hoy }, { token: 'tok-malo' });
  ok(r.status === 401 && r.headers['x-chat-ident'] === 'invalid', 'token inválido → 401');
  r = await run({ mensaje: 'x', fecha: hoy }, { token: null });
  ok(r.status === 401 && r.headers['x-chat-ident'] === 'missing', 'sin token → 401');
  r = await run({ mensaje: 'x', fecha: hoy }, { origin: 'https://evil.com' });
  ok(r.status === 403, 'origin ajeno → 403');
  r = await run({ mensaje: '', fecha: hoy });
  ok(r.status === 400 && r.body.error === 'mensaje_invalido', 'mensaje vacío → 400');
  r = await run({ mensaje: 'x'.repeat(2001), fecha: hoy });
  ok(r.status === 400, 'mensaje > 2000 → 400');
  r = await run({ mensaje: 'x', fecha: '2020-01-01' });
  ok(r.status === 400 && r.body.error === 'fecha_invalida', 'fecha lejana → 400');
  const usadosAntes = estado.usados;
  r = await run({ mensaje: 'x', fecha: 'nada' });
  ok(r.status === 400 && estado.usados === usadosAntes, 'un 400 no descuenta del tope');
  estado.usados = 120;
  r = await run({ mensaje: 'x', fecha: hoy });
  ok(r.status === 429 && r.body.error === 'daily_limit' && r.headers['x-chat-used'] === '121', 'tope diario → 429 con x-chat-used');
  estado.usados = 0;
  estado.falloAnthropic = 529;
  r = await run({ mensaje: 'x', fecha: hoy });
  ok(r.status === 503 && r.body.retryable === true, 'Anthropic saturado → 503 retryable');
  estado.falloAnthropic = null;
  process.env.CHAT_MESSAGE_ENABLED = '0';
  r = await run({ mensaje: 'x', fecha: hoy });
  ok(r.status === 404, 'flag apagado → 404');
  process.env.CHAT_MESSAGE_ENABLED = '1';
  process.env.CHAT_MESSAGE_ALLOW = '';
  r = await run({ mensaje: 'x', fecha: hoy }, { token: 'tok-otra' });
  ok(r.status === 404 && r.body.error === 'sin_perfil', 'sin allowlist y sin ficha en usuarios → 404 sin_perfil');
  r = await run({ mensaje: 'x', fecha: hoy }, { method: 'GET' });
  ok(r.status === 405, 'GET → 405');
} finally {
  try { unlinkSync(TMP); } catch {}
  try { unlinkSync(ORIGEN_TMP); } catch {}
}
console.log(fallas ? `\n✗ ${fallas} falla(s)` : '\n✓ handler OK offline (18 chequeos)');
process.exit(fallas ? 1 : 0);
