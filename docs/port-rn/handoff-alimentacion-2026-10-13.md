# Port a React Native — traspaso para la conversación "Mi Alimentación" (2026-10-13)

Para abrir la conversación dedicada a **3.2 Mi Alimentación** sin perder contexto. La conversación
"Port React Native — Mi Entreno" sigue aparte (ahí vive la 3.1 y su pasada visual). Fuente de verdad:
el tablero [`../plan-port-react-native.md`](../plan-port-react-native.md) + la memoria
`port_react_native.md` + el traspaso general [`handoff-2026-10-13.md`](handoff-2026-10-13.md)
(cómo levantar, gotchas, decisiones visuales). Este archivo trae solo lo específico de Alimentación.

## 0. Reglas que no se discuten

- 🔥 **REGLA DE ORO (Beto, 2026-10-13): JAMÁS poner en riesgo la base ni la PWA.** Hay clientas pagando
  que financian el proyecto. Desde el port: cero código de la PWA (solo leerla como espec), cero cambios de
  estructura en la base, escrituras de QA solo en la cuenta de Beto (`beto131312@gmail.com`, tenant King) y
  por SQL siempre con OK previo. Memoria: `feedback_proteger_pwa_y_base.md`.
- **Mi Alimentación es más delicada que Entreno:** lo que se tilda acá alimenta `progreso_diario`, que es lo
  que leen el **cierre semanal, Progreso y el chat**. Un número distinto al de la PWA = el cierre de esa clienta
  cuenta mal. Por eso la 3.2.b/c van con **Fable 5.1** y paridad estricta del espejo.
- Protocolo por tarea: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone (+ logs
  de Supabase) → corregir → tildar. Siempre en español rioplatense.
- **Siempre arrancar Metro desde la raíz** (`npx.cmd expo start` en `coachai-native`), nunca desde `scripts/`
  (rompe la generación de rutas tipadas). Túnel: `--tunnel` (ngrok a veces tira "remote gone away" → reintentar).

## 1. Estado al corte

| Tarea | Estado |
|---|---|
| **3.2.a — Ver la dieta** (solo lectura) | ✅ Código hecho y commiteado (`a2162ac`), **SIN QA de Beto todavía** → primer paso de la conversación nueva |
| 3.2.b — Tildar comidas + espejo a `progreso_diario` | ⬜ Fable 5.1. Riesgo alto (ver §3) |
| 3.2.c — Detalle de comida + editar (texto libre → estimación) | ⬜ Fable 5.1. Depende de B1 (ver §3) |
| 3.2.d — Completar un día retroactivo | ⬜ Opus 5.5 |

### Qué hay en el código (3.2.a)
- `src/features/alimentacion/dieta.ts` — port 1:1, funciones puras: `parseDietaContenido`,
  `synthesizePlainTextDieta`, `parsePlanDieta` (estructurado → si no hay días, texto plano del coach),
  `repartirObjetivo` ("método King": objetivo solo en el header → se reparte entre las comidas; OJO: la PWA lo
  hace MUTANDO el día dentro del render y esos valores los usa después el espejo → **quien escriba en 3.2.b tiene
  que usar el día ya repartido**), `resumenDia` (comidas hechas, kcal con estado `under/achieved/exceeded` a
  ±3 %, macros hechas/plan con la prioridad custom > plan > proporción del header), `lineasComida` (" / " → " o ",
  grupos " · " en líneas), `fotoComida` (semilla día+comida), tipos `EstadoComida`/`EstadoAlim`.
- `scripts/paridad-dieta.mjs` → `npm run paridad:dieta`: compara contra el `index.html` vivo
  (red de regresión de la PWA + `scripts/dietas-corpus.local.json` gitignored con dietas reales + 2.500 fuzz):
  **89.971 comparaciones idénticas**. Si se toca `dieta.ts`, correrlo.
- `src/features/alimentacion/queries.ts` — `useDietaActual` (misma regla de "cerrada" que la rutina;
  **NO clona** la dieta cerrada, ver §3) y `useAlimSemana` (tildes de la semana ISO del calendario,
  `alimentacion_semanal.estado`).
- `src/features/alimentacion/ui.tsx` — `SelectorDias` (LUN–DOM con fechas reales, hoy, punto verde,
  futuros apagados), `AnilloMacro` (ProgressRing con color sólido; rojo si se pasa >3 %), `CardComida`
  (foto 64×64 de `assets/alim/`, nombre, líneas, "· editada", check).
- `src/app/(tabs)/alimentacion/index.tsx` — la pantalla: estados sin perfil / cargando / error / sin dieta /
  con datos (selector, objetivos diarios, resumen con anillos, "Cómo leer tu plan" solo King, comidas).
  El check hoy muestra un toast "llega en la 3.2.b".
- `assets/alim/*.webp` — las 12 fotos ambientales de la PWA (`img/alim/`), copiadas tal cual.

### QA pendiente de la 3.2.a (lo que Beto tiene que ver)
Tab Alimentación con su cuenta: tira LUN 12 … DOM 18 con hoy en rosa; objetivos 1387 kcal · 115 g · 135 g · 43 g
(su dieta es plantilla "Comida 1–4" con target); resumen 0/4 comidas · 0/1387 kcal · anillos en cero (no tildó
nada esta semana — verificado en la base el 2026-10-13); "Cómo leer tu plan" desplegable; 4 comidas con foto y
las alternativas con "o". Días futuros: check apagado.

## 2. Modelo de datos (de `inventario-pantallas.md` §4, resumido)

- Plan = `planes_semanales` tipo `dieta` (texto, `origen` ia/coach). Las alternativas viven **en el texto**
  (`/` = elegí una; `+` = van juntas).
- Tilde = `alimentacion_semanal.estado["d{i}m{j}"] = { cumplido, customText?, customKcal?, customProt?,
  customCarbs?, customFat? }`, por (usuaria, semana ISO del **calendario**, no del plan).
- Espejo a `progreso_diario` (PWA `syncProgresoDiarioForDay` L25553): 4 columnas fijas de texto
  (desayuno/almuerzo/merienda/cena — solo esas keys), `calorias_consumidas` (null si no hay nada tildado),
  `proteinas_g/carbos_g/grasas_g` con prioridad macros reales (custom o del plan) > proporción del header
  (`ratio = min(consumido/plan, 1.5)`). **La fecha sale del lunes calendario + i** (`alimDateForDayIdx`).
  Debounce 500 ms, upsert de la semana + espejo de los días "sucios", en secuencia por día.
- Cola offline: la misma `lib/sync.ts` de Entreno (`encolar` con keys `alim_<wk>` y la de
  `progreso_diario` por fecha; mirar `saveDiarioToSupabase` para el `onConflict`).

## 3. Decisiones abiertas (de Beto, cuando lleguen)

1. **B1 — la API rechaza a la nativa.** `api/_origin.js` exige Origin/Referer del dominio → la nativa recibe 403
   en `/api/chat`. Lo necesita **Editar comida** (estimación de kcal por IA). Arreglo chico y retrocompatible
   (aceptar sin Origin si el Bearer es válido), **pero es un cambio en el backend de producción** → va como tarea
   aparte con QA y rollback, no dentro del port. Mientras tanto la 3.2.c puede editar texto y estimar solo con
   Open Food Facts (marcas), o dejar la estimación para cuando esté B1.
2. **Dieta cerrada → semana nueva.** La PWA la clona (`autoRepeatPlans`) **y la ajusta con IA**
   (`autoAdjustDiet`). La nativa NO la clona (si lo hiciera, la PWA ya no la ajustaría). Hoy muestra "Sin dieta
   activa" hasta que la clienta abra la PWA. Solución definitiva: llevar clon+ajuste al servidor (B3).
3. **"Completar día" no escribe `alimentacion_semanal`** en la PWA (solo `progreso_diario` + `dias_entrenados`)
   → las dos fuentes pueden divergir. En la nativa: replicar **igual** (paridad estricta); si se unifica, en las dos
   apps a la vez.

## 4. Cómo seguir (propuesta de brief para la 3.2.b)

1. Escritor local-first como `useEscritorEntreno` (`features/entreno/estado.ts` es el modelo): mutar el doc de
   la semana en la caché, encolar entero (`alim_<wk>`), debounce 500 ms, y encolar el espejo de cada día tocado
   (`progreso_diario` por fecha). Lectura: `pendiente(key)` → lo local gana (igual que Entreno).
2. Port puro del espejo (`syncProgresoDiarioForDay` → función pura `filaProgresoDia(day repartido, header,
   estado, i)`) y **paridad contra el original** con tildes/ediciones al azar, antes de escribir una sola fila.
3. UI: el check de `CardComida` → optimista; en días futuros deshabilitado (ya está).
4. QA en la cuenta de Beto: tildar/destildar hoy y un día pasado, verificar en la base `alimentacion_semanal` y
   `progreso_diario` (columnas de texto, kcal, macros) y que la PWA muestre lo mismo.

## 5. Prompt sugerido para la conversación nueva

> Sos la sesión de trabajo dedicada al port de CoachAI Pro a React Native, sección **Mi Alimentación**.
> Leé primero `docs/port-rn/handoff-alimentacion-2026-10-13.md`, después `docs/port-rn/handoff-2026-10-13.md`
> y la memoria `port_react_native.md`, y el tablero `docs/plan-port-react-native.md`. Regla de oro: jamás poner
> en riesgo la base ni la PWA (hay clientas pagando). Protocolo: brief (qué / resultado esperado / motor) → ejecutar
> → QA en mi iPhone → corregir → tildar. Siempre en español. Arrancamos con el QA de la 3.2.a (ya está en el
> código) y después la 3.2.b con Fable 5.1.
