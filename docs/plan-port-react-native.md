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

- [ ] **0.1 — Repo nuevo `coachai-native`** (separado del actual; el backend queda donde está).
- [ ] **0.2 — Cuenta Expo + EAS** (el sistema de builds en la nube de Expo; evita pelear con Xcode/Android Studio local). Gravl usa exactamente esto.
- [ ] **0.3 — Hello World en tu iPhone**: proyecto Expo vacío corriendo en tu celu vía Expo Go. Tarea de una tarde, y es el momento "esto es real".
- [ ] **0.4 — Decisiones de stack cerradas por escrito** (propuesta: calcar Gravl — Expo SDK estable, TypeScript, expo-router para navegación, Reanimated para animación, Rive para ilustradas, RevenueCat para suscripciones, Sentry para crashes; estado con Zustand o similar liviano).
- [ ] **0.5 — Inventario de pantallas y flujos de la PWA** (el documento-espec: lista de cada pantalla, qué muestra, qué endpoints consume). Se puede generar casi entero leyendo el código actual.
- [ ] **0.6 — Inventario de endpoints** de la API que consume el frontend hoy (contrato que la app RN va a respetar tal cual).
- [ ] **0.7 — Login OTP de prueba desde RN**: mini-pantalla que haga el flujo Supabase OTP real. Si auth funciona temprano, el resto es renderizar datos.

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
