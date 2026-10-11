# Inventario de pantallas y flujos — espec del port a React Native

> Tarea **0.5** del [plan del port](../plan-port-react-native.md). Relevado el 2026-10-11 leyendo `index.html` (~40.600 líneas, toda la app cliente).
> **Para qué sirve:** en la Fase 3, una sección se da por cerrada cuando cada ☐ de su bloque está en la app nativa y se comporta igual que en la PWA. Los números `L12345` son líneas de `index.html` al momento del relevamiento (van a correrse; buscá por nombre de función).
> **Cómo leer "Datos":** `tabla` = tabla de Supabase · `/api/x` = endpoint de Vercel · `ls:clave` = localStorage (en RN → AsyncStorage/SecureStore).

---

## 0. Reglas transversales (aplican a TODA la app nativa)

Estas no son pantallas, pero si se rompen se rompe todo. Van primero porque la Fase 2 (esqueleto) las tiene que resolver.

- **Semana = semana ISO calendario, lunes a domingo** (`getISOWeekKey` L20279). Todo lo semanal (entreno, alimentación, cierres) se indexa así. Excepción: el reloj de *cierres* es híbrido (la 1ª semana abierta va del día siguiente al último cierre al domingo → puede ser parcial). Ver §6.
- **Cola offline de escrituras** (`syncPush` L20191, `ls:cai_sync_outbox_v1`): toda escritura importante (entreno, tildes, peso, chat) va a una cola con *last-write-wins por key*, reintenta al volver la red, al abrir la app y cada 60 s. **La versión nativa necesita el equivalente desde el día 1** (TanStack Query mutations + persistencia, o cola propia).
- **Debounces de guardado**: pesos/reps 500 ms · estado de entreno 800 ms · tildes de comida 500 ms. Agrupar por día evita carreras entre toques rápidos.
- **Nunca castigar**: los insights de Home solo aparecen cuando el dato es bueno para la usuaria.
- **Roles**: coaches/admins/owner (`role !== 'user'`) **nunca** se bloquean (paywall, renovación, gate de cierre) y **nunca** ganan logros. Lo mismo el modo impersonación.
- **Cuenta revisora de stores** (`review@coachaipro.ai`, `isReviewLogin`): sin OTP real (el código se valida como password), tenant forzado `coachaipro`, sin gates, suscripción "Activo" sin fecha. **Imprescindible para pasar la review de Apple.**
- **Anti-steering iOS**: en nativo NO se linkea a Stripe para renovar → "hablá con tu coach".
- **Fotos**: bucket privado `progress-photos`, en DB se guarda la publicUrl y se **firma al mostrar** (24 h; 1 h para la IA). En RN re-firmar, no cachear URLs más de 24 h.
- **Flags `?algo=0/1`**: casi todos son *escapes* de features ya LIVE. **En nativo se porta solo el comportamiento LIVE, sin flags.** Las features todavía *gated* al momento del port (hoy: `?reto=1`, `?mot2=1`, `?stores=1`) se portan según su estado en ese momento.
- **Textos ES/EN** (`data-es`/`data-en`, `setLang` L22498): la nativa nace con i18n.
- **Seguridad de render**: todo texto de IA pasa por `formatResponse` (escapa HTML antes del markdown). En RN usar un renderer de markdown sin HTML.

---

## 1. Entrada, auth y portones (Fase 2 + onboarding en Fase 3.6)

### Árbol del boot (en orden)
1. Tema por tenant: host `king.*` / `?tenant` / `#tenant` / path `/jesus|/king` / `ls:coachai_preview_tenant_v1` → `jesus` = tema King, si no tema claro violeta.
2. Splash si hay `ls:coachai_session_v1`.
3. `tryAutoLogin`: sesión Supabase → `proceedAfterAuth` · si no, OTP pendiente (< 55 min) → pantalla OTP · si no → landing.
4. `proceedAfterAuth` (RPC `auth_resolve_session`): error (notInvited / betaFull / wrongTenant) → landing con error · admin → elección admin · nuevo o perfil incompleto → onboarding (King o clásico) · completo → `launchCoach`.
5. `launchCoach`: paywall Google → renovación → overlay de carga de plan → **Home**. Tenant suspendido → overlay de pausa (async).

### Pantallas
- ☐ **Splash** `#app-splash` — ícono del tenant; mínimo 550 ms, tope 8 s. En RN = splash nativo de Expo.
- ☐ **Landing / login** `handleEmailLogin` L21515 — nombre + email, INGRESAR, legales, disclaimer de salud (iOS), botón revisor (solo wrapper iOS). Mientras se tipea el email consulta `beta_invitados.tenant_slug` para aplicar tema King. Maneja 429 (rate limit) aparte. **Datos:** `signInWithOtp(shouldCreateUser:true)`.
- ☐ **OTP** `showOtpScreen` L19302 — 6 dígitos (`one-time-code`, autocompletado iOS), reenviar con cooldown 60 s, cambiar email. **El pendiente sobrevive al relanzamiento** (`ls:coachai_otp_pending`, 55 min) — en iOS ir al mail a buscar el código mata la app. → **Tarea 0.7.**
- ☐ **Resolución de sesión** — RPC `auth_resolve_session(p_email, p_nombre, p_entry_tenant_slug, p_is_trial)`; al entrar: update `usuarios` (`last_active`, `session_count`, `origen_alta`) + insert `beta_eventos` + heartbeat 60 s. `coachai-default` y `coachaipro` son equivalentes.
- ☐ **Elección admin** `showAdminChoice` L21439 — "Abrir Studio" (web) / "Continuar como usuario" / cerrar sesión. En nativo: "Abrir Studio" = link al navegador.
- ☐ **Onboarding clásico** L16779–17126 — 11 paneles en 5 pasos: (1.1) nombre/edad/sexo/peso/altura · (1.2) objetivo · (2.1) nivel · (2.2) actividad · (3.1) días + lugar · (3.2) lesiones · (4.1) restricciones dieta + no-me-gusta · (4.2) comidas/día · (4.3) alergias · (5.1) resumen · (5.2) fotos inicio opcionales. Valida al cambiar de paso; "Saltar" visible. **Al entrar a 5.1 arranca el prefetch de rutina + dieta** (`/api/chat`, haiku, con QA y plantilla de respaldo); volver atrás lo descarta. No genera si la clienta es migrada (RPC `get_my_migration` / `beta_invitados.pre_*`). Variante de textos King + láminas.
- ☐ **Onboarding King** `kingOnbOpen` L18879 — solo cohorte `usuarios.metodo_king` (método **discontinuado**: confirmar antes del port si sigue existiendo alguna clienta en la cohorte; probablemente NO se porta). Lee `king_intake`.
- ☐ **Overlay "Preparando tu plan"** `showPlanLoadingOverlay` L21106 — frases rotando cada 2,6 s, tope 35 s; al cerrar postea la bienvenida del coach.
- ☐ **Paywall Google Play** `showGooglePaywall` L24540 — solo Android self-serve sin sub; SKU `coachai_pro_monthly`, `/api/play/verify` y `/api/play/refresh`. En nativo → **RevenueCat (Fase 4)**.
- ☐ **Renovación** `showRenewScreen` L24379 — si `acceso_hasta` pasó (fecha nula = no bloquea). Web: Stripe con `prefilled_email`. Nativo: "hablá con tu coach".
- ☐ **Tenant suspendido** `showTenantSuspendedScreen` L24574 — `tenants.status='suspended'`.
- ☐ **Buscador de coaches + trial 14 días** L21773–21850 — *gated* `?stores=1`. RPC `stores_coach_directory`. Decidir en Fase 4 si entra al nativo (es el funnel de stores).
- ✗ **No portar:** white label `showWhiteLabel` (código muerto), modal "Instalar PWA" (no aplica en nativo), recordatorio de navegador in-app.

---

## 2. Navegación y tema (Fase 1.4 + 2.1)

- ☐ **Tab bar de 5** (orden `_NAV_ORDER`): Inicio · Coach AI · Mi Alimentación · Mi Entreno · Perfil. **Thumb animado** que se desliza a la posición real del tab + etiqueta del activo debajo (nuestra firma visual → tarea 1.4). Oculta en Chat y onboarding.
- ☐ **Botón atrás Android**: primero cierra el overlay abierto (13 overlays), si no vuelve a la sección anterior; desde Inicio sale de la app.
- ☐ **Chat sin tab bar**: se sale con **swipe a la derecha** (>35% del ancho o velocidad) con parallax, o desde el drawer (`openNav` L31362: logo, nombre, objetivo, 5 destinos, toggle ES/EN).
- ☐ **Transiciones**: hoy View Transitions direccionales (Alim/Entreno/Perfil: adelante/atrás; Home y Chat: crossfade). En nativo = transiciones de expo-router.
- ☐ **Press-springs** en cards y botones (escala .965, rebote overshoot). Con Reanimated.
- ☐ **Tema**:
  - *Claro violeta (default)*: fondo `#FAFAFF` · superficie `#FFF` · sup.2 `#F3F2FE` · borde `#E9E7F5` · acento `#7c6aff` · acento2 `#ff6b6b` · acento3 `#2ecfb5` · texto `#1A1A2E` · muted `#6B6B80`.
  - *King (claro rosa)*: fondo `#FAFAFB` · sup.2 `#FFF0F4` · borde `#ECECF1` · acento `#FF4F7B` · acento2 `#FF6B95` · acento3 `#E03A6F` · texto `#1A1A26`. Cambia íconos/logos.
  - *Dark legacy* (`?light=0`): **no portar.**
  - Branding por tenant desde `tenants.branding_config`. → insumo de la **tarea 1.1 (tokens)**.

---

## 3. Mi Entreno — Fase 3.1 (el corazón)

**Modelo de datos.** La rutina es texto en `planes_semanales` (tipo `rutina`, la más reciente por `updated_at`; *cerrada* si hay un cierre con `fecha_fin ≥ fecha_entrega`), parseado por `parseRutinaContenido` L33460 a `days[idx] = {label, isRest, exercises:[{name, detail, note}]}`. Las series salen del número inicial del `detail` (default 3, tope 8). **Todo el estado de la semana es UN documento JSON** por (usuaria, semana ISO) en `entreno_semanal.estado` (+ caché `ls:coachai_entreno_v1`):
`completed{idx:"YYYY-MM-DD"}` · `weights`/`reps` con clave `d{idx}e{j}s{n}` · `sesion{"d{idx}":{i,i0,t,u,acc,pau,e,f}}` · snapshot `ex{"d0e1":{n,s}}`. **Indexado por posición en la rutina, no por día de la semana** → cualquier día se puede entrenar cualquier día.
**Un día cuenta como entrenado** cuando tiene `completed[idx]` (por ✓, Terminar o autocierre). La fecha es la de **inicio** de la sesión. Se espeja a `dias_entrenados` y `progreso_diario.entreno` — de ahí leen racha, Home, cierre y reto. Repetir un día ya hecho solo suma una fecha a `dias_entrenados`.

- ☐ **Entrada a la sección** `showMiEntreno` L36202 — skeleton, header con chips *Intensificadores* y *Progresión*, card resumen "X/N días" con barra y count-up. Pinta desde caché y luego hidrata desde `entreno_semanal`. Estados vacío / "preparando".
- ☐ **Lista del split** `renderEntV2List` L36620 — saludo, card por día (badge DÍA N, nombre, nº ejercicios, día de la semana), badge **HOY** (sugerencia), `.done` en hechos, card **OFF** agrupando descansos (informativa). Mapeo día de semana ↔ día de rutina: label con nombre del día → `usuarios.dias_entreno` → días seguidos desde el lunes.
- ☐ **Vista previa del día** `_entPreviewHtml` L36515 — "Elegir otro día", card de sesión, ejercicios en acordeón, ✓ manual (`toggleEntrenoDone` L37076), chip cardio.
- ☐ **Card de sesión** `_renderEntSesCard` L34921 — estados: sin empezar ("Comenzar entrenamiento") / en vivo o pausada (reloj HH:MM:SS, Terminar, Pausar/Reanudar) / colgada >6 h (Finalizar/Descartar) / completada ("⏱ 45 min"). **El tiempo se calcula por timestamps** (`acc + (ahora − i)`), nunca contando ticks — en RN igual (y es la base de un futuro Live Activity).
- ☐ **Mini-pastilla del crono** `#ent-crono-mini` L34572 — aparece flotante cuando la card sale de pantalla; tap vuelve a la card; pausa propia.
- ☐ **Modo guiado** `_entGuiadoHtml` L36566 — "EJERCICIO N DE M", números tocables (`.filled` si tiene peso), barra, ejercicio actual, "Siguiente" (nunca exige datos) → en el último "Finalizar entrenamiento". El ejercicio actual se persiste (`s.e`) → si la app muere, retoma donde estaba.
- ☐ **Card de ejercicio + registro de series** `_entExCardHtml` L36446 — chip series×reps, cue, "Cómo se hace", nota (convierte "Intens set 3: …" en chip a la guía), filas `[reps] × [peso] kg ✓`. Sanitizado: peso dígitos+un punto (coma→punto, máx 6), reps máx 3 dígitos; **no tocar el valor mientras se compone** (bug teclado Samsung), limpiar al salir; vacío borra la clave. Cada input marca actividad (`_entSesTouch`) para el autocierre.
- ☐ **Arrastre de pesos** `loadEntrenoRef` L35044 — en campos vacíos, placeholder con el valor de la última semana *con pesos* + "sem. pasada". Emparejamiento por **nombre normalizado** vía snapshot `ex` (semanas viejas sin snapshot: por posición solo si toda la estructura calza). **Nunca copia solo** (no inventa pesos).
- ☐ **Terminar sesión** `entSesFinishAsk` L34517 — diálogo Terminar / Descartar / Seguir; aviso suave si duró <10 min (no bloquea).
- ☐ **Autocierre de sesiones olvidadas** `entSesAutofinSweep` L34856 — corre al renderizar, al volver al primer plano y tras hidratar, sobre **todas las semanas locales**. Regla: ≥3 h desde inicio **y** ≥45 min sin actividad → cierra con duración = última actividad + 10 min (sin actividad: tope 90 min); <10 min se descarta en silencio; toast "Tu entreno sin cerrar quedó guardado ✓".
- ☐ **Celebración "Entreno completado"** `showEntrenoCompletadoMoment` L33104 — medalla, "Día N de racha 🔥" (racha ≥2) o "Entreno #N" (count de `dias_entrenados`), duración + nombre del día, **Compartir** (imagen compuesta → share sheet nativo), confeti + brillo + vibración. Nunca al desmarcar ni en descanso.
- ☐ **Demo de ejercicio** `showEjercicioModal` L27480 — mp4 mudo en loop (`video_url`) o alterna 2 frames cada 700 ms, o texto "todavía no tenemos…". Datos: `ejercicios_biblioteca` completa (cache en memoria). Matching `_findEjercicioMatch` L27435 sobre `nombre_es` + `aliases[]`: exacto → contenido (largo más parecido) → ≥2 palabras en común.
- ☐ **Guía de intensificadores** `showIntensModal` L27691 — 7 técnicas fijas (TUT, negativa, pausa, dropset, cluster, rest-pause, superset) ES/EN; las de la rutina activa primero con badge; abre enfocada si viene desde un ejercicio.
- ☐ **Progresión de fuerza** `showProgresionModal` L35329 — selector de ejercicio (default: primero de hoy), gráfico del mejor peso por semana (12 sem), INICIO/ÚLTIMO/PROGRESO. Datos: `entreno_semanal` últimas 26 filas, caché compartida 60 s (`fetchEntrenoWeeksCached`, la usa también Home).
- ☐ **Récord personal** `_prCheck` L35927 — 900 ms después de tipear un peso que supera el máximo de *semanas anteriores*: brillo dorado + confeti + toast "🏆 ¡Récord personal! X kg (antes Y)" + vibración. Primer PR otorga logro `primer_record` en `user_logros`.
- ☐ **Chip de cardio** `_buildCardioChipHtml` L36156 — informativo ("CARDIO · 30 min · tipo · intensidad"), regla `parseCardioRule` (frecuencia entreno/todos/descanso).
- ✗ **No existe** timer de descanso entre series (el crono es duración total) — candidato a feature *nativa* post-paridad.
- ✗ **No portar:** layout V1 de Entreno (`?entrenov2=0`), `applyEntrenoRef` (botón retirado).

---

## 4. Mi Alimentación — Fase 3.2

**Modelo de datos.** Plan = fila de `planes_semanales` (tipo `dieta`, texto, `origen` ia/coach). Parse `parseDietaContenido` L33794 → `{header:{targetKcal,P,C,G}, days[7], notes[]}`; día = `{dayName, dayKey, meals[], totalKcal}` (0=Lun); comida = `{key, name, content, kcal, P, C, G}`. Las alternativas viven **en el texto** (`/` = elegí una → se muestra "o"; `+` = van juntas). Fallback texto plano del coach: `synthesizePlainTextDieta` L34141. **Tilde** = entrada `"d{i}m{j}"` en el jsonb `alimentacion_semanal.estado` (por usuaria + semana ISO): `{cumplido, customText?, customKcal?, customProt?, customCarbs?, customFat?}`, espejada como resumen diario a `progreso_diario` (lo que leen cierre, Progreso y chat).

- ☐ **Pantalla** `renderMiAlimentacion` L25785 — 4 estados: skeleton / "preparando" (dieta generándose) / vacío (CTA al chat) / con datos: card de objetivos (kcal P C G), resumen (comidas hechas/total, kcal hechas/plan, **anillos de macros**, barra), tips (solo King), lista de comidas. Kcal: verde a ±3% del plan, rojo 🚨 si se pasa >3% (animación solo al cambiar de estado). **Siempre abre en HOY.** Si el plan no trae kcal por comida pero sí target → reparte el target en partes iguales. El objetivo mostrado es siempre la **suma planificada** (así el exceso se ve como exceso).
- ☐ **Selector de días** `alimV2SelectDay` L25651 — LUN-DOM con fecha real de la semana calendario, hoy marcado, punto verde si hay alguna tilde, días fuera del plan deshabilitados. **Días futuros: se ven pero no se tildan ni editan.**
- ☐ **Card de comida** `_mealHtmlV2` — foto cuadrada decorativa (`img/alim/{desayuno|almuerzo|merienda|cena}-{1..3}.webp`, semilla `(día+comida)%3`, alias para pre/post-entreno/colación/snack), nombre, contenido (" · " en líneas), "· editada", check. Tap en card = detalle; check independiente.
- ☐ **Tildar comida** `toggleAlimComida` L26239 — debounce 500 ms → upsert `alimentacion_semanal` (cola offline) + `syncProgresoDiarioForDay` → upsert `progreso_diario` (4 columnas de texto fijas desayuno/almuerzo/merienda/cena + kcal y macros con prioridad custom > plan > proporción del header). **La fecha sale del lunes calendario + i**, no de la semana del plan.
- ☐ **Detalle de comida** `alimV2ShowDetail` L25679 — descripción completa, pills kcal/P/C/G/estado, "Editar comida" (deshabilitado en futuro).
- ☐ **Editar comida** `editAlimComida` L26254 / `saveAlimEdit` L26518 — textarea precargado. Texto igual al plan → cumplida con valores del plan, sin IA. Distinto → `estimateMealNutrition` L26422: **Open Food Facts** (solo si parece marca, timeout 1,5 s) → si no, `/api/chat` con prompt nutricionista que devuelve JSON. **Guardar siempre marca cumplida** (si la estimación falla, kcal null).
- ☐ **Completar día retroactivo** `openCompletarDia` L28614 — comidas del plan para ese día + "¿Entrenaste?". Escribe `progreso_diario` (+ `dias_entrenados`). ⚠️ No escribe `alimentacion_semanal` → hoy las dos fuentes pueden divergir (decidir en el port si se unifica).
- ✗ **No existen:** registro de comidas libres, foto de comida, modal de alternativas.
- ✗ **No portar (código muerto):** "Mi Día" legacy (`saveDiario`, `showMacrosEstimados`, `renderDiarioHistory`…), `renderPlainTextDieta`, layout V1 (`?alimv2=0`).
- **Del lado de generación (no es UI, pero condiciona):** origen IA → `saveWeeklyPlan` reconcilia kcal = 4P+4C+9G y valida consistencia (`dieta_consistency_alerts`); restricciones vegano/vegetariano se aplican **solo al generar** (`_bloqueRestriccionDieta` L23661). Post-cierre `autoRepeatPlans` clona el plan y `autoAdjustDiet` ajusta (±15%). Self-heal con `aiNormalizePlan` si no parsea. *Candidato a mover al servidor durante el port* (hoy lo orquesta el cliente).

---

## 5. Home — Fase 3.3

Carga: pinta síncrono desde caché, luego en paralelo anillo, insights, alimentación (`ensureAlimentacionLoaded`) y semanas. Cada widget aislado (si uno falla no tira los demás). Entrada en cascada (120 ms por card) + count-ups.

**Orden de aparición:**
1. ☐ Chip "i" de ayuda contextual (`showInfoModal('home')`).
2. ☐ **Banner "Tu coach te escribió"** — count de `notas_coach` con `de='coach'` y `leido=false` → abre el hilo.
3. ☐ **Banner "Preparando tu plan"** (post-onboarding).
4. ☐ ~~Card Índice de Armonía~~ (King, discontinuado → no portar salvo que quede cohorte).
5. ☐ **Hero rotativo**: *Entrenamientos X/N esta semana* (anillo con gradiente `#7c6aff→#5b9fff→#2ecfb5`; N = `getWeeklyTrainingTarget` L37375: rutina → `usuarios.dias_entreno` → 0; con N=0 anillo vacío, no 100%) ↔ *Tu progresión* (gráfico del ejercicio con mejor % de mejora; ≥3 semanas y delta positivo; tap → modal de progresión).
6. ☐ **Chip de racha** — ≥2 días seguidos registrando comidas (`computeStreaks`, 1 día de perdón, `progreso_diario` 90 días); llama chica días 1-3 del ciclo, grande 4-7.
7. ☐ **Chip del reto mensual** — *gated* `?reto=1` (ver §8).
8. ☐ **Grilla 2×2 de slots rotativos** (`initSlotRotator`: crossfade cada 8 s, siempre arranca en la 1ª slide funcional, fija si hay <2):

| Slot | Slide principal | Slides extra (solo si el dato es bueno) |
|---|---|---|
| Comida | **Próxima comida** (1ª sin tildar de hoy / "¡Día completo!") → Alimentación | Promedio 7 días (≥4 días, 80-110% del target) |
| Entreno | **Hoy toca** (grupo muscular, "Día N · X ej." / DESCANSO) → Entreno | Récord personal (últimas 2 sem) · Reto |
| Kcal | **Calorías hoy** (barras por comida, cumplidas vs pendientes) | Cierre semanal · Tu peso (si va a favor del objetivo) |
| Coach | **Coach AI** "Consultá lo que necesites" → Chat | Cardio (si aplica hoy) · Adherencia 4 sem (≥70%) |

9. ☐ **Seguimiento semanal** (cards por semana) — ver §6.
10. ☐ **Overlays encima**: gate de cierre libre y oferta de renovación de rutina (§6).

---

## 6. Perfil, cierre semanal y renovación — Fase 3.5

### Perfil (`renderPerfil` L32482) — orden: hero → progreso → transformación → logros → último análisis → notificaciones → idioma → mi plan → coach/soporte → suscripción → legales / cerrar sesión / eliminar cuenta
- ☐ **Hero** `renderPerfilHeroCard` L32042 — avatar (tap → Mis datos), nombre, objetivo, "Semana N", peso actual + delta vs `peso_inicial` (**"bueno" según objetivo**: bajar es bueno salvo en ganar músculo/volumen), racha 🔥, adherencia 4 sem (verde ≥75%).
- ☐ **Progreso de peso** `renderPerfilProgreso` L32315 — curva semanal (última pesada de cada semana ISO, `peso_inicial` como 1er punto), modal "Registrar mi peso" (30–250 kg) → upsert `progreso_peso` + `usuarios.peso`. **Empujón semanal** si tiene ≥1 cierre y no se pesó esta semana (descartable por semana; nunca en modo coach).
- ☐ **Transformación visual** `renderPerfilTransform` L32139 — carrusel INICIO (`fotos_progreso tipo='inicio'`) + SEM N (`cierres_semanales.foto_url`/`foto_url_espalda`), auto-scroll a la más reciente. **Lightbox** con swiper frente/espalda (umbral 15%, dots).
- ☐ **Foto de inicio** `renderFotoInicioCard` L27191 — solo si no existe; una sola vez e inmutable.
- ☐ **Subida de fotos** `uploadFoto` L27087 — compresión 1400 px JPEG .88; ruta `{uid}/{fecha}-{vista}-{ts}-{rand}.{ext}`, `upsert:false`; si falla el insert en `fotos_progreso` borra el blob; uid fijado al inicio. En RN: `expo-image-picker` + `expo-image-manipulator` (HEIC lo resuelve el sistema → la cadena de rescate HEIC→JPG de la PWA no hace falta).
- ☐ **Avatar** `uploadAvatarPhoto` L33215 — 400 px → `progress-photos/{uid}/avatar_{ts}.jpg` (path único: el bucket permite INSERT, no UPDATE) → `usuarios.avatar_url`. ⚠️ Bug en PWA: quitar avatar borra un path viejo y deja el archivo huérfano — no replicar.
- ☐ **Logros** `renderPerfilLogros` L32654 — catálogo `LOGROS_CATALOG` L32566 (19, con familias recurrentes `semana_perfecta_N`, `reto_mensual_YYYY-MM`), medalla destacada (`usuarios.logro_destacado` o la última), "Ver todas", grilla; tap en ganada = fijar/desfijar. **Otorgamiento** `checkAndAwardLogros` L32850: upsert `user_logros` (ignoreDuplicates); celebración leyendo `celebrado=false`, máx 3 en cola; en la 1ª sesión otorga en silencio. **Compartir logro**: canvas 1080×1920 con foto + medalla (`medals/<key>.webp`) → share nativo.
- ☐ **Mis datos** `openPerfilDatos` L32302 — avatar, nombre (obligatorio), email solo lectura, teléfono opcional → update `usuarios`.
- ☐ **Mi plan de la semana** `renderPerfilPlan` L33306 — cards plegables RUTINA / DIETA con estado ACTIVA / CERRADA / sin plan (→ chat).
- ☐ **Suscripción** `loadSubscriptionStatus` L30107 — badge Premium/Cancelada/Activo/Free + fecha; `/api/stripe/subscription-status` y `/api/stripe/cancel-subscription` (Bearer). En nativo convive con RevenueCat (Fase 4).
- ☐ **Eliminar cuenta** `openDeleteAccount` L30195 — escribir ELIMINAR/DELETE → `/api/delete-account` (Bearer) → signOut. **Requisito Apple 5.1.1(v) y Google.**
- ☐ **Coach / soporte** L20066–20123 — modal con dos modos: soporte → insert `feedback`; nota al coach → insert `notas_coach (de='cliente')` + hilo (últimas 50, marca leídas las del coach). Badge de no leídas en Perfil y banner en Home.
- ☐ **Ajustes**: idioma ES/EN · notificaciones (en nativo: push nativas, Fase 4).
- ✗ **No portar:** `openEditProfileForm` (huérfana), medidas King (`openMedidaCapture`), hero/progreso King, dark legacy.

### Cierre semanal
- ☐ **Reloj de semanas** `getWeekNum` L28109 / `getWeekRange` L28129 — cerradas usan su rango guardado; la 1ª abierta va del día siguiente al último cierre al domingo ISO (parcial); las siguientes lun-dom. `semana_num` = último cierre + 1.
- ☐ **Seguimiento semanal** `renderSemanas` L28196 — card por semana: SEM NN, rango, estado (En curso / Sin cerrar / Análisis pendiente / Completa), strip de 7 días, timeline, fotos, análisis en markdown; pasadas plegadas. Acciones: completar días, "Hacer mi análisis", REGENERAR. **Efectos:** `autoCloseEndedWeeks` L27934 inserta cierres vacíos para semanas terminadas (solo INSERT, nunca pisa análisis) y refresca stats de pendientes (solo si mejoran; con análisis quedan congeladas). Metas prorrateadas en semanas parciales.
- ☐ **Aviso de días faltantes** `attemptCierreSemana` L28702 — chips por día faltante (→ Completar día), "Cerrar igual" / "Completar ahora".
- ☐ **Modal de cierre** `openCierreSemana` L28801 — stats (entrenos/planeados, kcal/meta, proteína, días registrados/7), fotos de inicio + **2 slots obligatorios** (frente/espalda) → "Generar análisis" → sube fotos (`tipo='semana'`) → `generateWeeklyAnalysis` L29533 (`/api/chat` haiku con imágenes firmadas) → upsert `cierres_semanales` → recarga planes + `autoRepeatPlans` + logros. Guarda anti doble-tap; si falla el guardado, banner de reintento **sin volver a llamar a la IA**. Regenerar: máx 1/min por semana y 5/día.
- ☐ **Espera del análisis** `showAnalisisWait` L29117 — 7 frases rotando cada 4 s.
- ☐ **Gate de cierre libre** `renderCierreGateLibre` L30988 — overlay celebratorio, 1 vez por semana, cerrable, solo en Inicio/Coach/Perfil; nunca a coaches/admins/revisor ni antes de cargar cierres. (El gate bloqueante viejo `?cierrelibre=0` **no se porta**.)

### Renovación de rutina (L31034–31223)
- ☐ **Oferta cada 4 semanas** — tras cerrar el gate, si el último cierre es semana 4/8/12…, la usuaria es self-serve y la rutina activa es `origen='ia'` (**nunca** si es del coach). Wizard: pregunta → días → foco (glúteos / superior / fullbody / brazos / ninguno) → resumen → update `usuarios.dias_entreno` + `foco_entreno` → `prefetchPlan('rutina')` con overlay de 90 s. Si la IA falla, la rutina vieja sigue.

---

## 7. Chat con el Coach IA — Fase 3.4

- ☐ **Pantalla** `showChat` L37177 — historial completo (`historial_chat`), botones rápidos "Dieta" / "Rutina de la semana" (se ocultan si el plan está activo), "Pensando…" mientras espera, swipe a la derecha para salir. Header visible (único lugar).
- ☐ **Envío** `sendToAI` L25083 → `/api/chat` con `{system: buildSystemPrompt(), messages, model:'haiku'}` + `Bearer access_token`. **Respuesta JSON completa (hoy NO hay streaming)** → en nativo, streaming es una mejora opcional que requiere cambio de backend (decidir en 0.6/Fase 3.4). Reintentos: 2 con backoff 700 ms×intento ante red o 429/529. `daily_limit` → mensaje de límite; **401 y otros caen en "Error de conexión" genérico** (mejorar en nativo: 401 → re-login).
- ☐ **Historial** — `sanitizeTurnsForAPI` (empieza en user, roles alternados); upsert `historial_chat (usuario_id, fecha)` vía cola offline; últimos 7 días alimentan el system prompt. Si la sesión cambia a mitad, se descarta la respuesta.
- ☐ **Planes entregados por chat** — solo se guardan si el slot está libre (sin plan o cerrado) y con estructura válida (si no, `aiNormalizePlan`); dieta con clamp de kcal; **un plan activo nunca se pisa** (`plan_change_blocked`).
- ⚠️ `buildSystemPrompt` (con las REGLAS SUPREMAS de restricciones dietarias) vive hoy en el cliente: portarlo **idéntico** o, mejor, moverlo al servidor durante el port (una sola fuente de verdad para PWA y nativo).

---

## 8. Gamificación — Fase 3.6
- ☐ **Logros y medallas** — ver Perfil §6 (catálogo, otorgamiento, celebración, compartir).
- ☐ **Racha** — chip de Home + hero de Perfil.
- ☐ **Reto mensual** `renderRetoHome` L35494 / `openRetoDetail` L35537 — *gated* `?reto=1` al 2026-10-11. Objetivo default 16 entrenos/mes, cuenta días distintos de `progreso_diario.entreno` ∪ `dias_entrenados`, sin estado propio en DB; chip + slide en "Hoy toca" + modal (n/objetivo, barra, días restantes); medalla recurrente `reto_mensual_YYYY-MM`.

---

## 9. Fuera del alcance del port (se quedan en la web)
- **Studio** (`/studio`), **Tower** (`/tower`), **Cockpit** del tenant, panel admin dentro de `index.html` (`showAdminLogin` L38076, `renderBeta*`, `showAdminStudentDetail` L38539): herramientas de coach/negocio, siguen web.
- Landing B2B (`index-landing.html`), legales (`privacidad.html`, `terminos.html`, `eliminar-cuenta.html`) → links desde la app nativa.
- Mockups `*-mockup.html`, `presentacion-coaches.html`, manuales.

## 10. Tablas, RPCs y endpoints que toca el cliente (semilla para la tarea 0.6)
- **Tablas:** `usuarios` · `tenants` · `beta_invitados` · `beta_eventos` · `planes_semanales` · `entreno_semanal` · `dias_entrenados` · `alimentacion_semanal` · `progreso_diario` · `progreso_peso` · `cierres_semanales` · `fotos_progreso` · `user_logros` · `historial_chat` · `notas_coach` · `feedback` · `ejercicios_biblioteca` · `dieta_consistency_alerts` · `king_intake` / `king_medidas` (legacy King).
- **RPCs:** `auth_resolve_session` · `get_my_migration` · `stores_coach_directory`.
- **Storage:** bucket privado `progress-photos` (fotos de progreso + avatares).
- **Endpoints Vercel:** `/api/chat` · `/api/stripe/subscription-status` · `/api/stripe/cancel-subscription` · `/api/delete-account` · `/api/play/verify` · `/api/play/refresh`. (Push y crons: lado servidor.)
- **Externos:** Open Food Facts (estimación de comidas de marca).

## 11. Hallazgos para decidir antes / durante el port
1. **Lógica de negocio pesada en el cliente** — generación y validación de planes, `buildSystemPrompt`, `autoRepeatPlans`/`autoAdjustDiet`, `autoCloseEndedWeeks`. Portarla tal cual = duplicarla en dos apps. Propuesta: moverla a endpoints del servidor *antes* de la Fase 3 (la PWA también se beneficia). → discutir en 0.6.
2. **Tildes de alimentación con dos fuentes** (`alimentacion_semanal` vs `progreso_diario` vía "Completar día") que pueden divergir.
3. **Chat sin streaming** y 401 sin manejo propio.
4. **Sin timer de descanso entre series** — oportunidad de feature nativa (con notificación local y Live Activity).
5. **Método King discontinuado** — confirmar si queda cohorte activa; si no, todo lo King-método se descarta del port (el *tema* King de Jesús sí se porta).
6. **Comentarios de flags desactualizados**: `?progresion` y `?pr` dicen "OFF por default" pero el código los deja LIVE.
