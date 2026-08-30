# Límites y bloqueos del chat IA — documento de trabajo

> **Estado:** EN DISEÑO. Nada implementado. Documento de contexto para arrancar el trabajo en una conversación nueva.
> **Última actualización:** 2026-08-30
> **Disparador:** el caso **Roxana** (ver abajo). "Van a haber varias Roxanas."

---

## 1. El problema en una frase

La IA del chat de la app tiene **permiso para reescribir el plan completo** (dieta/rutina) de una clienta cuando ella pide cambios por chat. No hay ningún ancla que le diga "las kcal y la estructura del plan son intocables". Resultado: clientas que chatean mucho terminan **rompiendo su propio plan** (le suman calorías, comidas raras, ejercicios que no corresponden), y además queda abierto un **agujero de seguridad**: alguien con mala intención, a fuerza de muchos mensajes, puede empujar a la IA a hacer cosas que no debe.

## 2. La visión acordada (falta pulir)

Separar **dos mundos** que hoy están mezclados:

| | **El PLAN** | **El REGISTRO del día** |
|---|---|---|
| Qué es | Estructura: comidas + kcal + macros objetivo / rutina | Lo que realmente comió/entrenó hoy |
| Fuente de verdad | `planes_semanales` (contenido) | `progreso_diario` |
| Quién lo cambia | **Solo el coach** (Jesús, vía Studio) | **La clienta**, libremente |
| El "gustito" (un snack) | ❌ NO toca el plan | ✅ Se anota como comida del día |

**Regla de oro:** por más que la clienta pida snacks, más comida, otro ejercicio, etc., **las kcal/estructura de su plan NO se modifican por chat**. Si quiere un cambio de fondo → lo coordina con su coach. Si fue un gustito de un día → lo registra en Mi Alimentación y la IA le calcula los macros solo para ese día.

## 3. Cómo funciona hoy (mapa técnico)

Todo en `index.html` (la app entera). Nombres de función = anclas estables; las líneas se mueven con cada edición, re-verificar con grep.

### El agujero principal — el chat pisa el plan
- **`detectPlanInReply(reply)`** (~19166): detecta si la respuesta de la IA "parece" un plan completo (regex de kcal/macros/días).
- **Envío del chat** (~22618): `const tipoFromReply = detectPlanInReply(reply)`.
- **La línea del agujero** (~22686):
  ```js
  if (tipo && replyHasStructure && (!weeklyPlans[tipo] || weeklyPlans[tipo].closed || tipoFromReply)) {
      const saved = await saveWeeklyPlan(tipo, planTextToSave);  // ← PISA el plan existente
  ```
  El `tipoFromReply` significa: "si la IA escribió un plan en su respuesta, guardalo (pisando el anterior)". **Por acá se coló todo el desastre de Roxana**: pidió snacks → la IA regeneró la dieta entera → esta línea la guardó encima.

### El "gustito" — YA EXISTE, no hay que construirlo
- **`estimateMealNutrition(mealText)`** (~23580): toma una comida en lenguaje natural, calcula kcal + macros (usa Open Food Facts primero, si no cae a la IA con prompt experto ~23593), y lo guarda en el **registro del día** (`progreso_diario`), NO en el plan. Es exactamente el mecanismo que queremos para el snack. Se usa desde Mi Alimentación → editar comida.

### El prompt que genera los planes
- **`buildSystemPrompt()`** (~21396): el system prompt que le dice a la IA cómo generar dieta/rutina (template "Plan nutricional — [Nombre] | Target: Xkcal/día | P/C/G", tabla nutricional de referencia, formato de rutina "Día N · ..."). **Acá se le enseñarían las reglas de King** (ver §6) y la regla de "no reescribir el plan por chat".

### Otros puntos que regeneran/guardan planes (NO romper)
- **`saveWeeklyPlan(tipo, contenido)`** (~18356): el upsert a `planes_semanales`. Todo pasa por acá.
- **`autoRepeatPlans()`** (~18442): clona el plan de la semana pasada a la nueva (post-cierre / launch). Legítimo.
- **`autoAdjustDiet(semanaIso)`** (~18567): ajusta la dieta para la semana siguiente según progreso (prompt "AJUSTA una dieta semanal existente"). Legítimo — pero OJO, este también puede tocar kcal.
- **`reconcileDietKcal(text)`** (~18345): ya reconcilia/normaliza kcal de un plan. **Candidato a extender** para el "clamp" al target (ver §5b).
- **Gen headless del onboarding** (~18866): `saveWeeklyPlan(tipo, planText)` — el plan que nace del onboarding. **Acá es donde King recibe planes IA que violan sus reglas** (ver §6).
- **`aiNormalizePlan(tipo, raw)`** (~32938): reformatea un plan sin inventar contenido (usado en Studio y como fallback).

### Cómo identificar a una clienta de coach (King / 1-a-1)
- `usuarios.metodo_king` (boolean) — cohorte King, estampada al alta. Helper `kingEsCohorte()` (~26216).
- `beta_invitados.migrada_de_coach` — de qué coach viene una migrada.
- Estos flags sirven para decidir **a quién se le aplica el bloqueo**.

## 4. Las 4 tensiones a resolver (por qué NO lo tocamos a la ligera)

1. **Límite sin muro.** Decir "no" al cambio de plan sin que la clienta buena sienta que la app no la ayuda. El "gustito" es UNA válvula, pero hay que contemplar TODOS los pedidos legítimos: hambre real sostenida, una comida que le cae mal, un viaje, una lesión que le impide un ejercicio, etc. ¿Cuáles se resuelven solos (registro/sustitución) y cuáles escalan al coach?
2. **Quién y cuándo se bloquea.** ¿Todas las clientas de coach (`metodo_king`/migradas) por default? ¿Un flag por clienta activable desde Studio? ¿El tenant default (IA pura, sin coach humano) SÍ puede regenerar y solo las de coach no?
3. **Seguridad / abuso (lo más importante según Beto).** Prompt injection por volumen: alguien a fuerza de muchos mensajes empuja a la IA a regenerar planes, filtrar info, salirse de su rol, o quemar tokens/plata. Se trabaja **aparte** del tema kcal: límite de mensajes por período, IA anclada a su rol pase lo que pase, sin poderes destructivos desde el chat, no exponer datos de otras usuarias.
4. **Repercusión a futuro.** Cualquier candado tiene que **convivir** con: onboarding (genera plan), cierre semanal (`autoRepeatPlans`/`autoAdjustDiet` regeneran solos), y migraciones (Studio escribe el plan). Hay que bloquear a la CLIENTA por chat, NO al sistema.

## 5. Enfoque de solución candidato (NO decidido)

Idea de defensa en capas — a validar y pulir:

**a) Candado por clienta (el bloqueo real).** Flag `plan_bloqueado` (o reusar `metodo_king`). En la línea ~22686 agregar `&& !planBloqueado` → el chat NO puede pisar el plan para esas clientas. El plan solo cambia desde Studio (coach), onboarding, o el auto-repeat/adjust del cierre.

**b) Clamp por código (blindaje de kcal).** El prompt solo *convence*; Haiku a veces se desvía. Extender `reconcileDietKcal` (~18345) para que, si algún flujo intenta guardar una dieta cuyo total se fue >X% del target guardado de la clienta, la **rechace o la reescale** al target. El "Target" del plan pasa a ser fuente de verdad intocable.

**c) Prompt redirect.** En `buildSystemPrompt` (~21396): para clienta bloqueada, la IA responde a pedidos de cambio con algo tipo *"tu plan lo arma tu coach; si hoy te diste un gustito andá a Mi Alimentación → editar comida y te calculo los macros sin tocar tu plan"*.

**d) Blindaje anti-abuso (eje seguridad, §4.3).** Rate-limit de mensajes, prompt anclado al rol (no obedecer instrucciones que lo saquen de coach), sin capacidad de exponer datos ni ejecutar acciones destructivas desde el chat.

**Prioridad sugerida:** empezar por **a + c** (candado + redirect) que resuelven ~90% del caso Roxana con cambio chico y seguro; **b** como blindaje; **d** como track de seguridad propio.

## 6. Reglas de negocio de King que la IA NO conoce (y viola en el onboarding)

Descubiertas con Roxana. La IA genera planes en el onboarding **sin conocer el método King**, por eso salen mal:
- **NO se le da pecho a mujeres.** (Roxana tenía un "Día 5 · Pecho/Hombros" completo salido del onboarding IA; corregido a mano a "Glúteos/Hombros".) OJO: "pecho arriba" como cue de postura y ejercicios de espalda con "pecho" en el nombre (jalón al pecho, remo pecho apoyado) SÍ van — la regla es no ENTRENAR pecho.
- **Objetivo default de King para mujeres = definir**, no volumen (la IA le puso volumen a Roxana).
- **Dieta en estilo King de siempre**: opciones con "/", set de alimentos de ellos (camote/batata, yautía, pollo, carne roja magra, pescado, huevos, yogur griego, avena, arroz, aguacate, frutos secos, arándanos/fresas), 4 comidas, kcal por comida = 4·P + 4·C + 9·G exacto.

**Conclusión de fondo:** las clientas de King **no deberían recibir planes generados por IA en el onboarding** — los arma Jesús. La generación IA les viola las reglas del método. Mismo root que el tema del chat: la IA no debería tener autoridad sobre los planes de clientas de coach.

## 7. Restricciones / cómo trabajar

- **QA real obligatorio** antes de soltar nada (no "debería funcionar"). Probar con una cuenta antes de live. Marcar explícito lo no-probado.
- **Validar planes** con `node scripts/check-plan.mjs <dieta|rutina> <archivo>`; si se tocan parsers, `npm run test:parsers` (16 casos) antes y después.
- **Bump de versión** antes de cada deploy: `node scripts/bump-version.mjs` (sino la PWA sirve caché vieja).
- **Haiku se desvía** — por eso el candado tiene que ser por CÓDIGO, no solo prompt.
- No romper onboarding / cierre semanal / migraciones (§4.4).

## 8. Estado del caso Roxana (referencia, ya resuelto a mano)

`roxy6668@gmail.com` · id `65a2a604-88e7-4442-aa58-74cba3903ded` · King · 53 años, 56kg, 153cm.
- Dieta: era snack-heavy (generada por IA + modificada por chat) → reemplazada por dieta King de **definir** (1385 kcal, 4 comidas).
- Objetivo: era `volumen` (mal) → corregido a `definir` en DB.
- Rutina: tenía día de pecho (error del onboarding IA, NO lo pidió ella) → reemplazado por "Día 5 · Glúteos/Hombros".
- Todo verificado con check-plan + queries. Alertas de Tower borradas.

## 9. Preguntas abiertas para Beto / Jesús

- ¿El bloqueo aplica a TODAS las de coach por default, o flag por clienta desde Studio?
- ¿El tenant default (IA pura) mantiene la capacidad de regenerar por chat, o también se limita?
- ¿Qué pedidos legítimos deben resolverse solos (registro/sustitución de comida o ejercicio) vs. escalar al coach?
- ¿Límite de mensajes por período? ¿Cuál?
- ¿King deja de recibir planes IA en el onboarding? (implica que Jesús cargue el plan antes de que la clienta entre, o un estado "esperando plan del coach").

---

### Memorias relacionadas
`limites_chat_ia_plan` (índice de este tema), `motor_ia` (Haiku, caché), `seguridad_estado`, `flujo_producto`, `migration_rules` (formato canónico), `tenant_admin_architecture` (Studio), `entreno_registro_diagnostico` (patrón heavy-chatter rompe su plan).
