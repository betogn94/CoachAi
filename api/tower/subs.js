// GET /api/tower/subs
// Vista "Suscripciones" de Tower: devuelve el snapshot diario de suscripciones
// de Stripe (tabla stripe_subs, la refresca el cron de las 5am) con la
// categoría de negocio de cada producto (stripe_productos), más el catálogo
// completo para el editor de categorías. Solo lectura.

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

export default withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const [subs, productos] = await Promise.all([
      sb('/stripe_subs?select=*&order=vence.desc.nullslast'),
      sb('/stripe_productos?select=*&order=activo.desc,nombre.asc'),
    ]);
    const catPorId = new Map((productos || []).map((p) => [p.product_id, p.categoria]));
    const rows = (subs || []).map((s) => ({ ...s, categoria: (s.product_id && catPorId.get(s.product_id)) || 'revisar' }));
    const snapshotAt = rows.reduce((m, r) => (r.sincronizado_at > m ? r.sincronizado_at : m), '') || null;
    return res.status(200).json({ ok: true, snapshotAt, subs: rows, productos: productos || [] });
  } catch (e) {
    console.error('[tower/subs]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
