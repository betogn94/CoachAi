# Propuesta de backend — primeros planes en el servidor (3.6.x) — 2026-10-26

Estado: **BORRADOR, esperando OK de Beto.** No se tocó ninguna línea del servidor.

## Por qué

Hoy una clienta nueva de la nativa termina el onboarding (3.6.a) y **entra sin planes**. En la PWA los
primeros planes se generan **en el cliente** mientras está en el resumen (`startPlanPrefetch` L21088 →
`prefetchPlan` L20995 para rutina y dieta en paralelo), con `launchCoach` tapando con "Preparando tu plan"
hasta que están (`nativeFirstPlansFlow` L21238), y antes de eso migra los planes precargados por el coach
(`migrateClientPreloadedPlans` L24448). La nativa no tiene el cerebro (B3): todo eso tiene que correr en
el servidor. Decisión de Beto (2026-10-14): la clienta entra con dieta + rutina ya cargadas y **nunca** las
pide por chat.

## Qué es (ADITIVO, sobre `/api/plan-generate` que ya existe)

- Dos acciones nuevas en `api/plan-generate.js`. **No se toca** `/api/chat`, `/api/chat-message`,
  `/api/cierre-semana` ni la PWA. Mismos interruptores que hoy (`PLAN_GENERATE_ENABLED` + allowlist
  `PLAN_GENERATE_ALLOW` + `usuarios.es_interno`), misma auth (Bearer + Origin), mismo `maxDuration: 60` con
  presupuesto de tiempo (28 s para arrancar otra llamada, 55 s total).
- Reusa el cerebro generado (`buildSystemPrompt`, `planReplyHasStructure`, `validarRutinaEsqueleto`,
  `dietaHasMacros`, `evaluatePlanQuality`, `computeDietTarget`, `reconcileDietKcal`,
  `validateDietaConsistency`) y los helpers de `_chat-contexto.js` (`cargarContextoPlan`, `getBackupPlan`,
  `guardarPlan`, `guardarAlertasDieta`, `registrarEvento`) + `NORMALIZAR` de chat-message.
- **La acción `renovar` queda como está.** El loop de la rutina (intentos → esqueleto → reformateo → vara →
  plantilla) se saca a una función compartida `generarPlanIA(tipo, …)` que usan `renovar` y `primeros`: una
  sola verdad de las reglas de calidad. Guardia: `npm run test:plan-generate` (52 chequeos de hoy) tiene
  que seguir verde sin tocar un caso.

## Contrato

`POST /api/plan-generate` con Bearer:

### 1. `{ accion: 'primeros_estado', fecha, lang }` — rápido, sin IA

Qué hace, en orden:
1. Guardas: `role === 'user'` (coaches/admins no, como `startPlanPrefetch` L21091) · no es el revisor ·
   **perfil completo** (objetivo/nivel/peso/altura/edad/sexo, el gate de `proceedAfterAuth`) → si no,
   `409 perfil_incompleto`.
2. **Migración de precargadas** (port de `migrateClientPreloadedPlans`): lee `beta_invitados` por email con
   la service key (equivale al RPC `get_my_migration`); si hay `pre_rutina`/`pre_dieta` → inserta en
   `planes_semanales` con `origen='coach'`, `semana_iso` de hoy, `fecha_entrega` hoy (**ignoreDuplicates**
   sobre `usuario_id,tipo,semana_iso`: idempotente si se llama dos veces), valida la dieta migrada en
   `dieta_consistency_alerts` con `source='migration'`, limpia `pre_*` (= `clear_my_migration`) y registra
   `client_migrated { from }`.
3. Responde `{ faltan: ('rutina'|'dieta')[], migrada: string|null }` — `faltan` = tipos **sin plan
   vigente** (sin fila o cerrado, la regla de `has(t)` L21117). Migrada con los dos planes → `faltan: []`.

### 2. `{ accion: 'primeros', tipo: 'rutina'|'dieta', fecha, lang }` — genera UN plan

Port de `prefetchPlan(tipo)` L20995, una llamada por tipo (la nativa dispara las dos **en paralelo**, cada
una con sus 60 s; así no pasamos el tope de la función, que es el problema que señala el traspaso).

1. Mismas guardas que `primeros_estado` + **candado**: si el tipo ya tiene plan vigente → `200
   { ok: true, ya_existia: true }` sin gastar IA (reintentos y doble tap son gratis; un plan del coach
   nunca se pisa).
2. Tope diario antes de gastar (`chat_uso_incrementa`; cada llamada real descuenta), igual que `renovar`.
3. Prompt = `buildSystemPrompt()` con el contexto de la base. **Paridad con el onboarding de la PWA:** la
   PWA arma el prompt leyendo el formulario (chips de lesiones/dieta/alergias, comidas, días, lugar
   `gimnasio_completo` por default); el servidor lo arma desde las columnas que la 3.6.a ahora guarda
   (`lesiones`, `restricciones_dieta`, `alergias`, `comidas_dia`, `dias_entreno`) → **byte a byte igual**
   (lo verifica el test offline, punto 2). Mensaje: "💪 Rutina de la semana" / "🥗 Dieta de la semana".
4. Generación (hasta 2 intentos, `generarPlanIA`):
   - **rutina**: estructura → esqueleto de Jesús (`validarRutinaEsqueleto(sexo, días)`) → sin estructura
     un pase de reformateo → si ninguna cumple el esqueleto, la primera que parseó
     (`rutina_fuera_esqueleto`). Igual que `renovar`.
   - **dieta**: válida = estructura **+ `dietaHasMacros`** (≥ 80 % de las comidas con kcal, L20833) →
     si no, reformateo → si sigue sin macros, el loop regenera.
5. Vara de calidad `evaluatePlanQuality(tipo, …, { target: Mifflin de la usuaria, expectedDays:
   `dias_entreno.length`, noChest: mujer })` → si falla o no hubo plan → **plantilla de Jesús**
   (`getBackupPlan`, dieta por kcal más cercano, rutina por días). Evento `plan_quality_fallback
   { tipo, reasons, origen: 'onboarding' }`.
6. Guardado: `guardarPlan` (upsert `usuario_id,tipo,semana_iso`), `semana_iso` y `fecha_entrega` = hoy
   (sin cierres todavía, misma regla que `saveWeeklyPlan`), `origen='ia'`. **Dieta: `reconcileDietKcal`
   antes de guardar + alertas Tower `source='ai'`** (`saveWeeklyPlan` L20465 + L20454).
7. Eventos (nombres de la PWA, `app: 'native'`): `plan_prefetch_start { tipos }`, `first_plans_autogen
   { tipos, fuente }`; nuevos solo `primeros_fail { tipo, reason }`.
8. Respuesta: `{ ok: true, tipo, fuente: 'ia'|'ia_fuera_esqueleto'|'plantilla', plan: { id, semana_iso,
   fecha_entrega }, used }`. Fallas: `503 overloaded` (429/529 de Anthropic, retryable), `429 daily_limit`,
   `500 sin_plan` (IA caída y sin plantilla: **no se escribió nada**), `500 save_failed`.

### Lo que NO hace el servidor

- **No escribe en `historial_chat`.** La bienvenida (`postNativeWelcome` / la de migradas) ya la pinta la
  nativa cuando el hilo está vacío (`coach/index.tsx` L53–59, elige la de migradas si la rutina es
  `origen='coach'`) y se persiste con el primer mensaje de la usuaria. Menos escrituras, mismo resultado.
  (Mientras la PWA conviva, una cuenta onboardeada en la nativa vería ahí el saludo genérico de la IA en
  vez de esta bienvenida: aceptable, la PWA se desactiva.)
- No toca `usuarios` (la 3.6.a ya guardó todo) ni genera para clientas con rol coach/admin.

## Costo y tiempo

2–6 llamadas Haiku por clienta nueva (típico 2–3), **una vez en la vida de la cuenta**. Igual que la PWA.
Tiempo real: la rutina de la renovación salió en ~20 s; las dos en paralelo deberían estar en 20–40 s.

## Tests (antes de deploy) — `npm run test:plan-generate` ampliado

1. Cerebro al día con index.html (ya está).
2. **Prompt del onboarding**: PWA con el formulario lleno como lo deja el onboarding (chips, comidas, días,
   lugar default, sin "no me gusta") vs servidor desde la fila de `usuarios` → idéntico byte a byte en 4
   perfiles: varón definir · mujer vegana con lesión · mujer 2 días keto · sin chips (ninguno marcado).
3. Handler con `fetch` falso: `primeros_estado` (perfil incompleto 409 · rol coach · migrada inserta
   `origen='coach'` + alertas migration + limpia `pre_*` + `faltan` correcto · segunda llamada no duplica ·
   sin nada → `faltan: ['rutina','dieta']`) · `primeros` (candado `ya_existia` · rutina esqueleto OK /
   fuera / plantilla · dieta sin macros → reformateo → con macros · dieta sin macros dos veces → plantilla ·
   `reconcileDietKcal` aplicado · alertas Tower escritas · IA 529 → 503 sin escribir · tope diario · save
   fallido).
4. Los 52 chequeos de `renovar` siguen verdes; `test:chat-message` y `test:cierre-semana` también.

## QA real (con tu OK para cada escritura; solo en `beto131312+onb1@gmail.com`)

Prep por SQL: `es_interno=true` en onb1 (así pasa la allowlist sin tocar env vars) · `objetivo=null` para
volver al onboarding · borrar sus filas de `planes_semanales` si las hubiera.
1. **Nativa nueva**: onboarding → overlay → entra con rutina + dieta. Verificar en la base: 2 filas
   `origen='ia'`, `fecha_entrega` hoy, dieta con kcal reconciliadas, alertas Tower, eventos; en la PWA se
   ven igual. Perfil → pestaña Plan los muestra.
2. **Migrada**: poner `pre_rutina`/`pre_dieta` de prueba en la invitación de onb1 + borrar planes +
   objetivo null → rehacer el onboarding → 2 filas `origen='coach'`, `pre_*` en null, **cero llamadas a la
   IA** (contador `x-chat-used` sin cambio), bienvenida de migradas en el chat.
3. **Reintento**: con un plan ya guardado, volver a llamar `primeros` → `ya_existia`, sin gasto.
4. Negativo con tu cuenta: `primeros_estado` → `faltan: []` (tenés los dos activos), nada escrito.

## Rollback

Revertir el commit (las acciones nuevas desaparecen; `renovar` vuelve a su código de hoy, cubierto por los
tests) o sacar `PLAN_GENERATE_ENABLED` (404 al instante: la nativa entra sin planes, como hoy). La PWA no
depende de este archivo.

## La parte nativa (3.6.b, Opus, después del OK y del server)

Al tocar "Comenzar con mi coach" (o "Saltar por ahora") en el onboarding: guarda el perfil (ya está) →
**overlay a pantalla completa "Preparando tu plan"** (port de `showPlanLoadingOverlay` L21147: ruedita +
frases rotando cada 2,6 s: "Calculando tus calorías y macros…", "Armando tu rutina de la semana…",
"Eligiendo tus comidas…", "Casi listo 💪") → `primeros_estado` → `primeros` en paralelo por cada tipo
de `faltan` → cuando terminan las dos (o a los **70 s**, tope de seguridad) invalida las queries de
rutina/dieta/alimentación y entra a las tabs. Si una falló: entra igual y **al próximo arranque** con slot
libre y perfil completo reintenta en silencio una vez por apertura (el `fallbackGenerateMissing` de la
PWA), sin overlay. Nunca se pide por chat.
