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
| **F2** | **Simulación offline con datos reales** ✅ HECHA 2026-09-28 (ver §8) + **Modo sombra en la app**: computar ambos relojes, loguear `week_clock_divergencia` en `beta_eventos` unos días | Cero (solo lectura/telemetría) |
| **F3** | Flip del cliente (index.html: consumidores 1-12) detrás de escape **`?semanaiso=0`** + bump + QA E2E con cuentas de prueba (alta lunes / alta jueves / usuaria con historial viejo) | Medio — mitigado por sombra + escape |
| **F4** | Cron (13) + Studio si hiciera falta (14 — en principio intacto por `fecha_inicio/fin`) | Bajo |
| **F5** | Limpieza: retirar reloj viejo + doc de cierre | Bajo |

**Regla de oro de todo el proyecto:** cada fase se deploya sola, con QA real, y ninguna fase reescribe datos históricos.

## 6. QA plan (mínimo)
- Harness Node de fechas: alta en cada día de la semana × (semana parcial, semana completa, borde de año ISO, cambio de hora) → rangos esperados.
- Cuentas de prueba: `beto131312` (reset, alta lunes) y una alta jueves; + `josealberto.gnavas` (caso real con historial viejo → valida el cierre puente).
- Simulación F2 revisada por Beto ANTES del flip (números concretos: qué cambia para quién).
- Cron: dry-run del push de cierre con el reloj nuevo contra usuarias reales (sin enviar).

## 7. Preguntas abiertas — ✅ RESUELTAS (Beto, 2026-09-28)
1. **Semana de arranque: PRORRATEADA (opción A).** Se evaluó la alternativa "primera semana aniversario de 7 días" (cerrar el jueves siguiente): viable pero solo mueve la semana parcial a la semana 2, revive la comparación 7-días-vs-4-días y mantiene dos definiciones de semana → descartada.
2. **Transición: CIERRE PUENTE (opción A).** Un único cierre neutro por usuaria, marcado transición, sin juicio.
3. **Índice King: IRRELEVANTE.** El método King / Índice de Armonía ya no lo usa ningún usuario (confirmado por Beto). El código (`kingCierreCalcula`, checkpoint %4) queda dormido tal cual, sin cambios. `semana_num` se conserva como contador de orden para mostrar "Semana N".
4. **Comunicación: TRANSPARENTE (opción A).** El cierre puente con tono neutro absorbe la transición.

---

## 8. F2 — Resultados de la simulación con datos reales (2026-09-28)

Método: para cada cuenta activa (31), serie de entrenos/semana (unión `dias_entrenados` + `progreso_diario.entreno` — la misma regla del cierre) bajo ambos relojes, últimas 6 semanas completas (17/08→27/09), y peor caída semana-a-semana según cada reloj.

**Validación del método:** todas las altas de lunes dan series IDÉNTICAS bajo ambos relojes (p.ej. Virginia `3,3,3,3,3,3`) → la simulación computa bien.

**Resultado: de 13 cuentas con actividad comparable, 8 (62%) reciben una narrativa semanal distinta según el reloj.** Casos destacados (solo nombre de pila):

| Caso (alta) | Serie ISO (real) | Serie reloj personal | Distorsión |
|---|---|---|---|
| Angelica (sáb) | `1,2,1,1` (caída máx -1) | `3,0,2` (caída -3) | El reloj viejo inventa una semana en CERO → análisis "no entrenaste" FALSO |
| FlorL (dom) | `5,5,5,3` | `5,4,6,3` | Constancia perfecta convertida en serrucho |
| Bárbara (sáb) | `4,5,4,4,3,1` | `4,3,6,4,3,1` | Pico de 6 inventado, constancia 4-5 escondida |
| José Alberto (mar) | `3,3` | `4` (→2 al cerrar) | El caso disparador, confirmado exacto |
| Erica (dom) | `5,5,3,2,5,1` (-4) | `6,4,4,2,4,2` (-2) | Narrativa completamente distinta |
| Carolina C. (vie) | `0,2,1,2,0,0` | `0,2,0,3,0,0` | Montaña rusa inventada |
| Fernanda D. (sáb) | `5,3,4,3,0,1` (-3) | `5,3,4,2,1,1` (-2) | **Dirección inversa**: el viejo ESCONDE un parate real (la semana en 0 existió) |
| Roxana (vie) | `2,5,5,6,3,3` | `5,5,6,5,3` | Corrimientos de 1 día por borde |

**Conclusiones:**
1. La distorsión es **masiva** (62% de las comparables) y **bidireccional**: a veces reta de más (Angelica, FlorL, José Alberto), a veces esconde un parate real (Fernanda D.) — el reloj viejo no es "más blando" ni "más duro", es **incorrecto** respecto de la semana humana.
2. Al menos 1 análisis habría afirmado un hecho falso ("cero entrenos") sobre una semana en la que la clienta SÍ entrenó.
3. Refuerza la decisión de F0: parches de etiqueta no arreglan esto; solo el cambio de reloj.

Queda de F2: **modo sombra** en la app (`week_clock_divergencia` en `beta_eventos`) para validar en vivo el reloj nuevo contra el viejo antes del flip F3.

**Hallazgo extra (2026-09-28, captura real de José Alberto):** la card "Seguimiento semanal" dibuja la barra de días con etiquetas fijas **L M M J V S D**, pero pinta los días por POSICIÓN dentro de la semana personal → para una alta de martes, el entreno del martes aparece bajo la "L" y el del jueves bajo la "M". **El reloj personal está etiquetando mal los días de la semana en la UI** para toda alta no-lunes (72%). El flip F3 lo arregla gratis (la posición 1 pasa a ser realmente lunes); no vale la pena un parche previo.
