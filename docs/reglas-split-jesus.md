# Reglas de split — Jesús (fuente de verdad para la IA de rutinas)

Recibidas el 2026-10-19 (Beto ↔ Jesús). Este documento es el contrato: el código arma el
esqueleto de la semana con estas reglas y la IA solo completa los ejercicios.

## Reglas generales (mujeres y hombres)

1. **Descanso por músculo:** ningún músculo se repite sin al menos 1 día de por medio.
2. **Nunca** se mezcla tren inferior con tren superior en el mismo día.
3. **Volumen por músculo según su aparición en la semana:**
   - 1ª vez en la semana → hasta **3 ejercicios**, máx 3 series c/u.
   - 2ª vez (y 3ª o más) → **2 ejercicios**, máx 3 series c/u, **1 intensificador**.
   - **Músculo solo en el día** (único caso) → hasta **4 ejercicios**, máx 3 series c/u,
     máx 2 intensificadores en ejercicios distintos.
   - **Día de 3 músculos** → **2 ejercicios por músculo**, hasta **4 series** por ejercicio
     (única excepción al tope de 3 series).
4. **Intensificadores:** máx 2 por músculo, siempre en ejercicios distintos (nunca 2 en el mismo).
5. Mínimo 3 días por semana, cubriendo todos los músculos principales.

## Mujeres — enfoque tren inferior (glúteo)

**Pecho: NUNCA** (regla firme de Beto, ni aunque la alumna lo pida).

| Días | Split |
|---|---|
| 3 | Glúteos/Cuádriceps · Espalda/Hombros/Bíceps/Tríceps · Glúteos/Femorales |
| 4 | Glúteos/Cuádriceps · Espalda/Hombros · Glúteos/Femorales · Hombros/Bíceps/Tríceps |
| 5 | Glúteos/Cuádriceps · Espalda/Hombros · Glúteos · Hombros/Bíceps/Tríceps · Glúteos/Femorales |
| 6 | el de 5 + día 6 = día 1 sin los músculos que violan el descanso → **Cuádriceps** (solo) |

Ejercicios por día resultantes (5 días): 6 · 6 · 4 · 6 · 5 — (6 días: + 4).

## Hombres — enfoque tren superior (pecho)

| Días | Split |
|---|---|
| 3 | Pecho/Tríceps/Hombros · Espalda/Bíceps/Trapecios · Cuádriceps/Femorales/Glúteos/Pantorrillas |
| 4 | Pecho/Tríceps · Espalda/Bíceps · Cuádriceps/Femorales/Pantorrillas/Glúteos · Hombros/Tríceps |
| 5 | Pecho/Tríceps · Espalda/Bíceps · Cuádriceps/Femorales/Pantorrillas/Glúteos · Hombros/Bíceps · Pecho/Tríceps |
| 6 (A) | Pecho/Tríceps · Espalda/Bíceps · Cuádriceps/Femorales/Glúteos/Pantorrillas · Hombros/Bíceps · Pecho/Tríceps · Espalda/Femorales |
| 6 (B) | PPL ×2: Pecho/Tríceps/Hombros · Espalda/Bíceps/Trapecios · Pierna completa · (descanso) · repetir |

Nota de Jesús (5 días): no va Hombros/Tríceps porque al día siguiente es Pecho/Tríceps y el
pecho carga tríceps indirectamente → se cambia por Hombros/Bíceps.

Ejercicios por día resultantes (5 días): 6 · 6 · ? · 5 · 4 — (6A: 6 · 6 · ? · 5 · 4 · 4).

## Decisiones por sentido común (Beto, 2026-10-19)

- **Días de 4 músculos** (piernas de hombre; Espalda/Hombros/Bíceps/Tríceps de mujer 3 días):
  2 ejercicios por músculo (8 en total), máx 3 series c/u.
- **Hombres 6 días:** opción A.
- 2 días (nadie lo usa hoy; usuarios reales: 3-6): mujer = Glúteos/Cuádriceps/Femorales +
  Espalda/Hombros/Bíceps/Tríceps; hombre = Pecho/Espalda/Hombros + pierna completa.
  7 días → se usa el split de 6.

## Implementación

- `index.html`: `_splitSemanal(sexo, nDias)` arma el esqueleto, `_splitPromptBlock(isEs)` lo
  inyecta en `buildSystemPrompt` (después del método, lo pisa donde difiera),
  `validarRutinaEsqueleto(contenido, sexo, nDias)` mide si la rutina lo cumple.
- `prefetchPlan` (onboarding + renovación): si la rutina no cumple el esqueleto, pide otra;
  si ninguna cumple, guarda la primera (como antes) y registra `rutina_fuera_esqueleto`.
- El servidor (`api/_chat-cerebro.js`, chat + app nativa) recibe el mismo prompt al regenerar.
- QA 2026-10-19 contra la IA real (8 perfiles F/M 3-6 días): prod 0/8 cumple · nuevo 15/16
  al primer intento (el que falla: 1 ejercicio de menos en un día → lo cubre el reintento).
- Pendiente: plantilla de respaldo de varón (5 días) no sigue este split; prompt en inglés
  sin QA.
