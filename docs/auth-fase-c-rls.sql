-- =====================================================================
-- AUTH FASE C — RLS POR-USUARIO (cierra el crítico C1: anon lee/escribe todo)
-- =====================================================================
-- Estado: DISEÑO VALIDADO 2026-06-25 en un schema de prueba aislado (rlstest)
--   con JWT simulado. Probado: aislamiento por-usuario (lectura+escritura),
--   rama coach (ve/edita SOLO su tenant), cross-tenant bloqueado, sin-auth =
--   sin datos, y protección de columnas (clienta NO puede tocar role/acceso_hasta).
--
-- ⚠️ NO APLICAR A PROD HASTA EL CUTOVER (Fase D), en ventana tranquila / base
--   limpia de stores. Antes del cutover, el flujo de login OTP (Fase B) debe
--   estar ACTIVADO (sin ?authotp gate) para que las queries corran autenticadas
--   y manden el JWT — sino esto deja a todos afuera.
--
-- Requisito previo: usuarios.auth_id poblado (se linkea en el primer login OTP).
-- Rollback: tener listo el SQL que recrea las policies permisivas *_all USING(true).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) HELPERS (SECURITY DEFINER → bypassean RLS; evitan recursión cuando una
--    policy sobre `usuarios` necesita consultar `usuarios`).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_current_uid() RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT id FROM usuarios WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.app_current_tenant() RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT tenant_id FROM usuarios WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.app_is_coach() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios
                 WHERE auth_id = auth.uid() AND role IN ('admin','coach')) $$;

-- Los helpers NO deben ser públicos (el advisor marca SECURITY DEFINER ejecutable por anon).
REVOKE EXECUTE ON FUNCTION public.app_current_uid(), public.app_current_tenant(), public.app_is_coach() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.app_current_uid(), public.app_current_tenant(), public.app_is_coach() TO authenticated;

-- ---------------------------------------------------------------------
-- 2) usuarios — fila propia O (coach del mismo tenant). + protección de COLUMNAS.
-- ---------------------------------------------------------------------
-- (Cutover: dropear primero las permisivas usuarios_select/usuarios_update/usuarios_insert.)
DROP POLICY IF EXISTS usuarios_select ON public.usuarios;
DROP POLICY IF EXISTS usuarios_update ON public.usuarios;
DROP POLICY IF EXISTS usuarios_insert ON public.usuarios;

CREATE POLICY usuarios_sel ON public.usuarios FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR (app_is_coach() AND tenant_id = app_current_tenant()));
CREATE POLICY usuarios_upd ON public.usuarios FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR (app_is_coach() AND tenant_id = app_current_tenant()));
CREATE POLICY usuarios_ins ON public.usuarios FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

-- CRÍTICO: la RLS es por-fila, no por-columna. Sin esto, la clienta puede UPDATE
-- su propia fila y cambiarse role='admin' o acceso_hasta (bypass de pago).
-- Solo el service-role (webhook Stripe / Tower) toca role/tenant_id/acceso_hasta/
-- auth_id/renew_url/es_interno/created_at.
REVOKE UPDATE ON public.usuarios FROM authenticated;
GRANT  UPDATE (email, nombre, edad, sexo, peso, altura, cuello, cintura, cadera,
               objetivo, nivel, actividad, dias_entreno, duracion_sesion,
               lugar_entreno, lesiones, restricciones_dieta, alergias, comidas_dia,
               no_le_gusta, telefono, timezone, logro_destacado, updated_at,
               last_active, session_count)
  ON public.usuarios TO authenticated;

-- ---------------------------------------------------------------------
-- 3) TABLAS HIJAS (datos de clienta) — fila propia O (coach con cliente del tenant).
--    Excluye tower_revenue (financiera → queda LOCKED, solo service-role).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  pol record;
  tbls text[] := ARRAY[
    'alimentacion_semanal','beta_eventos','cargas_ejercicios','cierres_semanales',
    'dias_entrenados','dieta_consistency_alerts','entreno_semanal','feedback',
    'fotos_progreso','historial_chat','king_medidas','notas_coach','notification_log',
    'planes_semanales','progreso_diario','progreso_medidas','progreso_peso',
    'push_subscriptions','user_logros'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- dropear TODAS las policies existentes de la tabla (las permisivas *_all)
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = ('public.'||t)::regclass LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.polname, t);
    END LOOP;
    -- policy nueva por-usuario + rama coach
    EXECUTE format($f$
      CREATE POLICY %1$I ON public.%2$I FOR ALL TO authenticated
      USING (
        usuario_id = app_current_uid()
        OR (app_is_coach() AND EXISTS (
              SELECT 1 FROM usuarios u WHERE u.id = %2$I.usuario_id
              AND u.tenant_id = app_current_tenant()))
      )
      WITH CHECK (
        usuario_id = app_current_uid()
        OR (app_is_coach() AND EXISTS (
              SELECT 1 FROM usuarios u WHERE u.id = %2$I.usuario_id
              AND u.tenant_id = app_current_tenant()))
      )
    $f$, t||'_owner', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4) TABLAS COMPARTIDAS — lectura para cualquier autenticado, escritura solo service-role.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text; pol record;
DECLARE shared text[] := ARRAY['plan_templates','ejercicios_biblioteca','tenants'];
BEGIN
  FOREACH t IN ARRAY shared LOOP
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = ('public.'||t)::regclass LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.polname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_read', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5) QUEDAN LOCKED (sin policy = deny para anon/authenticated; solo service-role):
--    tower_revenue, tower_costs, team_tasks, team_recurring, team_push_subscriptions,
--    beta_invitados, king_intake.  (No se tocan acá — ya están así.)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 6) STORAGE — bucket progress-photos privado + acceso por path = <auth uid del dueño>.
--    El path de subida es `${usuario_id}/...`; lo atamos a que el primer segmento
--    sea el id del usuario autenticado (o un coach de su tenant).
--    (Ejecutar junto con: UPDATE storage.buckets SET public=false WHERE id='progress-photos';
--     y migrar el render del cliente a createSignedUrl.)
-- ---------------------------------------------------------------------
-- DROP POLICY IF EXISTS "progress-photos insert" ON storage.objects;  -- ejemplo
-- CREATE POLICY "pp_owner_rw" ON storage.objects FOR ALL TO authenticated
--   USING (bucket_id='progress-photos'
--          AND (storage.foldername(name))[1] = app_current_uid()::text)
--   WITH CHECK (bucket_id='progress-photos'
--          AND (storage.foldername(name))[1] = app_current_uid()::text);
-- (La rama coach para fotos se agrega si Studio necesita ver fotos de sus clientas.)

-- ---------------------------------------------------------------------
-- 7) studio_delete_client — al cutover, validar identidad REAL del que llama
--    (auth.uid() es admin del tenant) en vez de confiar en p_admin_email param,
--    y REVOKE EXECUTE a anon/authenticated (que lo llame solo un endpoint server-side
--    con service-role, o reescribir para usar app_is_coach()/app_current_tenant()).
-- ---------------------------------------------------------------------
