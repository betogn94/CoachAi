# CoachAI Pro — Multi-Tenant Foundation

**Status:** Phase A executed 2026-05-26 · Phase B/C/D pending
**Author:** Claude + Beto · 2026-05-26
**Scope:** Lay the SaaS-grade tenant foundation under the existing beta WITHOUT
breaking what's live. No frontend visual changes in this phase.

## ✓ Phase B — completed 2026-05-26

Frontend now reads the user's tenant from DB after login and applies its
`branding_config` to:
- CSS variables `--accent` / `--accent-bright` / `--accent2` / `--accent3`
- `<title>` (uses `name — tagline` pattern)
- `<meta name="apple-mobile-web-app-title">` (PWA standalone label)
- Logo image URLs — only swapped when the tenant overrides `/logo.png`
  or `/logo-icon.png`, so the default tenant doesn't touch the DOM.

For `coachai-default`, the branding values are identical to the values
the app hardcoded → zero visual diff. Verified against TestB:
- `currentTenant.slug = coachai-default`
- CSS vars unchanged (`#7c6aff`, `#b4a7ff`, `#5b9fff`, `#2ecfb5`)
- QA harness 12/12 green (vs 11/12 yesterday — the rutina race
  condition that was failing got fixed as a side-effect of the slightly
  longer login path).

Adding a whitelabel tenant is now a one-step operation: insert into
`tenants` with a `branding_config` JSONB and assign the relevant
`usuarios.tenant_id`. No code change needed.

## ✓ Phase A — completed 2026-05-26

Applied via Supabase MCP `apply_migration` (transactional, fully reverted
on first attempt due to a `cannot use subquery in DEFAULT expression`
error, re-applied with a `default_tenant_id()` STABLE function and passed).

Verification:
- `tenants` table: 1 row → `coachai-default` / `CoachAI Pro` / `active`, branding_config has all 9 expected keys.
- `usuarios.tenant_id`: NOT NULL ✓, DEFAULT set ✓, FK to tenants ✓, indexed ✓.
- All 4 existing users backfilled to `coachai-default`.
- Onboarding INSERT probe (`INSERT INTO usuarios (email, nombre) VALUES (…)`) auto-fills tenant_id correctly.
- QA harness 11/12 steps green. The one failing step (`plan_rutina_delivered`) is a pre-existing race in the harness — `loadCurrentWeekPlans` repopulates `weeklyPlans` AFTER the harness reset, masking both plan buttons. Unrelated to the migration (chat code doesn't read `tenant_id`).

**No frontend deploy required for Phase A.** The app keeps reading and
writing exactly the same data; it just gains an invisible `tenant_id`
column populated automatically.

Snapshot of users before the migration: `docs/backups/pre-multi-tenant-2026-05-26.md`.

---

## 1. What we have today

### 1.1 Codebase shape

- Single-page app — everything is in `index.html` (~18k lines).
- Vercel serverless functions in `/api/` (currently just `chat.js`, the
  Anthropic Claude proxy).
- Supabase project `vmvhlgzwufkardaruutt` (us-east) — 16 public tables.
- Custom email-only auth (no Supabase Auth users table is used).
  `usuarios.email` is the login key; the row is the user identity.
- PWA shell + service worker (`sw.js`).

### 1.2 Database shape

All per-user data joins through `usuario_id → usuarios.id`. The full graph:

```
usuarios (id, email, …profile…)
   ├── progreso_diario        (cumplimiento de comidas + entrenos por día)
   ├── progreso_peso          (peso semanal)
   ├── progreso_medidas       (medidas semanales)
   ├── planes_semanales       (dieta + rutina por semana ISO)
   ├── alimentacion_semanal   (estado por semana — comidas cumplidas)
   ├── entreno_semanal        (estado por semana — pesos por serie)
   ├── cargas_ejercicios      (histórico de cargas por ejercicio)
   ├── dias_entrenados        (fechas en que se entrenó)
   ├── fotos_progreso         (foto inicio + fotos semanales)
   ├── cierres_semanales      (análisis del coach al cerrar la semana)
   ├── historial_chat         (chat por día con conversation_history JSONB)
   ├── feedback               (mensajes al equipo)
   └── beta_eventos           (telemetría — 2.1k filas hoy)

(Sin FK al usuario)
├── beta_invitados            (whitelist + pre-rutina/dieta del coach migrador)
└── ejercicios_biblioteca     (122 demos compartidos entre todos los users)
```

### 1.3 Branding hoy (lo que vamos a reemplazar)

- **White-label config** vive en `localStorage` (key `LS_WL`), no en DB.
- Es **per-device**, no per-user, no per-tenant.
- `applyWhiteLabelToApp(wl)` mutación: cambia `--accent` CSS var, swap del
  `<title>`, swap del logo del header, swap del nombre.
- `beta_invitados.migrada_de_coach` ("Daniel") es el único hint multi-coach
  que ya existe — dispara un welcome message especial pero no afecta branding.

### 1.4 Lo que NO existe todavía

- Tabla `tenants`.
- Relación usuario → tenant.
- Branding persistido en DB.
- Resolución dinámica (subdominio / dominio custom).
- Superadmin que vea todos los tenants.
- Aislamiento de datos cross-tenant (hoy es per-user via RLS; tenant es nuevo).

---

## 2. Arquitectura propuesta

### 2.1 Modelo de datos (DB)

```
tenants
├── id                  uuid PK
├── slug                text UNIQUE     -- "coachai-default", "daniel", "jesus"
├── name                text            -- "CoachAI", "Daniel Coaching", "Jesús Fit"
├── status              text            -- "active" | "trial" | "suspended"
├── plan                text            -- "free" | "pro" | "enterprise" (default 'pro')
├── branding_config     jsonb           -- { colors, logos, fonts, slogans }
├── theme_config        jsonb           -- { mode, density, animations }
├── social_links        jsonb           -- { instagram, whatsapp, tiktok }
├── domain              text NULL       -- custom domain (futuro — coachai.com/jesus, jesus-fit.com)
├── limits              jsonb           -- { max_users, max_ai_calls_per_day }
├── created_at          timestamptz default now()
└── updated_at          timestamptz default now()

usuarios
├── … (todo lo que ya tiene)
└── tenant_id           uuid NULL → tenants.id   ← NUEVO
```

**branding_config shape (propuesto, todo opcional):**
```json
{
  "name": "CoachAI",
  "shortName": "CoachAI",
  "tagline": "Tu entrenador personal con IA",
  "logo": "/logo.png",
  "logoIcon": "/logo-icon.png",
  "favicon": "/icon-512.png",
  "colors": {
    "accent":       "#7c6aff",
    "accentBright": "#b4a7ff",
    "accent2":      "#5b9fff",
    "accent3":      "#2ecfb5"
  },
  "footer":     "Powered by Anthropic Claude",
  "showProBadge": true
}
```

El default tenant `coachai-default` arranca con esa config (la que ya
renderiza la app hoy). Los whitelabels override solo los campos que
necesiten cambiar.

### 2.2 Resolución de tenant (Phase A → C)

| Fase | Estrategia | Cuándo |
|------|------------|--------|
| A    | Implícita: `currentUser.tenant_id` después de login. Todos los usuarios existentes resuelven a `coachai-default`. | YA (foundation) |
| B    | Misma como A + frontend lee `branding_config` del tenant del user y lo aplica al app shell. | Cuando Jesús esté listo |
| C    | Subdominio (`jesus.coachai.app`) o dominio custom resuelve tenant ANTES del login (incluso landing usa branding). | Producto maduro |

Hoy implementamos **solo A**. La landing seguirá siendo CoachAI Pro genérica.

### 2.3 Aislamiento de datos

Decisión: **NO agregamos `tenant_id` a las 13 tablas per-user** en esta fase.

Razón: cada fila ya tiene `usuario_id → usuarios.id → tenant_id`. El
aislamiento se mantiene **transitivo** vía RLS:

```sql
-- Conceptual (no SQL final — todavía no tocamos RLS):
CREATE POLICY tenant_isolation ON progreso_diario
  USING (
    usuario_id IN (
      SELECT id FROM usuarios
      WHERE tenant_id = current_setting('app.current_tenant', true)::uuid
    )
  );
```

Esto evita una migración masiva, y como **todo dato per-user ya pasa por
`usuarios`**, hay zero superficie cross-tenant que filtrar. Si en el
futuro Superadmin necesita queries agregadas por tenant performantes,
**agregamos `tenant_id` denormalizado** (con trigger) solo a la(s)
tabla(s) que lo pidan.

**Tablas que SÍ podrían necesitar `tenant_id` directo en el futuro
(no ahora):**
- `beta_eventos` — para métricas por tenant sin joins pesados
- `historial_chat` — si Superadmin quiere auditar uso de AI por tenant

### 2.4 Tenant context layer (frontend)

Una sola variable global:

```js
let currentTenant = null;  // resuelto después del login

async function resolveTenantForUser(userId) {
  const { data } = await sbClient
    .from('usuarios')
    .select('tenant_id, tenant:tenants(*)')
    .eq('id', userId)
    .single();
  return data?.tenant || DEFAULT_TENANT;
}
```

En `handleEmailLogin` después de cargar el usuario, también cargamos el
tenant. **Si el tenant no tiene `branding_config`, no pasa nada** — la
app sigue renderizando con los defaults hardcodeados que ya tiene.

### 2.5 Superadmin (preparación, no construcción)

El admin actual (`/admin` route — login por código) seguirá funcionando
exactamente igual. **No tocamos nada del admin en esta fase.** Solo nos
aseguramos que el modelo `tenants` esté listo para que el admin pueda,
en una fase futura:
- Listar tenants
- Crear/editar tenants (slug, name, branding, limits)
- Reasignar usuarios entre tenants
- Ver métricas por tenant

---

## 3. Plan de migración por fases

### Phase A — DB foundation (este PR)

Solo backend. **Cero cambios visuales en el frontend.**

**A1. Crear tabla `tenants`**

```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trial','suspended','archived')),
  plan text NOT NULL DEFAULT 'pro',
  branding_config jsonb DEFAULT '{}'::jsonb,
  theme_config jsonb DEFAULT '{}'::jsonb,
  social_links jsonb DEFAULT '{}'::jsonb,
  domain text NULL,
  limits jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
-- Public read so cualquier app puede resolver tenant por slug/domain.
-- Write quedará detrás de la service role (Superadmin futuro).
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
```

**A2. Insertar default tenant**

```sql
INSERT INTO tenants (slug, name, branding_config) VALUES (
  'coachai-default',
  'CoachAI Pro',
  jsonb_build_object(
    'name', 'CoachAI Pro',
    'shortName', 'CoachAI Pro',
    'tagline', 'Tu entrenador personal con IA',
    'logo', '/logo.png',
    'logoIcon', '/logo-icon.png',
    'showProBadge', true,
    'colors', jsonb_build_object(
      'accent', '#7c6aff',
      'accentBright', '#b4a7ff',
      'accent2', '#5b9fff',
      'accent3', '#2ecfb5'
    )
  )
);
```

**A3. Agregar `usuarios.tenant_id` (nullable inicialmente)**

```sql
ALTER TABLE usuarios
  ADD COLUMN tenant_id uuid REFERENCES tenants(id);
CREATE INDEX usuarios_tenant_id_idx ON usuarios(tenant_id);
```

**A4. Backfill: todos los usuarios actuales → coachai-default**

```sql
UPDATE usuarios SET tenant_id = (SELECT id FROM tenants WHERE slug = 'coachai-default')
WHERE tenant_id IS NULL;
```

**A5. Lock-in: NOT NULL constraint + default**

```sql
ALTER TABLE usuarios
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT
    (SELECT id FROM tenants WHERE slug = 'coachai-default');
```

**A6. Trigger updated_at en tenants** (cosmético, deja la tabla pulida):

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**A7. Verificación**

```sql
SELECT count(*) FROM tenants;                            -- expected: 1
SELECT slug, name FROM tenants;                          -- expected: coachai-default | CoachAI Pro
SELECT count(*) FROM usuarios WHERE tenant_id IS NULL;   -- expected: 0
SELECT u.email, t.slug FROM usuarios u JOIN tenants t ON t.id = u.tenant_id;
```

**No tocamos:**
- Frontend code
- RLS policies de las tablas per-user
- Auth flow
- White-label localStorage code (lo dejamos vivo en paralelo hasta Phase B)

### Phase B — Frontend tenant-aware load (próximo PR, sin urgencia)

1. En `handleEmailLogin`, después de cargar `currentUser`, cargar
   también `currentTenant` con un JOIN.
2. Crear `applyTenantBranding(tenant)` que mutate CSS vars + título +
   logos a partir de `branding_config`.
3. Para `coachai-default`, los valores coinciden con los hardcodeados
   actuales → cero cambio visual.
4. White-label localStorage queda como override de admin-page para
   compatibilidad con tests; ya no se usa en producción.

### Phase C — Branding completo per-tenant (cuando Jesús esté)

1. Crear tenant `jesus` con su `branding_config`.
2. Asignar usuarios de Jesús a su tenant (via `beta_invitados.tenant_slug`
   nuevo campo).
3. La app aplica branding por tenant automáticamente.

### Phase D — Superadmin (mucho después)

UI para administrar tenants. Nada que codear hoy.

---

## 4. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|:--:|------------|
| Migración rompe `INSERT INTO usuarios` del onboarding (NOT NULL sin default) | Media | Phase A5 establece `DEFAULT (SELECT id FROM tenants WHERE slug='coachai-default')`. Cualquier insert sin tenant_id va al default. |
| Vercel cachea la DB connection y no ve la nueva columna | Baja | Supabase pgbouncer refresca schema en cada conexión; reload del lambda lo agarra. Si pasa, restart manual de la función. |
| RLS bloquea reads de tenants para anon | Baja | Phase A1 incluye policy `SELECT USING (true)` para lectura pública. |
| Conflict con white-label localStorage actual | Baja | Phase A no toca frontend. Phase B mantiene el localStorage como override de testing. |
| Backfill UPDATE en producción mientras hay usuarios activos | Baja | UPDATE simple sin lock significativo (~4 filas hoy). Se corre en segundos. |
| Service worker cache desactualiza el frontend | Media | No aplica — Phase A no cambia archivos servidos al cliente. |

---

## 5. Lo que esta foundation HABILITA

Después de Phase A + B (que sigue), el equipo puede:

✓ Crear un tenant nuevo con un solo INSERT (sin tocar código).
✓ Cambiar branding de un tenant editando un JSONB.
✓ Mover un usuario entre tenants con un UPDATE.
✓ Queries cross-tenant trivially (`WHERE tenant_id = ?`).
✓ Empezar a separar usage AI por tenant (para billing futuro).
✓ Construir el Superadmin sin más migraciones DB.

Lo que **NO** habilita todavía (y está ok):

✗ Dominios custom (`jesus-fit.com` → tenant jesus). Necesita Phase C.
✗ Onboarding con branding del tenant correcto desde el primer pixel.
  La landing siempre arrancará como CoachAI Pro hasta Phase C.
✗ Aislamiento RLS estricto por tenant. Hoy es per-user (más estricto aún,
  así que no hay riesgo de leak). En Phase C/D agregamos tenant-level si
  necesitamos cross-user-within-tenant reads (ej: coach ve clientas).

---

## 6. Estimación

- Phase A (este plan): **~30 min** — solo SQL via Supabase MCP + commit
  del documento. Sin tocar frontend.
- Phase B: ~1 hora — pequeño cambio en `handleEmailLogin` + un helper
  `applyTenantBranding`. Verificable con el QA harness existente.
- Phase C: depende del whitelabel de Jesús (cuándo esté el design).
- Phase D: lejano.

---

## 7. Decisión pedida antes de ejecutar

1. ¿OK con la estrategia de **NO agregar `tenant_id` a las 13 tablas
   per-user** y mantener aislamiento transitivo vía `usuarios`?
2. ¿OK con el nombre `coachai-default` para el tenant base?
3. ¿OK con la shape de `branding_config` (JSONB con name/logo/colors/etc)?
4. ¿Ejecuto Phase A ahora (solo DB, ~30 min) o preferís revisarlo más
   tranquilo y arrancamos mañana?

Cualquier ajuste antes de tocar la DB lo charlamos acá.
