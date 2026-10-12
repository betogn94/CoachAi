# Contrato de la API — lo que la app nativa consume

> Tarea **0.6** del [plan del port](../plan-port-react-native.md). Relevado el 2026-10-11 leyendo `api/`, `middleware.js`, `vercel.json` e `index.html`. Complementa el [inventario de pantallas](inventario-pantallas.md).
> **Regla de oro:** el backend no cambia de forma; la app nativa respeta este contrato tal cual. Donde un cambio es **inevitable**, se hace *retrocompatible* (la PWA sigue funcionando igual) y se marca acá como **🔧 cambio de backend**.

---

## TL;DR — veredicto

La app nativa habla con el backend por **dos caminos**, igual que la PWA:

1. **Directo a Supabase** (supabase-js + sesión OTP + RLS por usuaria) → ✅ **funciona igual desde nativo, sin cambios.** Es ~80% del tráfico (leer planes, guardar entrenos, tildes, peso, fotos, logros…).
2. **Endpoints de Vercel `/api/*`** (IA, Stripe, borrar cuenta) → ❌ **hoy rechazan a una app nativa.** Hay **3 cambios de backend necesarios**, chicos y retrocompatibles (ver §4).

| # | Cambio de backend | Por qué | Cuándo |
|---|---|---|---|
| **B1** | Aceptar llamadas **sin `Origin`** si traen un token de sesión válido | `_origin.js` exige `Origin`/`Referer` de nuestro dominio; una app nativa no los manda → **403 en todos los `/api/*`** | Antes de la **0.7 / Fase 2** (lo primero que choca) |
| **B2** | Push nativas: guardar **Expo push tokens** y que el cron les mande por Expo | Hoy las push son *web push* (VAPID), que en nativo no existe | Fase 4 (push nativas) |
| **B3** | Mover el "cerebro" (prompts y generación de planes) **al servidor** | Hoy el cliente arma el system prompt y orquesta la IA → portarlo = duplicarlo en 2 apps | Recomendado **antes de la Fase 3** (dic 2026) |

---

## 1. Autenticación (cómo se identifica la app)

- **Supabase Auth con OTP por email** (código de 6 dígitos — *no* magic link, así que **no hace falta deep link** para el login).
  - Pedir código: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` → 429 si hay rate limit.
  - Verificar: `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
  - Resolver la sesión de negocio: RPC **`auth_resolve_session(p_email, p_nombre, p_entry_tenant_slug, p_is_trial)`** → `wrongTenant` | `notInvited` | `betaFull` | `{ user, isNew, trial }`.
- **Cuenta revisora** `review@coachaipro.ai`: no recibe mail → el código se valida con `signInWithPassword` (receta en la memoria `ios_launch`). **La nativa la necesita para la review de Apple.**
- **Sesión en nativo:** `supabase-js` con `storage` = `expo-secure-store` (llavero cifrado), `autoRefreshToken: true`, `detectSessionInUrl: false`.
- **Para los `/api/*`:** header `Authorization: Bearer <access_token>` (el `access_token` de la sesión de Supabase). Todos los endpoints validan el token contra `GET {SUPABASE_URL}/auth/v1/user` — no hay JWT casero.
- **Config pública que lleva la app** (no son secretos): `SUPABASE_URL` y la **anon key**. Nunca la service role.

---

## 2. Endpoints de Vercel que consume la app cliente

Base: `https://coachaipro.ai` (la nativa debe usar **URL absoluta**; la PWA usa rutas relativas).
Todos son `POST`, JSON, y hoy pasan por el guard `isAllowedOrigin` (→ **B1**).

### `POST /api/chat` — proxy de IA (el más usado: 8 llamadas distintas)
- **Auth:** `Bearer` obligatorio (`AUTH_MODE='enforce'` desde 2026-09-23). Si Supabase Auth está caído → *fail-open* (deja pasar).
- **Request:** `{ system: string, messages: [{role, content}], model: 'haiku' | 'sonnet' }`
  - `messages[0].role` debe ser `'user'`; `content` puede ser string o bloques (incluye `{type:'image', source:{type:'url', url}}` con URLs firmadas para el análisis de cierre).
  - Límites: ≤100 mensajes · `system` ≤100.000 caracteres · `messages` serializado ≤200.000 → si no, **413** `payload_too_large`.
  - `model` es un **alias**; el servidor lo mapea (hoy `haiku` → Claude Haiku 4.5, `sonnet` → Claude Sonnet 4.6). Nunca acepta un model id del cliente. `system` >4000 caracteres se cachea (prompt caching).
- **Response 200:** el objeto `Message` de Anthropic completo → la app lee `content[0].text`. **Sin streaming.**
- **Errores:** `403 forbidden_origin` · `401 {error:'auth_required', retryable:false}` · `429 {error:'daily_limit', retryable:false}` (tope **120/día** por usuaria, env `CHAT_DAILY_LIMIT`) · `400` mensajes inválidos · `413` · `503 {retryable:true}` (Anthropic saturado, tras 4 reintentos del SDK) · `500 {retryable:false}`.
- **Headers de diagnóstico:** `x-chat-ident` (`ok|missing|invalid|error`) y `x-chat-used` (llamadas de hoy).
- **Quién lo usa en la PWA:** chat con el coach · generación de planes en el onboarding y renovación · `adjustDietViaAI` (ajuste post-cierre) · `estimateMealNutrition` (editar comida) · análisis del cierre semanal (con fotos) · `aiNormalizePlan` (reformatear planes rotos) · checkpoint visual King (legacy) · panel admin.
- ⚠️ Hoy es un **proxy genérico**: el *cliente* manda el prompt completo. Ver **B3**.

### `POST /api/stripe/subscription-status`
- **Auth:** `Bearer` → el servidor deriva el email del token (nunca del body).
- **Request:** sin body.
- **Response:** `{ plan:'premium', status, renovacion (ISO), cancelAtPeriodEnd, trialing }` o `{ plan:'none' }`.
- **Errores:** `403` · `401 no_auth` · `500 server_error`.

### `POST /api/stripe/cancel-subscription`
- **Auth:** `Bearer` (email del token).
- **Request:** sin body.
- **Response:** `{ ok:true, accesoHasta }` o `{ ok:true, alreadyCancelled:true, accesoHasta }` (idempotente). Cancela a fin de período y marca la baja en nuestra base al instante.
- **Errores:** `403` · `401` · `404 no_subscription` · `500`.
- **Nativo iOS:** ojo con anti-steering — cancelar una sub de **Stripe** desde la app iOS es válido (no es venta); las subs **in-app** se cancelan desde Ajustes de Apple (RevenueCat, Fase 4).

### `POST /api/delete-account` — requisito Apple 5.1.1(v)
- **Auth:** `Bearer`; el `auth.uid()` del token debe ser el **dueño** (`usuarios.auth_id`).
- **Request:** `{ usuario_id, email }` (deben coincidir con una fila real).
- **Response:** `{ ok:true }`. Borra fotos del bucket, tablas hijas, `beta_invitados`, la fila de `usuarios` (cascada) y la identidad de Auth. `tower_revenue` queda anonimizada.
- **Errores:** `403 forbidden_origin|not_owner` · `401 no_auth|invalid_token` · `400 faltan_datos` · `404 no_match` · `500`.

### `POST /api/play/verify` y `POST /api/play/refresh` — Google Play Billing (solo Android)
- **Auth:** `Bearer` (dueño) + `purchaseToken` que no puede estar atado a otra usuaria.
- Setean `usuarios.acceso_hasta` y `play_sub_state` según Google Play Developer API.
- **En nativo:** se reemplazan por **RevenueCat** (Fase 4), que tiene sus propios webhooks → probablemente un endpoint nuevo `/api/revenuecat/webhook` que escriba el mismo `acceso_hasta`. *El candado de acceso (`acceso_hasta`) no cambia.*

---

## 3. Superficie directa de Supabase (sin pasar por Vercel)

Con la sesión OTP, **la RLS por usuaria** decide qué ve y qué escribe cada una (cutover 2026-06-29, `anon` = 0 filas). La nativa usa **el mismo cliente, la misma anon key, las mismas políticas** → no hay nada que cambiar.

### Tablas que toca la app cliente
| Tabla | Lee | Escribe | Notas para el port |
|---|---|---|---|
| `usuarios` | ✅ | update (perfil, peso, `dias_entreno`, `foco_entreno`, `avatar_url`, `logro_destacado`, `last_active`…) | ⚠️ columnas escribibles por la usuaria = **whitelist** (`grant update(col)`); una columna nueva necesita su grant |
| `tenants` | ✅ | — | branding (`branding_config`), `status`, `limits` |
| `beta_invitados` | ✅ | — | tenant por email (tema King), pre-planes de migradas |
| `planes_semanales` | ✅ | insert/upsert (planes IA) | último por `updated_at` por tipo; `origen` ia/coach |
| `plan_templates` | ✅ | — | plantillas de respaldo si la IA falla |
| `entreno_semanal` | ✅ | upsert vía cola offline | 1 doc JSON por (usuaria, semana ISO) |
| `dias_entrenados` | ✅ | upsert/delete vía cola | espejo de "día entrenado" |
| `alimentacion_semanal` | ✅ | upsert vía cola | tildes `d{i}m{j}` |
| `progreso_diario` | ✅ | upsert vía cola | resumen diario (comidas, kcal, entreno) |
| `progreso_peso` | ✅ | upsert vía cola | |
| `cierres_semanales` | ✅ | insert/upsert | análisis, fotos, stats |
| `fotos_progreso` | ✅ | insert | fila por foto subida |
| `user_logros` | ✅ | upsert/update | `celebrado`, `notificado` |
| `historial_chat` | ✅ | upsert vía cola | por (usuaria, fecha) |
| `notas_coach` | ✅ | insert / update (`leido`) | hilo con el coach |
| `feedback` | ✅ | insert | soporte |
| `ejercicios_biblioteca` | ✅ | — | demos + aliases |
| `dieta_consistency_alerts` | — | insert/delete | QA de dietas IA |
| `beta_eventos` | — | insert | telemetría (en nativo: + Sentry) |
| `king_intake`, `king_medidas` | ✅ | insert | **legacy King — no portar** |

### RPCs (`supabase.rpc`)
| RPC | Uso | ¿Nativo? |
|---|---|---|
| `auth_resolve_session` | resolver sesión/tenant/alta tras el OTP | ✅ sí |
| `get_my_migration` / `clear_my_migration` | planes precargados de clientas migradas | ✅ sí |
| `save_push_subscription` | guardar suscripción web push | 🔧 **B2** (equivalente para Expo token) |
| `stores_coach_directory` | buscador de coaches (funnel stores) | ⏳ si entra el funnel |
| `beta_time_stats` | panel admin | ✗ no |

### Storage
- Bucket **privado** `progress-photos`. Rutas `{uid}/{fecha}-{vista}-{ts}-{rand}.{ext}` y `{uid}/avatar_{ts}.jpg`. Política `pp_owner_rw` (cada una solo su carpeta). **INSERT sí, UPDATE no** → paths siempre únicos.
- Operaciones: `upload` · `getPublicUrl` (lo que se guarda en DB) · `createSignedUrl(s)` (24 h para mostrar, 1 h para la IA) · `remove`.

### Cola offline (contrato de escritura)
Las tablas `entreno_semanal`, `dias_entrenados`, `alimentacion_semanal`, `progreso_diario`, `progreso_peso` (y `historial_chat`) se escriben con **upsert idempotente** por su clave natural (`usuario_id` + `semana_iso` / `fecha`). Por eso una cola *last-write-wins* es segura: reenviar la misma operación no duplica. **La nativa debe mantener upserts idempotentes**, nunca inserts sueltos, en estas tablas.

---

## 4. Los 3 cambios de backend, en detalle

### 🔧 B1 — Dejar entrar a la app nativa (bloqueante, chico)
**Problema:** `api/_origin.js` devuelve `false` si no hay `Origin` ni `Referer` → `403 forbidden_origin`. Los `fetch` de React Native **no mandan `Origin`**.
**Por qué ahora se puede relajar sin riesgo:** el guard de origen se puso cuando `/api/chat` no tenía auth ("defensa en profundidad, no un muro"). Hoy **todos** los endpoints que usa la nativa exigen un token válido de Supabase → el token es la puerta real.
**Propuesta (retrocompatible):** en cada endpoint, permitir el request si **(a)** el `Origin` está en la allowlist (como hoy, la PWA no cambia) **o (b)** no viene `Origin` **y** el `Bearer` resuelve a un usuario válido. Un `Origin` *presente y ajeno* sigue rebotando. Opcional: header `X-CoachAI-Client: native/<versión>` para telemetría.
**Cuándo:** antes de la 0.7 si la prueba de login va a llamar a algún `/api/*`; en todo caso antes de la Fase 2.
**QA:** curl sin Origin con token → 200; sin token → 401; Origin ajeno → 403; PWA en prod sin cambios.

### 🔧 B2 — Push nativas (Fase 4)
**Hoy:** la PWA se suscribe con `pushManager.subscribe` + VAPID → RPC `save_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` → tabla `push_subscriptions`. El cron `api/cron-notifications.js` (disparado por cron-job.org cada ~30 min, con `CRON_SECRET`) evalúa la hora local de cada clienta y manda con `web-push`; candado anti-duplicados en `notification_log (usuario_id, tipo, fecha-local)`.
**Nativo:** `expo-notifications` da un **Expo push token** → hace falta (a) guardarlo (columna/tipo nuevo en `push_subscriptions` o tabla hermana, vía RPC nueva `save_expo_push_token`), y (b) que el cron, además de `web-push`, mande por la **Expo Push API** a esos tokens. Mismas reglas de horario y mismo `notification_log`.
**Retrocompatible:** las suscripciones web siguen igual.

### 🔧 B3 — Llevar el "cerebro" al servidor (recomendado, antes de Fase 3)
**Hoy en el cliente:** `buildSystemPrompt` (incluye las REGLAS SUPREMAS de restricciones dietarias), prompts de generación de rutina/dieta, QA de planes + plantilla de respaldo, `reconcileDietKcal` + `validateDietaConsistency`, clamp de kcal, `autoRepeatPlans` / `autoAdjustDiet`, `aiNormalizePlan`, prompt del análisis semanal, `autoCloseEndedWeeks`.
**Riesgo de no hacerlo:** dos copias de la lógica más delicada del producto (la que define qué come y entrena cada clienta) en dos apps con ritmos de deploy distintos (la nativa pasa por la review de Apple). Un fix de prompt en una y no en la otra = clientas con planes distintos según el teléfono.
**Propuesta:** endpoints *de intención* en vez del proxy genérico, p. ej. `/api/plan/generate` (`{tipo, contexto}`), `/api/meal/estimate` (`{texto}`), `/api/cierre/analyze` (`{semana}`), `/api/chat/message` (`{mensaje}` — el servidor arma el system prompt con los datos de la usuaria). `/api/chat` genérico queda vivo para la PWA mientras migra.
**Beneficio extra:** el chat puede pasar a **streaming** de paso, y los prompts quedan fuera del cliente (no se pueden leer ni manipular).
**Tamaño:** es el cambio más grande de los tres → proyecto propio, con su plan y QA de prompts (el harness de QA de dietas veganas sirve de base). **Decisión de Beto.**

---

## 5. Lo que NO consume la app nativa (servidor ↔ servidor o herramientas web)
- `POST /api/stripe/webhook` (Stripe → nosotros) · `GET /api/stripe/sync-subs` (cron diario 08:00 UTC, `vercel.json`) · `POST /api/play/rtdn` (Google → nosotros).
- `GET /api/cron-notifications` (cron-job.org).
- `POST /api/king-intake` (quiz externo de King).
- `POST /api/send-invite` (Studio / panel admin: invitar clientas).
- `/api/tower/*` (Tower: dashboard, revenue, costs, team, bugs, users, tenants…).
- `middleware.js` solo actúa sobre `/` (landing `.com`) → no afecta a la API.

---

## 6. Checklist de compatibilidad para la Fase 2 (esqueleto)
- [ ] `supabase-js` con `expo-secure-store` como storage; OTP de punta a punta (0.7).
- [ ] RPC `auth_resolve_session` desde nativo devuelve la misma usuaria que la PWA.
- [ ] Leer `usuarios` / `planes_semanales` con RLS desde nativo (Perfil, tarea 2.3).
- [ ] **B1 desplegado** y `/api/stripe/subscription-status` respondiendo 200 desde el iPhone.
- [ ] Subir una foto a `progress-photos` y leerla firmada.
- [ ] Cola offline nativa con upserts idempotentes (probada en modo avión).
