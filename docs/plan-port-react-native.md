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
- [x] **0.6 — Inventario de endpoints** ✅ 2026-10-11 (OK de Beto; B3 queda como decisión abierta) de la API que consume el frontend hoy (contrato que la app RN va a respetar tal cual). → borrador en [`docs/port-rn/contrato-api.md`](port-rn/contrato-api.md) — trae 3 cambios de backend necesarios (B1 origen, B2 push, B3 cerebro al servidor).
- [x] **0.7 — Login OTP de prueba desde RN**: mini-pantalla que haga el flujo Supabase OTP real. Si auth funciona temprano, el resto es renderizar datos. ✅ 2026-10-11 — verificado en los logs de Supabase desde el iPhone de Beto (`Expo/Darwin`): `otp` 200 → `verify` 200 → `usuarios` 200 (fila propia leída con RLS). `shouldCreateUser:false`, solo lectura. Sesión persistida en AsyncStorage (pasar a almacenamiento cifrado en 2.2). Login directo a Supabase → no necesitó el cambio B1.

> 🎉 **FASE 0 COMPLETA (2026-10-11).** Los cimientos quedaron: repo, Expo/EAS, app corriendo en el iPhone, stack decidido, espec de pantallas, contrato de API y login real. Abierto para decidir: **B3** (llevar el "cerebro" al servidor) — ver [contrato-api.md](port-rn/contrato-api.md).

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

> 🎨 **Dirección visual (Beto, 2026-10-11):** lo más **iOS-native posible** — controles, navegación, sheets, listas, gestos y haptics se comportan como iOS. La identidad va **solo en los detalles de color**: violeta `#7c6aff` para CoachAI Pro default y rosa `#FF4F7B` para el tenant King. Dos temas que solo cambian la paleta de acento. **Referencia: la app Ajustes del iPhone** — que parezca hecha por Apple (títulos grandes, listas agrupadas inset, SF Symbols, colores semánticos + modo oscuro automático, marca como *tint*). **Tipografía: SF Pro (fuente del sistema)**, no DM Sans — decidido 2026-10-11.

- [x] **1.1 — Tokens desde la app actual**: colores (violeta + tema King), DM Sans, radios, sombras, espaciados, duraciones/curvas del motion system Snappy → archivo de tokens compartible. ✅ 2026-10-12 (OK de Beto en el iPhone) — `coachai-native/src/theme/` (commit `47f8c5b`): colores semánticos de iOS claro/oscuro + marcas `coachai`/`king` como *tint* + escala Dynamic Type con SF Pro (sin DM Sans) + spacing/radius/métricas de listas agrupadas + motion Snappy con springs "a la Apple"; `useTheme()` resuelve marca × apariencia. README con el mapa PWA→nativo. Gotcha: el modo web `static` de Expo pre-renderiza en Node y tiraba el servidor con Supabase → `web.output: "single"`.
- [x] **1.2 — Componentes base**: Button, Card, Chip, BottomSheet, Toast, Input, Anillo de progreso, Barra de adherencia — cada uno con sus springs nativos (acá Reanimated brilla de verdad: 120fps, gestos). ✅ 2026-10-12 (OK de Beto: "todo se siente muy bien y smooth") — `src/components/ui/` (13 piezas, commits `1e3dd4b`→`3622c4d`): Text, PressableScale (press-spring con pulso mínimo + haptics), Button ×4 variantes, GroupedSection (+ nivel elevado), ListRow, RowIcon, TextField, Chip, Card, ProgressRing (SVG + gradiente de marca), ProgressBar, BottomSheet (spring iOS + arrastre), Toast. Gotcha: React Compiler exige `shared.get()/.set()` en Reanimated y nada de setState en efectos. Decisión: `controlMode` del tema = **`brand`** por ahora (quedan `neutral` y `system` para comparar).
- [ ] **1.5 — Pasada de color (pendiente, pedido de Beto 2026-10-12)**: suavizar la *cantidad* y la *distribución* del color de marca (King satura): regla de "un solo botón relleno por pantalla", chips suaves (ya), revisar anillo/barra/switch; comparar con los modos `neutral`/`system` que quedaron en el muestrario. Se hace cuando haya pantallas reales (Fase 2/3), no sobre el muestrario.
- [x] **1.3 — Pantalla muestrario** (catálogo interno de componentes para QA visual rápido en el celu). ✅ 2026-10-12 — ruta `/muestrario` con header nativo (título grande, push, swipe-back): hero con anillo/barra/chips, 4 botones, filas, hoja, toasts + selectores de marca / controles / apariencia.
- [x] **1.4 — El bottom-nav con su thumb animado** — nuestra firma visual, versión nativa. ✅ 2026-10-12 (OK de Beto tras 3 iteraciones en el iPhone) — `components/navigation/TabBar.tsx` + `app/(tabs)/` (5 placeholders). Resultado: **cápsula flotante y compacta a la Gravl** (42 pt de margen, 56 de alto, solo íconos SF de 26), **Liquid Glass real** en iOS 26 (`expo-glass-effect`) y desenfoque clásico en iOS anterior, thumb = pastilla blanca translúcida que viaja con spring, **cero color de marca en la barra** (activo negro/blanco, resto gris). Aprendizajes: Beto NO quiere tinte de marca en la navegación ni thumbs de color ("efecto violeta"); referencia = Gravl/Instagram/WhatsApp iOS 26. Posibles mejoras más adelante: altura del flote, animación del thumb al reaparecer, ocultar en Chat (Fase 3.4). **Diseño final (2026-10-12, 6 iteraciones con capturas reales de Gravl/WhatsApp/Instagram iOS 26): estilo Instagram** — cápsula flotante compacta (40 pt de margen, 60 de alto), solo íconos SF de 28, vidrio que acompaña el modo del teléfono (claro/oscuro) con misma forma, pastilla del activo alrededor del ícono. Beto: "una belleza".

> 🎉 **FASE 1 COMPLETA (2026-10-12, en un solo día con Fable 5.1).** Tokens + 13 componentes + muestrario + tab bar. Queda la **1.5 (pasada de color)** para cuando haya pantallas reales.

> 🎨 **Decisiones de Beto con pantallas reales (2026-10-13, 4 iteraciones con capturas) — actualizan lo de arriba:**
> - **Tab bar en claro = vidrio BLANCO** (tinte blanco 85 % sobre el Liquid Glass + sombra suave). Causa del gris que se veía: el vidrio translúcido dejaba ver la sombra de abajo. En oscuro sigue `#14161C`.
> - **La burbuja del tab activo SÍ lleva color de marca, suave** (tint al 13 % + ícono en tint), compacta (56 pt) alrededor del ícono. Reemplaza la regla "cero marca en la navegación": sobre la barra blanca, un toque de marca en el activo "aparece justo donde estás parado y nada más", mismo lenguaje que los cuadraditos "Día N" y los chips. La barra entera sigue sin marca.
> - **Tema CLARO por default** (como la PWA), con **Perfil → Apariencia: Claro / Oscuro / Automático** guardado en el dispositivo y aplicado también a iOS (`Appearance.setColorScheme`) para que header, hojas, menús y teclado acompañen.

## FASE 2 — Esqueleto navegable (diciembre-enero) 🦴

*Objetivo: una app real en tu bolsillo, aunque vacía: navegación + login + datos reales.*

- [x] **2.1 — Tabs con expo-router** (Inicio / Coach / Alimentación / Entreno / Perfil) con transiciones nativas. ✅ 2026-10-12 — cada tab es una carpeta con su `_layout` → `TabStack` (stack nativo con título grande que colapsa, push lateral y swipe-back dentro del tab, tab bar flotante visible). Demo: Entreno → "Día 2 · Glúteos". **GOTCHA iOS 26:** sin `backgroundColor` en el header o el título grande desaparece detrás del fondo; color del título explícito en `label` (`headerTintColor` también pinta el título en native-stack).

> 🎉 **FASE 2 COMPLETA salvo TestFlight (2026-10-12).** Esqueleto navegable real: login OTP + sesión en el llavero + marca por tenant + 5 tabs con stacks nativos + Perfil con datos reales. Solo falta la **2.4**, bloqueada por el pago de Apple Developer.
- [x] **2.2 — Login OTP completo** + sesión persistida (RLS ya funciona igual que en la PWA). ✅ 2026-10-12 — `lib/auth.tsx` (AuthProvider: sesión + fila de `usuarios` + marca por tenant), `lib/login.ts` (flujo calcado de la PWA: OTP o password revisora → RPC `auth_resolve_session`), `lib/secure-storage.ts` (llavero en trozos por el tope de 2 KB), `lib/otp.ts` (código pendiente sobrevive al relaunch), `app/login.tsx` + portero con `Stack.Protected` y splash nativo hasta decidir. **Verificado en logs de Supabase desde el iPhone de Beto:** otp → verify → usuarios → tenants → RPC 200 sin rebote (15:57) y reapertura con sesión recuperada sin pedir código (16:00). GOTCHA DESCUBIERTO: `beta_invitados` no tiene política de lectura para `authenticated` → el tenant de entrada se toma de la propia fila de `usuarios` (si no, el RPC rebota a las clientas de King por "wrongTenant"); por lo mismo, el "pintar King al tipear el email" de la PWA está muerto desde el cutover de RLS.
- [x] **2.3 — Perfil leyendo datos reales** de Supabase (la pantalla más simple como prueba de punta a punta). ✅ 2026-10-12 — tab Perfil con nombre/email/objetivo/acceso_hasta de `usuarios` + marca por tenant (captura de Beto: "Marca: King · tenant jesus").
- [ ] **2.4 — Primera build TestFlight** (solo vos). A partir de acá, cada avance se prueba en tu iPhone de verdad. ⚠️ **Bloqueada hasta pagar Apple Developer** (Beto, 2026-10-12: la cuenta todavía no está activa, falta el pago). Mientras tanto seguimos con Expo Go.

## FASE 3 — El port, sección por sección (enero → ) 📱

*Orden elegido por valor y por dificultad creciente. Cada sección se da por cerrada cuando, lado a lado con la PWA, no le falta nada.*

1. [ ] **Mi Entreno** (el corazón: split, sesión guiada, cronómetro, arrastre de pesos, PR) — partición en [handoff-2026-10-13.md](port-rn/handoff-2026-10-13.md) §7
   - [x] **3.1.a — Rutina real + lista del split** ✅ 2026-10-13 (QA de Beto en el iPhone, commit nativo `c38ee2c`) — `features/entreno/rutina.ts` = port 1:1 de `parseRutinaContenido` + `buildTrainingDayMapping`; **`scripts/paridad-rutina.mjs`** las compara contra el `index.html` vivo (red de regresión + rutinas reales gitignored + 2.500 fuzz × 7 días × varios `dias_entreno` = 703k comparaciones idénticas). Rutina vigente + "cerrada" como `loadCurrentWeekPlans`, con TanStack Query y caché persistida (se borra al cerrar sesión). Tab Entreno: saludo, split con número de día + día de la semana, HOY, card Descanso, vacío/cargando/error, pull-to-refresh; Día muestra los ejercicios reales. **Extra: la semana nueva llega sola en la nativa** — port de `autoRepeatPlans` **solo rutina** (clon idéntico a la semana ISO actual al detectar la rutina cerrada). Verificado end-to-end con la cuenta de Beto: el iPhone creó la rutina W42 (POST 201) + evento `plan_auto_repeated` con `app: native`. HALLAZGO del QA: sin esto, quien abra la nativa antes que la PWA tras un cierre veía "Sin rutina activa".
   - [x] **3.1.b — Vista del día** ✅ 2026-10-13 (QA de Beto en el iPhone, commit nativo `15bf9e8`) — `features/entreno/ejercicio.ts` = port 1:1 de `parseSeriesCount`, split dato/cue, `_renderEntNote` (nota + chips de intensificador), `parseCardioRule` y el snapshot `ex` (paridad ampliada: 1.236 notas, cardio y snapshots idénticos). `estado.ts` = `entreno_semanal` por semana ISO del calendario + **✓ manual** como `toggleEntrenoDone` (relee la fila antes de escribir, optimista con rollback) + espejo a `dias_entrenados`/`progreso_diario` (verificado en edge_logs: 3 vueltas marcar/desmarcar desde el iPhone). Día: "Día N · Lun", ejercicios/series, ejercicios en acordeón, cardio; lista con "Esta semana X/N" y días hechos con ✓. **Feedback de Beto:** el primer acordeón (spring con rebote + fundido) era "muy exagerado" y pisaba otros ejercicios → despliegue por **altura recortada con la curva estándar, sin rebote** (aprobado). Regla: en listas, nada de springs con rebote para reacomodos.
   - [x] **3.1.c — Registro de pesos/reps + cola offline** ✅ 2026-10-13 (Fable 5.1; QA de Beto en el iPhone) — `lib/sync.ts` = outbox persistido con dedup por key y flush al reconectar (`expo-network`) / volver al frente / cada 60 s; **mejor que la PWA:** mientras hay algo pendiente, la lectura devuelve lo local y el servidor no pisa lo que no subió (la PWA sí al hidratar). `estado.ts` = escritor local-first (`setSerie`/`toggleDia`), documento entero, sube con debounce 800 ms. Filas `Serie N [reps] × [kg]` con el sanitizado de la PWA (paridad OK). **Verificado:** pesos en `entreno_semanal` (1×5, 6×8, 6×9), subida agrupada por ráfaga, **modo avión → aviso → al volver la señal subió solo** (8×6 a las 14:59:21). **Lecciones del QA (4 iteraciones por un "sube y baja" al tipear):** (1) el culpable era MI aviso "N cambios sin sincronizar", que aparecía durante el segundo normal de subida y empujaba la lista 80 pt → ahora solo cuando un cambio FALLÓ; (2) de paso quedaron dos mejoras reales: campos NO controlados (reescribir el valor por tecla hace que iOS reacomode la lista) y **`react-native-keyboard-controller`** (sí viene en Expo Go) con parche propio `followCaret={false}` en `patches/` (sin él re-scrollea en cada tecla); nada de `automaticallyAdjustKeyboardInsets`; (3) método que funcionó: medir `measureInWindow` del campo a +0/150/400/900/1500 ms y leer la terminal de Metro, en vez de adivinar. **Pendiente para TestFlight:** abrir la app sin red (Expo Go necesita Metro).
   - [x] **3.1.d — Sesión: card con estados, cronómetro por timestamps, modo guiado** ✅ 2026-10-13 (Fable 5.1; QA de Beto en el iPhone) — `features/entreno/sesion.ts` = port 1:1 del contrato `{i,i0,t,u,acc,pau,e,f}` (elapsed pause-aware, HH:MM:SS, fecha de INICIO, estados idle/running/paused/colgada 6h/done, transiciones puras; paridad con 8 secuencias idénticas a la PWA). Terminar marca el día con la fecha de inicio y espeja; repetir un día suma su fecha sin tocar la marca. **Verificado:** cerrar la app con el reloj corriendo → exacto al volver (Beto); sesión en la base con pausa + reanudación + fin. **Decisiones de diseño de Beto:** con la sesión corriendo, **barra compacta** (reloj + Pausar + Terminar) y se esconde la fila "Día N" para que el ejercicio con sus series quede a la vista **sin scrollear**; el reloj del header aparece **solo cuando la barra se fue de la pantalla** (no dos relojes a la vista). Hoja Terminar/Descartar/Seguir (la del muestrario) con aviso <10 min. Bug propio arreglado: `GroupedSection` chocaba claves (`key={0}` vs respaldo `0`) → prefijo. Pendiente para 3.1.e: autocierre de sesiones olvidadas + celebración (medalla/racha/compartir); mientras tanto, toast.
   - [x] **3.1.e — Terminar/descartar + espejo + autocierre + celebración** ✅ 2026-10-13 (Fable 5.1; QA de Beto en el iPhone) — **Autocierre** (`autofinCerrar` = port 1:1 de `_entSesAutofinClose`, 18 casos de paridad): `escritor.autocerrar()` barre todas las semanas locales al entrar / volver al frente / bajar la semana; verificado plantando una sesión olvidada en la base → cerrada sola con 70 min, día marcado y espejado. **Celebración** con la medalla de la PWA, "Día N de racha 🔥" (port de `computeStreaks`) / "Entreno #N", Duración + Entrenamiento, confeti + haptics, Compartir / Listo. **Compartir**: cámara/galería/sin foto → story 1080×1920 igual a `drawShareCanvas` (vista previa escalada, captura a tamaño real con `react-native-view-shot`) → hoja nativa de iOS (`expo-sharing`); eyebrow rosa King / violeta CoachAI. **GOTCHA iOS:** no reemplazar un modal por otro en el mismo instante (quedaba todo congelado tras elegir foto) → cerrar la celebración, esperar `onDismiss`, abrir la preview; cada celebración se re-monta con `key`. Permisos de cámara/fotos declarados en `app.json` para la build.

> 🎉 **3.1 Mi Entreno: a–e completas en UN día (2026-10-13).** Quedan 3.1.f (arrastre de pesos + récord personal) y 3.1.g (demo de ejercicio + guía de intensificadores + progresión).
   - [x] **3.1.f — Arrastre de pesos + récord personal** ✅ 2026-10-13 (Fable 5.1; QA de Beto con su historial real) — `features/entreno/referencia.ts` = port 1:1 de `loadEntrenoRef`/`entrenoRefSlot` (última semana ANTERIOR con pesos, salta vacías; emparejado por nombre normalizado vía snapshot `ex`; posicional solo si toda la semana vieja calza) y del núcleo de `_prMaybeInit`/`_prCheck` (vara con historia + lo cargado esta semana en silencio). **Paridad: 24k comparaciones** con semanas sintetizadas (snapshot, reordenadas, renombradas, legacy rotas). Placeholders "sem. pasada" en gris solo en campos vacíos; récord 900 ms tras tipear → brillo dorado + confeti + toast + haptics + medalla `primer_record` una sola vez. **Verificado:** referencia de la W40 saltando la W41 vacía (34 kg), sin referencia para el Jalón renombrado por el coach (correcto, igual que la PWA), récord 60 kg (antes 55) y medalla en `user_logros`. Infra: `npm run paridad` con hook de resolución `.ts` para que los módulos puros se importen entre sí.
   - [x] **3.1.g — Demo de ejercicio + guía de intensificadores + progresión de fuerza** ✅ 2026-10-13 (Opus 5.5; QA de Beto, varias iteraciones de diseño; commit nativo `0e4cbcc`) — Port 1:1 con paridad de `_findEjercicioMatch` (demo: video mudo en loop / 2 fotos / texto), textos y orden de la guía de intensificadores (abre enfocada desde el chip del ejercicio) y `_progRender`. **"Tu progresión" va más allá de la PWA (solo lectura, extra nativo):** "Para superar tu marca" (1 rep más o el siguiente escalón de peso), **fuerza estimada 1RM** (Epley) con su variación, récord con reps, "tu última vez" serie por serie; selector desplegable agrupado por día; gráfico que se recorre con el dedo, línea que se dibuja, último punto que respira; números en **SF Pro Rounded** (la letra de Fitness). Criterio de diseño acordado con Beto: **mirar hacia adelante** (meta concreta) como hace Gravl, con la estética de la app Fitness de iOS. Lecciones: el count-up con `adjustsFontSizeToFit` se ve "bugueado" → fundido; las animaciones dentro de una hoja modal deben esperar a que termine la presentación.

> 🎉 **3.1 MI ENTRENO COMPLETA (a–g) — 2026-10-13, en un solo día.** Rutina real, día con acordeón, pesos por serie con cola offline, sesión con cronómetro y guiado, autocierre, celebración y story, arrastre de pesos, récord personal con medalla, demos, guía de intensificadores y progresión. Próxima: **3.2 Mi Alimentación**.

> 🧭 **Decisión de Beto (2026-10-13): la nativa va a ser LA app y la PWA se desactiva** (no queda "como versión web"). Consecuencia: toda lógica que hoy corre *en el cliente al abrir la PWA* tiene que portarse a la nativa o pasar al servidor antes de apagarla. Primer caso: `autoRepeatPlans` — la rutina ya la clona la nativa; **la dieta se clona Y se ajusta con IA (`autoAdjustDiet`) → va al servidor junto con B3** (pendiente; mientras la PWA viva, la clona ella). Inventariar el resto de estos "efectos al abrir" (prefetch de planes del onboarding, self-heal con IA, logros, renovación) antes del cutover.
2. [ ] **Mi Alimentación** (días, comidas, tildes, anillos, fotos)
3. [ ] **Home** (hero + rotadores de KPIs + cascada)
4. [ ] **Chat / Coach IA** (misma API, streaming)
5. [ ] **Perfil + cierres semanales + renovación de rutina**
6. [ ] **Gamificación** (medallas, rachas, retos) **+ onboarding**

## FASE 4 — Paridad y cutover (según avance) 🚀

- [ ] Push notifications nativas (mejores que las de PWA) · deep links · RevenueCat/IAP
- [ ] Beta con grupito de clientas reales vía TestFlight
- [ ] Cutover gradual: la app nativa reemplaza al wrapper en las stores; ~~la PWA queda como versión web~~ → **la PWA se desactiva** (Beto, 2026-10-13) — antes, portar/llevar al servidor todos sus "efectos al abrir" (ver nota en Fase 3)
- [ ] Post-cutover: lo que la PWA no podía — **HealthKit/Health Connect, widgets, Live Activities**

## Rama paralela — Apple Watch (Swift) ⌚

Arranca cuando Fase 3 esté avanzada. App mínima: arrancar entreno, tildar series, timer, pulso → contra la misma API. Después, Garmin (SDK propio).

---

## Cómo trabajamos los ratos libres

- Cada rato libre = **una tarea del checklist**, con su tilde. Nada de sesiones maratónicas obligatorias: el plan está diseñado para avanzar de a piezas chicas.
- Las sesiones de trabajo del port viven en su propia conversación ("Port a React Native"); las del producto actual siguen aparte. No se mezclan.
- Este documento es el tablero: se tilda acá y se anota lo decidido abajo de cada fase.

> **La foto final:** enero 2027 arrancando Fase 3 con cimientos, design system y esqueleto ya resueltos en los ratos libres de 2026. El port deja de ser un salto al vacío y pasa a ser ensamblar piezas sobre rieles.
