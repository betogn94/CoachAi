# DESIGN BRIEF — CoachAI · Home + Seguimiento Semanal

> **Importante**: no tocar funcionalidad ni código. Solo proponer cambios visuales que el dev implementa después. Las interacciones de cada elemento ya están testeadas con usuarios beta — los cambios visuales deben respetar las affordances (qué es tappable, qué no).

---

## Contexto del producto

CoachAI es una **PWA de coaching fitness con IA** (mobile-first, dark theme, app-style — no landing page). Está en beta con usuarios reales. La arquitectura visual ya consolidada se llama **"crystal-depth"**: cards con bg `rgba(20,20,32,0.55)` + `backdrop-filter: blur(24px) saturate(140%)` + bordes sutiles `rgba(255,255,255,0.08)` + sombras de profundidad + inset highlights top.

### Paleta brand
- Background base: `#04040a` (casi negro)
- Violeta primario: `#7c6aff` · bright: `#b4a7ff`
- Azul: `#5b9fff`
- Teal / accent positivo: `#2ecfb5`
- Rojo warning: `#ff6b6b`
- Gradiente brand: `linear-gradient(135deg, #7c6aff, #5b9fff, #2ecfb5)`

### Tipografía
- **Bebas Neue** — títulos grandes (números hero, headings)
- **DM Sans** — body, nombres de cards
- **JetBrains Mono** — eyebrows, labels técnicos, chips

---

## PARTE 1 — Home: pulir visualmente cards existentes

📸 **Ver `screens/01-home-top.png`**

5 cards en total visibles desde el primer scroll.

### Cards a mantener visualmente iguales (solo pulido sutil)

1. **Hero card "ENTRENAMIENTOS X/N COMPLETADOS"** — el ring con la mancuerna está bien. Mantener el ícono de mancuerna + el gradiente brand del anillo + el número con gradient text.
2. **"PRÓXIMA COMIDA"** — ícono bowl con vapor ✅ mantener.
3. **"HOY TOCA"** — ícono mancuerna ✅ mantener.
4. **"COACH AI · CONSULTA LO QUE NECESITES"** — ícono burbuja de chat ✅ mantener.

### ⚠️ Card que necesita ÍCONO NUEVO

5. **"CALORÍAS HOY"** — actualmente usa un ícono de llama 🔥 lineal. **Necesitamos un ícono que represente mejor "tracking de calorías diarias"** — algo más fitness-tracker, menos "fuego".

   Ideas a explorar: dial/gauge, una hoja con número, manzana stylized, target con anillo, ring de macronutrientes simplificado. Crystal-depth aesthetic, line-icon style (stroke 1.6px) consistente con los otros.

   El gráfico de barras (DES/ALM/MER/CEN) está OK estructuralmente — son las 4 comidas tildadas del día. El color violeta de las barras se puede mantener o explorar gradient.

---

## PARTE 2 — Seguimiento Semanal: REDISEÑO TOTAL (visual)

📸 **Ver `screens/02-seguimiento-mixed.png`**, **`screens/03-semana-cerrada-expanded.png`** y **`screens/04-cierre-modal.png`**

Esta es la pieza crítica del brief — la card de Seguimiento Semanal tiene **múltiples estados e interacciones** y todo se siente legacy. Necesitamos rediseño completo manteniendo el flujo funcional intacto.

### Estados visuales a rediseñar

#### A. Card de semana — colapsada · estado "En curso"
📸 *screens/02-seguimiento-mixed.png — parte inferior (SEM 1)*

- Hoy se ve: badge `SEM 2` (verde teal) + rango de fechas + chips de stats (días entrenados, kcal/día) + pill `En curso` violeta + chevron
- Estilo legacy "card con border" — no matchea crystal-depth del resto de Home
- **Rediseñar**: que sea coherente con las otras cards de Home (mismo bg, blur, sombras). Considerar un layout más limpio que NO compita con las cards superiores.

#### B. Card de semana — expandida · estado "En curso"
📸 *screens/02-seguimiento-mixed.png — parte superior (SEM 2)*

- Lista vertical de días con emojis (💪 Entrenó / ❌ Descanso / 🍽 kcal)
- Botón gigante con gradient `🏁 Cerrar semana y ver mi análisis`
- **Rediseñar**: la lista diaria se siente desordenada. El botón puede ser más sutil/elegante. Considerar timeline visual.

#### C. Card de semana — colapsada · estado "Cerrada"
📸 *screens/02-seguimiento-mixed.png — parte inferior*

- Badge `SEM 1` + chip rojo `0 días entrenados` (cuando trained=0) + pill verde `✓ Cerrada` + chevron
- **Rediseñar**: que el estado cerrada se vea "completado" y se diferencie visualmente del "En curso" sin saturar.

#### D. Card de semana — expandida · estado "Cerrada"
📸 *screens/03-semana-cerrada-expanded.png*

- Sección `📸 TRANSFORMACIÓN VISUAL` con 2 fotos lado a lado (INICIO + SEMANA N)
- Sección `📊 ANÁLISIS DE LA SEMANA` con texto markdown del análisis IA
- **Rediseñar**: la comparación de fotos puede ser más impactante (overlay, swipe before/after, slider). El análisis IA debe verse como una "carta del coach" — más editorial, menos raw text.

#### E. Modal de cierre semanal
📸 *screens/04-cierre-modal.png*

- Header `🏁 CIERRE DE SEMANA · Semana 2 · 25 may al 31 may`
- Grid 2x2 con 4 stats grandes: Días entrenados X/N · Kcal promedio/día · Proteína prom X/Ng · Días registrados X/7
- Sección "📸 Compará tu evolución" con 2 slots: foto inicial (siempre llena) + foto nueva (opcional, upload)
- CTA gradient `✨ Generar análisis de mi semana`
- Botón `← Cerrar`
- **Rediseñar**: las cards de stats están OK pero podrían sentirse más "premium dashboard". El upload de foto necesita un look más invitador. El CTA principal puede aprovechar más el gradient brand.

### Interacciones a respetar (no cambiar comportamiento)

- Tap en card colapsada → expande/colapsa (chevron rota)
- Tap "Cerrar semana" → abre modal full-screen
- Modal: tap upload foto → preview inline + 2 botones (elegir otra / confirmar)
- Modal: tap "Generar análisis" → loader → texto del IA aparece inline en modal + se guarda + card pasa a "Cerrada"
- Tap "← Cerrar" → cierra modal sin guardar
- Tap "VER ANÁLISIS COMPLETO →" (en Perfil → Último Análisis) → navega a Home y abre la card de la semana correspondiente

### Reglas de diseño no negociables

1. **Mobile-first 375px**. Cualquier propuesta debe verse bien primero en mobile.
2. **Crystal-depth aesthetic**. Bg dark, blur, sombras, sin colores planos.
3. **Tipografía existente** (Bebas Neue / DM Sans / JetBrains Mono). No introducir fuentes nuevas.
4. **Gradiente brand** para acentos importantes — usar con moderación.
5. **Sin emojis decorativos invasivos**. Los actuales (📸 📊 🏁 ✨) se pueden reemplazar por SVG line-icons.
6. **Accesibilidad táctil**: cada card/botón mínimo 44px alto, áreas de tap claras.

### Entregable esperado

Mockup Figma (o equivalente) con:
- Card colapsada "En curso" + Card colapsada "Cerrada"
- Card expandida "En curso" (con lista de días + CTA)
- Card expandida "Cerrada" (con fotos + análisis)
- Modal de cierre (estado inicial + post-análisis)
- Nuevo ícono para "CALORÍAS HOY"
- Sugerencias menores documentadas para las otras 4 cards de Home (si aplica)

---

## Screenshots (carpeta `design/screens/`)

| # | Archivo | Qué muestra |
|---|---|---|
| 1 | `01-home-top.png` | Home completo: header + hero ring + 4 cards + inicio de Seguimiento Semanal |
| 2 | `02-seguimiento-mixed.png` | SEM 2 expandida en curso + SEM 1 colapsada cerrada |
| 3 | `03-semana-cerrada-expanded.png` | Semana cerrada con Transformación Visual + Análisis IA |
| 4 | `04-cierre-modal.png` | Modal Cierre de Semana — flujo completo |
