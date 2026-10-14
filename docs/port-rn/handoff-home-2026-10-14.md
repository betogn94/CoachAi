# Port a React Native — traspaso para la conversación "Home" (2026-10-14)

Para abrir la conversación dedicada a **3.3 Home** sin perder contexto. Las conversaciones "Mi Entreno" (3.1) y
"Mi Alimentación" (3.2) quedan aparte; ambas secciones están COMPLETAS. Fuente de verdad: el tablero
[`../plan-port-react-native.md`](../plan-port-react-native.md) + la memoria `port_react_native.md` + el traspaso
general [`handoff-2026-10-13.md`](handoff-2026-10-13.md) (cómo levantar, gotchas, decisiones visuales). Este archivo
trae solo lo específico de Home.

## 0. Reglas que no se discuten

- 🔥 **REGLA DE ORO (Beto, 2026-10-13): JAMÁS poner en riesgo la base ni la PWA.** Hay clientas pagando. Desde el
  port: cero código de la PWA (solo leerla como espec), cero DDL/RLS/migraciones, escrituras de QA solo en la cuenta
  de Beto (`beto131312@gmail.com`, `usuario_id 5716a081-2c4d-4eab-be06-98006c271e06`, tenant King) y por SQL con OK
  previo; datos de clientas solo lectura y en `*.local.json` gitignored. Memoria: `feedback_proteger_pwa_y_base.md`.
- **Home solo LEE.** No escribe ninguna tabla (la única escritura cercana, marcar `notas_coach` como leídas, es del
  hilo del chat → 3.4). Riesgo para la base: nulo. Lo que importa acá es la **paridad de los números** con la PWA y
  lo visual (es la primera pantalla que ve la clienta).
- Protocolo por tarea: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone → corregir →
  tildar en el plan → commit. Siempre en español rioplatense.
- Metro: SIEMPRE desde la raíz de `coachai-native` (`npx.cmd expo start --tunnel`); si ya hay uno en el 8081, reusarlo
  (`curl http://localhost:8081/status`). QR como PNG (`npx.cmd qrcode@1.5.4 -o .expo/qr.png -w 480 "exp://…"`).
  Chequeos antes de pedir QA: `npx tsc --noEmit` · `npx.cmd expo lint` · las paridades que toquen (`npm run paridad`,
  `paridad:dieta`, `paridad:espejo`, `paridad:estimar`).

## 1. Estado al corte

| Tarea | Estado |
|---|---|
| 3.1 Mi Entreno (a–i) | ✅ completa |
| 3.2 Mi Alimentación (a–c) | ✅ completa 2026-10-14 (3.2.d "Completar día" movida a 3.5) |
| **3.3 Home** | ⬜ **esta conversación** |
| 3.4 Chat · 3.5 Perfil+cierres · 3.6 Gamificación+onboarding | ⬜ |

Hoy `src/app/(tabs)/inicio/index.tsx` es un placeholder ("Se porta en la Fase 3").

## 2. Qué es Home en la PWA (espec: `inventario-pantallas.md` §5, `renderHome` en `index.html`)

Carga síncrona desde caché, luego en paralelo anillo, insights, alimentación y semanas; cada widget aislado (si uno
falla no tira los demás). Entrada en cascada (120 ms por card) + count-ups. Orden:

1. Banner **"Tu coach te escribió"** — count de `notas_coach` con `de='coach'` y `leido=false` → abre el hilo (3.4).
2. **Hero rotativo**: *Entrenamientos X/N esta semana* (anillo con gradiente de marca; N = `getWeeklyTrainingTarget`
   L37375: rutina → `usuarios.dias_entreno` → 0; **con N=0 anillo vacío, no 100 %**) ↔ *Tu progresión* (gráfico del
   ejercicio con mejor % de mejora; elegible si ≥3 semanas con pesos y delta > 0, `_insightsFeaturedProgress`; tap →
   progresión parada en ese ejercicio).
3. **Chip de racha** 🔥 — ≥2 días seguidos registrando comidas (`computeStreaks`, 1 día de perdón, `progreso_diario`
   90 días); llama chica días 1-3 del ciclo, grande 4-7. **Ya portado**: `features/entreno/racha.ts` (3.1.e).
4. Chip del **reto mensual** — gated `?reto=1` en la PWA → NO portar todavía (memoria `reto_mensual_feature`).
5. **Grilla 2×2 de slots rotativos** (`initSlotRotator`: cross-fade cada 8 s, arranca SIEMPRE en la slide funcional,
   fija si hay <2 elegibles; **sin dots ni flechas**, decisión de Beto):

| Slot | Slide principal | Slides extra (solo si el dato es BUENO; nada negativo rota nunca) |
|---|---|---|
| Comida | **Próxima comida** (1ª sin tildar de hoy / "¡Día completo!") → Alimentación | Promedio 7 días (≥4 días con registro, 80–110 % del target; sub = proteína promedio) |
| Entreno | **Hoy toca** (grupo muscular, "Día N · X ej." / DESCANSO) → Entreno | Récord personal (`_insightsRecentPR`, máximo histórico superado en las últimas 2 semanas ISO) · Reto (no portar) |
| Kcal | **Calorías hoy** (barras por comida, cumplidas vs pendientes) | Cierre semanal · Tu peso (≥1 pesada + ancla `peso_inicial` o 1ª pesada, dirección a favor del objetivo; wantsUp = ganar_musculo/volumen) |
| Coach | **Coach AI** "Consultá lo que necesites" → Chat | Cardio (si la regla aplica hoy; ya portado `parseCardioRule`/`cardioAppliesToday`) · Adherencia 4 sem (`computeAdherencia4w`, solo ≥70 %) |

6. Seguimiento semanal + overlays (gate de cierre libre, oferta de renovación) → **propuesta: van a 3.5** (son el
   reloj de semanas y los cierres; Home solo los muestra). "Preparando tu plan" (post-onboarding) → 3.6.

Memoria de referencia: `home_insights_feature.md` (elegibilidad de cada KPI, decisiones de Beto: sin flechas, sin
dots, delta de progresión en verde; `fetchEntrenoWeeksCached` 60 s; seed de QA en la cuenta de Beto).

## 3. Qué ya está portado y se REUSA (no reescribir)

- `features/entreno/useSplit.ts` → `useSplit()` (rutina, mapping con `todayRoutineIdx`/`isTodayRest`), `resumenSemana`
  (X/N de la semana), `useHoy()`.
- `features/entreno/racha.ts` (port de `computeStreaks`), `progresion.ts` (series por ejercicio, gráfico scrubbable en
  `(tabs)/entreno/progresion.tsx`), `record.ts`/`referencia.ts` (PR y semanas históricas, `useSemanasHist` 26 semanas),
  `ejercicio.ts` (`parseCardioRule`, `cardioAppliesToday`, `minutosEstimados`).
- `features/alimentacion/dieta.ts` (`parsePlanDieta`, `repartirObjetivo`, `resumenDia`), `queries.ts`
  (`useDietaActual`), `estado.ts` (`useAlimSemana` tildes de la semana ISO del calendario).
- `components/ui`: `ProgressRing` (gradiente de marca), `ProgressBar`, `Card`, `Chip`, `NumeroVivo` (count-up).
- `lib/api.ts` (`/api/chat` con Bearer + Origin, opción A de B1) — Home no lo necesita.
- Patrón de PORT: funciones puras en `features/<sección>/` sin imports + `scripts/paridad-*.mjs` que extrae las
  originales del `index.html` vivo (brace-matcher) y exige resultado idéntico. **Para Home: `getWeeklyTrainingTarget`,
  `computeAdherencia4w`, `_insightsFeaturedProgress`, `_insightsRecentPR`, elegibilidad de peso / promedio 7 días.**

## 4. Partición propuesta (brief ya presentado a Beto el 2026-10-14)

| Tarea | Qué | Motor |
|---|---|---|
| **3.3.a** Hero + racha + banner del coach | Anillo con el mismo N que la PWA, racha reusando `racha.ts`, banner con el conteo de `notas_coach` (RLS: la clienta lee las suyas) | Opus 5.5 |
| **3.3.b** Grilla 2×2 funcional | Las 4 cards principales con datos reales (split, dieta, tildes ya portados); tap → cada tab | Opus 5.5 |
| **3.3.c** Insights rotativos | Elegibilidad calcada + paridad por KPI; rotación cross-fade 8 s sin dots; la slide funcional siempre primero | Fable 5.1 |
| **3.3.d** Pasada visual | Cascada de entrada 120 ms, count-ups, criterio Fitness/Gravl (como 3.1.h y la de 3.2.a); sin springs con rebote en reacomodos de listas | Fable 5.1 |

**Resultado esperado:** abrir la nativa y ver la Home real de Beto: anillo con sus entrenos de la semana, racha, las
4 cards con los datos de hoy y los KPIs rotando cuando corresponda, **idéntica en números a la PWA** (QA lado a lado
con su cuenta: tiene entrenos del 13/10, tildes de la W42, récord del 13/10, pesadas y 5 filas sembradas de
`progreso_diario` 2026-09-30→10-04 para la slide nutricional).

## 5. Gotchas heredados que aplican a Home

- React Compiler: Reanimated con `.get()/.set()`; nada de `setState` sincrónico en efectos; `Math.random` fuera del
  render (`useState(() => …)`).
- iOS 26 + títulos grandes: sin `backgroundColor` en headers.
- Animaciones: count-up + `adjustsFontSizeToFit` se ve bugueado → fundido; reacomodos sin rebote; no sumar haptics
  encima de botones que ya vibran.
- El engranaje azul flotante es el menú de Expo Go, no de la app.
- La PWA del celu de Beto puede estar logueada con otra cuenta → mirar `usuario_id` en edge_logs al comparar.
- Visual (Beto): la marca solo en acentos finos; tab bar ya decidida; tema claro default; números grandes en SF Pro
  Rounded (`Text rounded`); "pantallas de datos = mirar hacia adelante (Gravl) + estética Fitness".
