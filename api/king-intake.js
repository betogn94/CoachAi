// POST /api/king-intake
// Puente de datos del ecosistema KING: el landing (Lovable) postea acá los datos
// del quiz / Mapa Estético al terminarlo. Se guardan en `king_intake` (keyed por
// email + tenant), y la app los lee al loguear para RECONOCER a la clienta y
// disparar el Reveal (la app "ya la conoce").
//
// Seguridad: el landing autentica con un secreto compartido (KING_INTAKE_SECRET)
// en el header `x-intake-key`. Así Lovable NUNCA toca la base directo — solo
// conoce una URL + un secreto. La escritura corre server-side con el service role.

import { sb } from './tower/_db.js';
import crypto from 'node:crypto';

// Comparación de secreto en tiempo constante (evita timing attacks). Guarda de
// longitud primero porque timingSafeEqual exige buffers del mismo tamaño.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Guard de secreto compartido. Sin el env var configurado, rechaza todo
  // (fail-closed) — el endpoint queda inerte hasta que se setee KING_INTAKE_SECRET.
  const provided = req.headers['x-intake-key'] || '';
  const expected = process.env.KING_INTAKE_SECRET || '';
  if (!expected || !safeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Tope de tamaño — es un quiz, no debería pesar casi nada. Frena el inflado de DB.
  if (JSON.stringify(body).length > 50000) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'email_invalido' });
  }
  const tenant_slug = String(body.tenant_slug || 'jesus');

  // Construimos la fila SOLO con los campos presentes. Clave: el intake llega en
  // varios eventos para la MISMA clienta (pago Mapa → pago Foundation → reenvío con
  // pdf_url). Como el upsert es merge por (email,tenant_slug), si incluyéramos los
  // ausentes como null, un evento tardío (ej: el reenvío del PDF, que puede no
  // reenviar el quiz) pisaría con null lo que otro evento ya guardó. Por eso
  // email+tenant_slug+fuente+updated_at van siempre, y el resto SOLO si viene.
  const row = {
    email,
    tenant_slug,
    fuente: body.fuente || 'lovable',
    updated_at: new Date().toISOString(),
  };
  const setIfPresent = (col, val) => { if (val !== null && val !== undefined) row[col] = val; };
  setIfPresent('nombre', body.nombre);
  setIfPresent('producto', body.producto);
  setIfPresent('stripe_session_id', body.stripe_session_id);
  // fundacion_pagada: `false` es un valor válido que SÍ queremos guardar (no omitir).
  // Solo omitimos null/undefined. Aceptamos boolean o el string 'true'/'false'.
  if (body.fundacion_pagada === true || body.fundacion_pagada === false) row.fundacion_pagada = body.fundacion_pagada;
  else if (body.fundacion_pagada === 'true') row.fundacion_pagada = true;
  else if (body.fundacion_pagada === 'false') row.fundacion_pagada = false;
  // monto_usd: numérico. Aceptamos number o string numérico ('19.99').
  if (typeof body.monto_usd === 'number' && isFinite(body.monto_usd)) row.monto_usd = body.monto_usd;
  else if (typeof body.monto_usd === 'string' && body.monto_usd.trim() !== '' && isFinite(Number(body.monto_usd))) row.monto_usd = Number(body.monto_usd);
  // Aceptamos nombres alternativos del payload del quiz para no acoplarnos a Lovable.
  setIfPresent('quiz_respuestas', body.quiz_respuestas ?? body.respuestas ?? body.answers);
  setIfPresent('arquetipo', body.arquetipo ?? body.archetype);
  setIfPresent('diagnostico', body.diagnostico ?? body.diagnosis);
  setIfPresent('pdf_url', body.pdf_url ?? body.pdfUrl);

  try {
    // Upsert por (email, tenant_slug): si rehace el quiz, actualiza su intake.
    await sb('/king_intake?on_conflict=email,tenant_slug', {
      method: 'POST',
      body: row,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[king-intake] error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
