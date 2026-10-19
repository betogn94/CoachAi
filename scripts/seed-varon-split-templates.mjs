// Plantillas de respaldo de RUTINA para VARONES con el split de Jesús (docs/reglas-split-jesus.md).
// Reemplazan la vieja "varon_5d_rutina.txt" (Cuádriceps · Espalda/Hombros · Pecho/Tríceps ·
// Femorales/Aductores/Pantorrillas · Bíceps/Tríceps), que no sigue el split nuevo. Ejercicios y
// forma de escribir los intensificadores sacados de esa plantilla real de Jesús.
//
// Uso: node scripts/seed-varon-split-templates.mjs   → valida contra el esqueleto y la vara de la
//      app (api/_chat-cerebro.js) y escribe las fuentes en migra_king/. NO toca la base: la carga
//      se hace aparte (update de la fila 5d existente + insert de 3/4/6).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const { crearCerebro } = await import(pathToFileURL(join(RAIZ, 'api', '_chat-cerebro.js')).href);
const cerebro = crearCerebro({});

const DROP = 'drop set (máximo peso al fallo → bajar 30% y fallar → bajar 30% y fallar otra vez)';
const CLUSTER = 'al fallo → esperar 15s → al fallo otra vez (2 a 5 reps más)';

const B = {
  pechoTriceps: `Dia {N} · Pecho/Tríceps
1. Pecho Inclinado (Mancuernas) — 3x15,12,12 · aumentar peso en cada set; último set pausa abajo en cada rep hasta el fallo
2. Pecho Plano (Máquina o Mancuernas) — 3x12 · recorrido completo, aumentar peso en cada set
3. Aperturas (Máquina Peck Deck o Mancuernas) — 3x15 · ir pesado que cueste; última serie ${DROP}
4. Press Cerrado (Barra o Máquina) — 3x12 · codos pegados al cuerpo, aumentar peso en cada set
5. Extensión de Tríceps (Polea con barra recta o en V) — 3x15,12,12 · subir peso en cada set; última serie ${DROP}
6. Extensión de Tríceps Tras Nuca (Soga o Francés con mancuernas) — 3x15 · aguantar 2s el estiramiento abajo en cada rep`,
  espaldaBiceps: `Dia {N} · Espalda/Bíceps
1. Jalones (Barra, agarre abierto) — 3x15,12,12 · aumentar peso en todos los sets; último set ${CLUSTER}
2. Remo Sentado (agarre cerrado) — 3x15,12,12 · aguantar la contracción 2s en cada rep
3. Remo con Mancuerna — 3x15 · recorrido completo, aumentar peso en cada set
4. Curl de Bíceps (Barra o Mancuernas) — 3x15,12,12 · aumentar peso en cada set; última serie al fallo
5. Bíceps Preacher o Scott (Máquina/Barra/Mancuernas) — 3x15 · aumentar peso en cada set, ir pesado que cueste
6. Martillos (con soga en la polea) — 3x15 · aumentar peso en cada set; última serie ${DROP}`,
  pierna: `Dia {N} · Cuádriceps/Femorales/Glúteos/Pantorrillas
1. Sentadilla Hack o Smith — 3x15,12,12 · aumentar peso en cada set; último set cada 5 reps pausa isométrica de 5s a 90 grados
2. Extensión de Cuádriceps — 3x20,15,15 · último set ${DROP}
3. Peso Muerto Rumano (Barra o Mancuernas) — 3x15 · pesado, recorrido completo, aumentar peso en cada serie
4. Curl de Femorales Acostado — 3x15 · negativa de 3s en todas las reps
5. Hip Thrust — 3x15 · aguantar 2s la contracción arriba en cada rep
6. Abducción de Caderas (Máquina) — 2x20 · peso medio/alto, recorrido completo
7. Pantorrillas Parado (Máquina) — 3x20 · pausa al fondo de 2s en cada rep, aumentar peso en todas las series
8. Pantorrillas Sentado — 2x25 · si las 25 no son al fallo, ir al fallo`,
  hombrosTriceps: `Dia {N} · Hombros/Tríceps
1. Elevaciones Laterales — 3x20 · aumentar peso en cada set; aguantar 2s arriba hasta la rep 10, en la décima aguantar 5s y luego 10 más sin pausa
2. Press Militar (Mancuernas) — 3x12 · peso pesado, aumentar en cada set
3. Pájaros (Reverse Peck Deck o Mancuernas) — 3x15 · aguantar 2s la contracción atrás en cada rep
4. Extensión de Tríceps (Cables con soga) — 3x15,12,12 · subir peso en cada set; última serie ${DROP}
5. Tríceps Francés con Mancuerna — 3x15 · subir peso en cada set`,
  hombrosBiceps: `Dia {N} · Hombros/Bíceps
1. Elevaciones Laterales — 3x20 · aumentar peso en cada set; aguantar 2s arriba hasta la rep 10, en la décima aguantar 5s y luego 10 más sin pausa
2. Press Militar (Mancuernas) — 3x12 · peso pesado, aumentar en cada set
3. Pájaros (Reverse Peck Deck o Mancuernas) — 3x15 · aguantar 2s la contracción atrás en cada rep
4. Curl de Bíceps Inclinado (Mancuernas) — 3x12 · estiramiento completo abajo; última serie al fallo
5. Martillos (con soga en la polea) — 3x15 · aumentar peso en cada set`,
  pechoTricepsBis: `Dia {N} · Pecho/Tríceps
1. Pecho Inclinado (Máquina) — 3x15,12,12 · aumentar peso en cada set; última serie ${DROP}
2. Crossover en Polea — 3x15 · aguantar 2s la contracción al centro en cada rep
3. Fondos Asistidos (foco tríceps) — 3x12 · cuerpo erguido; último set ${CLUSTER}
4. Extensión de Tríceps (Polea con barra en V) — 3x15 · recorrido completo, aumentar peso en cada set`,
  espaldaFemorales: `Dia {N} · Espalda/Femorales
1. Dominadas (libres o asistidas) — 3x12 · negativa de 4s en las últimas 4 reps de cada serie
2. Remo con Barra o T-Bar — 3x15 · aumentar peso en cada set
3. Peso Muerto Rumano (Mancuernas) — 3x15 · pausa de 2s abajo (músculo más estirado) en todas las reps
4. Curl de Femorales Sentado — 3x15,15,12 · aumentar peso en cada set`,
  pechoTricepsHombros: `Dia {N} · Pecho/Tríceps/Hombros
1. Pecho Inclinado (Mancuernas) — 4x15,15,12,12 · aumentar peso en cada set; los últimos 2 sets pausa abajo en cada rep hasta el fallo
2. Aperturas (Máquina Peck Deck o Mancuernas) — 3x15 · ir pesado que cueste; última serie ${DROP}
3. Extensión de Tríceps (Polea con barra recta o en V) — 4x15,12,12,12 · subir peso en cada set; última serie al fallo
4. Extensión de Tríceps Tras Nuca (Soga o Francés con mancuernas) — 3x15 · aguantar 2s el estiramiento abajo en cada rep
5. Elevaciones Laterales — 4x20 · aumentar peso en cada set; aguantar 2s arriba hasta la rep 10, en la décima aguantar 5s y luego 10 más sin pausa
6. Press Militar (Mancuernas) — 3x12 · peso pesado, aumentar en cada set`,
  espaldaBicepsTrapecios: `Dia {N} · Espalda/Bíceps/Trapecios
1. Jalones (Barra, agarre abierto) — 4x15,12,12,12 · aumentar peso en todos los sets; último set ${CLUSTER}
2. Remo Sentado (agarre cerrado) — 3x15,12,12 · aguantar la contracción 2s en cada rep
3. Curl de Bíceps (Barra o Mancuernas) — 4x15,15,12,12 · aumentar peso en cada set; última serie al fallo
4. Martillos (con soga en la polea) — 3x15 · aguantar 2s la contracción en todas las reps
5. Encogimientos (Mancuernas o Barra) — 3x15 · aguantar 2s arriba en cada rep
6. Remo Alto agarre amplio (Polea) — 3x15 · codos altos, bajada controlada de 3s`,
};

const SPLITS = {
  3: ['pechoTricepsHombros', 'espaldaBicepsTrapecios', 'pierna'],
  4: ['pechoTriceps', 'espaldaBiceps', 'pierna', 'hombrosTriceps'],
  5: ['pechoTriceps', 'espaldaBiceps', 'pierna', 'hombrosBiceps', 'pechoTricepsBis'],
  6: ['pechoTriceps', 'espaldaBiceps', 'pierna', 'hombrosBiceps', 'pechoTricepsBis', 'espaldaFemorales'],
};

export function plantilla(n) {
  const dias = SPLITS[n].map((k, i) => B[k].replace('{N}', String(i + 1)));
  const titulos = dias.map((d) => d.split('\n')[0].replace(/^Dia \d+ · /, '')).join(', ');
  return `RUTINA — {NOMBRE} · ${n} dias · ${titulos}\n\n${dias.join('\n---\n')}\n---\n`
    + `**Cardio:** post entreno, 25-30 minutos de caminata en cinta inclinada\n`
    + `**Descanso:** los días sin entrenamiento — caminata, movilidad o estiramientos 20-30 min\n`;
}

const esScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (esScript) {
  mkdirSync(join(RAIZ, 'migra_king'), { recursive: true });
  let ok = true;
  for (const n of [3, 4, 5, 6]) {
    const c = plantilla(n);
    const esq = cerebro.validarRutinaEsqueleto(c, 'masculino', n);
    const vara = cerebro.evaluatePlanQuality('rutina', c, { expectedDays: n }).reasons;
    if (esq.length || vara.length) ok = false;
    console.log(`${n} días: esqueleto ${esq.length ? '✗ ' + esq.join(' ; ') : '✓'} · vara ${vara.length ? '✗ ' + vara.join(' ; ') : '✓'}`);
    writeFileSync(join(RAIZ, 'migra_king', `backup_varon_${n}d_split.txt`), c);
  }
  process.exit(ok ? 0 : 1);
}
