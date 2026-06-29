# Runbook — empaquetar CoachAI para Google Play + App Store

Estado 2026-06-29. Auth + seguridad cerrados. Este doc es el camino para publicar.
La app que va a las stores = **CoachAI neutral** (el buscador + trial de invitado,
`?stores=1`). King y otros whitelabel quedan como web por ahora (apps aparte = futuro).

## ✅ La PWA ya está lista para wrappear (auditado)
- `manifest.json`: name/short_name/description, `display:standalone`, theme+bg color,
  orientation, íconos 192/512 + maskable, categories health/fitness. ✓
- Meta tags en `index.html`: viewport (`viewport-fit=cover`), `<link manifest>`,
  theme-color claro/oscuro, `apple-mobile-web-app-capable` + status-bar + title,
  `apple-touch-icon`. ✓
- HTTPS ✓, service worker ✓ ([[pwa_cache_versioning]]), `privacidad.html` existe ✓.
- **Anti-steering** ya construido (`isNativeWrapper()` + `shouldHideExternalPay()` ocultan
  links de pago externos dentro del wrapper) → soporta el modelo reader/login.

### Mejoras web opcionales (no bloquean)
- Ícono **maskable dedicado** (hoy reusa el 512 "any" → puede recortarse en Android).
- `screenshots` en el manifest (install prompt más rico + listing de Play).
- `apple-touch-startup-image` (splash de iOS; la app ya tiene splash propio → menor).
- **Términos de servicio** (no se encontró archivo) — Apple/Google los piden para subs.

## 🧾 Lo que hace BETO — cuentas de dev (registro personal, ver charla)
- **Google Play Console:** USD 25 **una vez**. Individual (DNI, sin D-U-N-S). Verificación
  de identidad ~48h. → consola para subir el `.aab`.
- **Apple Developer:** USD 99 **/año**. Individual (sin D-U-N-S). ~24-48h. → App Store Connect.
- (A futuro: migrar a la empresa vía **App Transfer** — trámite conocido, ver charla.)

## 📦 Generar los wrappers
### Android (TWA — Trusted Web Activity)
La app Android es un contenedor liviano que abre la PWA fullscreen (sin barra de URL).
- Herramienta: **Bubblewrap** (CLI de Google) o **PWABuilder** (web, más fácil). Apuntás a
  `https://coachaipro.ai/manifest.json` → genera el proyecto Android → firma → `.aab`.
- **Play App Signing** (recomendado): Google guarda la llave; el **SHA-256 fingerprint**
  sale de Play Console → Setup → App signing. Ese fingerprint va en `assetlinks.json` (abajo).
- Subís el `.aab` a Play Console.

### iOS (no hay TWA; es un wrapper WKWebView)
- Herramienta: **PWABuilder** (genera proyecto iOS) o **Capacitor** (más control).
- **Necesita una Mac** para compilar (Xcode) → subir a App Store Connect. (Opciones si no
  hay Mac: servicio de build en la nube tipo Codemagic, o una Mac prestada.)
- iOS NO usa assetlinks; el wrapper apunta a la URL + usa el manifest/meta tags.

## 🔗 assetlinks.json (Android) — pegar cuando exista el fingerprint
Crear `/.well-known/assetlinks.json` (servido desde la raíz del dominio). Plantilla:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "ai.coachaipro.app",
    "sha256_cert_fingerprints": ["<SHA256_DE_PLAY_APP_SIGNING>"]
  }
}]
```
- `package_name`: el que elijas en Bubblewrap/Play (ej. `ai.coachaipro.app`).
- El fingerprint sale de Play Console (App signing) o del keystore (`keytool -list`).
- Sin esto bien, el TWA abre **con barra de URL** (no rompe, pero se ve menos app-nativa).

## ⚖️ Compliance — el modelo reader/login (lo charlado, clave para no rebotar)
**Causa #1 de rechazo: "vende contenido digital sin IAP".** Para evitarlo:
- La app se lee como **login/reader**: la clienta **entra a acceder** lo que su coach pagó
  **afuera** (B2B, Stripe) → **no compra nada adentro** → sin IAP, sin comisión. ✅
- **Anti-steering**: dentro del wrapper, NO mostrar links/prompts de pago externo (ya hecho).
- **Trial de invitado** (`?stores=1`): cuando el guest convierte → o **IAP** (comisión casual)
  o **registro afuera** (sin prompt de compra adentro). NO vender la sub adentro sin IAP.
- **⚠️ Stripe = SOLO cobro fuera de las tiendas** (web/B2B: el coach le paga a la plataforma).
  **JAMÁS** para compras dentro de iOS/Android (eso DEBE ser IAP de Apple/Google, o rechazo
  instantáneo). Los docs legales (privacidad + términos) ya dejan esta distinción cristalina:
  "Stripe = pagos fuera de las tiendas; compras in-app = Apple/Google".
- Verificar contra las guidelines vigentes al armar (cambian seguido). No es asesoría legal.

## ✅ Checklist de submission (ambas stores)
- [ ] **Privacy policy** URL pública (verificar `privacidad.html` — contenido + accesible).
- [ ] **Data safety (Google) / Privacy nutrition labels (Apple):** declarar email, fotos,
      **datos de salud/fitness** (peso, medidas). Decir cómo se protegen (RLS, no se venden).
- [ ] **Términos de servicio** (crear si falta — subs lo piden).
- [ ] **Screenshots** por tamaño de dispositivo (iPhone 6.7"/6.5", Android phone/tablet).
- [ ] **Descripción, categoría** (Health & Fitness), **age rating** (cuestionario).
- [ ] **Disclaimers de salud**: "no es consejo médico; consultá un profesional" (clave para
      fitness/dieta — reduce riesgo de rechazo + responsabilidad).
- [ ] Ícono de tienda (1024² Apple), feature graphic (Google).

## Lo que preparo YO (técnico web, sin bloquear en tus cuentas)
1. Ícono maskable dedicado + screenshots en el manifest. 2. assetlinks.json (cuando haya
fingerprint). 3. Términos de servicio (si falta). 4. Repasar disclaimers de salud en la app.
5. Verificar el contenido de `privacidad.html`. 6. Confirmar el anti-steering 100% en modo wrapper.
