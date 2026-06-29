-- =====================================================================
-- ROLLBACK de AUTH FASE C — vuelve al estado PERMISIVO (el de hoy, 2026-06-29)
-- =====================================================================
-- Correr ESTO si el cutover de RLS rompe algo y hay que deshacer YA.
-- Deja la base como antes de aplicar docs/auth-fase-c-rls.sql:
--   policies *_all USING(true) permisivas + sin column-grant + sin helpers.
-- Generado capturando las policies reales de prod antes del cutover.
-- Tras correr esto, REVERTIR TAMBIÉN el deploy de la app (volver a la rama legacy
-- sin OTP) — sino el login OTP quedaría andando contra RLS permisivo (inofensivo,
-- pero conviene dejar todo coherente).
-- =====================================================================

-- 1) DROPEAR las policies RESTRICTIVAS que creó la Fase C ------------------
DROP POLICY IF EXISTS usuarios_sel ON public.usuarios;
DROP POLICY IF EXISTS usuarios_upd ON public.usuarios;
DROP POLICY IF EXISTS usuarios_ins ON public.usuarios;
DO $$
DECLARE t text;
  tbls text[] := ARRAY['alimentacion_semanal','beta_eventos','cargas_ejercicios','cierres_semanales',
    'dias_entrenados','dieta_consistency_alerts','entreno_semanal','feedback','fotos_progreso','historial_chat',
    'king_medidas','notas_coach','notification_log','planes_semanales','progreso_diario','progreso_medidas',
    'progreso_peso','push_subscriptions','user_logros'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_owner', t); END LOOP;
END $$;
DO $$
DECLARE t text; shared text[] := ARRAY['plan_templates','ejercicios_biblioteca','tenants'];
BEGIN
  FOREACH t IN ARRAY shared LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t); END LOOP;
END $$;

-- 2) REVERTIR el column-grant de usuarios (volver a UPDATE total) ----------
REVOKE UPDATE ON public.usuarios FROM authenticated;
GRANT  UPDATE ON public.usuarios TO authenticated;

-- 3) RECREAR las policies PERMISIVAS (estado de hoy) -----------------------
CREATE POLICY "alimentacion_semanal read all" ON public.alimentacion_semanal FOR SELECT TO public USING (true);
CREATE POLICY "alimentacion_semanal write all" ON public.alimentacion_semanal FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY beta_eventos_all ON public.beta_eventos FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY cargas_ejercicios_all ON public.cargas_ejercicios FOR ALL TO public USING (true);
CREATE POLICY cierres_semanales_all ON public.cierres_semanales FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY dias_entrenados_all ON public.dias_entrenados FOR ALL TO public USING (true);
CREATE POLICY "ejercicios_biblioteca read for all" ON public.ejercicios_biblioteca FOR SELECT TO public USING (true);
CREATE POLICY entreno_semanal_all ON public.entreno_semanal FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY feedback_all ON public.feedback FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY fotos_progreso_all ON public.fotos_progreso FOR ALL TO public USING (true);
CREATE POLICY historial_chat_all ON public.historial_chat FOR ALL TO public USING (true);
CREATE POLICY king_medidas_all ON public.king_medidas FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY notas_coach_all ON public.notas_coach FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY notification_log_all ON public.notification_log FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on plan_templates" ON public.plan_templates FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on planes_semanales" ON public.planes_semanales FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY progreso_diario_all ON public.progreso_diario FOR ALL TO public USING (true);
CREATE POLICY progreso_medidas_all ON public.progreso_medidas FOR ALL TO public USING (true);
CREATE POLICY progreso_peso_all ON public.progreso_peso FOR ALL TO public USING (true);
CREATE POLICY push_subscriptions_all ON public.push_subscriptions FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY tenants_public_read ON public.tenants FOR SELECT TO public USING (true);
CREATE POLICY "Allow all on user_logros" ON public.user_logros FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY usuarios_insert ON public.usuarios FOR INSERT TO public WITH CHECK (true);
CREATE POLICY usuarios_select ON public.usuarios FOR SELECT TO public USING (true);
CREATE POLICY usuarios_update ON public.usuarios FOR UPDATE TO public USING (true);
-- beta_invitados: se lockeó en el cutover (2026-06-29, gap del advisor). Recrear su
-- policy permisiva para que la registración LEGACY (anon, post-rollback) lea la allowlist.
CREATE POLICY beta_invitados_all ON public.beta_invitados FOR ALL TO public USING (true) WITH CHECK (true);

-- 4) DROPEAR los helpers de la Fase C (opcional — son inofensivos) ---------
DROP FUNCTION IF EXISTS public.app_current_uid();
DROP FUNCTION IF EXISTS public.app_current_tenant();
DROP FUNCTION IF EXISTS public.app_is_coach();

-- NOTA: los RPCs del cutover (auth_resolve_session, coach_*, *_my_migration,
-- studio_delete_client de 1 arg) pueden quedarse — son aditivos y solo se llaman
-- en modo OTP; con la app en legacy no se invocan.
