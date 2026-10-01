# Renovación de rutina cada 4 semanas

**Estado: F0-F2 IMPLEMENTADAS Y DEPLOYADAS (2026-10-01), gated `?renov=1`. Falta F3: QA E2E con login real + flip a default ON.**

QA hecho (2026-10-01, localhost con estado simulado — NO probado en prod con login real):
- Sintaxis de los scripts inline de index.html y studio OK (8/8).
- UI de los 4 pasos verificada con screenshots (tema claro violeta, días preseleccionados desde `dias_entreno`, resumen correcto).
- Gate: coach ✗ / no-self-serve ✗ / King sin self_serve ✓ / rutina `origen='coach'` ✗ / `origen=null` ✗ / rutina cerrada ✗ / elegible ✓.
- Cadencia: semana 3 ✗ / semana 4 y 8 ✓ / ya vista ✗. "Seguir con mi rutina" marca visto y no reaparece.
- `_focoPromptBlock` entra a `buildSystemPrompt()` solo con foco seteado.
- DB: columnas creadas + backfill `origen='ia'` a los 12 planes de las 6 self-serve (2026-10-01).
- **No probado:** generación real end-to-end (Haiku + guardado + render de Mi Entreno), flujo EN, King real con reglas sin-pecho, `renov_*` en beta_eventos con RLS real.

Pendiente F3: QA E2E con la cuenta de prueba (sembrar cierre semana 4) → flip del flag a `!== '0'` (escape `?renov=0`) + decidir backfill de las King web existentes.

## Qué es

Cada 4 semanas, a las usuarias self-serve (stores + compra web King) se les ofrece renovar su rutina con un overlay post-cierre:

- **"Seguir con mi rutina"** → 1 tap, todo sigue igual (el clon semanal ya existe).
- **"Quiero una rutina nueva"** → wizard de 3 pantallas:
  1. **Días**: chips lun-dom (mismo patrón del onboarding), preseleccionados con sus días actuales. Puede subir, mantener o bajar días.
  2. **Foco**: pregunta nueva — `Glúteos y piernas` / `Tren superior` / `Cuerpo completo` / `Abdomen y core` / `Sin preferencia`.
  3. **Resumen + confirmación**: "4 días (lun·mar·jue·vie) · foco glúteos — ¿Generamos tu nueva rutina?" → loading → rutina nueva.

**Regla de oro (pedida por Beto): nunca queda sin plan.** El clon de `autoRepeatPlans` se crea igual que siempre; la rutina nueva, si sale bien, lo pisa (mismo conflict `usuario_id,tipo,semana_iso`). Si Haiku falla dos veces y el template de respaldo tampoco aplica, sigue con el clon + toast de disculpa.

## Audiencia (crítico — no pisarle planes a Jesús)

Solo rutinas **generadas por IA**. Las migradas / cargadas a mano por el coach quedan FUERA.

Gate propuesto (doble candado):

1. **Usuario elegible**: `usuarios.self_serve === true` **o** `kingEsCohorte()` (`metodo_king`, L28766).
2. **Rutina elegible**: `planes_semanales.origen` (columna NUEVA) de la rutina activa ∈ `('ia','clon')`. Si `origen='coach'` → jamás mostrar. **El toque del coach gana**: si Jesús carga/edita una rutina en Studio, esa clienta deja de ver el overlay aunque sea self-serve.
3. Excluir `role!=='user'`, `isReviewLogin` (cuenta del revisor de Apple) — mismo patrón que `applyCierreGate`.

### Decisión pendiente (Beto)

Backfill de `origen` para filas existentes: `self_serve=true` → `'ia'` es seguro. Las King web ya activas con `metodo_king=true` en tenant jesus se mezclan con las 1:1 de Jesús — para ellas el default conservador es `origen=null` = **no mostrar** hasta que Beto/Jesús confirmen la lista. Se puede backfillear después sin tocar código.

## Cadencia

Igual que el checkpoint visual King (index.html L28303): **`semana_num >= 4 && semana_num % 4 === 0`**, evaluado post-cierre (manual o auto). Checkpoints fijos en semanas 4, 8, 12… — sin estado nuevo, sin reset. Mostrado una vez por semana vía localStorage `cai_renov_visto_<uid>_<weekNum>` (patrón `_cierreVistoKey`, L29869).

Momento de disparo: dentro de `reabrirCicloPostCierre()` (L27034) **después** de `autoRepeatPlans` (el clon ya existe = red de seguridad), y encolado detrás del overlay de cierre si está abierto (`applyCierreGate` ya respeta modales abiertos — misma cortesía inversa).

## Generación (reusa TODO el camino existente)

`prefetchPlan('rutina')` (L20139) ya hace: llamada Haiku → `planReplyHasStructure` → `aiNormalizePlan` → `evaluatePlanQuality` → fallback `getBackupPlan` → `saveWeeklyPlan`. El wizard solo necesita preparar el estado que `buildSystemPrompt()` lee:

- `selectedDias` ← chips del wizard (y persistir a `usuarios.dias_entreno`).
- Foco ← columna NUEVA `usuarios.foco_entreno` + inyección en el prompt (ver abajo).
- **Fix aprovechado**: hidratar lesiones desde `usuarios.lesiones` (hoy solo viven en localStorage/DOM — una usuaria que volvió en otro dispositivo genera rutina SIN sus lesiones; L21605). El wizard las carga a los chips antes de generar.

Dos ajustes al guardado:

- `saveWeeklyPlan` usa `fecha_entrega = hoy` → si el cierre terminó hoy, la rutina nueva nace `closed=true`. Usar `_dayAfter(maxCierreEnd)` como hace `autoRepeatPlans` (L19727). Variante: `saveWeeklyPlan(tipo, contenido, {fechaEntrega, origen})`.
- Marcar `origen='ia'` en el insert; `autoRepeatPlans` propaga el `origen` del plan que clona (default `'clon'` si null… no: propaga literal, y si la fila vieja no tiene, deja null).

### Foco en el prompt

Una línea condicional en la sección de rutina de `buildSystemPrompt()` (ES L23043-23044, EN L23241):

> `PREFERENCIA DE LA CLIENTA: foco en {X}. Prioriza el volumen semanal hacia {X} SIN romper las reglas del método.`

Las reglas King (`REGLAS_KING_MUJER_ES`, sin pecho) y el método reloj de arena siguen mandando — el foco solo redistribuye volumen. "Sin preferencia" = no se inyecta nada.

## Interacción con features vivas

- **Candado del chat**: intacto. Este es el camino *sancionado* fuera del chat (como `prefetchPlan` del onboarding). `sendToAI` no se toca.
- **Arrastre de pesos** (`estado.ex`): el matcheo por nombre rescata solo los ejercicios que se repiten entre rutinas — comportamiento deseado, no hay nada que hacer.
- **Semanas ISO**: `semana_num` ya viene del reloj híbrido F3 (`getWeekNum`, L27131). Nada extra.
- **Checkpoint visual King**: cae en las MISMAS semanas (4, 8, 12…). Orden propuesto: checkpoint (dentro del cierre manual) → overlay de cierre → overlay de renovación. No se pisan: viven en momentos distintos del flujo.

## DB (migración Supabase)

```sql
alter table usuarios add column foco_entreno text;
alter table planes_semanales add column origen text; -- 'ia' | 'coach' | 'clon'
```

- RLS: sin cambios (la usuaria ya actualiza su propia fila de `usuarios` vía `launchCoach`; `planes_semanales` ya tiene policies por usuario).
- Escrituras a marcar `origen='coach'`: Studio upserts (`studio/index.html` L3947) y `migrateClientPreloadedPlans` (L23295).
- GOTCHA MCP: el execute_sql corre todo en 1 transacción — no verificar DDL con ROLLBACK en la misma llamada.

## Flags, telemetría, idiomas

- Flag `RENOV_RUTINA`: nace **opt-in `?renov=1`** para QA → flip a default ON con escape `?renov=0` (patrón IIFE de `CIERRE_LIBRE`, L26990).
- Telemetría en `beta_eventos`: `renov_shown`, `renov_keep`, `renov_new` (payload: días viejos→nuevos, foco), `renov_ok`, `renov_fail`.
- Todo el copy ES/EN (la app tiene toggle de idioma).
- Overlay/wizard con CSS vars del tema (`--surface`, `--accent…`) — King es tema CLARO.

## Fases

- **F0 — DB**: migración de las 2 columnas + marcar `origen='coach'` en Studio y migración. Backfill `origen='ia'` para self_serve (resto: decisión pendiente).
- **F1 — Overlay**: gate de audiencia + cadencia + overlay 2 botones, gated `?renov=1`. Telemetría shown/keep. "Seguir" = dismiss y nada más.
- **F2 — Wizard + generación**: 3 pantallas, persistencia días/foco, hidratación de lesiones, foco en el prompt, `prefetchPlan` con `fecha_entrega` correcta y `origen='ia'`, loading overlay (patrón `#plan-loading-overlay`), toasts de éxito/fallo.
- **F3 — QA E2E + flip**: cuenta de prueba (reset receta beto131312, simular `semana_num=4` con cierres sembrados), probar: elegible ve overlay / migrada NO / coach-touched NO / mantener / cambiar OK / cambiar con Haiku caído (sigue el clon) / King sin pecho con foco tren superior / ES+EN / revisor Apple NO. Flip default ON + `?renov=0`. `node scripts/bump-version.mjs` antes del deploy.

## QA — recordatorios de la casa

- `?as=` está roto post-RLS → QA con login OTP leyendo Gmail; cuenta de prueba King en `?tenant=king`.
- NO pollear prod (Security Checkpoint) — checks sueltos espaciados.
- Commit directo a main, stagear archivos específicos (NUNCA `git add -A`).
