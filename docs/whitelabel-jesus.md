# CoachAI Pro — Jesús Whitelabel (KING Fitness)

**Status:** Phase C — design system scaffolding · local-only (no deploys)
**Author:** Claude + Beto · 2026-05-26
**Reference:** Airbnb design language (light, soft, generous whitespace)
**Brand decision:** Co-branding (Option 1) — wordmark stays "COACHAI Pro"
but in the KING coral palette. To be revisited when Jesús defines his
own brand identity.

---

## 1. Why a separate visual identity matters

CoachAI Pro = mass-market product. Visual reference: Apple Fitness (dark,
crystal-depth, vibrant gradient rings, performance-app vibe).

Whitelabel = **premium offering**. A client paying for whitelabel gets a
visually distinct app — not the same app with three colors swapped. The
client justifies the price by showing their end-users an app that feels
custom-made for their brand.

Jesús's whitelabel is the first one. Design north star: **Airbnb** —
light cream backgrounds, soft white cards, generous whitespace, coral CTAs,
rounded corners, photo-forward layout, humanist typography on display
elements.

This means the transformation is **bigger than a re-paint**: dark → light,
crystal-depth → soft-card, glass blur → solid surface with subtle shadow.

---

## 2. KING palette mapping → CSS variables

The current 13 CSS variables in `:root` (CoachAI default) map to KING as:

| Variable | CoachAI default | KING (Jesús) | Where it's used |
|----------|-----------------|--------------|-----------------|
| `--bg`              | `#04040a` (near-black) | `#FDF7F8` (cream)        | Page background |
| `--surface`         | `#0f0f1a` (dark navy)  | `#FFFFFF` (white)        | Card surface |
| `--surface2`        | `#161625`              | `#FFF0F4` (rosa softer)  | Subtle card variant |
| `--border`          | `#1e1e32`              | `#FFE1E8` (rosa soft)    | Borders / dividers |
| `--accent`          | `#7c6aff` (violet)     | `#FF4F7B` (coral primary)| CTAs, links, brand color |
| `--accent-bright`   | `#b4a7ff` (violet bright)| `#FF6B95` (coral bright)| Hover/highlight, big numbers |
| `--accent2`         | `#ff6b6b`              | `#FF6B95`                | Secondary accent |
| `--accent3`         | `#2ecfb5` (teal)       | `#E03A6F` (coral deep)   | Tertiary accent / "complete" state |
| `--text`            | `#eeeef5` (near-white) | `#1A1A26` (almost-black) | Body text |
| `--muted`           | `#6b6b8d`              | `#6B6B80`                | Subtitles, labels |
| `--muted2`          | `#3a3a55`              | `#A9A9B8`                | Very subtle text |
| `--success`         | `#2ecfb5`              | `#E03A6F`                | Done-meal state, completed-day chip |
| `--warning`         | `#ffb347`              | `#ffb347`                | Same — warnings shouldn't carry brand color |

### KING signature gradient

```css
linear-gradient(135deg, #FF6B95 0%, #FF4F7B 50%, #E03A6F 100%)
```

Used in: INGRESAR button, Bebas Neue big numbers, the kettlebell-AI icon,
PRO badge outline, summary card eyebrow.

---

## 3. Architecture — skin overlay strategy

### 3.1 Why NOT a massive var-only refactor

The app today has ~80 hardcoded color literals (rgba/hex) baked into
specific CSS rules (crystal-depth cards, glow shadows, brand gradients).
A var-only refactor would require touching every one of those — high
risk for the default theme, error-prone, hard to review.

### 3.2 The chosen approach: scoped CSS overrides under a body class

When the user's tenant is `jesus` (resolved at login), we:

1. Set every relevant CSS var to its KING value via `style.setProperty`.
2. Add `body.theme-king` class.
3. A dedicated CSS section in `<style>` defines `body.theme-king ...`
   selectors that override every dark-theme-specific rule that uses
   hardcoded colors.

Pros:
- **Default theme untouched** — zero risk of regression for existing
  CoachAI users
- **All KING rules in one section** — easy to iterate, easy to maintain
- **Removable** — if Jesús cancels, we drop the section + the tenant row
  and the codebase has zero KING residue
- **Consistent with how iOS apps support dark mode** — same html, two
  visual layers

Cons:
- Larger CSS bundle (~300-500 extra lines for the KING section)
- Two places to update if a card style changes (default + KING override)

### 3.3 The body class is set by extending Phase B's apply function

`applyTenantBranding(tenant)` already runs after login. We extend it:

```js
// Existing: set CSS vars from branding_config.colors
// NEW: if branding_config.bodyClass is set, add it to <body>
if (b.bodyClass) {
  document.body.classList.add(b.bodyClass);
}
```

Jesús's `branding_config` will include `"bodyClass": "theme-king"`.

---

## 4. Section-by-section design overrides

Quick list of areas the KING overrides must cover. We work through this
section by section, with screenshots after each, and iterate until
"prolijo".

### 4.1 Global / shell
- Body background → cream
- Body text color → dark
- Remove the radial vignette at body::after that creates dark glow
- Replace the violet/teal background gradient noise

### 4.2 Landing / login
- Cream background
- White card with soft shadow (no border glow)
- INGRESAR button: coral gradient
- Inputs: white with soft pink border on focus
- Logo: KING-recolored wordmark + icon
- Tagline color: muted dark

### 4.3 Header + drawer
- Logo bar: white background with soft bottom shadow (instead of dark
  with transparent overlay)
- Drawer: white surface, dark text on nav items, active item gets a
  coral-soft background instead of violet gradient

### 4.4 Bottom nav (Apple-Fitness-style pill, recolored)
- Pill background: white instead of dark navy
- Active thumb: coral gradient
- Inactive icons: muted gray
- Label below pill: coral instead of violet

### 4.5 Home dashboard
- Cards: white surface, 1px soft pink border, gentle drop shadow
- Big numbers (Bebas Neue): coral gradient or solid dark
- Progress rings (ENTRENAMIENTOS): coral stroke
- Stat eyebrows: coral muted instead of accent-bright
- Próxima Comida / Hoy Toca cards: white with subtle category icon tinted coral
- Calorías kcal-bars: coral fill for done, light pink for pending

### 4.6 Chat
- Message bubbles: coach bubbles get a very pale rosa background, user
  bubbles get a coral gradient
- Typing indicator: coral dot pulse (we already have the pulse animation,
  just retint)
- Quick action buttons (Dieta/Rutina): white with coral border and coral
  text

### 4.7 Mi Entreno / Mi Alimentación
- Hero card: white with soft shadow
- Sub-cards (Resto de la semana): white with thin pink dividers
- Done badge: coral filled
- Editar button: pink outline, coral text
- Inputs (reps, kg): white bg with coral focus ring

### 4.8 Perfil
- Stats grid: white tiles with coral numbers
- Section dividers: pink subtle
- Logout button: dark text on cream

### 4.9 Cierre semanal
- Modal: white card with soft shadow
- Photo frames: white with pink border
- Generar análisis: coral CTA
- Análisis card: white with coral eyebrow

### 4.10 Seguimiento semanal
- Week cards: white with pink left-border accent
- Stat bar: coral numbers, pink dividers
- Closed week badge: coral filled
- Open week: white expanded body

---

## 5. Assets

| Asset | Status | Path |
|-------|--------|------|
| Kettlebell-AI icon (coral) | ✓ Processed (451x549, transparent, no fringe) | `tenants/jesus/icon.png` |
| COACHAI Pro wordmark (coral) | ✓ Recolored programmatically as TEMP | `tenants/jesus/logo.png` |
| PWA icons (180/192/512) | Pending — generate from icon.png when ready to ship | `tenants/jesus/icon-*.png` |
| Custom slogan / tagline | TBD — defaulting to CoachAI's "Tu entrenador personal con IA" | `branding_config.tagline` |

When Jesús defines his real wordmark, drop it into `tenants/jesus/logo.png`
overwriting the temp.

---

## 6. Implementation plan

All work in the local worktree until visually approved. No deploys.

**6.1 — Scaffold the theme overlay infrastructure** *(small, ~30 min)*
- Extend `applyTenantBranding` to honor `branding_config.bodyClass`
- Add a placeholder `body.theme-king { /* will be filled section by section */ }` block in CSS

**6.2 — Create Jesús tenant in DB** *(~10 min)*
```sql
INSERT INTO tenants (slug, name, branding_config) VALUES (
  'jesus',
  'CoachAI Pro · KING',
  '{
    "name": "CoachAI Pro",
    "shortName": "CoachAI Pro",
    "tagline": "Tu entrenador personal con IA",
    "logo": "/tenants/jesus/logo.png",
    "logoIcon": "/tenants/jesus/icon.png",
    "bodyClass": "theme-king",
    "showProBadge": true,
    "colors": {
      "accent":       "#FF4F7B",
      "accentBright": "#FF6B95",
      "accent2":      "#FF6B95",
      "accent3":      "#E03A6F"
    }
  }'::jsonb
);
```

**6.3 — Move TestB to jesus tenant temporarily** *(test data only)*
```sql
UPDATE usuarios SET tenant_id = (SELECT id FROM tenants WHERE slug='jesus')
WHERE email = 'testb@test.com';
```
This is reverted before deploy.

**6.4 — Write KING CSS overrides section by section** *(the bulk of the work)*
Work order: shell → landing → header/drawer → bottom-nav → home →
mi entreno → mi alim → chat → perfil → cierre → seguimiento. Screenshot
after each section, fix anything that looks off before moving on.

**6.5 — Visual review with Beto** *(checkpoint)*
Take a full set of screenshots in `tenants/jesus/screens/`. Beto reviews
before we touch production.

**6.6 — Move TestB back to coachai-default** *(cleanup)*
```sql
UPDATE usuarios SET tenant_id = (SELECT id FROM tenants WHERE slug='coachai-default')
WHERE email = 'testb@test.com';
```

**6.7 — Deploy** *(when Beto approves)*
The whitelabel is fully built; no users are on `jesus` tenant yet, so the
deploy is dark-launched. Jesús's real users get assigned when their
onboarding starts.

---

## 7. Risks & open questions

| Risk / Q | Notes |
|----------|-------|
| Asset paths in branding_config (e.g., `/tenants/jesus/logo.png`) — does Vercel serve them statically? | Yes by default — Vercel serves the repo as static files. We can verify with curl after deploy. |
| Wordmark "COACHAI Pro" co-branding might confuse Jesús's end users (they signed up for "Jesús's program") | Co-branding is temporary. Real brand swap when Jesús defines his identity. Documented in §1. |
| KING palette is narrow (all corals) — gradient text may look flat | Mitigated by using lightness modulation on numbers, and dark text where ratio is too low. Iterate per section. |
| Performance — extra CSS block adds bundle size | ~5-10KB. Negligible. |
| QA harness uses TestB; if TestB is temporarily on jesus tenant, harness still passes (data flow is identical) | Yes — tenant only affects visual styling, not data flow. QA can run during dev. |

---

## 8. Decision points before starting Step 6.1

- [x] Phase B done and tested
- [x] Icon processed (`tenants/jesus/icon.png`)
- [x] Wordmark temp-recolored (`tenants/jesus/logo.png`)
- [x] Brand decision: Option 1 (co-branding, COACHAI Pro stays)
- [ ] **Need from Beto:** go-ahead to start writing the KING CSS overrides

Once the green light is given, we proceed section by section with
screenshots after each. Estimated effort: ~3-5 hours of focused work
spread across iterations.
