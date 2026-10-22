# Port a React Native — traspaso "Perfil + cierres, parte 2" (2026-10-22)

Para seguir la **3.5** en una conversación nueva (la anterior llegó al tope de contexto). Fuente de verdad:
el tablero [`../plan-port-react-native.md`](../plan-port-react-native.md) (3.5.a–d, x, y ✅; falta
**3.5.e parte nativa 2, 3.5.f, 3.5.g**), la memoria `port_react_native.md`, el traspaso general
[`handoff-perfil-2026-10-15.md`](handoff-perfil-2026-10-15.md) (reglas, cómo levantar, gotchas iOS 26) y la
propuesta de backend aprobada [`propuesta-cierre-semana-2026-10-22.md`](propuesta-cierre-semana-2026-10-22.md).

## 0. Reglas (no cambian)

- 🔥 Regla de oro: jamás poner en riesgo la base ni la PWA. Cero código PWA (solo lectura como espec), cero
  DDL. Escrituras de QA solo en la cuenta de Beto (`beto131312@gmail.com`, `usuarios.id`
  `5716a081-2c4d-4eab-be06-98006c271e06`, auth `7c308e20-a63d-42d5-8df3-2bf700f1bf15`) o `+light`, con OK.
- Protocolo: brief (qué · resultado esperado · motor) → ejecutar → QA de Beto en el iPhone (Expo Go) →
  verificar en Supabase (`vmvhlgzwufkardaruutt`, solo lectura salvo OK) → corregir → tildar → commit → memoria.
- Siempre en español rioplatense. Repos: nativa `C:\Users\BETO\Desktop\coachai-native` (push `origin HEAD:main`,
  NUNCA `git add -A`, commits con heredoc `git commit -F -`); PWA `C:\Users\BETO\Desktop\coachai` (docs en
  `docs/`, worktree → `git fetch origin main && git merge --ff-only origin/main` antes, push a main después).
- Metro: `npx.cmd expo start --tunnel` desde la RAÍZ de coachai-native (tab del panel de terminal); túnel
  `exp://fgxvw0m-betogn-8081.exp.direct` (verificar `curl .../status`; QR en `.expo/qr.png`). Chequeos antes
  de QA: `npx tsc --noEmit` · `npx.cmd expo lint` · `npm run paridad*` (incl. `paridad:perfil`, `paridad:semanas`).
  En el repo PWA, si se toca el server: `npm run test:cierre-semana` y `npm run test:chat-message`.
- Cuota de Fable: lo de pantalla va con **Opus 5.5**; Fable para backend/paridad fina.

## 1. Lo que ya existe en el Perfil nativo (3.5.a–d, x, y, e-servidor)

`src/app/(tabs)/perfil/index.tsx` + `src/features/perfil/*`:
- **Perfil "tu página"** (Instagram): portada rotativa/editable, avatar editable, 3 números, bio, botones
  Editar datos / Tu entrenador, **destacadas** (fotos de cada cierre + Inicio → `/comparar` lado a lado),
  tarjeta Peso (→ `/(tabs)/perfil/peso`), pestañas **Semanas · Plan · Logros**; Ajustes tras el engranaje.
- **Semanas** = Seguimiento semanal real (`semanas.ts` = reloj ISO híbrido con paridad `paridad:semanas`,
  3 M comparaciones): card por semana con estado, tira de días, entrenos/objetivo; desplegada: 3 stats,
  "Días sin registrar" (chips → `/completar-dia`), "Ver tu comparativa", análisis (`TextoHtml`), y
  **"Hacer mi análisis"** cuando el cierre está pendiente y YA tiene sus 2 fotos.
- **Hojas en el stack raíz** (`src/app/*.tsx`, `presentation:'modal'` + "Listo"): `entrenador`, `soporte`,
  `fotos-inicio`, `completar-dia`, `comparar`.
- **Subida de fotos**: `features/perfil/fotos.ts` → `subirFoto(usuarioId, uri, tipo:'inicio'|'semana', vista)`
  (port de `uploadFoto`: 1400 px JPEG, `{id}/{fecha}-{vista}-{ts}-{rand}.jpg`, insert `fotos_progreso`) y el
  selector `elegirImagen` de `portada.ts` (PHPicker, SIN `allowsEditing`: el editor nativo abre el selector
  viejo y tarda; además en iOS el recorte nativo es siempre cuadrado).
- **Cierre (3.5.e, servidor)**: `/api/cierre-semana` LIVE con `CIERRE_SEMANA_ENABLED=1` y allowlist
  `CIERRE_SEMANA_ALLOW` = auth uid de Beto (+ `es_interno`). Cliente: `lib/api.ts postCierreSemana`,
  `features/perfil/cierre.ts` (`useAutocerrar` en el layout de tabs y en Perfil, cada 10 min;
  `useAnalizarSemana`; `mensajeErrorCierre`), `cierre-ui.tsx` (`EsperaAnalisis`, 7 frases).
  - `autocerrar` = autocierre + statsfix + clon de rutina Y dieta + ajuste de dieta (cierra el viejo B3).
  - `analizar { semana_num, fotos? }` = stats del server, 4 fotos firmadas, análisis byte a byte con la PWA,
    upsert `cierres_semanales`, clon/ajuste, logros `primer_cierre` / `semana_perfecta_N` (celebrado=false).
    Sin `fotos` usa las del cierre. **409 `ya_analizado` si ya tiene análisis: NO hay regeneración (decisión
    Beto).** Solo se re-pide si quedó sin análisis (falló IA o guardado).
  - QA real hecho el 22/10 con la Semana 1 de Beto (análisis guardado; tiene fotos "después" en el cierre y
    "antes" como inicio). Costo ≈ 1 llamada Haiku por análisis (+1 si ajusta la dieta).

## 2. Lo que falta de 3.5.e (nativa, parte 2) — Opus

Port de `openCierreSemana` L28980 / `ejecutarCierreSemana` L29339 / `attemptCierreSemana` L28881 /
`renderCierreGateLibre` L31167 / `applyCierreGate` L31123 de `index.html`:
1. **Hoja "Cerrar semana"** (`src/app/cerrar-semana.tsx`, modal): cabecera "SEMANA N · rango", 4 stats
   (entrenados/objetivo con % adherencia, kcal/día vs target, proteína vs target, días registrados/7)
   calculadas con `armarSemanas`/`computeWeekStats` de `semanas.ts`; fotos de **inicio** (frente/espalda,
   firmadas) + **2 slots obligatorios** para las de esta semana (`elegirImagen` sin recorte); botón
   "Generar análisis de mi semana" deshabilitado hasta tener las 2 → sube las 2 con `subirFoto(...,'semana',vista)`
   (en paralelo; si una falla, aviso y reintento sin re-subir la que entró) → `useAnalizarSemana({ semana,
   fotos:{frente,espalda} })` con `EsperaAnalisis` → muestra el análisis (`TextoHtml`) y cierra. Si la IA
   falla, las fotos quedan subidas y se reintenta `analizar` sin fotos (el server toma las del cierre).
   Se abre desde la card de Semanas ("Hacer mi análisis" cuando el cierre pendiente NO tiene fotos) y desde
   el gate.
2. **Aviso de días faltantes** antes de abrir la hoja (`attemptCierreSemana`): si la semana tiene días
   `completable` (de `diasTira`), hoja/alert con los chips (→ `/completar-dia`), "Completar ahora" /
   "Cerrar igual".
3. **Gate celebratorio** (`renderCierreGateLibre`, cierre libre): al entrar a Inicio/Coach/Perfil, si hay un
   cierre SIN análisis (`pendingAnalisisWeek` = el más reciente) y no se vio esta semana (AsyncStorage
   `cai_cierre_visto_<uid>_<semana>`), un overlay "¡Terminaste tu semana N!" con "Hacer mi análisis" y X.
   Nunca a coaches/admins; nunca antes de que carguen los cierres.
4. Tildar **3.5.e** en el plan (ya con el servidor hecho) y actualizar `port_react_native.md`.

## 3. Después: 3.5.f y 3.5.g

- **3.5.f Renovación de rutina cada 4 semanas (Fable)**: wizard L31034–31223 (días + foco → `usuarios`) +
  generación de la rutina **en el servidor** (`/api/plan-generate`, aditivo, el mismo que usará 3.6.x; reusa
  `crearCerebro` + `guardarPlan`). Solo `origen='ia'` y self-serve; se ofrece tras el gate cuando el último
  cierre es semana 4/8/12 (`maybeOfferRenovacion`). Va con propuesta de backend + OK de Beto, como 3.5.e.
- **3.5.g Suscripción + eliminar cuenta (Opus)**: `/api/stripe/subscription-status` y `cancel-subscription`
  (Bearer; `cabecerasApi` ya sirve), `/api/delete-account` con "ELIMINAR" (Apple 5.1.1(v)). Las filas ya
  están en Ajustes (`src/app/(tabs)/perfil/ajustes.tsx`) con "Pronto".

## 4. Datos de la cuenta de Beto hoy (no resetear)

Alta `2026-10-15`, 3 días/sem, 78 kg (datos editados para capturas). Cierre **Semana 1** (15–18/10) CON
análisis y fotos "después" (`851e7a67-9fd5-4472-9f4c-0524455a1b92`); fotos de inicio = las "antes"; Semana 2
(19–25/10) en curso con días completados 19–21; planes W43 activos (dieta `ia` 2560 kcal "Comida 1–4" sin
kcal por comida → todo depende de `repartirObjetivo`; rutina `coach`). Portada propia + avatar en el bucket.
`+light` (`e2e10f8c-7633-42a4-9a25-f9facfd41858`) sirve para probar "desde cero".

## 5. Gotchas nuevos de esta conversación

- Canva `generate-image` devuelve miniaturas; Beto baja las originales a Descargas con el nombre del asset.
- El botón flotante de Expo Go tapa el engranaje de Ajustes del Perfil → arrastrarlo.
- `useMemo` en pantallas con React Compiler → "Could not preserve existing manual memoization": no usar.
- Extractor del cerebro (`scripts/build-chat-prompt.mjs`): conserva `async` y salta las llaves de un
  parámetro por defecto; los tests con `new Date()` real caducan → usar `getTodayKey()` del cerebro.
- `test-cierre-semana.mjs`: la PWA captura `_trainedDatesSet` al crearse (mutar el Set, no reemplazarlo).
- Verificar la fecha de alta en la base antes de afirmar cosas sobre "semana N".

## 6. Prompt sugerido

> Sos la sesión del port de CoachAI Pro a React Native, sección **Perfil + cierres, parte 2** (3.5.e nativa,
> 3.5.f, 3.5.g). Leé primero `docs/port-rn/handoff-cierre-2026-10-22.md`, después la memoria
> `port_react_native.md`, el tablero `docs/plan-port-react-native.md` y `handoff-perfil-2026-10-15.md`.
> Regla de oro: jamás poner en riesgo la base ni la PWA; backend solo aditivo con propuesta, rollback y mi OK.
> Protocolo por tarea. Siempre en español. Arrancamos por la hoja "Cerrar semana" (3.5.e parte 2) con Opus 5.5:
> presentame el brief.
