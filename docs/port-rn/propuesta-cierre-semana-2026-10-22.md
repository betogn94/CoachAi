# Propuesta de backend: el cierre semanal EN EL SERVIDOR (3.5.e del port)

**Estado: APROBADA por Beto 2026-10-22 (sí a D1–D5, opción A en D3) → IMPLEMENTADA en el repo
(`api/cierre-semana.js` + helpers en `api/_chat-contexto.js` + funciones del cierre en el cerebro generado +
`npm run test:cierre-semana`, 45 chequeos offline). Pendiente: env vars en Vercel + redeploy + QA real (§5).**

**QA real 2026-10-22 OK** (cuenta de Beto): `autocerrar` sin escrituras (semana en curso, planes activos);
`analizar` Semana 1 → 4 fotos firmadas, Haiku 12 s, análisis de 2.352 chars con comparativa de fotos,
cierre guardado, sin clon (planes activos), medalla ya existente no duplicada, tope +1; la regeneración
pasó una vez y la segunda la frenó el cooldown sin gastar.

**Decisión posterior de Beto (reemplaza D4): SIN regeneración.** El botón se saca de la app y el servidor
responde 409 `ya_analizado` a una semana con análisis. La única segunda vez es cuando falló la IA o el
guardado (el cierre quedó sin análisis). Motivo: aun con límite, 5 por día por clienta son tokens tirados.

Ajuste sobre la propuesta: `analizar` sin `fotos` en el body usa las que ya tiene el cierre (como el
Regenerar de la PWA, `cierre.foto_url`); sirve para analizar un cierre del autocierre al que ya se le
cargaron fotos, y para el QA con la Semana 1 de Beto.
Segunda propuesta de backend del port (la primera fue `/api/chat-message`, 3.4.b/c). Misma regla de oro:
aditivo, detrás de un interruptor, con rollback sin deploy, sin DDL, sin tocar `api/chat.js`, `api/_origin.js`
ni `index.html`.

## 1. Qué hace hoy la PWA al cerrar una semana (en el teléfono)

Fuente: `index.html`. Siete pasos que hoy corren en el navegador de la clienta:

| # | Paso | Función | Qué toca |
|---|------|---------|----------|
| 1 | Stats de la semana (entrenos, kcal/día, proteína, días registrados, semana parcial) | `computeWeekStats` L28334 sobre `recentDiario` + `dias_entrenados` | lee |
| 2 | Sube las 2 fotos de la semana (frente + espalda) | `uploadFoto(file,'semana',vista)` L27266 | bucket + `fotos_progreso` |
| 3 | Pide el análisis a Haiku **con las 4 fotos** (inicio frente/espalda + semana frente/espalda, firmadas) | `generateWeeklyAnalysis` L29712 → `/api/chat` | 1 llamada IA |
| 4 | Guarda el cierre | upsert `cierres_semanales` (usuario_id, semana_num) con fechas, `semana_iso`, `foto_url`, `foto_url_espalda`, `analisis`, `stats` | escribe |
| 5 | Reabre el ciclo: clona dieta y rutina cerradas a la semana ISO actual | `autoRepeatPlans` L20541 | upsert `planes_semanales` |
| 6 | Ajusta la dieta clonada con IA según el análisis (regla de oro: por default igual; clamp ±15 % de kcal) | `autoAdjustDiet` L20669 → `adjustDietViaAI` L20622 → `/api/chat` | 1 llamada IA + update `planes_semanales` |
| 7 | Otorga logros (`primer_cierre`, `semana_perfecta_N`) | `checkAndAwardLogros` L33029 | upsert `user_logros` |

Además, **"efectos al abrir"** que la PWA corre cada vez que se abre (y que la nativa hoy NO hace, nota B3
pendiente desde 3.1.a):

| Efecto | Función | Qué hace |
|---|---|---|
| Autocierre (cierre libre) | `autoCloseEndedWeeks` L28113 | inserta cierres VACÍOS (sin análisis, con stats) para semanas ya terminadas sin cierre; nunca pisa |
| Stats de pendientes | `refreshPendingCierreStats` L28161 | recalcula stats de cierres sin análisis si cargó datos retro (solo si mejoran) |
| Reabrir ciclo tras autocierre | `reabrirCicloPostCierre` L28189 | = paso 5 (+6 si hay análisis previo) |
| Gate celebratorio | `renderCierreGateLibre` L31167 | overlay "¡Terminaste tu semana N!" una vez por semana, invita al análisis |

Lo que NO se porta: el puntaje King (`kingCierreCalcula` / checkpoint visual; método discontinuado → el prompt
va con `indiceCtx = null`, idéntico al camino no-King), el gate bloqueante viejo (`?cierrelibre=0`) y el
rate-limit en localStorage (pasa a ser real, en el servidor).

## 2. Lo que se propone

### 2.1 Un endpoint aditivo: `POST /api/cierre-semana` (`api/cierre-semana.js`)

Mismo esqueleto que `api/chat-message.js`: Origin + Bearer (`identifyUser`), usuaria por `auth_id` con la
service key, `maxDuration: 60`. Tres acciones en el body (`{ accion, ... }`):

| Acción | Cuándo la llama la nativa | Qué hace el servidor | IA |
|---|---|---|---|
| `autocerrar` | al abrir la app y al entrar al Perfil (reemplaza los "efectos al abrir") | `autoCloseEndedWeeks` + `refreshPendingCierreStats` + `autoRepeatPlans` (rutina Y dieta) + `autoAdjustDiet` si hay un análisis reciente | 0 (1 solo si ajusta dieta) |
| `analizar` | "Generar análisis" en la hoja de cierre, con las 2 fotos YA subidas por la nativa | stats de la semana (del lado del servidor, con los datos de la base, nunca del cliente) → firma las 4 fotos → `generateWeeklyAnalysis` → upsert `cierres_semanales` → `autoRepeatPlans` + `autoAdjustDiet` → logros del cierre | 1 (+1 si ajusta dieta) |
| `analizar` sobre una semana que YA tiene análisis (= "Regenerar") | botón REGENERAR de la card | lo mismo, con **rate-limit real en el servidor**: 60 s entre regeneraciones de la misma semana y 5 por día (hoy está en localStorage, bypasseable) | 1 |

Respuesta de `analizar`: `{ semana_num, analisis, analisis_html, stats, planes: { rutina: 'clonada'|'sin_cambios', dieta: 'clonada'|'ajustada'|'sin_cambios' }, logros: [...] }`.

### 2.2 El cerebro: las funciones del cierre se GENERAN desde `index.html`

Igual que el chat: `scripts/build-chat-prompt.mjs` suma a `FUNCIONES` las del cierre
(`generateWeeklyAnalysis` con su prompt byte a byte, `computeWeekStats`, `getWeekNum`, `getWeekRange`,
`_lastCierre`, `_addDaysStr`, `_isoKeyOfStr`, `isoWeekRange`, `isoWeekShift`, `isoWeeksBetween`,
`adjustDietViaAI`, `autoRepeatPlans`/`autoAdjustDiet` en su lógica pura, `stripLeadingDietFromRutina`,
`dietaAvgDayKcal`) y `api/_chat-cerebro.js` se regenera (`npm run chat:cerebro`). Mientras la PWA viva,
`index.html` sigue siendo la fuente de verdad del prompt del análisis: cambiar el prompt = cambiar
`index.html` + regenerar + commitear, como ya pasa con el chat.

El `fetch('/api/chat')` interno de esas funciones se reemplaza por una función inyectada que llama al SDK de
Anthropic (Haiku, mismo modelo que la PWA) con las imágenes como `{ type: 'image', source: { type: 'url' } }`,
exactamente lo que hoy manda la PWA.

### 2.3 Fotos

La nativa sube las dos fotos de la semana ANTES de llamar (ya existe `subirFoto(tipo:'semana', vista)` desde
3.5.c: bucket privado + `fotos_progreso`, igual que `uploadFoto`). Manda las dos URLs públicas. El servidor:
- valida que las dos rutas estén dentro de la carpeta `{usuarios.id}/` de la usuaria (si no → 403);
- busca las de inicio en `fotos_progreso` (frente = vista 'frente' o legacy sin vista; espalda = vista 'espalda');
- firma las 4 con la service key (`/storage/v1/object/sign/...`, 1 h) y se las da a la IA.
Si el análisis falla, las fotos quedan subidas (igual que la PWA) y la nativa ofrece reintentar sin volver a subir.

### 2.4 Tope y costo

Cada llamada a la IA del cierre descuenta del MISMO tope diario que el chat (`chat_uso_incrementa`, 120/día),
como hoy (la PWA pasa por `/api/chat`). Un cierre normal = 1 llamada (análisis) + a lo sumo 1 (ajuste de
dieta). Haiku con 4 imágenes ≈ 5–10 ¢ por análisis.

### 2.5 Interruptores y rollback

- `CIERRE_SEMANA_ENABLED=1` → si falta, el endpoint responde 404 y la nativa muestra "El cierre todavía no
  está disponible en esta versión" (nada se rompe; la PWA sigue cerrando como siempre).
- `CIERRE_SEMANA_ALLOW=<auth uid>[,…]` → mientras esté seteada, solo esas cuentas + `usuarios.es_interno`
  (QA: Beto y la cuenta `+light`).
- Rollback total: apagar la env var (sin deploy) o borrar `api/cierre-semana.js`. Sin DDL, sin columnas nuevas.
- Beto carga las env vars en el dashboard de Vercel (Production + Preview) y se redeploya con un commit vacío
  (el MCP de Vercel de esta cuenta no escribe env vars).

### 2.6 Convivencia con la PWA

Las dos apps escriben lo mismo con las mismas claves (upsert por `usuario_id + semana_num`,
`usuario_id + tipo + semana_iso`), así que una semana cerrada desde la nativa la ve la PWA y viceversa, y
el autocierre es idempotente (`ignoreDuplicates`). Si la PWA ya cerró la semana, `analizar` desde la nativa
la trata como regeneración (rate-limit).

## 3. Lo que escribe (todo en tablas que la PWA ya escribe igual)

| Tabla | Operación | Clave | Igual que |
|---|---|---|---|
| `cierres_semanales` | upsert | `usuario_id, semana_num` | `ejecutarCierreSemana` / `autoCloseEndedWeeks` |
| `planes_semanales` | upsert (clon) / update (ajuste) | `usuario_id, tipo, semana_iso` | `autoRepeatPlans` / `autoAdjustDiet` |
| `user_logros` | upsert `ignoreDuplicates` (`primer_cierre`, `semana_perfecta_<n>`, `celebrado=false`) | `usuario_id, logro_key` | `checkAndAwardLogros` (la celebración en la nativa es 3.6) |
| `beta_eventos` | insert (`cierre_auto`, `cierre_stats_refresh`, `plan_auto_repeated`, `diet_auto_adjusted` / `diet_adjust_clamped` / `diet_adjust_failed`, `cierre_regenerado`) | — | `trackEvent` + `app: 'native'` |

Nada de `alimentacion_semanal`, `entreno_semanal`, `usuarios` ni storage (las fotos las sube la nativa).

## 4. Tests offline (antes de deployar, como con el chat)

`scripts/test-cierre-semana.mjs` (`npm run test:cierre-semana`):
1. **Prompt byte a byte**: el `system` y el `user` que arma el cerebro generado == lo que arma
   `generateWeeklyAnalysis` de `index.html` con un `fetch` falso, en 6 perfiles × semanas completas/parciales
   × con/sin fotos de inicio.
2. **Reloj y stats del servidor == la nativa**: `getWeekNum`/`getWeekRange`/`computeWeekStats` generados vs
   `features/perfil/semanas.ts` (que ya tiene paridad con `index.html`) sobre los procesos sintéticos de
   `paridad-semanas.mjs`.
3. **Handler offline** con `fetch` falso: 404 apagado · 401 sin token · allowlist · 403 foto de otra carpeta ·
   `autocerrar` inserta solo semanas terminadas y nunca pisa · `analizar` arma la fila correcta · regeneración
   bloqueada por rate-limit · ajuste de dieta clampeado · tope diario.

## 5. Plan de ejecución (con el OK)

1. Generador: sumar las funciones del cierre a `FUNCIONES` → `npm run chat:cerebro` → `chat:cerebro:check`.
2. `api/cierre-semana.js` (+ helpers nuevos en `api/_chat-contexto.js`: firmar fotos, upsert cierre, logros).
3. Tests offline (§4) en verde. Commit al repo de la PWA (aditivo; `npm run test:chat-message` sigue verde).
4. Beto carga `CIERRE_SEMANA_ENABLED=1` y `CIERRE_SEMANA_ALLOW=7c308e20-a63d-42d5-8df3-2bf700f1bf15` →
   redeploy (commit vacío).
5. QA real, en la cuenta de Beto, en este orden: `autocerrar` (sin IA; verificar en la base que no inserta
   nada que no corresponda) → `analizar` la **Semana 1** (ya tiene sus fotos "después" y las de inicio) →
   verificar `cierres_semanales.analisis`, el clon de planes y `user_logros` → `analizar` otra vez
   (regeneración + rate-limit).
6. Recién después, la parte nativa (parte 2 de 3.5.e): hoja "Cerrar semana" (stats + 2 fotos + Generar
   análisis + espera con las 7 frases), gate celebratorio una vez por semana, "Hacer mi análisis" en las
   cards del Seguimiento, aviso de días faltantes (reusa Completar día), y la llamada a `autocerrar` al
   abrir la app.

## 6. Decisiones que necesita Beto

- **D1.** OK a crear `api/cierre-semana.js` aditivo con los interruptores de §2.5. (Sin esto no se toca nada.)
- **D2.** Autocierre + clon de planes al abrir la app **desde el servidor** (`autocerrar`), incluida la DIETA que
  hoy la nativa no clona. Esto cierra la nota B3 pendiente de 3.1.a.
- **D3.** Logros del cierre otorgados por el servidor (`primer_cierre`, `semana_perfecta_N`) con
  `celebrado=false`, y la celebración queda para 3.6. Alternativa: no otorgar logros hasta 3.6.
- **D4.** Rate-limit de regeneración en el servidor (60 s / 5 por día), que hoy es de adorno en localStorage.
- **D5.** King: sin puntaje del Índice (método discontinuado).

Costo del QA: 2–3 llamadas a Haiku con imágenes (≈ 30 ¢).
