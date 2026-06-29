# Runbook del CUTOVER de Auth (activar el candado RLS en prod)

Estado al 2026-06-29: **TODO construido, probado y gateado por `?authotp=1`**. Prod
sigue permisivo. Este runbook es la guía para el "flip" — el único paso pendiente.

## ⚠️ Impacto (leer antes)
Al activar el candado, **todas las clientas con sesión vieja (legacy) quedan deslogueadas**
y tienen que **volver a entrar con un código por email** (una sola vez; después la
sesión OTP persiste). → Hacerlo en **ventana de poco tráfico** y, idealmente, avisarle
a Jesús. Es ~5 min de ejecución.

## Pre-flight (chequear antes)
- [ ] Resend manda los códigos OK (confirmado: Beto entró por OTP a app + Studio).
- [ ] Admin de King con mail real: `beto131312+king@gmail.com` (✅ hecho).
- [ ] `docs/auth-fase-c-rls.sql` (migración) y `docs/auth-fase-c-rollback.sql` (revert) a mano.
- [ ] Tener abierto el panel de Supabase + el deploy de Vercel.

## Pasos del flip (en ORDEN)
1. **App + Studio en modo OTP permanente.** Cambiar el gate de query-param a `true`:
   - `index.html`: `AUTH_OTP_ENABLED` → leer un flag persistente o setear `= true`.
   - `studio/index.html`: idem (`const AUTH_OTP_ENABLED = true`).
   - `node scripts/bump-version.mjs "auth: cutover — OTP permanente"` + commit + push.
   - Esperar deploy LIVE. (En este punto el login nuevo corre, pero el RLS sigue
     permisivo → todo funciona; las sesiones legacy aún andan hasta el paso 2.)
2. **Aplicar el candado.** Correr `docs/auth-fase-c-rls.sql` (swap permisivo→restrictivo
   + column-grant + helpers). Desde acá el RLS enforce.
3. **Verificar EN VIVO (5 min):**
   - [ ] Clienta existente: `coachaipro.ai/?authotp=1` (o King) → email → código → entra y ve SUS datos (dieta/rutina/diario/cierres).
   - [ ] Coach: app → /studio → ve SUS clientas, responde un mensaje, edita un plan.
   - [ ] Una clienta NO ve datos de otra (spot-check).
   - [ ] Registro nuevo (invitada) + trial de stores → crean cuenta OK.
4. **Si algo se rompe → ROLLBACK YA:** correr `docs/auth-fase-c-rollback.sql` + revertir
   el deploy de la app (volver `AUTH_OTP_ENABLED` al gate `?authotp=1`). Diagnosticar
   con calma con el candado apagado.

## Post-flip (limpieza, sin apuro)
- [ ] Dropear las funciones legacy de 2 args: `studio_delete_client(text,text)`.
- [ ] Cerrar el caveat de `shouldCreateUser:true` (RPC de elegibilidad pre-send) si se ve abuso.
- [ ] Sacar el `?authotp=1` de las URLs de prueba / docs.
- [ ] **Fotos a bucket privado** (deferido): migrar `progress-photos` a privado +
      render con signed URLs (10+ spots en app + Studio). Endurecimiento, no bloqueante.

## RPCs que el cutover usa (todos ya en prod, aditivos)
`auth_resolve_session`, `auth_login_context`, `coach_list_invites`,
`coach_invite_client`, `get_my_migration`, `clear_my_migration`,
`studio_delete_client(text)` (1 arg). Los helpers (`app_current_uid/tenant/is_coach`)
los crea `auth-fase-c-rls.sql`.
