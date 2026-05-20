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
  const subject = safeNombre
    ? `${safeNombre}, tu lugar en la beta de CoachAI 💪`
    : 'Tu lugar en la beta cerrada de CoachAI 💪';

  const greetHtml = safeNombre ? `Hola <strong style="color:#b4a7ff;">${safeNombre}</strong>,` : 'Hola,';
  const greetTxt  = safeNombre ? `Hola ${safeNombre},` : 'Hola,';

  // Brand gradient used in the hero band — same as the app's wordmark/CTA
  const gradient = 'linear-gradient(135deg,#7c6aff 0%,#5b9fff 50%,#2ecfb5 100%)';
  const gradientCta = 'linear-gradient(135deg,#7c6aff 0%,#5b9fff 100%)';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CoachAI — invitación</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#070714;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f0f0fa;">
  <!-- Pre-header (only shows in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:#070714;font-size:1px;line-height:1px;">
    Tu coach personal con IA — rutina, dieta y seguimiento adaptados a vos. Beta exclusiva.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#070714" style="background:#070714;padding:24px 12px;">
    <tr>
      <td align="center">
        <!-- ====== Email card ====== -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background:#0c0c1c;border-radius:20px;overflow:hidden;border:1px solid rgba(124,106,255,0.18);">

          <!-- HERO with gradient + wordmark -->
          <tr>
            <td align="center" bgcolor="#7c6aff" style="background:#7c6aff;background:${gradient};padding:44px 24px 38px;text-align:center;">
              <div style="font-family:'Helvetica Neue','Arial Black',Arial,sans-serif;font-size:42px;font-weight:900;letter-spacing:9px;line-height:1;color:#ffffff;text-shadow:0 2px 14px rgba(0,0,0,0.20);">COACHAI</div>
              <div style="margin-top:14px;font-size:12.5px;color:rgba(255,255,255,0.92);letter-spacing:2px;text-transform:uppercase;font-weight:600;">Tu coach personal con IA</div>
            </td>
          </tr>

          <!-- Greeting + intro -->
          <tr>
            <td style="padding:34px 32px 0;">
              <div style="font-size:17px;color:#f0f0fa;line-height:1.5;margin-bottom:18px;">
                ${greetHtml}
              </div>
              <div style="font-size:15px;color:#dcdcec;line-height:1.7;margin-bottom:14px;">
                Imaginate tener un <strong style="color:#f0f0fa;">coach experto en entrenamiento y nutrición</strong> disponible <strong style="color:#f0f0fa;">24/7 en el celular</strong>, que arma tu plan exacto y te acompaña semana a semana.
              </div>
              <div style="font-size:15px;color:#dcdcec;line-height:1.7;margin-bottom:22px;">
                Eso es <strong style="color:#b4a7ff;">CoachAI</strong>. Y te queremos como uno de los primeros en probarla.
              </div>
            </td>
          </tr>

          <!-- Features box -->
          <tr>
            <td style="padding:0 32px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(124,106,255,0.07);border:1px solid rgba(124,106,255,0.20);border-radius:14px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#f0f0fa;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">💪</span>
                          <strong style="color:#b4a7ff;">Rutina semanal</strong> armada a tu medida y objetivos
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#f0f0fa;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">🥗</span>
                          <strong style="color:#b4a7ff;">Plan nutricional</strong> con tus gustos y restricciones
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#f0f0fa;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">🤖</span>
                          <strong style="color:#b4a7ff;">Coach AI 24/7</strong> en el bolsillo — pregunta y ajusta
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#f0f0fa;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">📊</span>
                          <strong style="color:#b4a7ff;">Progreso real</strong> medido semana a semana
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 32px 26px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#7c6aff" style="background:#7c6aff;background:${gradientCta};border-radius:100px;box-shadow:0 6px 20px rgba(124,106,255,0.32);">
                    <a href="${APP_URL}" target="_blank" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.8px;padding:16px 40px;border-radius:100px;">
                      ENTRAR A COACHAI &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- How to enter -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(46,207,181,0.07);border-left:3px solid #2ecfb5;border-radius:8px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <div style="font-size:10.5px;font-weight:700;color:#2ecfb5;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:6px;">Cómo entrar</div>
                    <div style="font-size:13.5px;color:#d8d8e8;line-height:1.65;">
                      Ingresá a <a href="${APP_URL}" style="color:#5b9fff;text-decoration:none;font-weight:600;">coachaipro.ai</a> con <strong style="color:#f0f0fa;">este mismo email</strong>. Sin clave, sin formularios largos — la app te reconoce.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td style="padding:4px 32px 26px;">
              <div style="font-size:13.5px;color:#a8a8c0;line-height:1.65;margin-bottom:18px;">
                ¿Dudas? <strong style="color:#dcdcec;">Respondé este mail</strong> y te contestamos personalmente.
              </div>
              <div style="font-size:13.5px;color:#a8a8c0;line-height:1.65;">
                Te esperamos.<br>
                <strong style="color:#b4a7ff;">— Equipo CoachAI</strong>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 32px 22px;border-top:1px solid rgba(124,106,255,0.10);">
              <div style="font-size:11px;color:#6c6c80;line-height:1.55;text-align:center;">
                Recibiste este mail porque te invitamos a la beta cerrada de CoachAI.<br>
                <a href="${APP_URL}" style="color:#7c6aff;text-decoration:none;">coachaipro.ai</a>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `COACHAI — Tu coach personal con IA

${greetTxt}

Imaginate tener un coach experto en entrenamiento y nutrición disponible 24/7 en el celular, que arma tu plan exacto y te acompaña semana a semana.

Eso es CoachAI. Y te queremos como uno de los primeros en probarla.

💪 Rutina semanal armada a tu medida
🥗 Plan nutricional con tus gustos y restricciones
🤖 Coach AI 24/7 en el bolsillo
📊 Progreso real medido semana a semana

→ ENTRAR A COACHAI: ${APP_URL}

Cómo entrar: ingresá a coachaipro.ai con este mismo email. Sin clave, sin formularios — la app te reconoce.

¿Dudas? Respondé este mail y te contestamos personalmente.

Te esperamos.
— Equipo CoachAI
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
