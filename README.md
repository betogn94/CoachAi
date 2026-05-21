# CoachAI — Design Handoff Brief

Producto: app de coaching personal con IA. Plataforma SaaS de fitness + nutrición con un coach AI conversacional, planes semanales personalizados, tracking de progreso y secciones premium (Mi Entreno con animaciones de ejercicios, Mi Alimentación con seguimiento de comidas, Mi Progreso con métricas semanales).

**Live en producción:** https://coachaipro.ai
**Repo:** https://github.com/betogn94/CoachAi

---

## 🎯 Mission de esta sesión de diseño

**Llevar toda la interfaz a un nivel estético premium**, manteniendo la coherencia visual con la identidad ya construida (paleta morado→azul→teal sobre fondo oscuro, tipografía Bebas Neue + DM Sans, logo CoachAI con gradient).

Pensar en marcas referentes: **Stripe, Linear, Whoop, Strava, Hevy, Notion**. La meta es que un usuario que abra la app por primera vez diga "se ve carísima". Hoy ya está bien — la meta es elevarla.

Áreas de oportunidad típicas (no exhaustivo, usar criterio):
- Refinar microinteracciones, hover states, transiciones entre secciones
- Pulir spacing, tipografía y jerarquía visual
- Mejorar componentes recurrentes (cards, botones, badges, modales)
- Estados de carga (skeleton screens, shimmers, etc.)
- Empty states con personalidad de marca
- Animaciones sutiles que aporten "vida" sin distraer

---

## 🛑 Reglas duras — qué NO tocar

Esta es una app en **beta activa con usuarios reales**. El alcance es **estrictamente visual/UX**. Cualquier cambio fuera de esto rompe usuarios.

| ❌ NO tocar |
|---|
| **Arquitectura**: la app es UN solo archivo `index.html` con HTML + CSS + JS embebido. No splitear en módulos, frameworks ni bundlers. |
| **Identidad de marca**: paleta de colores, logos (`logo.png`, `logo-icon.png`), tipografías, gradient principal |
| **Lógica de backend**: nada en `/api/`, nada de Supabase queries, nada de prompts del AI |
| **Schema de datos**: tablas, columnas, RLS — nada de eso |
| **Funcionalidad existente**: parsers, estado, save flows, tracking, deploys |
| **Mobile-first**: todo debe seguir funcionando perfecto en celular (la mayoría del tráfico viene de ahí) |
| **Performance**: la app ya carga rápido, no degradar con assets pesados |
| **Deploy config**: `vercel.json`, `package.json`, env vars |
| **Onboarding flow lógico**: el orden de pasos, validaciones, datos requeridos |

**En duda → preguntar antes de tocar.**

---

## 🏗️ Stack y arquitectura

- **Frontend**: Single-file vanilla HTML/CSS/JS (~13.500 líneas en `index.html`)
- **Backend**: Vercel Serverless Functions (`/api/chat.js` para AI, `/api/send-invite.js` para mails)
- **DB**: Supabase (Postgres + Storage + Auth-like via email)
- **AI**: Anthropic Claude via `@anthropic-ai/sdk`
- **Email**: Resend
- **Deploy**: Vercel (auto-deploy on push to `main`)

**Por qué single-file**: simpleza, sin build step, deploy instantáneo, fácil de auditar. Es una decisión consciente — **mantener este patrón**.

---

## 🎨 Sistema de diseño actual (referencia)

### Colores (CSS variables, ya en `:root`)

```css
--bg:           #070714   /* fondo principal, casi negro con tinte morado */
--surface:      #111122   /* cards, modales */
--surface2:     #1a1a2e   /* cards anidados */
--border:       rgba(124,106,255,0.18)
--text:         #f0f0fa   /* texto principal (off-white) */
--muted:        #8a8aa0   /* texto secundario */
--muted2:       #6c6c80   /* texto terciario */
--accent:       #7c6aff   /* morado brand (CTAs, links principales) */
--accent-bright:#b4a7ff   /* morado claro (text accents, highlights) */
--accent2:      #5b9fff   /* azul brand (CTAs secundarios) */
--accent3:      #2ecfb5   /* teal brand (success, callouts positivos) */
```

### Brand gradient principal

```css
linear-gradient(135deg, #7c6aff 0%, #5b9fff 50%, #2ecfb5 100%)
```
Usado en hero del logo, CTA principales, decoración de marca.

### Tipografía

- **Bebas Neue** — display, títulos grandes ("COACHAI" wordmark, page titles)
- **DM Sans** — body, UI general
- **JetBrains Mono** — etiquetas técnicas, badges, números monoespaciados

Todas cargadas desde Google Fonts en el `<head>` del HTML.

### Logos / assets de marca

- `logo.png` (1700×386, transparente) — wordmark horizontal con icono
- `logo-icon.png` (635×612, transparente) — solo icono cuadrado

Ya están subidos al Supabase Storage también (`brand/coachai-logo.png`) para usar en emails.

---

## 📁 Estructura de archivos

```
coachai/
├── index.html              ← TODA la app (HTML + CSS + JS embebido)
├── api/
│   ├── chat.js             ← Vercel function: proxy al Claude API
│   └── send-invite.js      ← Vercel function: invitaciones por mail
├── docs/
│   ├── beta-guide/         ← Guía de la beta (PDF + HTML source)
│   ├── coachai-overview/   ← Overview del producto
│   ├── plan-direccion/     ← Plan de dirección multi-tenant (PDF para reuniones)
│   └── prompts/            ← Prompts de la IA + mapeo de ejercicios
├── logo.png                ← Wordmark horizontal
├── logo-icon.png           ← Icono cuadrado
├── package.json            ← deps (anthropic SDK, resend)
├── vercel.json             ← Redirects .com → .ai
├── .env.example            ← Variables de entorno requeridas
├── NOTAS-DISEÑO.md         ← ⭐ Historia de las sesiones de diseño previas (LEER)
└── README.md               ← Este archivo
```

---

## 🗺️ Mapa de la app — secciones que vas a tocar

Orden en que un usuario nuevo encuentra cada pantalla:

| # | Pantalla | Buscar en `index.html` por | Notas |
|---|---|---|---|
| 1 | **Landing / Login** | `landing-wrapper`, `email-login` | Primera impresión, ya bastante pulido |
| 2 | **Onboarding (5 pasos)** | `form-wrapper`, `step1` a `step5` | ⚠️ Marcado como pendiente en NOTAS-DISEÑO.md |
| 3 | **Home** | `home-section`, `home-card` | Hero + journey + explore cards |
| 4 | **Chat** | `chat-section`, `chat-messages`, `msg` | Conversación con coach AI |
| 5 | **Mi Entreno** | `mi-entreno-wrapper`, `entreno-day`, `entreno-ex` | Rutina semanal + modal "Cómo se hace" |
| 6 | **Mi Alimentación** | `diario-wrapper`, `alim-day`, `alim-comida` | Plan semanal con ✓/✏️ por comida |
| 7 | **Mi Progreso** | `dashboard-wrapper`, `chart-card` | Adherencia, kcal, fotos, semanas |
| 8 | **Perfil** | `perfil-wrapper`, `perfil-hero`, `chart-card` | Datos, transformación visual, planes |
| 9 | **Admin** (solo admins) | `admin-wrapper`, `admin-profile-card` | Tablero coach: alumnos, planes, beta |
| 10 | **Modales / overlays** | `ej-modal`, `tour-overlay`, `foto-lightbox`, `cierre-overlay`, `admin-action-modal` | Componentes reutilizables |

### Componentes recurrentes a tener en cuenta

- `.chart-card.coach-card` — el "card" base. Aparece como ~40 instancias.
- `.btn-launch`, `.btn-subir-foto`, `.btn-admin-save`, `.tour-btn-next` — variantes de botón principal con gradient.
- `.semana-card`, `.entreno-day`, `.alim-day` — variantes de "día" (cards expandibles).
- `.msg.user`, `.msg.coach` — bubbles de chat.
- `.beta-inv-row`, `.admin-profile-field` — rows de listado en admin.
- Modales: ya hay un patrón establecido (overlay + card centrado con border morado).

---

## 🧪 Cómo correr localmente

```bash
cd C:\Users\Usuario\Desktop\coachai
npx serve -p 3030 .
# Abrir http://localhost:3030
```

> Limitación: `/api/chat` y `/api/send-invite` son funciones de Vercel — **no funcionan localmente**. El chat va a fallar localmente, pero TODAS las secciones visuales (onboarding, home, mi-entreno, mi-alimentación, mi-progreso, perfil, admin) se pueden navegar y refinar sin necesidad del backend.

Para probar como usuario de testing sin pasar por el cap de la beta cerrada, usar:
- Email: `test@test.com`
- Nombre: `Test`

Ese usuario ya existe en producción con onboarding completo (perfil random pero coherente).

---

## 📊 Estado de la beta — heads-up

- **Beta cerrada activa** con usuarios reales.
- Cap actual: 20 usuarios.
- ~80 personas interesadas en lista de espera.
- **Cualquier deploy a `main` va a producción automático**. Si cambiás algo, asegurate de probarlo bien antes.

Para evitar mover producción mientras trabajás:
- Trabajá en una rama (`git checkout -b design/<tu-nombre>`)
- Levantá un preview deploy con `vercel` (sin `--prod`)
- Mergear a `main` solo cuando esté listo y revisado

---

## 📜 Historia previa de diseño

📌 **`NOTAS-DISEÑO.md`** tiene el log de la sesión anterior de diseño (mayo 2026), con detalle de qué se polish y qué quedó pendiente. **Leer antes de empezar** — evita rehacer trabajo y ayuda a continuar el tono.

---

## 🆕 Cambios funcionales recientes (no diseño, contexto)

Cosas nuevas que se sumaron en las últimas semanas y que ya existen funcionalmente — el diseño de algunas puede beneficiarse de un pase de pulido:

- 💪 **"Cómo se hace"** en Mi Entreno: modal con animación 2-frame del ejercicio + cues estilo Daniel
- 🥗 **Mi Alimentación rehecho**: vista semanal con ✓ tildar comidas + ✏️ editar
- 📊 **Heartbeat tracking**: métricas de tiempo-en-app por usuario (admin las ve)
- 🎯 **Welcome tour interactivo**: 6 pasos guiados, auto-fire post-onboarding
- 📬 **Invitaciones automáticas por mail** (Resend) — el template del mail es light-themed, intencionalmente diferente del dark de la app
- 👤 **"Mi información"** (Perfil): card compacto editable (nombre + email read-only + teléfono)
- 🔧 **Admin completo**: edición full de datos físicos del alumno, gestión de invitados, métricas de uso

---

## 💬 Contacto

Cualquier duda durante el trabajo, escribir directo en este chat. Reglas:
1. Si hay duda sobre si algo es "tocable" o no → **preguntar primero**.
2. Si encontrás un bug que NO es de diseño → reportar pero no arreglar (lo manejamos por otro lado).
3. Si querés probar un cambio grande → preview deploy primero, mostrar el link.

¡Mucha suerte y a sacar este producto a otro nivel! 🚀
