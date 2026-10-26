# Port a React Native — traspaso "3.6 Gamificación + onboarding" (2026-10-26)

Para arrancar la **3.6** en una conversación nueva. La 3.5 Perfil + cierres quedó COMPLETA el 2026-10-23
(ver el resumen en el tablero). Fuente de verdad: el tablero [`../plan-port-react-native.md`](../plan-port-react-native.md)
(ítem 6 de la Fase 3: "Gamificación (medallas, rachas, retos) + onboarding" y la **3.6.x**), la memoria
`port_react_native.md`, el inventario [`inventario-pantallas.md`](inventario-pantallas.md) §1 (onboarding) y los
traspasos anteriores (reglas y gotchas iOS 26 en [`handoff-perfil-2026-10-15.md`](handoff-perfil-2026-10-15.md),
cierre en [`handoff-cierre-2026-10-22.md`](handoff-cierre-2026-10-22.md)).

## 0. Reglas (no cambian)

- 🔥 Regla de oro: jamás poner en riesgo la base ni la PWA. Cero código PWA (solo lectura como espec), cero
  DDL/RLS. Backend solo ADITIVO, detrás de interruptor por env var, con propuesta aparte + rollback + OK de Beto
  (como `/api/chat-message`, `/api/cierre-semana`, `/api/plan-generate`). Escrituras de QA solo en la cuenta de
  Beto (`beto131312@gmail.com`, `usuarios.id` `5716a081-2c4d-4eab-be06-98006c271e06`, auth
  `7c308e20-a63d-42d5-8df3-2bf700f1bf15`) o `+light` (`e2e10f8c-7633-42a4-9a25-f9facfd41858`), por SQL siempre con OK.
- Protocolo por tarea: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone (Expo Go) →
  verificar en Supabase (`vmvhlgzwufkardaruutt`) → corregir → tildar → commit → memoria. Siempre en español rioplatense.
- Repos: nativa `C:\Users\BETO\Desktop\coachai-native` (push `origin HEAD:main`, NUNCA `git add -A`, commits con
  heredoc `git commit -F -`); PWA `C:\Users\BETO\Desktop\coachai` (docs en `docs/`; en worktree:
  `git fetch origin main && git merge --ff-only origin/main` antes, `git push origin HEAD:main` después).
- Motor: Opus 5.5 para pantallas; Fable para backend nuevo y paridad fina (Beto cambia el selector).

## 1. Qué hay que hacer en la 3.6 (propuesta de partición — confirmarla con Beto en el primer brief)

1. **3.6.a Onboarding clásico (pantallas)** — Opus. PWA L16779–17214 (`onb-viewport`, `onbNextOrLaunch`,
   `prevPanel`), 11 paneles en 5 pasos (inventario §1): datos · objetivo · nivel · actividad · días + lugar ·
   lesiones · dieta + no-me-gusta · comidas/día · alergias · resumen · fotos de inicio opcionales (ya existe
   `/fotos-inicio` y `subirFoto`). Guarda con la misma escritura que `saveProfileToSupabase` L20162 (OJO RLS:
   columnas de `usuarios` con grant de update por columna). Se entra desde `proceedAfterAuth` L21626 cuando el
   perfil está incompleto: hoy la nativa no tiene esa rama (solo login de cuentas existentes).
   Onboarding King: método DISCONTINUADO → no se porta salvo que Beto diga lo contrario.
2. **3.6.x Primeros planes en el servidor** — Fable (backend). Sumar `accion: 'primeros'` (o `motivo:
   'onboarding'`) a `/api/plan-generate`: port de `startPlanPrefetch` L21088 + `prefetchPlan` L20995 para
   rutina Y dieta (dieta: `dietaHasMacros`, clamp contra `computeDietTarget`, `reconcileDietKcal`, alertas Tower
   como en `chat-message`), guard de migradas (`get_my_migration` / `beta_invitados.pre_*`: si es migrada NO
   genera), `nativeFirstPlansFlow` L21238 / `autoGenerateFirstPlans` L20752 y la bienvenida
   `buildPlanesReadyNotification` L21345. Con propuesta de backend + OK. **Ojo tiempo:** rutina + dieta pueden
   pasar los 60 s de la función → dos llamadas separadas desde la nativa (una por tipo), cada una con el
   presupuesto de tiempo que ya usa `renovar`.
3. **3.6.b Overlay "Preparando tu plan"** — Opus. Port de `showPlanLoadingOverlay` L21147 (frases rotativas,
   timeout de seguridad) mientras corren las dos llamadas; la usuaria entra con dieta + rutina cargadas.
   NUNCA se piden planes por chat (decisión Beto 2026-10-14).
4. **3.6.c Gamificación** — Opus. Pestaña Logros del Perfil (hoy vacía): 17 medallas (memoria
   `gamificacion_logros`), rachas (ya hay `computeStreaks`), celebración de logros con `celebrado=false` (el cierre
   del servidor ya otorga `primer_cierre` / `semana_perfecta_N` sin celebrar). Retos mensuales: gated en la PWA
   (`?reto=1`, memoria `reto_mensual_feature`) → confirmar con Beto si entran.

Al final: tildar el ítem 6 de la Fase 3 y actualizar la memoria.

## 2. Lo que ya existe y se reusa

- `/api/plan-generate` (`api/plan-generate.js`): `elegible` + `renovar`, con `cargarContextoPlan` y
  `actualizarPreferenciasRutina` en `_chat-contexto.js`, test `npm run test:plan-generate` (52 OK). Prendido con
  `PLAN_GENERATE_ENABLED=1` + `PLAN_GENERATE_ALLOW` = auth uid de Beto (+ `es_interno`).
- Nativa: `lib/api.ts postPlanGenerate`, `features/entreno/renovacion.ts` (hooks), `src/app/renovar-rutina.tsx`
  (wizard de días/foco reutilizable para el onboarding), `features/perfil/gate-cierre.tsx` (`TarjetaGate`,
  `useGateCierreEstado`), `features/perfil/fotos.ts` (`subirFoto`), `components/ui` (13 piezas).

## 3. Cómo levantar

Desde la raíz de coachai-native: `npx.cmd expo start --tunnel`. En esta última sesión `run_in_terminal` rechazó
el cwd de coachai-native → se levantó con Bash `run_in_background` y log al scratchpad. Si ya hay Metro en el
8081 (`curl http://localhost:8081/status`) reusalo; túnel `exp://fgxvw0m-betogn-8081.exp.direct` (verificar con
`curl https://fgxvw0m-betogn-8081.exp.direct/status`); QR en `.expo/qr.png` → SendUserFile. Las rutas nuevas
recién tipan (`tsc`) con Metro corriendo (typed routes). Chequeos antes de QA: `npx tsc --noEmit` ·
`npx.cmd expo lint` · `npm run paridad` + `paridad:dieta|espejo|estimar|home|chat|perfil|semanas`. Backend:
`npm run test:plan-generate`, `test:cierre-semana`, `test:chat-message`.

## 4. Gotchas nuevos (3.5.e–g)

- **Worktree de Windows + CRLF**: la copia de `api/_chat-cerebro.js` en un worktree sale con CRLF → la
  comparación exacta "generado == archivo" de `test:chat-message` / `test:cierre-semana` falla SOLO ahí (en main
  está idéntico). `test-plan-generate` compara sin CRLF.
- `maxDuration` de las funciones: quedarse en 60 (un valor que el plan de Vercel no permita rompe el deploy de
  TODA la PWA); usar presupuesto de tiempo dentro de la función.
- Para QA de flujos "de clienta nueva" sin cuenta descartable: preparar `+light` por SQL (receta en la memoria:
  `self_serve`, cierres con `stats.qa`, planes con `origen`), respaldo en `coachai-native/scripts/*.local.json`
  y restaurar al final. La 3.6 puede necesitar una cuenta realmente nueva (onboarding desde cero): crear cuentas
  NO lo hace Claude → Beto se registra él mismo, o se resetea `+light` con su OK.
- Gates (`Modal`): navegar recién en `onDismiss` (un Modal no reemplaza a otro en iOS).
- `delete-account` del servidor NO cancela Stripe (la nativa sí lo hace antes); el hueco sigue en la PWA.
- La línea de encabezado de una rutina generada puede copiar los días de la rutina vieja (texto de la IA, igual
  en la PWA); los días reales salen de `usuarios.dias_entreno`.
