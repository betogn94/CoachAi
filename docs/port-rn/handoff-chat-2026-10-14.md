# Port a React Native — traspaso para la conversación "Chat / Coach IA" (2026-10-14)

Para abrir la conversación dedicada a **3.4 Chat / Coach IA** sin perder contexto. Las conversaciones
"Mi Entreno" (3.1), "Mi Alimentación" (3.2) y "Home" (3.3) quedan aparte; las tres secciones están
COMPLETAS. Fuente de verdad: el tablero [`../plan-port-react-native.md`](../plan-port-react-native.md) +
la memoria `port_react_native.md` + el traspaso general [`handoff-2026-10-13.md`](handoff-2026-10-13.md)
(cómo levantar, gotchas, decisiones visuales). Este archivo trae solo lo específico del chat.

## 0. Reglas que no se discuten

- 🔥 **REGLA DE ORO (Beto, 2026-10-13): JAMÁS poner en riesgo la base ni la PWA.** Hay clientas pagando. Desde el
  port: cero código de la PWA (solo leerla como espec), **cero cambios en `api/chat.js` ni en `api/_origin.js`**
  (ver §4: cualquier cambio de backend se propone aparte, con rollback y QA), cero DDL/RLS, escrituras de QA solo
  en la cuenta de Beto (`beto131312@gmail.com`, `usuario_id 5716a081-2c4d-4eab-be06-98006c271e06`, tenant King) y
  por SQL con OK previo. Memoria: `feedback_proteger_pwa_y_base.md`.
- **El chat es la sección más sensible al costo y al abuso**: cada mensaje es una llamada a Claude pagada por Beto,
  con tope de **120/día por usuaria** y candados de producto (un plan ACTIVO nunca se pisa desde el chat). Memorias
  `limites_chat_ia_plan.md` (las "Roxanas") y `motor_ia.md` (Haiku para todo; Sonnet descartado en planes).
- **El chat de la IA NO es el hilo con el coach humano.** Son dos cosas: Coach AI (esta tab, `/api/chat`) y las
  `notas_coach` (hilo con Jesús/el entrenador, va con Perfil en **3.5.y**). Beto lo marcó en Home (3.3.a): el aviso
  "Tu coach te escribió" nunca debe llevar al chat de la IA.
- Protocolo por tarea: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone (+ edge_logs
  de Supabase y runtime logs de Vercel) → corregir → tildar en el plan → commit. Siempre en español rioplatense.
- Metro: SIEMPRE desde la raíz de `coachai-native` (`npx.cmd expo start --tunnel`); si ya hay uno en el 8081,
  reusarlo (`curl http://localhost:8081/status`). Chequeos antes de pedir QA: `npx tsc --noEmit` ·
  `npx.cmd expo lint` · las paridades (`npm run paridad`, `paridad:dieta`, `paridad:espejo`, `paridad:estimar`,
  `paridad:home`) + la nueva del chat.

## 1. Estado al corte

| Tarea | Estado |
|---|---|
| 3.1 Mi Entreno · 3.2 Mi Alimentación · 3.3 Home | ✅ completas (2026-10-13/14) |
| **3.4 Chat / Coach IA** | ⬜ **esta conversación** |
| 3.5 Perfil + cierres + hilo con el coach · 3.6 Gamificación + onboarding | ⬜ |

Hoy `src/app/(tabs)/coach/index.tsx` es un placeholder ("Se porta en la Fase 3"). La card "Coach AI" de Home y
el toque del aviso del coach (toast) ya apuntan a `/(tabs)/coach`.

## 2. Qué es el chat en la PWA (espec: `inventario-pantallas.md` §7)

- **Pantalla** `showChat` L37177: historial completo, burbujas usuario/coach, "Pensando…" mientras espera,
  **sin tab bar** (se sale con swipe a la derecha o con el drawer), header visible (único lugar de la app),
  input `maxlength=2000` con autosize, **botones rápidos** "🥗 Dieta de la semana" / "💪 Rutina de la semana" que
  solo aparecen si ese slot está LIBRE (sin plan o cerrado). Bienvenida hardcodeada `postNativeWelcome` L21149
  (texto distinto para nativas vs migradas; regla de Beto: "tu entrenador", nunca nombres propios).
- **Envío** `sendMessage` L25346 → `sendToAI` L25083 → `callChatAPI` → `POST /api/chat` con
  `{ system: buildSystemPrompt(), messages: sanitizeTurnsForAPI(conversationHistory), model: 'haiku' }` +
  `Authorization: Bearer <access_token>` (`aiAuthHeaders` L25024). **Respuesta JSON completa, SIN streaming.**
  Reintentos: 2 con backoff 700 ms×intento solo ante 429/529/red. `data.error === 'daily_limit'` → mensaje de
  tope ("🛑 Llegaste al límite…"); **401 y el resto caen en "Error de conexión" genérico** (mejorar en nativo).
  Si el usuario cambia a mitad del fetch, se descarta la respuesta. Si falla, se hace `pop()` del turno del
  usuario (Anthropic exige alternancia estricta user/assistant).
- **Historial** (`historial_chat`, una fila por `(usuario_id, fecha)`): `mensajes` (lo que se pinta) +
  `conversation_history` (turnos para la API). `loadAllChatHistory` L20265 trae TODO ordenado para pintar
  continuidad; los **últimos 7 días** (`loadRecentChatHistory` ~L21395) alimentan `buildHistorySummary` dentro
  del prompt. Al enviar se mandan los **últimos 40 turnos** (`sanitizeTurnsForAPI` L25070: empieza en user, roles
  alternados). Escritura: `saveChatToSupabase` (upsert por fecha, vía la **cola offline** `syncPush`).
- **Planes entregados por chat** (L25153-L25290): si el usuario pidió un plan (`detectPlanRequest`) o la respuesta
  tiene forma de plan (`detectPlanInReply`) y mide >400 chars → **CANDADO**: solo se guarda si el slot está libre
  (`!weeklyPlans[tipo] || .closed`) y pasa `planReplyHasStructure` (si no, `aiNormalizePlan` L39250 reformatea);
  dieta con clamp de kcal (`evaluatePlanQuality` → `getBackupPlan` si no pasa la vara); intento de pisar un plan
  activo → evento `plan_change_blocked` en `beta_eventos`. Guardado = `saveWeeklyPlan` L20438 (que además
  `reconcileDietKcal`). Luego "plan listo" solo si `_planPersisted`.
- **El prompt** `buildSystemPrompt` L23687: **~1.260 líneas** armadas en el cliente con TODO el contexto de la
  usuaria (perfil, objetivo/target Mifflin, planes activos, resumen de los últimos 7 días de chat, `recentDiario`,
  cierres, cohorte King con sus reglas, método Babot para rutinas, few-shot, constitución "el target es
  sagrado", transparencia de rol, idioma). Es lo que **B3** propone mover al servidor.
- **Otros consumidores de `/api/chat` que NO son el chat** (no se portan acá): generación de planes en onboarding
  (`prefetchPlan` L20969) y renovación, `autoAdjustDiet`, análisis del cierre con fotos, `estimateMealNutrition`
  (ya portada en 3.2.c), `aiNormalizePlan`.

## 3. Qué ya está portado y se REUSA (no reescribir)

- **`lib/api.ts`** → `cabecerasApi()` (Bearer de Supabase + `Origin: https://coachaipro.ai`, la opción A de B1) y
  `postChat({ system, messages, model })` que devuelve el `Message` de Anthropic o lanza con `status`
  (403 origen · 401 sesión · 429 tope · 413 payload) y `ident` (`x-chat-ident`). Verificado contra prod en 3.2.c:
  sin Origin 403 · con Origin sin token 401 · desde el iPhone con sesión 200.
- **`features/alimentacion/estimar-io.ts`** = ejemplo de uso con mapeo de errores (`'origen'|'sesion'|'tope'|'red'`).
- **`lib/sync.ts`** = cola offline (outbox en AsyncStorage, dedup por key, flush al reconectar/foreground/60 s,
  **persiste a disco al irse al fondo**). El upsert de `historial_chat` tiene que ir por acá con la **misma key**
  que la PWA (`'chat_' + fecha`, verificar en `saveChatToSupabase`), para no pisar lo que la PWA suba.
- **`lib/query.tsx`** TanStack Query con caché persistida (el historial pinta al instante desde disco).
- **`features/alimentacion/dieta.ts`** (`parsePlanDieta`) y **`features/entreno/rutina.ts`** (`parseRutinaContenido`)
  ya son port 1:1 con paridad → sirven para el *structure gate* si se decide guardar planes desde la nativa.
- `components/ui`: `Text`, `PressableScale`, `TextField`, `BottomSheet`, `Toast`; `components/navigation/Pantalla`
  con `ScrollConTeclado` (keyboard-controller con parche `followCaret={false}`; NUNCA `automaticallyAdjustKeyboardInsets`).
- Patrón de PORT: funciones puras en `features/chat/` + `scripts/paridad-chat.mjs` que extrae las originales del
  `index.html` vivo (copiar el `extractFunction` brace-matcher de `paridad-home.mjs`) y exige resultado idéntico.
  **Para el chat: `sanitizeTurnsForAPI`, `detectPlanRequest`, `detectPlanInReply`, `planReplyHasStructure`,
  `buildHistorySummary` y — si el prompt se queda en el cliente — `buildSystemPrompt` byte a byte.**

## 4. La decisión que hay que tomar PRIMERO: dónde vive el cerebro (B3)

`docs/port-rn/contrato-api.md` §B3 lo deja planteado; Beto todavía no decidió. Las dos opciones, honestas:

| | **A · Port fiel (prompt en el cliente)** | **B · B3: cerebro al servidor** |
|---|---|---|
| Qué se hace | Portar `buildSystemPrompt` (~1.260 líneas) + candados + guardado de planes a la nativa, con paridad byte a byte del prompt | Endpoint nuevo `/api/chat/message` (`{ mensaje }`): el servidor arma el prompt con los datos de la usuaria, aplica candados, guarda historial y planes; la nativa solo manda texto |
| Backend | **Cero cambios** (regla de oro intacta) | Código nuevo en Vercel (aditivo: `/api/chat` genérico sigue vivo para la PWA) + service key en server |
| Duplicación | El prompt queda en 2 lugares → cada cambio de Jesús/Beto se hace 2 veces y puede divergir | Una sola verdad; la PWA puede migrar después |
| Riesgo | Bajo para la base; **alto de divergencia** a mediano plazo | Riesgo de backend (mitigable: aditivo, feature-flag, QA con la cuenta de Beto) |
| Esfuerzo | Alto en paridad (prompt de 1.260 líneas con 30+ globals) | Medio-alto, pero reusa el mismo JS del prompt (se mueve, no se reescribe) |
| Encaja con | "La nativa es LA app y la PWA se desactiva" (decisión 2026-10-13) → la duplicación sería temporal | Lo mismo, pero sin pagar la duplicación |

**Recomendación del traspaso:** **B**, con una salvedad de alcance. Lo que va al servidor primero es SOLO el
mensaje de chat (`/api/chat/message`); la generación de planes del onboarding, el ajuste post-cierre y el
análisis semanal se mueven en su propia tarea (van con 3.5/3.6). Y la 3.4.a (pantalla + historial, solo
lectura) se puede hacer YA mientras Beto decide, porque no depende de la decisión.

Si Beto elige **A**, agregar al brief de 3.4.b: harness de paridad del prompt contra el `index.html` vivo con
globals plantados (perfil, planes, `recentDiario`, cierres, cohorte) → el `system` tiene que ser idéntico
byte a byte para que Claude responda igual; `scripts/test-generation.mjs` de la PWA ya hace esa extracción.

## 5. Partición propuesta (brief a presentar a Beto)

| Tarea | Qué | Motor |
|---|---|---|
| **3.4.a** Pantalla + historial (solo lectura) | Lista de burbujas estilo iMessage/Mensajes (continuidad por días con separadores de fecha), carga de `historial_chat` completa con caché persistida, bienvenida si no hay historial, input con autosize sobre el teclado (keyboard-controller), **tab bar oculta** en esta tab, swipe-back nativo. Sin enviar todavía. | Opus 5.5 |
| **3.4.b** Enviar y recibir | Según §4: **A** = `postChat` con `buildSystemPrompt` portado + `sanitizeTurnsForAPI` + reintentos + upsert de `historial_chat` por la cola; **B** = `/api/chat/message` nuevo (aditivo) + cliente fino. En ambos: "Pensando…" nativo, errores claros (401 → re-login, 429 → mensaje de tope con `x-chat-used`, 503 → reintento), descartar respuesta si cambió la sesión. **Sin streaming** (el backend no lo soporta; agregarlo es un cambio de servidor aparte). | Fable 5.1 |
| **3.4.c** Planes por chat + botones rápidos | Botones "Dieta/Rutina de la semana" solo con slot libre; candado + structure gate + clamp de kcal (en A: portar `evaluatePlanQuality`/`getBackupPlan`; en B: ya está en el server); "plan listo" solo si se guardó de verdad; evento `plan_change_blocked`. | Fable 5.1 |
| **3.4.d** Pasada visual + vida | Burbujas con entrada suave (sin springs con rebote), indicador "escribiendo" con los 3 puntos de iOS, haptic al recibir, scroll al último mensaje sin saltos, modo oscuro; criterio "parece hecho por Apple". | Fable 5.1 |

**Resultado esperado de la sección:** abrir Coach AI en la nativa, ver el historial real de Beto, mandar un
mensaje y recibir la respuesta de Haiku con el mismo contexto que en la PWA (misma respuesta ante el mismo
mensaje, salvo la variabilidad del modelo), ver el mensaje aparecer en la PWA al refrescar (misma fila de
`historial_chat`), y que el tope de 120/día y el candado del plan se comporten igual.

## 6. Gotchas heredados y específicos del chat

- **Haiku, no Sonnet**, para todo lo que pase por `/api/chat` (`motor_ia.md`): Sonnet duplica planes.
- **Alternancia estricta**: nunca mandar dos turnos `user` seguidos; ante error, sacar el turno pendiente.
- **`historial_chat` se escribe por FECHA local** (una fila por día): respetar `formatLocalDate` (= `localDateKey`
  de `features/entreno/semana.ts`, ya con paridad) para no partir un día en dos filas.
- **No prometer acciones de UI que no existen** en copys (regla 2026-09-09): los ejercicios de Mi Entreno no
  se editan; comidas → "Comí otra cosa" (3.2.c).
- **Tope diario = cuenta de auth, no `usuarios.id`**; RPC `chat_uso_incrementa` es del server, la nativa no la toca.
- **iOS congela timers en background** → cualquier debounce de la cola se persiste y se sube al instante al irse
  al fondo (ya resuelto en `lib/sync.ts`, lección de 3.2.c).
- **Telemetría "congelada" de Vercel**: un `chat_auth_missing` puede loguearse con el request siguiente
  (fire-and-forget + freeze de la función) — no perseguir fantasmas.
- Keyboard: el `BottomSheet` NO sirve con `KeyboardAvoidingView`; en una pantalla normal, `ScrollConTeclado` +
  input fijo abajo midiendo `keyboardWillChangeFrame` (3.2.c). Para una lista invertida (chat) evaluar
  `KeyboardAwareScrollView` vs `FlatList inverted` + `KeyboardStickyView` de keyboard-controller.
- **Tab bar oculta en Chat** (espec §2 de inventario): el `TabBar` flotante hoy se pinta en el layout de tabs →
  hace falta un mecanismo para esconderla en esta ruta (p. ej. estado en el layout por `usePathname`).
- La PWA del celu de Beto puede estar logueada con otra cuenta → mirar `usuario_id` en edge_logs al comparar.
- QA de la IA sin gastar de más: 120/día alcanza de sobra, pero cada prueba cuesta; preparar los mensajes de QA
  antes (bienvenida, pregunta casual, sustitución de comida, pedido de plan con slot ocupado → candado).

## 7. Datos de la cuenta de Beto para el QA

- Tenant King, `metodo_king=false`, objetivo `definir`, target real ~2470 kcal (perfil masculino/activo), dieta
  activa 1387 kcal (Comida 1–4), rutina activa de 4 días (W42, clonada por la nativa el 13/10) → **ambos slots
  OCUPADOS**: los botones rápidos no deben aparecer y pedir un plan tiene que caer en el candado
  (`plan_change_blocked`).
- `historial_chat`: verificar cuántas filas tiene antes de arrancar (`select fecha, jsonb_array_length(mensajes)
  from historial_chat where usuario_id='5716a081-…' order by fecha`) y usarlas como muestra dorada del pintado.
- Para un QA "limpio" del candado y de la bienvenida se puede usar la cuenta de prueba reseteable
  (memoria `reset_cuenta_prueba_beto.md`), siempre con OK previo.
