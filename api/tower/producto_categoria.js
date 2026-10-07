// POST /api/tower/producto_categoria  { product_id, categoria }
// Clasifica a mano un producto del catálogo de Stripe (stripe_productos).
// Marca clasificado_por='manual' → el cron de sync-subs NUNCA pisa una
// categoría puesta por un humano (solo clasifica productos nuevos).

import { withAuth } from './_auth.js';
import { sb } from './_db.js';

const CATEGORIAS = new Set(['app', 'asesoria_1a1', 'otros', 'revisar']);

export default withAuth(async (req, res, session) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const productId = String(body.product_id || '').trim();
  const categoria = String(body.categoria || '').trim();
  if (!productId.startsWith('prod_')) return res.status(400).json({ ok: false, error: 'invalid_product_id' });
  if (!CATEGORIAS.has(categoria)) return res.status(400).json({ ok: false, error: 'invalid_categoria' });

  try {
    const rows = await sb(`/stripe_productos?product_id=eq.${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: { categoria, clasificado_por: 'manual', updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    });
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    console.log('[tower/producto_categoria]', productId, '→', categoria, 'por', session?.email || 'tower');
    return res.status(200).json({ ok: true, producto: rows[0] });
  } catch (e) {
    console.error('[tower/producto_categoria]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
