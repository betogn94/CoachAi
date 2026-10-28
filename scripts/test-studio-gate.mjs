// ============================================================================
// TEST-STUDIO-GATE — el gate de legibilidad de Studio (planGateCheck)
// ============================================================================
// `node scripts/test-studio-gate.mjs` (o `npm run test:studio-gate`).
//
// Carga de studio/index.html el bloque generado (window.StudioPlanParsers) y
// planGateCheck REALES, y verifica:
//   - formatos crudos tipo Roxana/Ana (2026-10-23/28) → RECHAZADOS con un motivo útil
//   - formatos canónicos (incl. estilo Vicky/Juli: LUNES + "Comida N:") → ACEPTADOS
//   - los ejemplos que Studio le muestra al coach → ACEPTADOS (si no, el
//     ejemplo enseñaría un formato roto)
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunction } from './build-chat-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const studio = readFileSync(join(__dirname, '..', 'studio', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

const blk = studio.match(/<!-- BEGIN studio-plan-parsers[^\n]*\n\s*<script>\n([\s\S]*?)<\/script>/);
if (!blk) throw new Error('No encontré el bloque studio-plan-parsers');
const window = {};
new Function('window', blk[1])(window);

const ej = studio.match(/const PLAN_EJEMPLO = (\{[\s\S]*?\n {2}\});/);
if (!ej) throw new Error('No encontré PLAN_EJEMPLO');
const PLAN_EJEMPLO = new Function(`return ${ej[1]};`)();

const planGateCheck = new Function('window', `${extractFunction(studio, 'planGateCheck')}; return planGateCheck;`)(window);

const CASOS = [
  // — dietas rechazadas —
  { tipo: 'dieta', esperado: false, motivo: /Falta el día/, nombre: 'Roxana: **DESAYUNO** sin día ni kcal', txt:
`**DESAYUNO**
- 2 claras de huevo + 1 huevo entero / 60g de pollo
- 2 galletas de arroz / 40g de avena

**ALMUERZO**
- 110g de pechuga de pollo / 1 scoop de proteínas

**CENA**
- 110g de carne roja / 100g de salmón` },
  { tipo: 'dieta', esperado: false, motivo: /“DESAYUNO”.*Comida 1: Desayuno/, nombre: 'Ana: **Calorías** + **COMIDA 2**', txt:
`**Calorías: 1620kcal**
**Proteínas: 130g | Carbos: 160g | Grasas: 55g**

**DESAYUNO**
- 2 huevos enteros

**COMIDA 2**
- 120g de carne roja magra

**MERIENDA**
- 150g de queso cottage` },
  { tipo: 'dieta', esperado: false, motivo: /“DÍA 1” no sirve en dietas/, nombre: 'salida real de la IA: **DÍA 1** + **DESAYUNO** (QA 2026-10-28)', txt:
`**DÍA 1**

**DESAYUNO**
- 2 claras de huevo + 1 huevo entero

**CENA**
- 110g de carne roja` },
  { tipo: 'dieta', esperado: false, motivo: /Falta el día/, nombre: 'Comida N: bien pero sin día', txt:
`Comida 1: Desayuno — 482kcal · P:34g C:37g G:22g
- 2 huevos enteros
Comida 2: Almuerzo
- 120g de carne` },
  { tipo: 'dieta', esperado: false, motivo: /DEBAJO del día/, nombre: 'comidas arriba del día', txt:
`Comida 1: Desayuno
- 2 huevos
LUNES` },
  { tipo: 'dieta', esperado: false, motivo: /./, nombre: 'charla sin plan', txt: 'Hola! Te paso la dieta mañana, cualquier cosa avisame.' },
  // — dietas aceptadas —
  { tipo: 'dieta', esperado: true, nombre: 'canónica con kcal/macros', txt:
`Plan nutricional — Ana | Target: 1620 kcal/día | P:130g C:160g G:55g

LUNES

Comida 1: Desayuno — 482kcal · P:34g C:37g G:22g
- 2 huevos enteros + 0.5 scoop de proteína

Comida 2: Almuerzo — 395kcal · P:32g C:51g G:7g
- 120g de carne roja magra

Total: 877kcal` },
  { tipo: 'dieta', esperado: true, nombre: 'estilo Vicky (LUNES + Comida N: sin kcal)', txt:
`Plan nutricional — Vicky | Target: 1387 kcal/día | P:112g C:138g G:43g

LUNES

Comida 1:
- 3 claras de huevo + 1 huevo entero

Comida 2:
- 120g de pechuga de pollo` },
  { tipo: 'dieta', esperado: true, nombre: 'IA: 7 días con Desayuno:/Cena:', txt:
`Target: 2000 kcal/día | P:150g C:200g G:60g
**LUNES**
Desayuno: avena con banana — 450 kcal
Cena: pollo con arroz — 600 kcal
MARTES
Desayuno: tostadas — 400 kcal` },
  { tipo: 'dieta', esperado: true, nombre: 'ejemplo que muestra Studio (dieta)', txt: PLAN_EJEMPLO.dieta },
  // — rutinas —
  { tipo: 'rutina', esperado: false, motivo: /series×reps/, nombre: 'rutina cruda sin × ni días', txt:
`**PIERNAS**
Sentadilla 4 series de 10
Prensa 3 series de 12` },
  { tipo: 'rutina', esperado: false, motivo: /Falta el encabezado/, nombre: 'ejercicios sin día', txt:
`1. Hip thrust — 4×10
2. Prensa — 3×12` },
  { tipo: 'rutina', esperado: true, nombre: 'rutina canónica', txt:
`Día 1 · Glúteos
1. Hip thrust — 4×10 · desc 90s
2. Peso muerto rumano — 3×12
Día 2 · Tren superior
1. Press militar — 4×8
Descanso: miércoles, domingo` },
  { tipo: 'rutina', esperado: true, nombre: 'rutina Jesús (**LUNES** + series x reps)', txt:
`**LUNES — GLÚTEOS**
Hip thrust — 4 series x 10 reps — descanso: 90s
Sentadilla búlgara — 3 series x 12 reps` },
  { tipo: 'rutina', esperado: true, nombre: 'ejemplo que muestra Studio (rutina)', txt: PLAN_EJEMPLO.rutina },
];

let fallas = 0;
for (const c of CASOS) {
  const g = planGateCheck(c.tipo, c.txt);
  let ok = g.ok === c.esperado;
  if (ok && !c.esperado && c.motivo && !g.motivos.some(m => c.motivo.test(m))) ok = false;
  if (!ok) fallas++;
  console.log(`${ok ? '✓' : '✗'} [${c.tipo}] ${c.nombre} → ${g.ok ? 'ACEPTADO' : 'RECHAZADO'}`);
  if (!g.ok) g.motivos.forEach(m => console.log(`     · ${m}`));
}
console.log(`\n${CASOS.length - fallas} OK · ${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
