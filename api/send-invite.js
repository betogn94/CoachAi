// Send a beta invitation email via Resend.
//
// Triggered by the admin panel after a successful INSERT into beta_invitados.
// The DB row is the source of truth — the email is the courtesy notification.
// If this fails, the invitation still works on the DB side (the invitee can
// still register), so we surface a soft error in the UI instead of blocking.

import { Resend } from 'resend';

const APP_URL  = 'https://coachaipro.ai';
const ALLOWED_ORIGINS = [
  'https://coachaipro.ai',
  'https://www.coachaipro.ai',
  'https://coachaipro.com',
  'https://www.coachaipro.com',
  'https://coach-ai-pearl.vercel.app',
];

// Whitelist of tenant slugs we accept in the body. We DON'T blindly stuff
// arbitrary input into the URL — that would let a malformed admin payload
// inject querystrings into the CTA link. Anything not on this list falls
// back to no querystring (CoachAI default landing).
const VALID_TENANT_SLUGS = new Set(['coachai-default', 'jesus']);

// Per-tenant email theme. Each tenant's invite gets its own logo + color
// palette so the inbox preview, the hero banner, the CTA button and every
// brand-colored accent inside the body match what the invitee will see
// when they tap through to the app.
//
// Hosting note: the KING logo is served by Vercel as a static file under
// /tenants/jesus/logo.png (same path the app already uses for the app-side
// wordmark swap). Resend pulls it from the public URL.
function tenantEmailTheme(slug) {
  if (slug === 'jesus') {
    return {
      logoUrl:        'https://coachaipro.ai/tenants/jesus/logo.png',
      // Page bg = the KING --bg cream
      bodyBg:         '#FDF7F8',
      cardBorder:     'rgba(255,79,123,0.20)',
      cardShadow:     'rgba(255,79,123,0.14)',
      // Hero band gradient — IMPORTANT: the COACHAI Pro wordmark logo
      // itself is in coral (the brand co-branding decision recolored the
      // wordmark for KING). Putting the coral wordmark on a vivid coral
      // gradient makes it nearly invisible. So we soften the hero into
      // a cream → light-rose wash that mirrors the app's own --bg +
      // --surface2 palette + the PWA-install icon background — both
      // already battle-tested for legibility of coral marks. The 3-stop
      // gradient keeps a sense of depth without saturating to a level
      // where the logo disappears.
      gradient:       'linear-gradient(135deg,#FFF6F9 0%,#FFE7EE 50%,#FFD7E4 100%)',
      gradientFallback: '#FFE7EE',
      // Tagline ("TU COACH PERSONAL CON IA") sits below the wordmark on
      // the hero. The default uses rgba(255,255,255,0.95) (white on the
      // dark violet hero); on the new cream hero we need a dark-ish
      // coral so it reads with AA contrast against the soft bg.
      taglineColor:   '#7a2842',
      // CTA button (2-stop): coral → coral-deep — kept VIVID coral
      // because the white CTA text needs the high-contrast dark bg.
      gradientCta:    'linear-gradient(135deg,#FF4F7B 0%,#E03A6F 100%)',
      ctaFallback:    '#FF4F7B',
      ctaShadow:      'rgba(255,79,123,0.30)',
      // Brand-accent color used everywhere a single hex was inlined
      accent:         '#FF4F7B',
      accentDark:     '#C42960',
      // Feature box (rutina/dieta/coach/progreso list)
      featureBg:      '#FFF0F4',
      featureBorder:  'rgba(255,79,123,0.22)',
      featureBullet:  '#C42960',
      // "Cómo entrar" highlight box
      howToBg:        '#FFEEF2',
      howToBorder:    '#FF4F7B',
      howToEyebrow:   '#FF4F7B',
      howToText:      '#5a2f3f',
      howToLink:      '#FF4F7B',
      // Footer
      footerBorder:   'rgba(255,79,123,0.16)',
      footerLink:     '#FF4F7B',
    };
  }
  // Default CoachAI Pro — original violet/teal palette + canonical logo
  return {
    logoUrl:        'https://vmvhlgzwufkardaruutt.supabase.co/storage/v1/object/public/exercise-gifs/brand/coachai-logo.png',
    bodyBg:         '#f3f1fa',
    cardBorder:     'rgba(124,106,255,0.18)',
    cardShadow:     'rgba(124,106,255,0.10)',
    gradient:       'linear-gradient(135deg,#7c6aff 0%,#5b9fff 50%,#2ecfb5 100%)',
    gradientFallback: '#7c6aff',
    // Default tagline uses near-white on the dark violet hero — kept as-is
    taglineColor:   'rgba(255,255,255,0.95)',
    gradientCta:    'linear-gradient(135deg,#7c6aff 0%,#5b9fff 100%)',
    ctaFallback:    '#7c6aff',
    ctaShadow:      'rgba(124,106,255,0.28)',
    accent:         '#7c6aff',
    accentDark:     '#5e4dc9',
    featureBg:      '#f6f4ff',
    featureBorder:  'rgba(124,106,255,0.22)',
    featureBullet:  '#5e4dc9',
    howToBg:        '#eafaf5',
    howToBorder:    '#1ba88f',
    howToEyebrow:   '#1ba88f',
    howToText:      '#2c4a40',
    howToLink:      '#1ba88f',
    footerBorder:   'rgba(124,106,255,0.14)',
    footerLink:     '#7c6aff',
  };
}

function buildEmail({ nombre, invitadoPor, tenantSlug }) {
  // Pass-through tenant info only if it's a known slug AND not the default
  // (the default landing is what we'd hit without the param, so adding
  // ?tenant=coachai-default would be redundant noise).
  const safeTenantSlug =
    typeof tenantSlug === 'string' && VALID_TENANT_SLUGS.has(tenantSlug) && tenantSlug !== 'coachai-default'
      ? tenantSlug
      : null;
  // Build the URL the CTA + every link in the email points to. With a
  // whitelabel tenant we append ?tenant=<slug> so the invitee's first
  // tap on the email shows them the branded landing instead of the
  // generic CoachAI one — they see the right brand BEFORE typing email.
  const appUrl = safeTenantSlug ? `${APP_URL}/?tenant=${encodeURIComponent(safeTenantSlug)}` : APP_URL;
  // Resolve the per-tenant theme so the email visually matches the app
  // the invitee will land on.
  const theme = tenantEmailTheme(safeTenantSlug);
  // Strip HTML angle brackets + the Unicode replacement char (U+FFFD = "?")
  // + C0/C1 control chars. Real admin-panel submissions are always clean UTF-8;
  // this is a defensive sanitizer for malformed test calls / weird inputs.
  const safeNombre = (nombre || '')
    .replace(/[<>]/g, '')
    .replace(/[�\x00-\x1F\x7F-\x9F]/g, '')
    .trim();

  const subject = safeNombre
    ? `${safeNombre}, tu lugar en la beta de CoachAI 💪`
    : 'Tu lugar en la beta cerrada de CoachAI 💪';

  const greetHtml = safeNombre ? `Hola <strong style="color:${theme.accent};">${safeNombre}</strong>,` : 'Hola,';
  const greetTxt  = safeNombre ? `Hola ${safeNombre},` : 'Hola,';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>CoachAI — invitación</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${theme.bodyBg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c1c2e;">
  <!-- Pre-header (only shows in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:${theme.bodyBg};font-size:1px;line-height:1px;">
    Tu coach personal con IA — rutina, dieta y seguimiento adaptados a vos. Beta exclusiva.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.bodyBg}" style="background:${theme.bodyBg};padding:28px 12px;">
    <tr>
      <td align="center">
        <!-- ====== Email card ====== -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:580px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${theme.cardBorder};box-shadow:0 10px 36px ${theme.cardShadow};">

          <!-- HERO: gradient band + real logo PNG -->
          <tr>
            <td align="center" bgcolor="${theme.gradientFallback}" style="background:${theme.gradientFallback};background:${theme.gradient};padding:36px 24px 30px;text-align:center;">
              <img src="${theme.logoUrl}" alt="CoachAI Pro" width="280" style="display:block;width:280px;max-width:78%;height:auto;margin:0 auto 10px;border:0;outline:none;text-decoration:none;">
              <div style="font-size:12.5px;color:${theme.taglineColor};letter-spacing:2px;text-transform:uppercase;font-weight:600;margin-top:6px;">Tu coach personal con IA</div>
            </td>
          </tr>

          <!-- Greeting + intro -->
          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff;padding:34px 32px 0;">
              <div style="font-size:17px;color:#1c1c2e;line-height:1.5;margin-bottom:18px;">
                ${greetHtml}
              </div>
              <div style="font-size:15px;color:#3d3d52;line-height:1.7;margin-bottom:14px;">
                Imaginate tener un <strong style="color:#1c1c2e;">coach experto en entrenamiento y nutrición</strong> disponible <strong style="color:#1c1c2e;">24/7 en el celular</strong>, que arma tu plan exacto y te acompaña semana a semana.
              </div>
              <div style="font-size:15px;color:#3d3d52;line-height:1.7;margin-bottom:22px;">
                Eso es <strong style="color:${theme.accent};">CoachAI</strong>. Y te queremos como uno de los primeros en probarla.
              </div>
            </td>
          </tr>

          <!-- Features box (subtle lavender tint over white) -->
          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff;padding:0 32px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.featureBg};border:1px solid ${theme.featureBorder};border-radius:14px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#1c1c2e;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">💪</span>
                          <strong style="color:${theme.featureBullet};">Rutina semanal</strong> armada a tu medida y objetivos
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#1c1c2e;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">🥗</span>
                          <strong style="color:${theme.featureBullet};">Plan nutricional</strong> con tus gustos y restricciones
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#1c1c2e;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">🤖</span>
                          <strong style="color:${theme.featureBullet};">Coach AI 24/7</strong> en el bolsillo — pregunta y ajusta
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;font-size:14.5px;color:#1c1c2e;line-height:1.55;">
                          <span style="display:inline-block;width:28px;font-size:18px;vertical-align:middle;">📊</span>
                          <strong style="color:${theme.featureBullet};">Progreso real</strong> medido semana a semana
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
            <td align="center" bgcolor="#ffffff" style="background:#ffffff;padding:0 32px 26px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${theme.ctaFallback}" style="background:${theme.ctaFallback};background:${theme.gradientCta};border-radius:100px;box-shadow:0 6px 20px ${theme.ctaShadow};">
                    <a href="${appUrl}" target="_blank" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.8px;padding:16px 40px;border-radius:100px;">
                      ENTRAR A COACHAI &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- How to enter -->
          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff;padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.howToBg};border-left:3px solid ${theme.howToBorder};border-radius:8px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <div style="font-size:10.5px;font-weight:700;color:${theme.howToEyebrow};letter-spacing:1.6px;text-transform:uppercase;margin-bottom:6px;">Cómo entrar</div>
                    <div style="font-size:13.5px;color:${theme.howToText};line-height:1.65;">
                      Ingresá a <a href="${appUrl}" style="color:${theme.howToLink};text-decoration:none;font-weight:600;">coachaipro.ai</a> con <strong style="color:#1c1c2e;">este mismo email</strong>. Sin clave, sin formularios largos — la app te reconoce.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff;padding:4px 32px 26px;">
              <div style="font-size:13.5px;color:#5a5a70;line-height:1.65;margin-bottom:18px;">
                ¿Dudas? <strong style="color:#1c1c2e;">Respondé este mail</strong> y te contestamos personalmente.
              </div>
              <div style="font-size:13.5px;color:#5a5a70;line-height:1.65;">
                Te esperamos.<br>
                <strong style="color:${theme.accent};">— Equipo CoachAI</strong>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td bgcolor="#ffffff" style="background:#ffffff;padding:18px 32px 22px;border-top:1px solid ${theme.footerBorder};">
              <div style="font-size:11px;color:#9494a8;line-height:1.55;text-align:center;">
                Recibiste este mail porque te invitamos a la beta cerrada de CoachAI.<br>
                <a href="${appUrl}" style="color:${theme.footerLink};text-decoration:none;">coachaipro.ai</a>
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

→ ENTRAR A COACHAI: ${appUrl}

Cómo entrar: ingresá a coachaipro.ai con este mismo email. Sin clave, sin formularios — la app te reconoce.

¿Dudas? Respondé este mail y te contestamos personalmente.

Te esperamos.
— Equipo CoachAI
${appUrl}`;

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
    const { email, nombre, invitadoPor, tenantSlug } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const cleanEmail = email.trim().toLowerCase();

    const resend = new Resend(apiKey);
    const { subject, html, text } = buildEmail({ nombre, invitadoPor, tenantSlug });

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
