# Wrapper Android (TWA) con PWABuilder — guía de build

Para empaquetar CoachAI Pro como app Android y subirla a Google Play.
La app Android es un **TWA** (Trusted Web Activity): un contenedor liviano que abre la
PWA (coachaipro.ai) a pantalla completa, sin barra de URL. **No es una reescritura** —
es la misma PWA adentro de un cascarón Android.

**Estado de la web (lo que YO ya dejé listo):** manifest optimizado (`id`, maskable,
theme/bg, etc.) + la infra de `assetlinks.json` en `/.well-known/` esperando el fingerprint.

---

## 🧰 Herramienta: PWABuilder (lo más fácil, sin instalar Android SDK)
**pwabuilder.com** — web, gratis, hecho por Microsoft. Genera el `.aab` (el archivo que
sube a Play) leyendo el manifest. No necesitás saber Android.

## Paso a paso

### 1. Generar el paquete
1. Andá a **pwabuilder.com** → pegá **`https://coachaipro.ai`** → "Start".
2. Te da un score del PWA (debería estar bien — manifest + SW + HTTPS ✓).
3. **"Package for stores" → Android.**
4. En las opciones del paquete, confirmá/poné:
   - **Package ID:** **`ai.coachaipro.app`** ← ⚠️ **PERMANENTE, no se puede cambiar después de publicar.** (Tiene que coincidir con el `assetlinks.json` que ya dejé — si querés otro, avisame y lo cambio en los dos lados.)
   - **App name:** `CoachAI Pro`
   - **Launcher name (corto):** `CoachAI Pro`
   - **Display mode:** standalone · **Status bar / theme:** que tome los del manifest.
   - Dejá el resto por defecto.
5. **Signing key:** elegí **"Create new"** (que PWABuilder genere la llave).
   → ⚠️⚠️ **GUARDÁ la llave (.keystore) + las contraseñas que te muestra, en un lugar SEGURO.**
   Si la perdés, **NO vas a poder volver a actualizar la app NUNCA** (Google no la recupera).
   Guardala en un gestor de contraseñas / backup. **Esto es lo más importante del proceso.**
6. **Download** → te bajás un zip con: el **`.aab`** (para subir a Play), la **llave**, y un
   `assetlinks.json` de ejemplo + instrucciones.

### 2. Subir a Play Console + Play App Signing
1. En Play Console: creá la app → subí el **`.aab`** a **Producción** (la cuenta de
   organización NO necesita el test de 12 testers).
2. Aceptá **Play App Signing** (recomendado: Google guarda la llave de firma final).
3. ⚠️ **GOTCHA #1 del TWA (el que rompe a todos):** con Play App Signing, Google **re-firma**
   la app con SU llave. → El `assetlinks.json` tiene que llevar el **SHA-256 de Google**, NO el
   de la llave de PWABuilder. **Sacá el correcto de:** Play Console → **Setup → App signing →**
   "App signing key certificate" → copiá el **SHA-256**.

### 3. Pegar el fingerprint en la web (lo hago yo en 1 minuto)
- Pasame ese **SHA-256** y yo lo pego en `/.well-known/assetlinks.json` + redeploy.
- (O lo editás vos: reemplazás `REEMPLAZAR_CON_EL_SHA256...` por el valor y pusheás.)
- Sin esto bien, el TWA **abre con la barra de URL** (funciona, pero se ve menos "app nativa").
- Verificás que quedó: `https://coachaipro.ai/.well-known/assetlinks.json` debe mostrar el SHA real.

### 4. Completar la ficha de Play (en paralelo)
- **Data safety** (declarar email/fotos/datos de salud) · **Content rating** · **Target audience**.
- **Descripción** con el **disclaimer de salud** ("no es un dispositivo médico…").
- **App access (acceso del revisor):** ⚠️ **GOTCHA #2:** el login es por código (OTP) → el
  revisor no puede recibirlo. **Escribile en las instrucciones que use "Ingresar como invitado"**
  (entra sin login y revisa todo). Sin esto = rechazo por "no pudimos acceder a la app".
- **Screenshots + ícono 512 + feature graphic** (lo de Juli).
- **Privacy policy URL:** `coachaipro.ai/privacidad.html` (ya está).

### 5. Enviar a revisión → ~7 días o menos.

---

## ✅ Checklist rápida del wrapper
- [ ] PWABuilder → Android → package ID `ai.coachaipro.app` → **guardar la llave** → bajar `.aab`.
- [ ] Subir `.aab` a Play (Producción) + aceptar Play App Signing.
- [ ] Sacar el **SHA-256 de Play App Signing** → ponerlo en `assetlinks.json` → redeploy.
- [ ] Data safety + content rating + descripción con disclaimer + App access = "Ingresar como invitado".
- [ ] Enviar a revisión.

## Para iOS (después)
Mismo PWABuilder → "Package for stores → iOS" genera un proyecto Xcode, pero **compilar iOS
necesita una Mac** (la de Jesús). Lo encaramos cuando estés con Android resuelto.
