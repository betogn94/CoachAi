# Port a React Native — traspaso para la conversación "Perfil + cierres" (2026-10-15)

Para abrir la conversación dedicada a **3.5 Perfil + cierres semanales + renovación** sin perder contexto.
Las conversaciones de Entreno (3.1), Alimentación (3.2), Home (3.3) y Chat (3.4) quedan aparte; las cuatro
secciones están COMPLETAS. Fuente de verdad: el tablero [`../plan-port-react-native.md`](../plan-port-react-native.md)
(ahí está la partición 3.5.a–g con el motor de cada una) + la memoria `port_react_native.md` + el traspaso general
[`handoff-2026-10-13.md`](handoff-2026-10-13.md) (cómo levantar, gotchas, decisiones visuales). Este archivo
trae solo lo específico de Perfil / cierres y lo que cambió con el chat (el cerebro en el servidor).

## 0. Reglas que no se discuten

- 🔥 **REGLA DE ORO (Beto): JAMÁS poner en riesgo la base ni la PWA.** Cero código de la PWA (solo se lee como
  espec), cero DDL/RLS, escrituras de QA solo en la cuenta de Beto (`beto131312@gmail.com`, usuario
  `5716a081-2c4d-4eab-be06-98006c271e06`, auth `7c308e20-a63d-42d5-8df3-2bf700f1bf15`) o en sus cuentas internas
  de prueba (`beto131312+light@gmail.com`, usuario `e2e10f8c-7633-42a4-9a25-f9facfd41858`, `es_interno=true`) y
  por SQL con OK previo. **Cambios de backend = propuesta aparte con rollback y OK explícito** (como se hizo con
  `/api/chat-message`): siempre ADITIVOS, detrás de un interruptor por env var, sin tocar `api/chat.js`,
  `api/_origin.js` ni `index.html`.
- **Cuota de Fable:** Beto la cuida. Las tareas mecánicas (lecturas de Supabase con el patrón de las otras tabs,
  listas, formularios) van con **Opus 5.5**; Fable queda para backend (3.5.e, 3.5.f), paridad fina (reloj de
  semanas) y pasadas visuales. El motor lo cambia Beto en el selector; recomendarlo es parte del brief.
- Protocolo por tarea: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone con Expo Go
  (+ verificación en Supabase, proyecto `vmvhlgzwufkardaruutt`, solo lectura salvo OK) → corregir → tildar →
  commit → memoria. Siempre en español rioplatense.
- Metro: SIEMPRE desde la raíz de `coachai-native` (`npx.cmd expo start --tunnel`); si ya hay uno en el 8081,
  reusarlo (`curl http://localhost:8081/status`; el túnel vivo al cierre era `exp://fgxvw0m-betogn-8081.exp.direct`).
  Chequeos antes de pedir QA: `npx tsc --noEmit` · `npx.cmd expo lint` · `npm run paridad`, `paridad:dieta`,
  `paridad:espejo`, `paridad:estimar`, `paridad:home`, `paridad:chat` + las nuevas. En el repo de la PWA, si se
  toca el backend del chat: `npm run test:chat-message` y `npm run chat:cerebro:check`.

## 1. Estado al corte

| Tarea | Estado |
|---|---|
| 3.1 Entreno · 3.2 Alimentación · 3.3 Home · 3.4 Chat | ✅ completas (2026-10-13/15) |
| **3.5 Perfil + cierres + renovación** | ⬜ **esta conversación** (partición a–g en el tablero) |
| 3.6 Gamificación + onboarding (incl. 3.6.x primeros planes automáticos en el servidor) | ⬜ |

Hoy `src/app/(tabs)/perfil/index.tsx` es un placeholder útil: cuenta (nombre, email, objetivo, acceso hasta),
**Apariencia (Claro/Oscuro/Automático, ya funciona y se queda)**, muestrario y cerrar sesión. Home ya lee
`peso_inicial` y `usePesadas` (progreso_peso) para el KPI "Tu peso".

## 2. Lo que cambió con el chat y se REUSA

- **El cerebro de la IA vive en el servidor (B3, decidido por Beto 2026-10-14):** `api/_chat-cerebro.js` es
  GENERADO desde `index.html` por `scripts/build-chat-prompt.mjs` (buildSystemPrompt + métodos + reglas +
  detectores + vara de calidad + reconciliación + avisos). Cualquier endpoint nuevo que necesite IA con contexto
  de la usuaria (cierre semanal 3.5.e, renovación 3.5.f, primeros planes 3.6.x) **reusa `crearCerebro(ctx)` y
  `api/_chat-contexto.js`** (carga de `usuarios` por auth_id, planes con `closed`, historial, diario, upserts).
  Para sumar funciones de `index.html` al cerebro: agregarlas a `FUNCIONES` del generador, regenerar, commitear.
  Mientras la PWA viva, `index.html` sigue siendo la fuente de verdad → regenerar tras cada cambio de prompt.
- **Patrón de endpoint aditivo** (`api/chat-message.js`): origin + Bearer (`identifyUser`), interruptor
  `*_ENABLED=1` (si no, 404), allowlist `*_ALLOW` de auth uid + `es_interno`, tope diario compartido
  (`chat_uso_incrementa`), tests offline con `fetch` falso (`scripts/test-chat-message-handler.mjs` es la plantilla).
- **Vercel gotchas:** módulos auxiliares como `api/_nombre.js` (un `.mjs` en subcarpeta tiró
  FUNCTION_INVOCATION_FAILED al cargar); el MCP de Vercel de esta cuenta NO escribe env vars ni lee logs/deploys
  (403) → Beto las carga en el dashboard (Config, Production + Preview) y se redeploya con un commit vacío; no hay
  CLI de Vercel instalada; `export const config = { maxDuration: 60 }` funciona.
- `lib/api.ts`: `cabecerasApi()` (Bearer + `Origin: https://coachaipro.ai`) sirve tal cual para
  `/api/stripe/*` y `/api/delete-account` (3.5.g). `postChatMessage` es el ejemplo de cliente fino.
- `lib/sync.ts` (cola offline, keys iguales a la PWA), `lib/query.tsx` (caché persistida), `components/ui`
  (incl. `BottomSheet`, `Toast`, `ProgressRing`, `NumeroVivo`), `features/entreno/racha.ts` (`computeStreaks`),
  `features/home/insights.ts` (`adherencia4w`), `features/entreno/semana.ts` (`localDateKey`, `isoWeekKey`).
- Chat: `features/chat/mensajes.ts` tiene el parser HTML → bloques nativos; sirve para pintar el **análisis del
  cierre** (markdown de la IA) y las notas del coach si traen HTML.
- Patrón de PORT: funciones puras en `features/perfil/` + `scripts/paridad-perfil.mjs` que extrae las originales
  del `index.html` vivo (copiar `extractFunction` de `paridad-home.mjs`) y exige resultado idéntico. Candidatas
  con lógica real: `getWeekNum` / `getWeekRange` (reloj de semanas), delta de peso "bueno" según objetivo,
  metas prorrateadas de semanas parciales, `isWeekCierreEligible`.

## 3. Espec (inventario §6) — resumen por tarea

Ver `inventario-pantallas.md` §6 (Perfil L138–154, Cierre L156–162, Renovación L164–165) con las líneas de
`index.html`. Puntos que no están ahí y conviene saber:
- **El hilo con el coach (3.5.y) es con el humano**, no con la IA. Beto lo marcó en Home: el aviso "Tu coach te
  escribió" (`AvisoCoach` en `app/(tabs)/inicio/index.tsx`, hoy un toast) tiene que abrir este hilo. Copys sin
  nombres propios de coach: siempre "tu entrenador".
- **Fotos:** bucket privado con signed URLs 24 h (memoria `fotos_bucket_privado`); en nativo `expo-image-picker`
  + `expo-image-manipulator` (sin la cadena HEIC de la PWA). No replicar el bug del avatar huérfano.
- **Cierre semanal (3.5.e) = backend.** `autoCloseEndedWeeks`, `generateWeeklyAnalysis` (Haiku con imágenes
  firmadas), `autoRepeatPlans` + `autoAdjustDiet` (clon de dieta/rutina + ajuste con clamp) y los logros del
  cierre son "efectos al abrir / al cerrar" que hoy corren en el cliente → van a un endpoint aditivo que reusa el
  cerebro. Es la segunda propuesta de backend del port; va con brief, rollback y OK de Beto como la primera.
- **Renovación (3.5.f):** solo rutinas `origen='ia'` y usuarias self-serve; nunca pisa una rutina del coach.
  `prefetchPlan('rutina')` también va al servidor (`/api/plan-generate`), el mismo que usará el onboarding 3.6.x.
- **Método King:** discontinuado (memoria `king_reform_state`): no portar hero/progreso/medidas King.
- **Completar día (3.5.x):** no reparte el objetivo King (guarda 0 kcal en esos planes); replicar igual.

## 4. Datos de la cuenta de Beto para el QA

- `usuarios`: Beto, 32, masculino, 80 kg / 173 cm, definir, avanzado, moderado, `dias_entreno` lun/mie/vie/jue,
  `foco_entreno='brazos'`, `peso_inicial` cargado (ver Home), tenant King (`metodo_king=false`).
- Planes W42 activos (dieta 1387 kcal "Comida 1–4", rutina 4 días `origen='ia'`); `cierres_semanales`: verificar
  cuántos tiene y el último `semana_num` antes de tocar el reloj de semanas.
- `progreso_peso`: pesadas reales (Home muestra el KPI); `progreso_diario` 90 días con el seed de QA ya borrado;
  `dias_entrenados` tiene 12–18/10 (días futuros de pruebas viejas).
- `notas_coach`: tabla sin triggers; existe copia `purga_20261005.notas_coach` → calificar siempre `public.`.
  Para QA del hilo: insertar una nota `de='coach'` en la cuenta de Beto con OK y borrarla después (receta en 3.3.a).
- Cuenta interna `beto131312+light@gmail.com` (coachai-default, perfil completo, planes de julio cerrados con un
  cierre QA `7b42083b-215e-4835-b601-277253c2bb67`): sirve para probar flujos "desde cero" sin tocar la cuenta
  principal. **`beto131312@gmail.com` NO se resetea** (tiene todos los datos del port).

## 5. Gotchas heredados (no volver a caer)

- iOS 26: NUNCA `backgroundColor` en headers con título grande; con título chico sí (chat). `headerTintColor`
  pinta el título → color vía `headerTitleStyle`. Botones custom del header en `label`, no en tint (la cápsula
  de vidrio de iOS 26 los hace ilegibles).
- React Compiler: nada de `setState` sincrónico en efectos ("estado derivado en render" o `.then`); Reanimated
  con `.get()/.set()`; `Math.random` en render prohibido.
- Teclado: `Pantalla` (KeyboardAwareScrollView con `followCaret={false}`) para formularios; para una barra
  pegada al teclado, `useAnimacionTeclado()` de `lib/teclado.tsx` (el `KeyboardAvoidingView` de la librería no
  desplaza dentro de un stack con header).
- Modales: nunca reemplazar un `Modal` por otro en el mismo render; animaciones en hojas esperan ~420 ms.
- Motion: reacomodos sin rebote (280 ms curva estándar); springs solo en press; Beto pide cadencias rápidas,
  llenados lentos; nada de tinte de marca en superficies grandes.
- Cola offline: iOS congela timers en background → `lib/sync.ts` persiste y sube al irse al fondo (ya resuelto).
- Expo Go no abre sin red; el engranaje azul es el menú de Expo Go.

## 6. Prompt sugerido para la conversación nueva

> Sos la sesión de trabajo dedicada al port de CoachAI Pro a React Native, sección **Perfil + cierres semanales +
> renovación** (3.5). Leé primero `docs/port-rn/handoff-perfil-2026-10-15.md`, después `handoff-2026-10-13.md`, la
> memoria `port_react_native.md`, el tablero `docs/plan-port-react-native.md` (la 3.5 ya está partida en a–g con
> motor) y `inventario-pantallas.md` §6. Regla de oro: jamás poner en riesgo la base ni la PWA; backend solo
> aditivo, con propuesta, rollback y mi OK. Protocolo: brief (qué / resultado esperado / motor) → ejecutar → QA en
> mi iPhone → corregir → tildar. Siempre en español. Arrancamos por la 3.5.a con Opus 5.5.
