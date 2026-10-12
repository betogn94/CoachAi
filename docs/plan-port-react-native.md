# CoachAI Pro → React Native · Plan de implementación

> **Objetivo:** llegar a enero 2027 con todo preparado para portar CoachAI Pro a React Native, avanzando en ratos libres durante 2026 — sin frenar ni arriesgar el producto actual.
> Creado: 2026-10-10 · Insumo principal: teardown de Gravl (ingeniería inversa, oct 2026)

---

## Introducción — por qué hacemos esto

CoachAI Pro hoy es una PWA que funciona, factura y está en las stores. Pero el mercado de fitness lo lideran apps (Gravl, Strava) construidas en **React Native / tecnología nativa**, y la batalla de percepción se juega primero con los ojos: **si nos vemos al nivel de los líderes, competimos**; nuestro diferencial hace el resto — no somos solo una app de entrenos, combinamos **nutrición + entrenamiento + seguimiento** con coach detrás.

Tenemos tres ventajas que casi nadie tiene al encarar un port así:

1. **El manual del líder.** Hicimos ingeniería inversa de Gravl: sabemos exactamente qué stack usa (Expo, expo-router, Reanimated, Rive, RevenueCat, Sentry) y cómo organiza sus pantallas. No vamos a adivinar tecnología: vamos a usar la que ya probó funcionar con 1M+ de usuarios.
2. **La espec ya existe.** La app actual ES la especificación: cada pantalla, flujo y regla de negocio está resuelta y validada con clientas reales. Portar con espejo es 2-3× más rápido que crear de cero.
3. **Distribución propia.** Instagram con ~110k seguidores. Con cientos a 1.000 usuarias pagas ya somos negocio para el tamaño del equipo.

**Las reglas de oro (no negociables):**
- 🥇 **La PWA sigue siendo EL producto** hasta el cutover. Durante el port: solo bugs y features críticas en la app actual.
- 🧱 **Port incremental, nunca big-bang.** Pantalla por pantalla, TestFlight temprano, cutover solo con paridad.
- ⌚ **El watch va en Swift aparte** (React Native no corre en watchOS; Gravl mismo lo hace así). Es otra rama de este plan, no un bloqueante.
- 🔌 **El backend NO cambia.** La misma API en Vercel y el mismo Supabase sirven a la PWA y a la app RN. Eso achica el proyecto a "solo" la capa visual.

---

## FASE 0 — Cimientos (octubre-noviembre, ratos libres) 🏗️

*Objetivo: que el día que arranque el port de verdad, no haya NADA administrativo ni decisiones abiertas en el camino. Cada ítem es una tarea de un rato libre.*

- [x] **0.1 — Repo nuevo `coachai-native`** (separado del actual; el backend queda donde está). ✅ 2026-10-11 — [github.com/betogn94/coachai-native](https://github.com/betogn94/coachai-native) (privado), local en `Desktop/coachai-native`. README con reglas de oro + tabla del stack; .gitignore Expo.
- [x] **0.2 — Cuenta Expo + EAS** (el sistema de builds en la nube de Expo; evita pelear con Xcode/Android Studio local). Gravl usa exactamente esto. ✅ 2026-10-11 — cuenta personal `betogn` (beto131312@gmail.com, plan gratis) + `eas-cli` 24.12.1 global en la PC, `eas whoami` OK. Expo también creó la organización `betogns-team` (vacía, la dejamos). Gotcha Windows: PowerShell bloquea los `.ps1` → usar **`eas.cmd`** (no tocamos la política de ejecución). El login es por navegador (OAuth), no pide contraseña en la terminal.
- [x] **0.3 — Hello World en tu iPhone**: proyecto Expo vacío corriendo en tu celu vía Expo Go. Tarea de una tarde, y es el momento "esto es real". ✅ 2026-10-11 — Expo SDK 57 (RN 0.86, expo-router en `src/app`, Reanimated 4 y expo-image ya incluidos), proyecto EAS `@betogn/coachai-native`. Pantalla violeta `#7c6aff` en el iPhone de Beto + cambio en vivo desde la PC verificado (hot reload OK). Gotcha: por LAN el iPhone no llega a la PC (firewall/red) → **arrancar siempre con `npx.cmd expo start --tunnel`** (`@expo/ngrok` quedó como devDependency).
- [x] **0.4 — Decisiones de stack cerradas por escrito** ✅ 2026-10-11 (OK de Beto) (propuesta: calcar Gravl — Expo SDK estable, TypeScript, expo-router para navegación, Reanimated para animación, Rive para ilustradas, RevenueCat para suscripciones, Sentry para crashes; estado con Zustand o similar liviano). → ver **📌 Decisiones de stack** abajo.
- [x] **0.5 — Inventario de pantallas y flujos de la PWA** ✅ 2026-10-11 (OK de Beto) (el documento-espec: lista de cada pantalla, qué muestra, qué endpoints consume). Se puede generar casi entero leyendo el código actual. → borrador en [`docs/port-rn/inventario-pantallas.md`](port-rn/inventario-pantallas.md).
- [ ] **0.6 — Inventario de endpoints** de la API que consume el frontend hoy (contrato que la app RN va a respetar tal cual). → borrador en [`docs/port-rn/contrato-api.md`](port-rn/contrato-api.md) (pendiente OK de Beto) — trae 3 cambios de backend necesarios (B1 origen, B2 push, B3 cerebro al servidor).
- [ ] **0.7 — Login OTP de prueba desde RN**: mini-pantalla que haga el flujo Supabase OTP real. Si auth funciona temprano, el resto es renderizar datos.

### 📌 Decisiones de stack (0.4 — cerradas el 2026-10-11)

**Criterio general:** calcamos el stack de Gravl (probado con 1M+ de usuarios en nuestro rubro) **salvo** donde ya tenemos algo propio que funciona. No adivinamos tecnología.

| Capa | Herramienta | ¿Gravl? | Por qué (en una línea) |
|---|---|---|---|
| Framework | **Expo** (SDK 57) + **TypeScript** + Hermes | ✅ igual | Un solo código para iPhone y Android, con cámara/notificaciones/navegación ya resueltas; TypeScript marca errores antes de que lleguen a una clienta. |
| Builds y deploy | **EAS** + **TestFlight** + actualizaciones **OTA** | ✅ igual | Builds en la nube sin Mac ni certificados a mano; OTA nos conserva la velocidad de hoy (arreglar sin esperar la review de Apple). |
| Navegación | **expo-router** | ✅ igual | Transiciones y swipe-back reales de iOS; cada archivo en `src/app/` es una pantalla. |
| Animación | **Reanimated** + **Rive** | ✅ igual | Springs físicos a 120fps en un hilo aparte (adiós peleas con WebKit); Rive para celebraciones y medallas ilustradas. |
| Suscripciones in-app | **RevenueCat** (recién Fase 4) | ✅ igual | Maneja los pagos de Apple/Google (recibos, renovaciones, restaurar). Convive con Stripe; el balance entre las dos puertas se decide con Jesús antes de F4. |
| Crashes | **Sentry** | ✅ igual | Nos enteramos de cada error con pantalla y modelo de teléfono antes de que la clienta escriba. |
| Pagos web | **Stripe** (el circuito actual) | ❌ Gravl usa Paddle | Ya tenemos webhooks, sync-subs y Tower funcionando; no se toca. |
| IA | **Nuestra `/api/chat`** en Vercel | ❌ Gravl usa Vercel AI Gateway | Auth, límites por plan y clamps ya viven del lado del servidor; la app solo la llama. |
| Estado | **TanStack Query** + **Zustand** | elección nuestra | Query cachea y refresca datos del servidor (cargas instantáneas); Zustand para el estado chico de pantalla. Estándar 2026 en Expo, sin el peso de Redux. |
| Datos y sesión | **supabase-js** + **expo-secure-store** | elección nuestra | Mismo Supabase, mismo OTP, misma RLS; la sesión va al llavero cifrado del iPhone. Las clientas entran y está todo — no se migra nada. |
| Estilos | **StyleSheet** + **tokens propios** (`tokens.ts`) | elección nuestra | Look 100% CoachAI, sin librería de UI de terceros (ni Tamagui ni NativeWind). Los tokens salen de la PWA en la tarea 1.1. |
| Listas / imágenes | **FlashList** / **expo-image** | elección nuestra | Scroll perfecto en historiales largos; fotos de comidas y progreso cacheadas en disco. |

**Otras decisiones que quedaron tomadas en el camino:**
- **Repo aparte** (`coachai-native`), no monorepo: el backend sigue viviendo en el repo de la PWA y ninguno de los dos se ensucia con el otro.
- **Versiones fijadas por Expo:** paquetes nuevos siempre con `npx expo install` (elige la versión compatible con el SDK), nunca `npm install` a mano. Se actualiza de SDK de a uno y a propósito, no "porque salió".
- **Desarrollo diario:** Expo Go en el iPhone de Beto vía **túnel** (la red local no llega). Cuando aparezca la primera librería nativa que Expo Go no soporte (probablemente Rive o RevenueCat), pasamos a **development build** propia vía EAS.
- **Cuenta Expo personal** (`betogn`); si se suma alguien del equipo, se crea una organización y se transfiere el proyecto.

## FASE 1 — Design System (noviembre-diciembre) 🎨

*Objetivo: definir UNA vez cómo se ve y se siente todo, al nivel Gravl, con identidad CoachAI Pro. Acá se gana la batalla visual.*

- [ ] **1.1 — Tokens desde la app actual**: colores (violeta + tema King), DM Sans, radios, sombras, espaciados, duraciones/curvas del motion system Snappy → archivo de tokens compartible.
- [ ] **1.2 — Componentes base**: Button, Card, Chip, BottomSheet, Toast, Input, Anillo de progreso, Barra de adherencia — cada uno con sus springs nativos (acá Reanimated brilla de verdad: 120fps, gestos).
- [ ] **1.3 — Pantalla muestrario** (catálogo interno de componentes para QA visual rápido en el celu).
- [ ] **1.4 — El bottom-nav con su thumb animado** — nuestra firma visual, versión nativa.

## FASE 2 — Esqueleto navegable (diciembre-enero) 🦴

*Objetivo: una app real en tu bolsillo, aunque vacía: navegación + login + datos reales.*

- [ ] **2.1 — Tabs con expo-router** (Inicio / Coach / Alimentación / Entreno / Perfil) con transiciones nativas.
- [ ] **2.2 — Login OTP completo** + sesión persistida (RLS ya funciona igual que en la PWA).
- [ ] **2.3 — Perfil leyendo datos reales** de Supabase (la pantalla más simple como prueba de punta a punta).
- [ ] **2.4 — Primera build TestFlight** (solo vos). A partir de acá, cada avance se prueba en tu iPhone de verdad.

## FASE 3 — El port, sección por sección (enero → ) 📱

*Orden elegido por valor y por dificultad creciente. Cada sección se da por cerrada cuando, lado a lado con la PWA, no le falta nada.*

1. [ ] **Mi Entreno** (el corazón: split, sesión guiada, cronómetro, arrastre de pesos, PR)
2. [ ] **Mi Alimentación** (días, comidas, tildes, anillos, fotos)
3. [ ] **Home** (hero + rotadores de KPIs + cascada)
4. [ ] **Chat / Coach IA** (misma API, streaming)
5. [ ] **Perfil + cierres semanales + renovación de rutina**
6. [ ] **Gamificación** (medallas, rachas, retos) **+ onboarding**

## FASE 4 — Paridad y cutover (según avance) 🚀

- [ ] Push notifications nativas (mejores que las de PWA) · deep links · RevenueCat/IAP
- [ ] Beta con grupito de clientas reales vía TestFlight
- [ ] Cutover gradual: la app nativa reemplaza al wrapper en las stores; la PWA queda como versión web
- [ ] Post-cutover: lo que la PWA no podía — **HealthKit/Health Connect, widgets, Live Activities**

## Rama paralela — Apple Watch (Swift) ⌚

Arranca cuando Fase 3 esté avanzada. App mínima: arrancar entreno, tildar series, timer, pulso → contra la misma API. Después, Garmin (SDK propio).

---

## Cómo trabajamos los ratos libres

- Cada rato libre = **una tarea del checklist**, con su tilde. Nada de sesiones maratónicas obligatorias: el plan está diseñado para avanzar de a piezas chicas.
- Las sesiones de trabajo del port viven en su propia conversación ("Port a React Native"); las del producto actual siguen aparte. No se mezclan.
- Este documento es el tablero: se tilda acá y se anota lo decidido abajo de cada fase.

> **La foto final:** enero 2027 arrancando Fase 3 con cimientos, design system y esqueleto ya resueltos en los ratos libres de 2026. El port deja de ser un salto al vacío y pasa a ser ensamblar piezas sobre rieles.
