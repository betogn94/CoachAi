// TEMPORAL — verifica que la cuenta de servicio puede autenticarse con Google Play.
// Protegido por el secreto RTDN (?key=). BORRAR después de verificar.
import { getGoogleAccessToken, getSubscription } from './_google.js';

export default async function handler(req, res) {
  const expected = process.env.PLAY_RTDN_SECRET;
  const got = (req.query && req.query.key) || '';
  if (!expected || got !== expected) return res.status(403).json({ ok: false });

  const out = { hasSAEnv: !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT };
  // Email/proyecto de la cuenta que usa la llave (para comparar con la invitada en Play).
  try {
    const j = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT || '{}');
    out.saEmail = j.client_email || null;
    out.saProject = j.project_id || null;
  } catch (e) { out.saParse = 'fail'; }
  try {
    const token = await getGoogleAccessToken();
    out.googleAuth = token ? 'ok' : 'no_token';
    out.tokenPrefix = token ? token.slice(0, 10) + '…' : null;
  } catch (e) { out.googleAuth = 'error'; out.authError = String(e && e.message).slice(0, 220); }

  // Llamada real con un token falso: si el error es de Google (400/404), la
  // AUTENTICACIÓN funcionó (solo el purchaseToken es inválido) = todo OK.
  try {
    await getSubscription('fake-token-diagnostic');
    out.apiCall = 'unexpected_ok';
  } catch (e) {
    out.apiCall = 'error';
    out.apiStatus = e && e.status;
    out.apiMsg = String(e && e.message).slice(0, 200);
  }
  return res.status(200).json(out);
}
