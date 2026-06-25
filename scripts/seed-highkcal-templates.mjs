// Crea plantillas de dieta de ALTO KCAL (gap del backup: fem tope 1591, masc 2000).
// Escala fielmente el FORMATO de Jesús (multi-opción "/", header {TARGET}, días que
// repiten estructura). El header lleva {TARGET} → al servir se reemplaza por el target
// REAL del usuario, así que la vara siempre pasa; las porciones acá sostienen el kcal_base.
// Inserta en plan_templates vía PostgREST (RLS allow-all → anon key pública alcanza).
//
// Uso: node scripts/seed-highkcal-templates.mjs            (valida + muestra, NO inserta)
//      node scripts/seed-highkcal-templates.mjs --insert   (inserta de verdad)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPA = 'https://vmvhlgzwufkardaruutt.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdmhsZ3p3dWZrYXJkYXJ1dXR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzA4NjcsImV4cCI6MjA5Mjg0Njg2N30.x9-lV9xi3Kdu_zpHcGC0PC80-GiXpc1WD4lnAuFI_iM';
const DIAS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

// ── FEMENINO ~2400 (volumen / mujer grande). 4 comidas, proteína-densa. ──
const FEM_DIA = `Desayuno: 4 claras de huevo + 2 huevos enteros + 80g de avena / 80g crema de arroz / 5 galletas de arroz + 1 banana o 120g de fruta + 15g de pasta de maní o almendras / 15 almendras o nueces + infusión a gusto (con endulzante, sin azúcar)
Almuerzo: 180g de pechuga de pollo o pescado blanco / 2 latas de atún al natural / 1 scoop de proteína + 130g de pechuga + 180g de arroz / 180g de quinoa / 250g de papa o boniato + 30g de aguacate + 10g de aceite de oliva + 70g de verduras verdes
Merienda: 200g de yogurt griego sin azúcar / 1 scoop y medio de proteína + 50g de avena / 3 galletas de arroz + 100g de arándanos o fresas + 16g de mantequilla de almendras o frutos secos
Cena: 180g de carne roja magra / pechuga de pollo / merluza / mariscos / 140g de salmón + 180g de arroz / 180g de quinoa / 250g de papa o boniato + 70g de mix de ensalada verde + 10g de aceite de oliva`;

// ── MASCULINO ~2700 (volumen / varón grande). 5 comidas, escala del 2000 de Jesús. ──
const MASC_DIA = `Comida 1: 4 huevos enteros + 80g de avena / 4 rebanadas de pan lactal / 6 galletas de arroz + 30g de palta + 20g de mantequilla de frutos secos (preferentemente almendra) / 20 almendras o nueces + 1 banana o 120g de fruta + café o té
Comida 2: 220g de pechuga de pollo / atún / tilapia / cerdo / carne roja magra + 180g de arroz / 180g de quinoa / 250g de papas o batatas + 60g de vegetales verdes + 30g de palta / 12g de aceite de oliva / 30g de queso
Comida 3: 250g de yogur griego / 1 scoop y medio de whey + 60g de avena / 2 rebanadas de pan + 1 banana o 120g de fruta + 20g de nueces / pasta de maní
Comida 4: 220g de salmón / atún / carne roja magra / pescado blanco + 180g de arroz / 180g de quinoa / 250g de papas o batatas + 60g de vegetales verdes + 10g de aceite de oliva
Comida 5: 1 scoop y medio de whey / 250g de yogur griego + 40g de avena / 2 galletas de arroz + 100g de fruta + 20g de mantequilla de maní o almendras`;

function buildPlan(dia) {
  return 'Plan nutricional — {NOMBRE} | {TARGET}\n\n' +
    DIAS.map(d => d + '\n' + dia).join('\n\n') + '\n';
}

const templates = [
  { tipo: 'dieta', sexo: 'femenino',  objetivo: 'volumen', dias: null, kcal_base: 2400, contenido: buildPlan(FEM_DIA) },
  { tipo: 'dieta', sexo: 'masculino', objetivo: 'volumen', dias: null, kcal_base: 2700, contenido: buildPlan(MASC_DIA) },
];

// guardar las fuentes para el registro (como los otros backups)
try { mkdirSync(join(__dirname, '..', 'migra_king'), { recursive: true }); } catch (e) {}
for (const t of templates) {
  writeFileSync(join(__dirname, '..', 'migra_king', `backup_${t.sexo}_${t.kcal_base}.txt`), t.contenido);
}

// validación estructural mínima (la vara real vive en index.html; acá chequeo lo básico)
for (const t of templates) {
  const days = t.contenido.split(/\n(?=LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)/).filter(s => /^(LUNES|MARTES)/.test(s) || DIAS.some(d => s.startsWith(d)));
  const dayCount = (t.contenido.match(/\b(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)\b/g) || []).length;
  const mealsPerDay = (t.contenido.split('LUNES')[1] || '').split(/\n(?=MARTES)/)[0].split('\n').filter(l => /^(Desayuno|Almuerzo|Merienda|Cena|Comida)/.test(l)).length;
  const hasTarget = /\| \{TARGET\}/.test(t.contenido);
  console.log(`${t.sexo} ${t.kcal_base}: dias=${dayCount} comidas/dia=${mealsPerDay} header={TARGET}:${hasTarget} len=${t.contenido.length}`);
}

if (!process.argv.includes('--insert')) {
  console.log('\n(dry-run — agregá --insert para insertar en plan_templates)');
  process.exit(0);
}

for (const t of templates) {
  const r = await fetch(`${SUPA}/rest/v1/plan_templates`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(t),
  });
  console.log(`insert ${t.sexo} ${t.kcal_base}: HTTP ${r.status}${r.ok ? ' OK' : ' — ' + (await r.text()).slice(0, 200)}`);
}
