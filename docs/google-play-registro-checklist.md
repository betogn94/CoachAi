# Checklist — Registro como dev individual en Google Play (al 2026-06-30)

Para registrar a **Beto como desarrollador PERSONAL** (cuenta individual) y publicar CoachAI Pro.
Verificado contra las páginas oficiales de Google Play Console (jun 2026).

---

## ⚠️ LO MÁS IMPORTANTE — el "muro" de los 12 testers (afecta el timeline)
**Las cuentas PERSONALES creadas después del 13-nov-2023 DEBEN correr un test cerrado
antes de poder publicar en producción:**
- **Mínimo 12 testers** opt-in (recomendado 15-20 por si alguno se baja).
- **14 días CONSECUTIVOS** opt-in (sin cortes — si alguien se baja y vuelve, los 14 días tienen que ser corridos).
- Recién después: botón **"Apply for production"** → revisión (~7 días o menos).
- **Las cuentas de ORGANIZACIÓN están EXENTAS** de esto (pero necesitan D-U-N-S + la empresa).

**Qué significa para vos:** registrarte personal es **rápido de registrar**, pero llegar a
**producción** = ~3 semanas (14 días de test + ~7 de revisión + setup). El registro no es
el cuello de botella; **el test de 14 días sí**.

**✅ La buena noticia:** **tus clientas de King pueden ser los 12 testers** — ya usan la app.
Las sumás al test cerrado (las invitás por email a la lista de testers), corren 14 días, y listo.
Así el "muro" deja de ser un problema. → **Conviene arrancar el test cerrado lo antes posible**
(en paralelo a terminar lo demás), porque es el reloj de 14 días el que manda.

---

## 📋 Para REGISTRARTE — tené esto listo
- [ ] **Cuenta de Google (Gmail)** con **verificación en 2 pasos ACTIVADA** (requisito).
- [ ] **Tarjeta** (crédito/débito) para los **USD 25** (pago único, no anual).
- [ ] Tipo de cuenta: **"Personal"** (NO "Organización" → esa pide D-U-N-S).
- [ ] **Nombre legal** (tiene que coincidir con tu DNI).
- [ ] **Dirección legal** (la que figure en tu comprobante de domicilio).
- [ ] **Email de contacto** + **teléfono de contacto** (Google te manda un código a cada uno → verificalos y mantenelos operativos).
- [ ] **Email de desarrollador** (se muestra PÚBLICO en tu perfil de Google Play) → usá uno de **soporte** (ej. `support.coachaipro@gmail.com`), NO tu personal.
- [ ] **Developer name** (nombre que se muestra de la app) → puede ser distinto del legal: **"CoachAI Pro"**.

## 🪪 Verificación de identidad (ANTES de publicar — la pide Google)
- [ ] **Documento con foto** emitido por el gobierno (DNI / pasaporte / licencia).
- [ ] **Comprobante de domicilio** emitido en los **últimos 90 días** (factura de servicio, resumen de banco/tarjeta, contrato de alquiler) **con tu nombre y dirección actual**.
- [ ] **El nombre del DNI DEBE coincidir** con el nombre legal del perfil de pagos de Google. (Si no coinciden → rechazo. Revisá esto ANTES.)
- [ ] Tarda **unos días** (a veces más). Si rechazan, te dicen el motivo y reenviás corregido.

## 📱 Para que APRUEBEN la app (cuando la subas)
- [ ] **Target API 36 (Android 16)** — obligatorio para apps nuevas (desde 31-ago-2026). El wrapper (Bubblewrap/PWABuilder) tiene que targetear esto → usar la versión actualizada de la herramienta.
- [ ] **Formulario "Data safety"** (obligatorio) → declarar qué datos junta (email, fotos, **datos de salud/fitness**: peso, medidas), para qué, con quién se comparten, cómo se protegen, + link a la **política de privacidad** (ya la tenés).
- [ ] **Content rating** (cuestionario de clasificación de contenido).
- [ ] **Target audience + ads** (declarar público objetivo; declarar que NO hay ads).
- [ ] **App access** → darle al revisor cómo entrar a la app. **CLAVE para CoachAI:** el login es por código (OTP) → el revisor NO puede recibir el código. **Solución: indicarle que use "Ingresar como invitado"** (`?stores=1` → trial) — entra sin login y revisa todo. (Anotar esto en las instrucciones de "App access".)
- [ ] **Privacy policy URL** pública (ya: `coachaipro.ai/privacidad.html`).
- [ ] **Screenshots** + ícono 512 + feature graphic 1024×500 (lo de Juli).

## 🏥 Específico de apps de SALUD/FITNESS (clave para NO rebotar)
- [ ] **Disclaimer en la DESCRIPCIÓN de la tienda** (no solo en los Términos): algo como
      *"CoachAI Pro no es un dispositivo médico y no diagnostica, trata, cura ni previene
      ninguna condición médica. Consultá a un profesional de la salud."* Google lo exige
      para apps de salud/fitness — sin esto pueden rechazar.
- [ ] Nada de promesas médicas/exageradas en el listing ni en las screenshots.

---

## 🗺️ Orden sugerido (para ganar tiempo de verdad)
1. **Registrarte** (Gmail 2FA + $25 + datos + identidad) → días.
2. **Apenas tengas la cuenta:** crear la app + subir un primer build (wrapper) a **test cerrado** + invitar a las clientas como testers → **arranca el reloj de 14 días YA**.
3. En paralelo: completar Data safety, content rating, screenshots, descripción con disclaimer.
4. A los 14 días con 12+ testers opt-in → **Apply for production** → revisión ~7 días.

> El registro personal te ahorra el trámite de empresa AHORA, pero el camino a producción
> lo marca el **test de 14 días** — por eso conviene arrancarlo cuanto antes.

## Fuentes (oficiales Google Play Console, jun 2026)
- App testing requirements (12 testers / 14 días): support.google.com/googleplay/android-developer/answer/14151465
- Required info para crear la cuenta: support.google.com/googleplay/android-developer/answer/13628312
- Verificación de identidad: support.google.com/googleplay/android-developer/answer/10841920
- Target API level: support.google.com/googleplay/android-developer/answer/11926878
- Data safety: support.google.com/googleplay/android-developer/answer/10787469
- Health content: support.google.com/googleplay/android-developer/answer/16555673
