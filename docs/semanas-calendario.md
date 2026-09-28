# Semanas calendario (lunes-domingo) — relevamiento + diseño

> **Estado:** DISEÑO — nada implementado. Para revisión de Beto y Jesús.
> **Fecha:** 2026-09-28
> **Disparador:** caso real de Beto (cuenta personal): entrenó 3+3 en dos semanas calendario, pero el reloj personal (anclado al martes de su alta) las partió 4/2 → el análisis leería "bajaste de 4 a 2". Decisión de Beto: ir al fix de raíz, bien planeado.

---

## 1. El problema

Hoy conviven **dos relojes** en la app:

| Reloj | Quién lo usa | Definición |
|---|---|---|
| **Semana ISO** (lunes-domingo) | Planes (`planes_semanales.semana_iso`), auto-repeat | Semana calendario estándar |
| **Semana personal** (anclada al alta) | Cierres, análisis, stats, racha de semanas, Índice King, push de cierre, Studio | Semana N = [alta + (N-1)·7 días, +6 días] |

Consecuencias del reloj personal:
- **72% de las usuarias afectadas** (58/80 con alta en día no-lunes; 22/31 de las activas). Sus semanas corren p.ej. jueves→miércoles, y nadie piensa así.
- **Análisis injustos en los bordes**: entrenos "reales" de una semana calendario caen partidos entre dos semanas personales → el análisis compara 4→2 y reta, cuando fue 3→3. (Mismo patrón de daño que el caso Bárbara, otra raíz.)
- Dos relojes = fábrica de bugs de borde (planes en un calendario, cierres en otro).

## 2. La decisión

**Unificar TODO en la semana ISO (lunes-domingo)** — el mismo reloj que ya usan los planes. La semana personal desaparece como concepto.

## 3. Inventario completo de consumidores del reloj viejo

Relevado el 2026-09-28 sobre todo el repo (símbolos: `getWeekNum`, `getWeekRange`, `getWeeksActiveSince`, `semana_num`, `cierreActualWeekNum`, `pendingCierreWeek`, `isWeekCierreEligible`).

### index.html
| # | Consumidor | Línea aprox | Qué hace con el reloj |
|---|---|---|---|
| 1 | `getWeekNum(createdAt)` | ~27001 | Semana actual del programa (1-based desde alta) — **función a reemplazar** |
| 2 | `getWeekRange(createdAt, weekNum)` | ~27018 | Rango [inicio, fin] de la semana N — **función a reemplazar** |
| 3 | `renderSemanas()` | ~27060 | Vista "Seguimiento semanal" (stats + fotos por semana, 1..actual) |
| 4 | Catch-up de cierres | ~27383 | Ofrecer cerrar semanas viejas sin cierre |
| 5 | `ejecutarCierreSemana()` | ~27655-28180 | El cierre: `cierreActualWeekNum`, `computeWeekStats(range)`, análisis IA (recibe historial "Sem N: X entrenos"), guarda `semana_num` + `fecha_inicio/fecha_fin` |
| 6 | Comparación de fotos post-cierre | ~28322 | Rango de la semana para elegir fotos |
| 7 | `isWeekCierreEligible()` / `pendingCierreWeek()` | ~29653/29672 | Elegibilidad y cola de cierres pendientes |
| 8 | **Cierre libre** (auto-close) | ~29741-29817 | Cierra la semana sola al terminar (usa 7) |
| 9 | `getWeeksActiveSince()` | ~30213 | "Semana N" del héroe de Perfil (~30440) + adherencia promedio lifetime (~30233) |
| 10 | `adminBuildSemanasHTML()` | ~36257 | Réplica de la vista semanas para admin/impersonación |
| 11 | `autoAdjustDiet()` | ~? (buscar `semana_num` en su idempotencia) | Idempotencia del ajuste "por semana del proceso" |
| 12 | Índice King (`kingCierreCalcula` + checkpoint) | ~28134-28145 | Puntaje por cierre + checkpoint visual cada 4 semanas (`semana % 4`) |

### api/cron-notifications.js
| # | Consumidor | Línea | Qué hace |
|---|---|---|---|
| 13 | `userWeek(createdAt, tz)` | ~147 | **Réplica del reloj viejo** para el push "cierre semana" (último día / día siguiente) + query de cierres por `semana_num` (~366) |

### studio/index.html
| # | Consumidor | Línea | Qué hace |
|---|---|---|---|
| 14 | Vista cierres del alumno | 2689, 2694, 3081, 3157 | Ordena por `semana_num`, etiqueta "SEM 01" |

### Base de datos
| # | Objeto | Detalle |
|---|---|---|
| 15 | `cierres_semanales` | `semana_num` (único por usuario: onConflict `usuario_id,semana_num`), `fecha_inicio`, `fecha_fin` |
| 16 | `king_medidas` | Filas origen 'cierre' referencian `semana_num` |

### A verificar en fase 1 (no aparentan usar el reloj, confirmar)
- Racha/logros (rachas son por DÍA, no semana → en principio intactas; confirmar logros semanales si los hay).
- `computeWeekStats` en sí es agnóstico (recibe un rango) → no cambia.

## 4. Diseño propuesto

### 4.1 El reloj nuevo
- Semana = **ISO lunes-domingo**, idéntica a `semana_iso` de planes (misma función generadora, un solo reloj en toda la app).
- `cierres_semanales` gana columna **`semana_iso` (text, ej. "2026-W40")** — el ancla real del cierre nuevo.
- `semana_num` se CONSERVA como **contador de orden para mostrar** ("Semana 8 de tu proceso"): cierre nuevo = `max(semana_num del usuario) + 1`. Nunca colisiona con la numeración vieja y las vistas (Studio, strip) siguen funcionando sin tocarse.

### 4.2 Semana de arranque (el trade-off central)
El ancla al alta existía para que TODA usuaria tuviera una primera semana de 7 días. Con ISO, la que se registra un jueves tiene semana 1 de 4 días. Diseño:
- La semana ISO del alta se marca **`parcial: true`** en los stats del cierre (días disponibles < 7).
- **Objetivo prorrateado**: `ceil(dias_entreno × días_disponibles / 7)` para adherencia/Índice.
- **Análisis instruido**: en semana parcial, tono de arranque, sin comparación ni juicio ("arrancaste el jueves: estos X días cuentan como puesta en marcha").
- **Índice King**: sin delta negativo en semana parcial.

### 4.3 Transición de las usuarias existentes (el flip)
- **Los cierres históricos NO se tocan** (son registro: sus `fecha_inicio/fecha_fin` describen el rango real que cubrieron).
- Al flip, cada usuaria tiene un "tramo huérfano": los días entre el `fecha_fin` de su último cierre viejo y el lunes de la semana ISO en curso.
  - **Regla propuesta**: el primer cierre nuevo cubre `[fecha_fin_último_cierre + 1, domingo de esa semana ISO]` — un **cierre puente** de 1-13 días, marcado `parcial`/`transicion: true`, sin juicio en el análisis (misma vara que la semana de arranque). Desde ahí, semanas ISO limpias.
  - Alternativa descartada: reescribir historia → jamás (falsificaría registros ya vistos por las usuarias).
- El análisis comparativo solo compara **semanas ISO completas entre sí**; las marcadas parcial/transición se muestran pero no puntúan comparaciones.

### 4.4 Compatibilidad
- `fecha_inicio/fecha_fin` siguen guardándose en cada cierre → Studio y las vistas históricas no necesitan saber qué reloj generó cada fila.
- El push del cron (`userWeek`) pasa a "es domingo (último día ISO) / es lunes (día siguiente)" en la tz de la usuaria — MÁS simple que hoy.
- `getWeeksActiveSince` (héroe "Semana N") pasa a contar semanas ISO desde la semana del alta — mismo número visible, definición limpia.

## 5. Plan de ejecución por fases

| Fase | Qué | Riesgo |
|---|---|---|
| **F0** | Este doc → revisión Beto + Jesús. Decidir las 3 reglas: arranque prorrateado, cierre puente, comparación solo-completas | — |
| **F1** | Aditivo: columna `semana_iso` en `cierres_semanales` + helpers nuevos (`isoWeekOf(date)`, `isoWeekRange(iso)`) + tests de fechas (harness con altas en los 7 días de la semana, DST, bordes de año ISO) | Cero (nada lo usa aún) |
| **F2** | **Simulación offline con datos reales** (SQL): para cada usuaria activa, computar sus cierres como si el reloj nuevo hubiera existido → tabla de divergencias (cuántos análisis habrían cambiado). + **Modo sombra en la app**: computar ambos relojes, loguear `week_clock_divergencia` en `beta_eventos` unos días | Cero (solo lectura/telemetría) |
| **F3** | Flip del cliente (index.html: consumidores 1-12) detrás de escape **`?semanaiso=0`** + bump + QA E2E con cuentas de prueba (alta lunes / alta jueves / usuaria con historial viejo) | Medio — mitigado por sombra + escape |
| **F4** | Cron (13) + Studio si hiciera falta (14 — en principio intacto por `fecha_inicio/fin`) | Bajo |
| **F5** | Limpieza: retirar reloj viejo + doc de cierre | Bajo |

**Regla de oro de todo el proyecto:** cada fase se deploya sola, con QA real, y ninguna fase reescribe datos históricos.

## 6. QA plan (mínimo)
- Harness Node de fechas: alta en cada día de la semana × (semana parcial, semana completa, borde de año ISO, cambio de hora) → rangos esperados.
- Cuentas de prueba: `beto131312` (reset, alta lunes) y una alta jueves; + `josealberto.gnavas` (caso real con historial viejo → valida el cierre puente).
- Simulación F2 revisada por Beto ANTES del flip (números concretos: qué cambia para quién).
- Cron: dry-run del push de cierre con el reloj nuevo contra usuarias reales (sin enviar).

## 7. Preguntas abiertas para Jesús/Beto (cerrar en F0)
1. ¿OK que la semana de arranque puntúe prorrateado (vs. no puntuar en absoluto)?
2. ¿OK el "cierre puente" único en la transición (vs. esperar al próximo lunes y dejar días sin cerrar)?
3. Índice King: ¿el checkpoint visual "cada 4 semanas" cuenta semanas de proceso (semana_num) como hoy? (Propuesta: sí, sin cambio.)
4. ¿Comunicamos el cambio a las usuarias (mensaje en el chat post-flip) o es transparente? (Propuesta: transparente; el cierre puente con tono neutro lo absorbe.)
