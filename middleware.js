// Edge Middleware (Vercel) — SOLO la raíz. Los scrapers de preview de links
// (WhatsApp, Facebook, Telegram, etc.) NO ejecutan el JavaScript de la app, así
// que nunca ven el logo/tema King que la app aplica en runtime → mostraban el
// ícono default (violeta) para TODOS los subdominios. Acá les servimos un HTML
// mínimo con las Open Graph tags correctas SEGÚN el subdominio (King = rosado).
// Los usuarios reales NO se ven afectados: si no es un bot de preview, passthrough
// (se sirve el index.html de siempre). Ante cualquier error → passthrough (nunca
// rompemos la carga de la app).
export const config = { matcher: '/' };

// User-Agents de los scrapers de PREVIEW social. NO incluimos googlebot/bingbot
// a propósito (que indexen la app real, no este HTML mínimo).
const PREVIEW_BOTS = /whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|telegrambot|slackbot|slack-imgproxy|discordbot|embedly|pinterest|redditbot|vkshare|skypeuripreview|whatsapp|applebot/i;

function ogHtml({ title, desc, image, url }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoachAI Pro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
</head><body></body></html>`;
}

export default function middleware(request) {
  try {
    const ua = request.headers.get('user-agent') || '';
    if (!PREVIEW_BOTS.test(ua)) return;   // usuario real → passthrough (la app de siempre)

    const host = (request.headers.get('host') || '').toLowerCase();
    const base = 'https://' + (host || 'coachaipro.ai') + '/';
    const isKing = /^king\./.test(host);
    const isCom = /(^|\.)coachaipro\.com$/.test(host);   // landing B2B (coaches y gimnasios)

    const html = isCom
      ? ogHtml({
          title: 'CoachAI Pro — Tu propia app con IA para coaches y gimnasios',
          desc: 'Nutrición, entrenamiento y seguimiento diario con IA, bajo tu marca. Vos supervisás; la IA hace el trabajo pesado.',
          image: 'https://coachaipro.ai/icon-512.png',
          url: base,
        })
      : isKing
      ? ogHtml({
          title: 'Método King · CoachAI Pro',
          desc: 'Del Mapa Estético a tu transformación: tu plan, tu progreso y tu Índice de Armonía, todo en un solo lugar.',
          image: 'https://coachaipro.ai/tenants/jesus/icon-512.png',
          url: base,
        })
      : ogHtml({
          title: 'CoachAI Pro — Tu entrenador personal con IA',
          desc: 'Tu plan de nutrición y entrenamiento personalizado con IA, con seguimiento diario.',
          image: 'https://coachaipro.ai/icon-512.png',
          url: base,
        });

    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  } catch (e) {
    return;   // ante cualquier error → passthrough, jamás romper la app
  }
}
