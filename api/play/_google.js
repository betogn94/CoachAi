// Helper para hablar con la Google Play Developer API (androidpublisher v3).
// Verifica compras de suscripción del TWA (Play Billing). Server-side, service role.
//
// Auth con Google: firmamos un JWT con la private key de la CUENTA DE SERVICIO
// (RS256, con el crypto nativo de Node → sin dependencias nuevas) y lo canjeamos
// por un access token OAuth2. Con ese token consultamos el estado de la suscripción.
//
// Env vars (se cargan en Vercel cuando exista la cuenta de servicio):
//   GOOGLE_PLAY_SERVICE_ACCOUNT  = el JSON de la key de la cuenta de servicio (pegado entero)
//   (alternativa) GOOGLE_PLAY_SA_EMAIL + GOOGLE_PLAY_SA_KEY  si se prefiere separado.

import crypto from 'node:crypto';

export const PLAY_PACKAGE = 'ai.coachaipro.app';
export const PLAY_SUB_PRODUCT_ID = 'coachai_pro_monthly';   // el ID de la suscripción en Play

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANDROIDPUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

// --- credenciales de la cuenta de servicio ---
function serviceAccount() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
  if (raw) {
    let json;
    try { json = JSON.parse(raw); }
    catch (e) { throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT no es JSON válido'); }
    return { email: json.client_email, key: json.private_key };
  }
  const email = process.env.GOOGLE_PLAY_SA_EMAIL;
  const key = process.env.GOOGLE_PLAY_SA_KEY;
  if (email && key) return { email, key };
  throw new Error('Faltan credenciales de la cuenta de servicio de Google Play');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Cache simple del access token (los serverless reusan el proceso un rato).
let _tokenCache = { token: null, exp: 0 };

export async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;

  const sa = serviceAccount();
  // Las env vars suelen guardar la key con "\n" literales → los volvemos saltos reales.
  const privateKey = String(sa.key).replace(/\\n/g, '\n');

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.email,
    scope: SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token error ${res.status}: ${t}`);
  }
  const data = await res.json();
  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

// Trae el estado de una suscripción por su purchaseToken (subscriptionsv2).
export async function getSubscription(purchaseToken) {
  const token = await getGoogleAccessToken();
  const url = `${ANDROIDPUBLISHER}/applications/${PLAY_PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`getSubscription ${res.status}: ${t}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Reconoce (acknowledge) la compra. Play exige reconocer las compras dentro de 3 días
// o se reembolsan solas. subscriptionsv2 devuelve acknowledgementState; si está pendiente,
// llamamos al endpoint clásico de acknowledge (mismo token).
export async function acknowledgeSubscription(purchaseToken) {
  const token = await getGoogleAccessToken();
  const url = `${ANDROIDPUBLISHER}/applications/${PLAY_PACKAGE}/purchases/subscriptions/${PLAY_SUB_PRODUCT_ID}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  // 200/204 = ok. Si ya estaba reconocida, Google devuelve error benigno → no abortamos.
  if (!res.ok && res.status !== 400) {
    const t = await res.text();
    console.warn('[play] acknowledge no-ok', res.status, t);
  }
  return res.ok;
}

// Normaliza el enum de estado de Google a nuestros valores cortos.
export function normalizeState(subState) {
  switch (subState) {
    case 'SUBSCRIPTION_STATE_ACTIVE': return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': return 'in_grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD': return 'on_hold';
    case 'SUBSCRIPTION_STATE_PAUSED': return 'paused';
    case 'SUBSCRIPTION_STATE_CANCELED': return 'canceled';
    case 'SUBSCRIPTION_STATE_EXPIRED': return 'expired';
    case 'SUBSCRIPTION_STATE_PENDING': return 'pending';
    default: return 'unknown';
  }
}

// ¿El estado da acceso a la app? (activa, en gracia = todavía adentro; cancelada
// mantiene acceso hasta expiry — se maneja por la fecha, no por el estado).
export function stateGrantsAccess(state) {
  return state === 'active' || state === 'in_grace' || state === 'canceled';
}

// Extrae el fin del período actual (expiry) del subscriptionsv2: el máximo expiryTime
// de los lineItems. Devuelve ISO string o null.
export function extractExpiry(sub) {
  const items = Array.isArray(sub?.lineItems) ? sub.lineItems : [];
  let max = null;
  for (const it of items) {
    if (it?.expiryTime) {
      const t = new Date(it.expiryTime).getTime();
      if (!Number.isNaN(t) && (max === null || t > max)) max = t;
    }
  }
  return max === null ? null : new Date(max).toISOString();
}

// Extrae productId / basePlan / offer del primer lineItem (para guardar/validar).
export function extractProduct(sub) {
  const it = (Array.isArray(sub?.lineItems) ? sub.lineItems : [])[0] || {};
  const offer = it.offerDetails || {};
  return {
    productId: it.productId || null,
    basePlanId: offer.basePlanId || null,
    offerId: offer.offerId || null,
  };
}
