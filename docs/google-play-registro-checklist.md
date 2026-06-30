# Checklist — Registro en Google Play como ORGANIZACIÓN (al 2026-06-30)

Para registrar CoachAI Pro bajo la **empresa de Jesús (EEUU)** = cuenta de **organización**.
Verificado contra páginas oficiales de Google Play Console (jun 2026).

---

## 🎉 La gran ventaja de la cuenta de organización
**Está EXENTA del test de 12 testers / 14 días** (eso es solo para cuentas personales).
→ Con la empresa vas **directo a producción**: más rápido, más profesional (la empresa como
"seller" en la tienda) y con **escudo de responsabilidad legal**.

## ⚠️ Lo ÚNICO que podría demorar: el número D-U-N-S
La cuenta de organización **exige un D-U-N-S** (identificador de 9 dígitos de Dun & Bradstreet,
gratis, con el que Google verifica la empresa).
- **Si la empresa de Jesús YA tiene D-U-N-S → instantáneo** (las empresas de EEUU que facturan/tienen crédito comercial casi siempre ya lo tienen).
- **Si NO lo tiene → pedirlo puede tardar hasta 30 días (a veces 4-8 semanas).**
- **ACCIÓN #1, HACER YA:** que Jesús **busque la empresa en el sitio oficial de Dun & Bradstreet** para ver si ya tiene D-U-N-S. Si no, pedirlo gratis **hoy** (es lo único en el camino crítico que depende de un tercero).
- *(Si la región no soporta D&B, Google ofrece un método alternativo de verificación — no aplica a EEUU.)*

> ⚠️ **Flag, no freno:** registrar bajo la empresa de Jesús ata la app legalmente a esa empresa.
> Como son equipo, está bien — solo sean **deliberados** con la propiedad/acuerdo (es parte del
> "trámite de sociedad" que formalizan después; usar la empresa de Jesús ahora es pragmático).

---

## 📋 Para REGISTRAR la cuenta de organización — tené listo
- [ ] **D-U-N-S** de la empresa (ver arriba — verificar/pedir YA).
- [ ] **Cuenta de Google (Gmail)** con **verificación en 2 pasos ACTIVADA**.
- [ ] **Tarjeta** para los **USD 25** (pago único, no anual).
- [ ] **Nombre legal de la empresa** + **dirección** → deben **coincidir con los registros del D-U-N-S** (si no coinciden → rechazo).
- [ ] **Sitio web** de la organización (Google lo pide/recomienda para org).
- [ ] **Email de contacto + teléfono** de la empresa (Google manda código a cada uno → verificar y mantener operativos).
- [ ] **Email de desarrollador** (se muestra público) → usá el de **soporte** (`support.coachaipro@gmail.com`).
- [ ] **Developer name** que se muestra en la tienda: **"CoachAI Pro"**.
- [ ] **Verificación de identidad de la persona** que crea/gestiona la cuenta (el representante autorizado): documento con foto. (La org se verifica con D-U-N-S; la persona, con su ID.)

## 📱 Para que APRUEBEN la app (cuando la subas) — igual que antes
- [ ] **Target API 36 (Android 16)** — obligatorio para apps nuevas (desde 31-ago-2026). El wrapper (Bubblewrap/PWABuilder) debe targetearlo → usar versión actualizada.
- [ ] **Formulario "Data safety"** → declarar datos (email, fotos, **salud/fitness**: peso/medidas), uso, con quién se comparten, cómo se protegen, + link a **política de privacidad** (ya está).
- [ ] **Content rating** (cuestionario).
- [ ] **Target audience + ads** (declarar público; declarar que NO hay ads).
- [ ] **App access (acceso del revisor):** el login es por **código OTP** → el revisor NO puede recibirlo. **Solución: indicarle que use "Ingresar como invitado"** (`?stores=1` → trial) — entra sin login y revisa todo. **Anotar esto en las instrucciones de App access** (evita un rechazo seguro).
- [ ] **Privacy policy URL** pública (ya: `coachaipro.ai/privacidad.html`).
- [ ] **Screenshots** + ícono 512 + **feature graphic 1024×500** (lo de Juli).

## 🏥 Específico de apps de SALUD/FITNESS (clave para NO rebotar)
- [ ] **Disclaimer en la DESCRIPCIÓN de la tienda** (no solo en Términos): *"CoachAI Pro no es un dispositivo médico y no diagnostica, trata, cura ni previene ninguna condición médica. Consultá a un profesional."* Google lo exige para salud/fitness.
- [ ] Nada de promesas médicas/exageradas en el listing ni en las screenshots.

## 🗺️ Orden sugerido
1. **HOY:** Jesús verifica/pide el **D-U-N-S** (es lo único que depende de un tercero).
2. Con D-U-N-S listo → **crear la cuenta de organización** ($25 + datos de la empresa + verificación).
3. **El wrapper de Android** (build target API 36) + completar Data safety, content rating, screenshots, descripción con disclaimer.
4. Subir a producción (org NO necesita el test de 14 días) → revisión ~7 días o menos.

> **Sin el muro de los 12 testers**, el cuello de botella pasa a ser el **D-U-N-S** (si hay que
> pedirlo) — por eso es la acción #1 de hoy.

## Plan B (si el D-U-N-S se complica mucho)
Registrar **personal** (rápido, sin D-U-N-S) PERO con el **test de 12 testers / 14 días** antes
de producción (clientas de King + familiares/amigos del equipo con **Android**). Migrar a la
empresa después vía **App Transfer**. Solo si la empresa no puede dar D-U-N-S a tiempo.

## Fuentes (oficiales Google Play Console, jun 2026)
- Tipos de cuenta / D-U-N-S: support.google.com/googleplay/android-developer/answer/13634885 y answer/13628312
- Test 12 testers (solo personal): support.google.com/googleplay/android-developer/answer/14151465
- Verificación de identidad: support.google.com/googleplay/android-developer/answer/10841920
- Target API level: support.google.com/googleplay/android-developer/answer/11926878
- Data safety: support.google.com/googleplay/android-developer/answer/10787469
- Health content: support.google.com/googleplay/android-developer/answer/16555673
