# Notas de diseño — CoachAI

Última actualización: 2026-05-13

---

## 🎯 Sesiones completadas (estética actualizada)

- ✅ **Login / Landing** — logo brand, card compacto, ícono optical-centered
- ✅ **Home** — Hero (gym + violeta), journey flow, explore cards SVG, "Cómo Funciona" con timeline
- ✅ **Chat** — integrado al fondo, input fijo bottom, avatars con gradient ring, auto-scroll
- ✅ **Menú hamburguesa** — íconos brand, footer con pulse
- ✅ **Perfil** — sección "MI PLAN ACTUAL" agregada (parcial — falta resto del perfil)
- ✅ **Admin** — badges ACTIVA/CERRADA, solo último plan por tipo

---

## 📋 Pendiente para próxima sesión

### Prioridad ALTA — Onboarding (Step 1-5)

Descubierto en QA de hoy. Es lo PRIMERO que ve un usuario nuevo después del login, así que rompe la unidad visual al estar con estética vieja.

1. **Progress bar de 5 pasos** (arriba del form)
   - Actualmente: emojis grandes (lapicito violeta, hoja roja, mancuerna amarilla, plato, check verde)
   - Cambiar a: gradient rings con SVG line icons (mismo patrón que menú hamburguesa)
   - 5 íconos: persona, target/diana, mancuerna, plato/manzana, check

2. **Cards de las secciones** (PERFIL FÍSICO, NIVEL DE ENTRENAMIENTO, etc.)
   - Cada card tiene un ícono "P" / "O" / "E" en violeta — viejo
   - Reemplazar con SVG icons brand a juego con el contenido

3. **Cards de opciones** (Principiante/Intermedio/Avanzado, objetivos, etc.)
   - Usan emojis grandes: 🌱 ⚡ 🔱 🔥 💪 ⚖️
   - Opción A: mini gradient ring + emoji adentro (look unificado)
   - Opción B: SVG line icons solamente (más minimalista)
   - Decidir antes de implementar

4. **Bug a corregir**: campo "EDAD" en Step 1 a veces aparece pre-llenado con "31" para usuario nuevo (probable leftover de algún test/sesión anterior cacheada en el form HTML). Debe estar vacío para usuario nuevo.

### Prioridad MEDIA

5. **Mi Día** — la sección de registro diario (comidas, entrenos, métricas)
   - Cards de macros estimados
   - Chips de "Entrenó hoy: Sí/No"
   - Sección de ejercicios
   - Aplicar misma estética brand

6. **Progreso (Dashboard)** — completar
   - Ya tiene: card "Mi Planificación" actualizado con ACTIVA/CERRADA
   - Falta: "Resumen de Adherencia" (entrenos esta semana, calorías), "Seguimiento Semanal" (calendario, semanas cerradas)
   - Cards con ícono brand, gradient rings, etc.

7. **Perfil** — completar lo que falta
   - Ya tiene: hero, transformación visual, TU CAMINO stats, MI PLAN ACTUAL ✓
   - Falta: refinar la estética de TRANSFORMACIÓN VISUAL (fotos antes/después)
   - Botón "Editar datos del perfil" (estética)

### Prioridad BAJA — Refinamientos

8. **Hover states**: en general se podría revisar pasada por toda la app que los hovers sean consistentes (no demasiado agresivos)
9. **Animaciones de transición**: entre secciones (fade, slide)
10. **Loading states**: cuando el chat está esperando respuesta, cuando se cargan stats, etc.

---

## 🐛 Bugs / mejoras funcionales resueltos hoy

- ✅ Plan cycle user-driven (antes era por semana ISO, ahora es por análisis semanal)
- ✅ Sistema prompt distinguir ACTIVA vs CERRADA (antes refusaba regenerar)
- ✅ Detección de tipo de plan desde reply (antes guardaba dieta como rutina si flag estaba mal)
- ✅ Regex más amplia para detectar pedidos en lenguaje natural
- ✅ Admin solo muestra últimos planes por tipo
- ✅ Footer escondido cuando chat abierto
- ✅ Auto-scroll al último mensaje al entrar a chat
- ✅ Iconos brand unificados (logo, menu, journey, explore cards)

## 🎨 Sistema de diseño actual (referencia rápida)

- **Brand gradient**: violeta (#7c6aff) → azul (#5b9fff) → cyan (#2ecfb5)
- **Typography logo**: Iceland (geometric, A sin barra)
- **Typography body**: DM Sans
- **Typography display headlines**: Bebas Neue
- **Mono accents**: JetBrains Mono
- **Patrón ícono brand**: gradient ring con padding 1.5-2px sobre fondo `var(--surface)`, SVG line icon dentro
- **Badges**: pastilla con `border + background tint` (ACTIVA=cyan, CERRADA=naranja, HISTÓRICA/SIN PEDIR=gris)
- **Hover**: glow sutil + drop-shadow con colores brand, NO fills agresivos

## 🧪 Testing pendiente

Cuando terminemos toda la estética, hacer **QA exhaustivo**:
- Flow completo usuario nuevo (5 steps onboarding → primer chat → primer plan)
- Flow returning user
- Mobile + desktop
- Casos edge: usuario sin plan, plan cerrado, primer cierre semanal, etc.
- Admin: ver alumnos, editar planes, comparar fotos
