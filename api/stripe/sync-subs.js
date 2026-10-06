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

import { sb } from '../tower/_db.js';
import { getStripe, resolveSubEmail, marcarCancelada, limpiarCancelada, VIGENTE } from './_subs.js';

export const config = { maxDuration: 60 };

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

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

  try {
    const stripe = getStripe();

    // 1) Todas las subs de Stripe (auto-paginado del SDK), agrupadas por email.
    const porEmail = new Map();   // email → [sub]
    const sinEmail = [];
    for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
      const email = await resolveSubEmail(stripe, sub);
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
              subs: [...porEmail.values()].reduce((n, arr) => n + arr.length, 0),
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

    const resumen = {
      ok: true,
      dry,
      subs_en_stripe: [...porEmail.values()].reduce((n, arr) => n + arr.length, 0),
      emails_con_sub: emails.length,
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
