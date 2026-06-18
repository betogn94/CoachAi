// Enviador de prueba de Web Push (Fase 0). Manda una notificación a TODAS las
// suscripciones de un usuario. Lee la llave privada VAPID de la env var de
// Vercel (VAPID_PRIVATE_KEY). Guardado por origin allowlist (defensa básica).
//
// Body: { usuario_id, title?, body?, url? }
//
// Más adelante esto se generaliza en el enviador real + el cron de la Fase 2.

import webpush from 'web-push';
import { isAllowedOrigin } from './_origin.js';

const SUPABASE_URL = 'https://vmvhlgzwufkardaruutt.supabase.co';
// anon key — pública (la misma que ya está en el cliente). RLS permisivo deja leer.
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdmhsZ3p3dWZrYXJkYXJ1dXR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzA4NjcsImV4cCI6MjA5Mjg0Njg2N30.x9-lV9xi3Kdu_zpHcGC0PC80-GiXpc1WD4lnAuFI_iM';

// Llave PÚBLICA VAPID (no es secreto) + subject. La PRIVADA va por env var.
const VAPID_PUBLIC  = 'BMU0PM_rgcq81HVt8F1Qma0AwbjoHeja5yv6LfadmumHa2Z_IJNmLHuLBsQsrxw13Kso2Krgz7UrU1-ZhsN4WIo';
const VAPID_SUBJECT = 'mailto:support.coachaipro@gmail.com';

export default async function handler(req, res) {
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_origin' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return res.status(500).json({ error: 'vapid_not_configured' });
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, priv);

  try {
    const { usuario_id, title, body, url } = req.body || {};
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id_required' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?usuario_id=eq.${usuario_id}&select=endpoint,p256dh,auth`,
      { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON } }
    );
    const subs = await r.json();
    if (!Array.isArray(subs) || subs.length === 0) return res.status(404).json({ error: 'no_subscriptions' });

    const payload = JSON.stringify({
      title: title || 'CoachAI 💪',
      body:  body  || '¡Funciona! Esta es una notificación de prueba.',
      url:   url   || '/',
      tag:   'coachai-test',
    });

    const results = [];
    for (const s of subs) {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, payload);
        results.push({ tail: s.endpoint.slice(-10), ok: true });
      } catch (err) {
        results.push({ tail: s.endpoint.slice(-10), ok: false, status: err.statusCode });
        // 404/410 = suscripción muerta → limpiarla
        if (err.statusCode === 404 || err.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`,
            { method: 'DELETE', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON } });
        }
      }
    }
    return res.status(200).json({ ok: true, sent: results });
  } catch (e) {
    console.error('[push-test] error', e);
    return res.status(500).json({ error: e.message || 'unknown' });
  }
}
