// GET /api/stripe/sync-subs?secret=<CRON_SECRET>[&dry=1]
//
// RECONCILIADOR de suscripciones: lee TODAS las subs de Stripe y sincroniza
// nuestra base (usuarios + beta_invitados), sin depender de que los webhooks
// lleguen. Es la red de seguridad del sistema de cancelaciones: aunque el
// endpoint de webhooks esté caído o mal suscripto, un pase diario deja la DB
// consistente con la verdad de Stripe.
//
// Por cada email con subs en Stripe decide UN estado (gana la sub vigente más
// nueva; si no hay vigente, la baja más reciente):
//   - cancelada (status=canceled o cancel_at_period_end) → marca
//     suscripcion_cancelada_at (sin pisar una fecha ya registrada)
//   - vigente sin cancelar → limpia la marca (reactivación/re-suscripción) y
//     EXTIENDE acceso_hasta al fin del período pagado si quedó atrás (nunca lo
//     acorta; nunca escribe sobre acceso_hasta=NULL, que es "gratis permanente"
//     a propósito — esos casos solo se reportan).
//
// Modo prueba: &dry=1 devuelve el plan de cambios SIN escribir nada.
// Auth: mismo patrón que cron-notifications (Bearer CRON_SECRET o ?secret=).
// Pensado para correr 1×/día vía cron-job.org.

import { sb, count } from '../tower/_db.js';
import { getStripe, resolveSubEmail, marcarCancelada, limpiarCancelada, VIGENTE } from './_subs.js';

export const config = { maxDuration: 60 };

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

// ── Catálogo clasificado (stripe_productos) ──
// Heurística de categoría por nombre. Solo aplica a productos NUEVOS: una vez
// en la tabla, la categoría es editable a mano (clasificado_por='manual') y el
// cron no la pisa jamás.
function categoriaAuto(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/upsell|mapa|foundation|combo transformacion|dieta personalizada|rutina personalizada/.test(n)) return 'otros';
  if (/coach\s?ai/.test(n)) return /programa|rutina/.test(n) ? 'revisar' : 'app';   // híbridos tipo "Programa COACH AI + RUTINA" → decide un humano
  if (/coaching|programa|m[eé]todo|king|plan premium/.test(n)) return 'asesoria_1a1';
  return 'revisar';
}

// Trae TODOS los productos de Stripe (activos y archivados), inserta los nuevos
// con categoría heurística y refresca nombre/activo de los existentes.
// Devuelve { total, nuevos, porId: Map(product_id → {nombre, categoria}) }.
async function refreshCatalogo(stripe, dry) {
  const deStripe = [];
  for await (const p of stripe.products.list({ limit: 100 })) {
    deStripe.push({ product_id: p.id, nombre: p.name || p.id, activo: !!p.active });
  }
  const existentes = await sb('/stripe_productos?select=product_id,nombre,categoria,activo');
  const porIdDb = new Map((existentes || []).map((r) => [r.product_id, r]));

  const nuevos = [];
  const cambios = [];
  const porId = new Map();
  for (const p of deStripe) {
    const db = porIdDb.get(p.product_id);
    if (!db) {
      nuevos.push({ ...p, categoria: categoriaAuto(p.nombre), clasificado_por: 'auto' });
      porId.set(p.product_id, { nombre: p.nombre, categoria: categoriaAuto(p.nombre) });
    } else {
      if (db.nombre !== p.nombre || db.activo !== p.activo) cambios.push(p);
      porId.set(p.product_id, { nombre: p.nombre, categoria: db.categoria });
    }
  }
  if (!dry) {
    if (nuevos.length) {
      await sb('/stripe_productos?on_conflict=product_id', {
        method: 'POST', body: nuevos,
        prefer: 'resolution=ignore-duplicates,return=minimal',
      });
    }
    for (const c of cambios) {
      try {
        await sb(`/stripe_productos?product_id=eq.${encodeURIComponent(c.product_id)}`, {
          method: 'PATCH', body: { nombre: c.nombre, activo: c.activo, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
        });
      } catch (e) { console.warn('[sync-subs] catálogo patch', c.product_id, e?.message); }
    }
  }
  return { total: deStripe.length, nuevos: nuevos.length, porId };
}

// ── Backfill F4: clasificar ingresos históricos de tower_revenue ──
// Un pase (&backfill=1) etiqueta hasta 40 filas source=stripe sin categoría:
// notes de Foundation/Mapa → 'otros'; facturas in_ → producto de la línea →
// categoría del catálogo; checkouts cs_ → line items. Correr las veces que
// haga falta hasta que 'restantes' llegue a 0; después queda dormido (las
// filas nuevas ya nacen clasificadas por el webhook).
async function backfillRevenue(stripe, porId) {
  const rows = await sb('/tower_revenue?select=id,stripe_payment_id,notes&source=eq.stripe&categoria=is.null&order=created_at.asc&limit=40');
  let clasificados = 0;
  for (const r of rows || []) {
    let categoria = null, productId = null;
    const notes = String(r.notes || '');
    const ref = String(r.stripe_payment_id || '');
    try {
      if (/^(Foundation|Mapa Estético)/.test(notes)) {
        categoria = 'otros';
      } else if (ref.startsWith('in_')) {
        const inv = await stripe.invoices.retrieve(ref);
        const p = inv?.lines?.data?.[0]?.price?.product;
        productId = typeof p === 'string' ? p : p?.id || null;
        categoria = (productId && porId.get(productId)?.categoria) || null;
      } else if (ref.startsWith('cs_')) {
        const items = await stripe.checkout.sessions.listLineItems(ref, { limit: 10 });
        const p = items?.data?.[0]?.price?.product;
        productId = typeof p === 'string' ? p : p?.id || null;
        categoria = (productId && porId.get(productId)?.categoria) || null;
      }
    } catch (e) { console.warn('[sync-subs] backfill', ref, e?.message); }
    if (!categoria) continue;
    try {
      await sb(`/tower_revenue?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH', body: { categoria, ...(productId ? { product_id: productId } : {}) }, prefer: 'return=minimal',
      });
      clasificados++;
    } catch (e) { console.warn('[sync-subs] backfill patch', r.id, e?.message); }
  }
  const restantes = await count('tower_revenue', 'source=eq.stripe&categoria=is.null');
  return { procesados: (rows || []).length, clasificados, restantes };
}

// Lee filas (email, acceso_hasta, suscripcion_cancelada_at) de una tabla para
// una lista de emails, en tandas (PostgREST in.() con emails entre comillas).
async function fetchRows(tabla, emails) {
  const out = new Map();
  for (let i = 0; i < emails.length; i += 40) {
    const chunk = emails.slice(i, i + 40);
    const inList = chunk.map((e) => `"${e}"`).join(',');
    const rows = await sb(`/${tabla}?select=email,acceso_hasta,suscripcion_cancelada_at&email=in.(${encodeURIComponent(inList)})`);
    for (const r of rows || []) {
      const e = String(r.email || '').toLowerCase();
      if (!out.has(e)) out.set(e, []);
      out.get(e).push(r);
    }
  }
  return out;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: 'cron_secret_not_configured' });
  const authed = req.headers.authorization === `Bearer ${secret}` || (req.query && req.query.secret === secret);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const dry = !!(req.query && (req.query.dry === '1' || req.query.dry === 'true'));
  const conBackfill = !!(req.query && req.query.backfill === '1');

  try {
    const stripe = getStripe();
    const runIso = new Date().toISOString();

    // 0) Catálogo de productos clasificado (alta de nuevos + refresco).
    const catalogo = await refreshCatalogo(stripe, dry);

    // 1) Todas las subs de Stripe (auto-paginado del SDK), agrupadas por email,
    //    y de paso la fila de snapshot de CADA sub (incluidas las sin email).
    const porEmail = new Map();   // email → [sub]
    const sinEmail = [];
    const snapRows = [];
    for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
      const email = await resolveSubEmail(stripe, sub);
      const price = sub.items?.data?.[0]?.price || {};
      const prodId = typeof price.product === 'string' ? price.product : price.product?.id || null;
      snapRows.push({
        sub_id: sub.id,
        email,
        customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
        product_id: prodId,
        producto: catalogo.porId.get(prodId)?.nombre || null,
        price_id: price.id || null,
        monto: price.unit_amount != null ? price.unit_amount / 100 : null,
        moneda: price.currency ? String(price.currency).toUpperCase() : null,
        intervalo: price.recurring?.interval || null,
        status: sub.status,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        renueva_auto: VIGENTE.has(sub.status) && !sub.cancel_at_period_end,
        inicio: iso(sub.start_date || sub.created),
        vence: iso(sub.current_period_end),
        cancelada_at: iso(sub.canceled_at || sub.ended_at),
        sincronizado_at: runIso,
      });
      if (!email) { sinEmail.push(sub.id); continue; }
      if (!porEmail.has(email)) porEmail.set(email, []);
      porEmail.get(email).push(sub);
    }

    // 2) Estado deseado por email: gana la vigente más nueva; sino, la última baja.
    const deseado = new Map();    // email → { estado:'activa'|'cancelada', sub }
    for (const [email, subs] of porEmail) {
      const vigentes = subs.filter((s) => VIGENTE.has(s.status)).sort((a, b) => (b.current_period_end || 0) - (a.current_period_end || 0));
      if (vigentes.length) {
        const s = vigentes[0];
        deseado.set(email, { estado: s.cancel_at_period_end ? 'cancelada' : 'activa', sub: s });
      } else {
        const bajas = subs.filter((s) => s.status === 'canceled').sort((a, b) => (b.ended_at || b.canceled_at || 0) - (a.ended_at || a.canceled_at || 0));
        if (bajas.length) deseado.set(email, { estado: 'cancelada', sub: bajas[0] });
      }
    }

    // 3) Estado actual en nuestra base (ambas tablas).
    const emails = [...deseado.keys()];
    const [enUsuarios, enInvitados] = await Promise.all([
      fetchRows('usuarios', emails),
      fetchRows('beta_invitados', emails),
    ]);
    const rowsDe = (email) => [...(enUsuarios.get(email) || []), ...(enInvitados.get(email) || [])];

    // 4) Diff → plan de cambios.
    const plan = { marcar: [], limpiar: [], extender: [], null_con_sub_activa: [], sin_fila: [] };
    for (const [email, d] of deseado) {
      const rows = rowsDe(email);
      if (!rows.length) {
        // Sub en Stripe sin cuenta/invitación nuestra. CLAVE distinguir: una
        // 'activa' acá = le estamos cobrando a alguien sin cuenta (ej. purgada
        // por error) → revisar a mano (restaurar o cancelar en Stripe).
        plan.sin_fila.push({ email, estado: d.estado, sub: d.sub.id, vence: iso(d.sub.current_period_end) });
        continue;
      }
      if (d.estado === 'cancelada') {
        if (rows.some((r) => !r.suscripcion_cancelada_at)) {
          plan.marcar.push({ email, cuando: iso(d.sub.canceled_at || d.sub.ended_at) || new Date().toISOString() });
        }
      } else {
        if (rows.some((r) => r.suscripcion_cancelada_at)) plan.limpiar.push({ email });
        const fin = iso(d.sub.current_period_end);
        if (fin) {
          const finMs = Date.parse(fin);
          if (rows.some((r) => r.acceso_hasta && Date.parse(r.acceso_hasta) < finMs)) plan.extender.push({ email, hasta: fin });
          if (rows.some((r) => !r.acceso_hasta)) plan.null_con_sub_activa.push(email);   // solo reporte, no se escribe
        }
      }
    }

    // 5) Aplicar (salvo dry-run).
    if (!dry) {
      // Snapshot full-refresh: upsert de todas las subs en un solo POST y
      // purga de las que ya no existen en Stripe (quedaron con run viejo).
      try {
        if (snapRows.length) {
          await sb('/stripe_subs?on_conflict=sub_id', {
            method: 'POST', body: snapRows,
            prefer: 'resolution=merge-duplicates,return=minimal',
          });
          await sb(`/stripe_subs?sincronizado_at=lt.${encodeURIComponent(runIso)}`, { method: 'DELETE', prefer: 'return=minimal' });
        }
      } catch (e) { console.error('[sync-subs] snapshot:', e?.message); }
      for (const a of plan.marcar) await marcarCancelada(a.email, a.cuando);
      for (const a of plan.limpiar) await limpiarCancelada(a.email);
      for (const a of plan.extender) {
        const enc = encodeURIComponent(a.email);
        const hastaEnc = encodeURIComponent(a.hasta);
        // Solo EXTIENDE: filtra acceso_hasta < nuevo fin (jamás acorta ni toca NULL).
        for (const tabla of ['usuarios', 'beta_invitados']) {
          try {
            await sb(`/${tabla}?email=eq.${enc}&acceso_hasta=lt.${hastaEnc}`, { method: 'PATCH', body: { acceso_hasta: a.hasta }, prefer: 'return=minimal' });
          } catch (e) { console.warn('[sync-subs] extender', tabla, a.email, e?.message); }
        }
      }
      // Bitácora del pase en beta_eventos (historial consultable por SQL/Tower).
      try {
        await sb('/beta_eventos', {
          method: 'POST',
          body: {
            evento: 'sync_subs_run',
            meta: {
              subs: snapRows.length,
              emails: emails.length,
              marcadas: plan.marcar.length,
              limpiadas: plan.limpiar.length,
              extendidas: plan.extender.length,
              sin_email: sinEmail.length,
              sin_fila: plan.sin_fila.length,
            },
          },
          prefer: 'return=minimal',
        });
      } catch (e) { /* bitácora best-effort */ }
    }

    // Resumen por categoría de las subs VIGENTES que renuevan solas (la foto
    // que piden los análisis mensuales). MRR solo de mensuales en USD.
    const porCategoria = {};
    for (const r of snapRows) {
      if (!r.renueva_auto) continue;
      const cat = (r.product_id && catalogo.porId.get(r.product_id)?.categoria) || 'revisar';
      if (!porCategoria[cat]) porCategoria[cat] = { subs: 0, mrr_usd: 0 };
      porCategoria[cat].subs += 1;
      if (r.intervalo === 'month' && r.moneda === 'USD' && r.monto) porCategoria[cat].mrr_usd = +(porCategoria[cat].mrr_usd + r.monto).toFixed(2);
    }

    // Backfill de ingresos históricos (un pase por corrida, solo si se pide).
    let backfill = null;
    if (conBackfill && !dry) {
      try { backfill = await backfillRevenue(stripe, catalogo.porId); }
      catch (e) { backfill = { error: String(e?.message || e) }; }
    }

    const resumen = {
      ok: true,
      dry,
      ...(backfill ? { backfill } : {}),
      subs_en_stripe: snapRows.length,
      emails_con_sub: emails.length,
      catalogo: { productos: catalogo.total, nuevos: catalogo.nuevos },
      vigentes_por_categoria: porCategoria,
      cambios: {
        marcadas_canceladas: plan.marcar,
        limpiadas_reactivadas: plan.limpiar,
        accesos_extendidos: plan.extender,
      },
      atencion: {
        null_con_sub_activa: plan.null_con_sub_activa,   // pagan pero acceso_hasta=NULL → revisar a mano
        sin_fila_en_db: plan.sin_fila,                   // sub en Stripe sin cuenta/invitación nuestra
        subs_sin_email: sinEmail,
      },
    };
    console.log('[sync-subs]', dry ? 'DRY-RUN' : 'aplicado', JSON.stringify(resumen.cambios).slice(0, 500));
    return res.status(200).json(resumen);
  } catch (e) {
    console.error('[sync-subs]', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error', detail: String(e?.message || e) });
  }
}
