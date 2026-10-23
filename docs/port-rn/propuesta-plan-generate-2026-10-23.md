# Propuesta de backend — `/api/plan-generate` (3.5.f renovación de rutina) — 2026-10-23

Estado: **BORRADOR, esperando OK de Beto.** No se tocó ninguna línea del servidor.

## Por qué

La renovación cada 4 semanas de la PWA (`maybeOfferRenovacion` L31273 → wizard → `renovGenerate` L31381)
genera la rutina **en el cliente**: arma el system prompt, llama a `/api/chat` y guarda en
`planes_semanales` con `prefetchPlan` L20995. La nativa no tiene el cerebro (B3 = opción B: el cerebro vive
en el servidor), así que necesita un endpoint que haga eso del lado del servidor. Es el mismo que va a
usar el onboarding nativo (3.6.x) para los planes iniciales; por eso el nombre es genérico. **Hoy solo
se habilita `motivo: 'renovacion'` + `tipo: 'rutina'`.**

## Qué es (ADITIVO, mismo patrón que `/api/chat-message` y `/api/cierre-semana`)

- Archivo nuevo `api/plan-generate.js`. No modifica `/api/chat`, `/api/chat-message`, `/api/cierre-semana`
  ni la PWA. Reusa `api/_chat-cerebro.js` (generado desde index.html; ya trae `buildSystemPrompt`,
  `_focoPromptBlock`, `planReplyHasStructure`, `validarRutinaEsqueleto`, `evaluatePlanQuality`,
  `computeDietTarget`) y de `api/_chat-contexto.js`: `cargarContexto`, `getBackupPlan`, `guardarPlan`,
  `registrarEvento`. El reformateo (`NORMALIZAR`/`normalizarPlanIA`) se mueve de `chat-message.js` a un
  helper compartido **sin cambiar su texto** (el test de chat-message lo sigue verificando byte a byte).
- Interruptores (rollback sin deploy): `PLAN_GENERATE_ENABLED=1` (si no, 404) y `PLAN_GENERATE_ALLOW`
  = allowlist de auth uid (+ `usuarios.es_interno`), como los otros dos.
- Auth: Bearer de Supabase obligatorio (sin token → 401); Origin con la misma regla (`isAllowedOrigin`).

## Contrato

`POST /api/plan-generate` con Bearer:

1. `{ accion: 'elegible', fecha }` → `{ elegible: boolean, semana: number | null, dias_actuales: string[] }`.
   Sin IA ni escrituras. La nativa lo pregunta antes de mostrar la oferta: **el servidor es la única
   verdad** de quién puede renovar (la nativa no necesita `self_serve` ni `metodo_king`).
2. `{ accion: 'renovar', fecha, semana_num, dias: ['lun',…], foco: 'gluteos'|'superior'|'fullbody'|'brazos'|'ninguno' }`
   → `{ ok: true, plan: { id, semana_iso, fecha_entrega }, fuente: 'ia' | 'ia_fuera_esqueleto' | 'plantilla', used }`.

Elegible (= `_renovElegible` L31262 + la cadencia de `maybeOfferRenovacion`, ahora **chequeado en el
servidor**): `role` user · no es el revisor · `self_serve === true` o `metodo_king === true` · rutina vigente
**no cerrada** con `origen = 'ia'` (el toque del coach gana: `origen='coach'` nunca se pisa) · último cierre
con `semana_num ≥ 4` y `% 4 === 0` · y en `renovar`, `semana_num` = ese último cierre. Si no → `409 no_elegible`.

## Qué hace `renovar` (port de `renovGenerate` + `prefetchPlan('rutina')`)

1. Valida `dias` (1–7, sin repetidos, de `lun…dom`) y `foco` (lista cerrada; `ninguno` → null).
2. Tope diario ANTES de gastar (`chat_uso_incrementa`, mismo contador que el chat; cada llamada real a la
   IA descuenta, como en la PWA que pasa todo por `/api/chat`).
3. Guarda `usuarios.dias_entreno` + `usuarios.foco_entreno` (solo esas 2 columnas, service key) — la PWA
   lo hace desde el cliente antes de generar; acá el server lo hace y recarga el contexto, así el prompt
   lee los días y el foco nuevos. Las lesiones salen de `usuarios.lesiones` (el "rehidratar chips" de la
   PWA viene gratis).
4. Hasta 2 intentos de Haiku con `buildSystemPrompt()` y el mensaje "💪 Rutina de la semana": estructura →
   esqueleto de Jesús (`validarRutinaEsqueleto` con sexo + días nuevos) → si no, un pase de reformateo →
   si ninguna cumple el esqueleto, la primera que parseó (`rutina_fuera_esqueleto`).
5. Vara de calidad `evaluatePlanQuality('rutina', …, { expectedDays: días nuevos, noChest: mujer })` → si
   falla o no hubo plan, **plantilla de Jesús** (`getBackupPlan('rutina', target, usuario, días)`).
6. Guarda con `guardarPlan` (upsert `usuario_id,tipo,semana_iso` = pisa el CLON de esta semana, nunca deja
   a nadie sin rutina): `semana_iso` = semana ISO de hoy, **`fecha_entrega` = último `fecha_fin` + 1 si el
   cierre terminó hoy o después, si no hoy** (regla de `renovGenerate` L31415: si no, nace cerrada y el clon
   la pisa), `origen = 'ia'`.
7. Eventos en `beta_eventos` con `app: 'native'`: `renov_new`, `renov_ok` / `renov_fail`,
   `plan_quality_fallback`, `rutina_fuera_esqueleto` (los mismos nombres que la PWA → Tower los ve igual).

Si la IA falla del todo y no hay plantilla → `500` y **la rutina vieja queda** (no se escribió nada salvo
días/foco, igual que la PWA). Las preferencias guardadas se mantienen (PWA idéntico).

## Costo y tiempo

1–3 llamadas Haiku por renovación (típico 1), una vez cada 4 semanas por clienta self-serve. **Punto a
mirar:** la PWA estira su espera a 90 s porque 2 intentos + reformateo pueden pasar los 60 s. Propongo
`maxDuration: 90` para esta función (si el plan de Vercel no lo permite, bajo a 1 intento + reformateo y
plantilla, que entra en 60 s).

## Tests (antes de deploy)

`npm run test:plan-generate` offline: (a) el prompt del server con días/foco nuevos == `buildSystemPrompt`
de la PWA byte a byte (mismo arnés que `test:chat-message`); (b) handler con `fetch` falso: los 7 casos de
elegibilidad, validación de días/foco, regla de `fecha_entrega`, esqueleto OK / fuera / plantilla, IA caída
→ 500 sin tocar el plan; (c) `test:chat-message` y `test:cierre-semana` siguen verdes.

## QA real (con tu OK para cada escritura)

- Negativo sin escrituras: tu cuenta → `elegible: false` (tu rutina es `origen='coach'`).
- Positivo en la cuenta `+light`: preparar por SQL un cierre semana 4 + rutina vigente `origen='ia'`
  (respaldo antes, restaurar después) → renovar desde el iPhone → verificar fila en `planes_semanales`,
  días/foco en `usuarios`, eventos, y que la PWA la muestra igual.

## Rollback

Sacar `PLAN_GENERATE_ENABLED` (404 al instante, la nativa no ofrece nada) o revertir el commit. La PWA no
depende de este archivo.

## La parte nativa (después del OK y del server)

Gate "¿Renovamos tu rutina?" que aparece cuando el gate del cierre ya no está (Inicio/Entreno/Perfil, una
vez por checkpoint, clave `cai_renov_visto_<uid>_<semana>` como la PWA) → hoja con el wizard: días (chips
L–D) → foco (5 opciones) → resumen → "Generar mi nueva rutina" con espera de hasta 90 s → toast + ir a
Entreno. Motor: Opus para la pantalla.
