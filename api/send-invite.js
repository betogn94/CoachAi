// Send a beta invitation email via Resend.
//
// Triggered by the admin panel after a successful INSERT into beta_invitados.
// The DB row is the source of truth — the email is the courtesy notification.
// If this fails, the invitation still works on the DB side (the invitee can
// still register), so we surface a soft error in the UI instead of blocking.
//
// During the beta, FROM defaults to Resend's sandbox sender. Once
// coachaipro.ai is verified inside Resend, set RESEND_FROM env var to
// 'Equipo CoachAI <invite@coachaipro.ai>' — no code change required.

import { Resend } from 'resend';

const APP_URL = 'https://coachaipro.ai';
const ALLOWED_ORIGINS = [
  'https://coachaipro.ai',
  'https://www.coachaipro.ai',
  'https://coachaipro.com',
  'https://www.coachaipro.com',
  'https://coach-ai-pearl.vercel.app',
];

function buildEmail({ nombre, invitadoPor }) {
  const safeNombre = (nombre || '').replace(/[<>]/g, '').trim();
  const greetHtml = safeNombre ? `Hola <strong>${safeNombre}</strong>,` : 'Hola,';
  const greetTxt  = safeNombre ? `Hola ${safeNombre},` : 'Hola,';

  const subject = '💪 Te invitamos a probar CoachAI (beta cerrada)';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CoachAI — invitación</title>
</head>
<body style="margin:0;padding:0;background:#070714;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070714;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111122;border:1px solid rgba(124,106,255,0.18);border-radius:18px;padding:36px 32px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="font-family:'Bebas Neue','Arial Narrow',Arial,sans-serif;font-size:36pt;letter-spacing:6px;line-height:1;background:linear-gradient(135deg,#b4a7ff 0%,#5b9fff 50%,#2ecfb5 100%);-webkit-background-clip:text;background-clip:text;color:#b4a7ff;font-weight:700;">COACHAI</div>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:18px;font-size:16px;color:#f0f0fa;line-height:1.55;">
              ${greetHtml}
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:18px;font-size:15px;color:#d8d8e8;line-height:1.65;">
              Te invitamos a sumarte a la <strong style="color:#b4a7ff;">beta cerrada de CoachAI</strong> — una app de entrenamiento personal con inteligencia artificial.
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:22px;font-size:14.5px;color:#c8c8d8;line-height:1.7;">
              En 1 minuto vas a tener:<br>
              · Una <strong style="color:#f0f0fa;">rutina semanal</strong> armada a tu medida<br>
              · Un <strong style="color:#f0f0fa;">plan de alimentación</strong> personalizado con tus gustos y restricciones<br>
              · Un <strong style="color:#f0f0fa;">coach AI</strong> 24/7 para preguntas, ajustes y seguimiento<br>
              · Métricas semanales de progreso reales
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 0 22px;">
              <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#7c6aff 0%,#5b9fff 100%);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:100px;font-size:15px;font-weight:700;letter-spacing:0.5px;">Entrar a CoachAI →</a>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:18px;font-size:13.5px;color:#a8a8c0;line-height:1.65;background:rgba(124,106,255,0.07);border-left:3px solid #7c6aff;padding:14px 16px;border-radius:8px;">
              <strong style="color:#b4a7ff;">Para entrar:</strong> ingresá a <a href="${APP_URL}" style="color:#5b9fff;text-decoration:none;">coachaipro.ai</a> con <strong style="color:#f0f0fa;">este mismo email</strong>. No necesitás clave — la app te reconoce y te recuerda.
            </td>
          </tr>
          <tr>
            <td style="padding-top:10px;font-size:13px;color:#8a8aa0;line-height:1.6;">
              Cualquier duda, <strong style="color:#a8a8c0;">respondé este mail</strong> y te contestamos.
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;font-size:11px;color:#6c6c80;line-height:1.5;border-top:1px solid rgba(124,106,255,0.10);padding-top:18px;">
              Recibís este mail porque te invitamos a la beta. Si fue un error, ignoralo y no vas a recibir más mensajes.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${greetTxt}

Te invitamos a sumarte a la beta cerrada de CoachAI — una app de entrenamiento personal con inteligencia artificial.

En 1 minuto vas a tener:
- Una rutina semanal armada a tu medida
- Un plan de alimentación personalizado
- Un coach AI 24/7 para preguntas, ajustes y seguimiento
- Métricas semanales de progreso reales

Para entrar: ingresá a ${APP_URL} con este mismo email. No necesitás clave.

Cualquier duda, respondé este mail y te contestamos.

—
Equipo CoachAI
${APP_URL}`;

  return { subject, html, text };
}

export default async function handler(req, res) {
  // Lightweight origin check — raises the bar so the endpoint isn't trivially
  // abused as a free email-sender. Proper admin auth comes in F1.
  const origin = req.headers.origin || req.headers.referer || '';
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!isAllowed) {
    return res.status(403).json({ error: 'forbidden_origin' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'resend_not_configured' });
  }

  try {
    const { email, nombre, invitadoPor } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const cleanEmail = email.trim().toLowerCase();

    const resend = new Resend(apiKey);
    const { subject, html, text } = buildEmail({ nombre, invitadoPor });

    const FROM = process.env.RESEND_FROM || 'CoachAI <onboarding@resend.dev>';
    const REPLY_TO = process.env.RESEND_REPLY_TO; // optional

    const sendArgs = {
      from: FROM,
      to: [cleanEmail],
      subject,
      html,
      text,
    };
    if (REPLY_TO) sendArgs.reply_to = REPLY_TO;

    const result = await resend.emails.send(sendArgs);
    if (result.error) {
      console.error('[send-invite] resend error:', result.error);
      return res.status(502).json({ error: 'send_failed', detail: result.error.message });
    }

    return res.status(200).json({ ok: true, id: result.data?.id || null });
  } catch (err) {
    console.error('[send-invite] error:', err);
    return res.status(500).json({ error: err.message || 'unknown_error' });
  }
}
