# HANDOFF — Tema claro default (violeta) + Onboarding rediseñado (2026-07-08 → 2026-07-13)

> Contexto para retomar en cualquier conversación. Todo lo descrito acá está **LIVE en producción** (`coachaipro.ai`), verificado en prod por Beto (iPhone + Android) y por QA automatizado. Repo: `C:\Users\BETO\Desktop\coachai`, deploy = push directo a `main` (Vercel). **SIEMPRE `node scripts/bump-version.mjs` antes de cada deploy** o la PWA sirve caché vieja.

## 1) Qué se hizo (resumen ejecutivo)

**A. Onboarding del King clásico con el look "ko" (2026-07-08).** El onboarding CLÁSICO del tenant King (clientas que compran la app SIN el Método) tomó la estética del onboarding del Método King (`ko-*`): full-screen sin cards sobre crema, títulos en frase natural, chips apilados full-width sin emojis, botón circular de tinta "›", barra de progreso continua de 4px que avanza por unidad (11 paneles + 2 láminas = 13 ticks) y NO desaparece sobre las láminas, 2 interstitials a pantalla completa reusando fotos existentes. **El motor NO se tocó** (`nextPanel`/`validateStep`/`launchCoach`/fotos/prefetch intactos) — es capa visual + copy inyectado por JS.

**B. Tema claro violeta = NUEVO DEFAULT (2026-07-13).** El tenant default pasó de oscuro a **blanco/violeta** en toda la app, reusando el molde del theme-king: un script (`scripts/gen-theme-light.mjs`) parseó las **482 reglas `body.theme-king`** dispersas en el CSS y emitió gemelas `body.theme-light` con coral→violeta (`#FF4F7B→#7c6aff`, `#FF6B95→#9d8dff`, `#E03A6F→#5a48e0`, rgba equivalentes, cremas→blanco-violeta). El onboarding ko-look quedó incluido para el default (con foto de HOMBRE propia en la lámina 1). Tras QA de Beto se hizo **el switch final**: `coachaipro.ai` arranca claro **sin flag**.

## 2) Arquitectura clave (para no romper nada)

- **`body.theme-light`** = la clase del tema claro. Sus ~490 reglas viven en `index.html` en 2 bloques: uno a mano ("DEFAULT LIGHT THEME · ETAPA 1", ~línea 196) y el generado ("reglas generadas desde theme-king", justo antes del bloque KING). El **dark viejo sigue completo** (es el estado sin clase) — no borrar.
- **Boot del tema** (IIFE ~línea 14050): `applyLightDefault()` agrega `theme-light` + pinta `<meta theme-color>` a `#FAFAFF` **solo en los caminos default** (sin tenant de marca). King entra por hostname `king.*` / `?tenant=jesus` → `theme-king`, jamás pasa por ahí.
- **`?light=0`** = interruptor de emergencia persistido (localStorage `coachai_theme_light='0'`) → vuelve al dark viejo. `?light=1` re-enciende. Sin flag = claro.
- **Anti-mezcla:** aplicar un tema de marca (`applySyncTenantTheme`, `applyTenantBranding` con `bodyClass`) **remueve** `theme-light`; la rama de limpieza del default lo **repone** (switches de tenant en caliente).
- **Los `@keyframes` NO se scopean por tema** — gotcha real: reglas light que apuntaban a keyframes King (`landingIconGlowKING`, `typingPulseKing`) colaban coral. El generador ahora los renombra (`landingIconGlow`, `typingPulseLight`).
- **Gates JS del onboarding ko-look** (corren bajo `theme-king` O `theme-light`): `initOnboardingPanels` (→ `wrapKingSelects` + `kobApplyCopy` + precarga de fotos), `nextPanel` (→ `kobShowInter`), `updateOnboardingChrome` (→ `--kob-prog`).
- **Copy del onboarding**: `KOB_COPY` (bilingüe) inyectado por `kobApplyCopy()` SOLO bajo esos temas, con `kobRestoreCopy()` de vuelta — el markup base queda intacto para el dark viejo.
- **Interstitials**: overlay `#kob-inter` reusa clases `.ko-inter`. Lámina A por tema: claro = `/tenants/default/onb-a.jpg` (hombre), King = `/tenants/jesus/king-onb-a.jpg` (mujer). Lámina C compartida (`king-onb-c.jpg`). Frases: A = "El único mal entrenamiento es el que va sin dirección." / C = "Los resultados aman la constancia." (King clásico) — el Método King usa su propio onboarding aparte (`#king-onb`), NO este.
- **`manifest.json`** (default): splash/theme a claro `#FAFAFF`. El de King (`manifest-jesus.json`) intacto.
- **Story de compartir logro** (`drawShareCanvas`): eyebrow "★ fecha" theme-aware — violeta `#B4A7FF` bajo theme-light, rosa `#FF8AA6` para King/dark.
- **Modal "Instalar en iPhone"**: bajo theme-light los chips numerados y "Entendido" van en gradiente violeta (la base usa `--accent2` coral-rojo, que se MANTIENE como color de errores — no cambiarlo global).

## 3) Herramientas / flags de QA

- **`?onbdemo=1`** — abre el onboarding clásico SIN login (demo visual; el botón final no genera planes). Tema según contexto: default → claro violeta; contexto King (`king.*` o `?tenant=jesus`) → King crema; `&light=0` → fuerza dark viejo.
- **`?kingonbdemo=1`** — demo del onboarding del MÉTODO King (otro componente).
- **Regenerar el tema claro si King cambia**: quitar el bloque generado del index y re-correr `scripts/gen-theme-light.mjs` (escribe `scripts/theme-light-generated.css` para inspección; la inserción es manual/script aparte). El script valida: 0 residuo coral, llaves balanceadas.
- **Cuentas de prueba** (resetear = borrar actividad en 19 tablas + perfil a NULL + `created_at=now()` — ver memoria `reset_cuenta_prueba_beto`):
  - `beto131312@gmail.com` → King clásico (tenant jesus, `metodo_king=false`, id `5716a081-2c4d-4eab-be06-98006c271e06`)
  - `beto131312+light@gmail.com` → tenant default (id `e2e10f8c-7633-42a4-9a25-f9facfd41858`)
  - `beto131312+king@gmail.com` → ADMIN (¡cae en pantalla de admin, no en onboarding!)

## 4) Fixes notables del camino (por si reaparecen síntomas)

- **Header (logo COACHAI PRO) sobre el onboarding**: `proceedAfterAuth` lo prende inline ANTES del onboarding → oculto vía `:has(.form-wrapper[style*="block"]) #main-header{display:none!important}` (stylesheet !important le gana al inline); reaparece solo al entrar a la app.
- **Rayita blanca entre barra de progreso y lámina**: era el `border-bottom` de `.progress-bar-container` (casi blanco en claro) → `border:none`.
- **Flash de degradado en la 1ª lámina**: precarga de las fotos en `initOnboardingPanels` (theme-aware).
- **Tap-highlight azul en Android**: `-webkit-tap-highlight-color:transparent` en el onboarding + interstitial.
- **Texto de cards corrido a la derecha**: la base vuelve las cards objetivo/nivel grid `44px 1fr` (columna del emoji); con emoji oculto quedaba el hueco → `display:block`.
- **Overlay de carga post-onboarding "no aparece"**: es DISEÑO — el prefetch arranca al entrar al resumen; si la persona tarda, los planes ya están listos y entra directo. Solo aparece si siguen generándose.

## 5) Pendientes conocidos

- **Mail OTP rosa** (plantilla de Supabase Auth, UNA para todos los tenants): Beto lo difirió. Plantilla neutra LISTA en `docs/otp-email-neutral.html` + instrucciones adentro (Dashboard → Authentication → Email Templates → pegar en "Magic Link" **y** "Confirm signup", asunto sugerido `Tu código de acceso: {{ .Token }}`).
- **Stores funnel (`?stores=1`)** sin QA bajo el tema claro (está flag-gated, nadie lo ve) — revisar al retomar stores.
- Lámina C compartida usa foto de mujer — si Beto quiere versión masculina para default, enchufar igual que la A.

## 6) Commits principales (main)

`7dd4163` reskin onboarding King clásico · `ff55a0f` header + flash láminas · `598718d` "(APROX.)" en Mi Alimentación · `d87d789` copia King→violeta (482 reglas) · `8bc6a42` onbdemo tema-aware · `4140916` caza de rosas (glow/modal/story/typing) · `4abb12e` lámina A hombre · `d191251` **SWITCH: claro = default**.
