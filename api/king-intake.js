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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Guard de secreto compartido. Sin el env var configurado, rechaza todo
  // (fail-closed) — el endpoint queda inerte hasta que se setee KING_INTAKE_SECRET.
  const provided = req.headers['x-intake-key'] || '';
  const expected = process.env.KING_INTAKE_SECRET || '';
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'email_invalido' });
  }
  const tenant_slug = String(body.tenant_slug || 'jesus');

  const row = {
    email,
    tenant_slug,
    // Aceptamos varias formas de nombrar el payload del quiz para no acoplarnos
    // a cómo lo mande Lovable.
    quiz_respuestas: body.quiz_respuestas ?? body.respuestas ?? body.answers ?? null,
    arquetipo: body.arquetipo ?? body.archetype ?? null,
    diagnostico: body.diagnostico ?? body.diagnosis ?? null,
    pdf_url: body.pdf_url ?? body.pdfUrl ?? null,
    fuente: body.fuente || 'lovable',
    updated_at: new Date().toISOString(),
  };

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
