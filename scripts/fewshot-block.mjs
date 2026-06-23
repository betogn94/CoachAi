// ⚠️ YA ESTÁ LIVE (2026-06-23): estos 3 bloques fueron PORTADOS a buildSystemPrompt
// en index.html. El modo `baseline` del harness ahora ya los incluye. NO corras `ab`
// esperando comparar contra el viejo prompt: spliceria ESTO encima de lo que ya está
// (doble). Sirve como referencia histórica del cambio. Para un A/B futuro, editá los
// bloques a la NUEVA mejora a probar.
// ============================================================================
// VARIANTE B — bloques que se splicean en buildSystemPrompt para el A/B test.
// Cada inserción va ANTES de su anchor (string exacto presente en el prompt).
// Diseñado contra las fallas REALES medidas en el baseline:
//   1. "preguntó" (5/5 dietas, 4/5 rutinas) → regla que FUERZA generar.
//   2. proteína baja / kcal lejos → few-shot dieta proteína-densa que suma al target.
//   3. "falta cardio/descanso" → few-shot rutina con esas líneas obligatorias.
// ============================================================================

const FORCE_GEN = `GENERACIÓN DE PLANES — ESTA REGLA MANDA SOBRE EL ONBOARDING Y LA BIENVENIDA:
Si el mensaje del cliente es exactamente "🥗 Dieta de la semana", "💪 Rutina de la semana" (o "🥗 Weekly Diet" / "💪 Weekly Routine"), tu respuesta ES el plan completo de 7 días, nada más. GENERALO YA, en el formato de abajo, empezando DIRECTAMENTE por la primera línea del plan (el header "Plan nutricional —" para dieta, o "Día 1 ·" para rutina).
PROHIBIDO ABSOLUTO en ese caso: saludar, presentarte, preguntar por dónde arrancar, ofrecer elegir entre dieta y rutina, mostrar el cálculo de TDEE, escribir "voy a calcular", o pedir confirmación — AUNQUE sea el primer mensaje del cliente y AUNQUE no haya conversación previa. El cliente ya pidió el plan; entregáselo entero.`;

const DIETA_FEWSHOT = `EJEMPLO DE REFERENCIA — así se arma UNA comida bien hecha (mismo formato exacto que vas a usar). Fijate la fuente de proteína fuerte y que los macros cierran con las calorías. NO copies este alimento ni esta cantidad: es solo el patrón de formato y densidad de proteína.
Alm: Pechuga de pollo 180g + arroz integral 130g cocido + ensalada mixta + 1 cda aceite oliva — 490cal · P:46g C:40g G:14g

CÓMO LLEGAR AL TARGET (CLAVE — el error más común es quedarse CORTO de calorías):
- Cada comida lleva una fuente de proteína fuerte (pollo, carne, pescado, huevo/claras, yogur griego, whey). Que la suma de proteína del día llegue al objetivo.
- Armá las 4-5 comidas y AJUSTÁ las porciones hasta que la suma de cada día caiga CERCA del Target del cliente (dentro de ±10%). Si tu plan suma menos, NO lo entregues: subí porciones (más arroz/avena/pan/papa/fruta/aceite) hasta llegar.
- ESCALÁ AL TARGET REAL: un plan para 1400 kcal es chico; uno para 2000-2800 kcal (volumen, o personas grandes/varones) lleva MUCHA más comida. NO uses porciones de "definir mujer" para un target alto: te vas a quedar corto y el plan queda mal.
- TÁCTICA PARA TARGETS ALTOS (>2000 kcal): hacé los carbohidratos grandes — arroz/avena/pasta 100-150g en SECO (no cocido), pan 3-4 rebanadas, 2 frutas; sumá una colación extra de ~400 kcal (ej: batido con avena+banana+mantequilla de maní, o pan con queso y huevo). Antes de cerrar cada día, SUMÁ los Totales: si el promedio quedó por debajo del Target, subí porciones hasta llegar. Es mejor pasarse un poco que quedarse corto.
- El "Target" del header debe ser el promedio real de los Totales de los 7 días.`;

const RUTINA_FEWSHOT = `EJEMPLO DE REFERENCIA — formato y nivel de detalle de una rutina bien hecha (adaptá los ejercicios, el énfasis y la cantidad de días al perfil de ESTE cliente; NO la copies literal):

Día 1 · Glúteos y femoral
1. Hip thrust con barra — 4×12 · peso desafiante · desc 90s
   ↳ Pausá 1 segundo arriba apretando fuerte el glúteo, bajá controlado sin tocar el piso.
2. Peso muerto rumano con mancuernas — 4×12 · desc 75s
   ↳ Sentí el estiramiento del femoral, espalda recta, la cadera va hacia atrás.
3. Estocadas búlgaras — 3×12 cada pierna · desc 60s
4. Patada de glúteo en polea — 3×15 cada pierna · desc 45s
Cardio: 15-20 min de caminata en cinta inclinada al terminar.

OBLIGATORIO en CADA rutina que generes: incluí una línea "Cardio: ..." (aunque sea caminata) y al final una línea "Descanso: ..." con los días libres de la semana. No las omitas nunca.`;

export default {
  insertions: [
    { anchor: 'MENSAJE DE BIENVENIDA (SOLO PARA EL PRIMER MENSAJE', text: FORCE_GEN },
    { anchor: 'REGLAS CRÍTICAS:', text: DIETA_FEWSHOT },
    { anchor: 'PARA CUALQUIER OTRA CONSULTA DEL CLIENTE:', text: RUTINA_FEWSHOT },
  ],
};
