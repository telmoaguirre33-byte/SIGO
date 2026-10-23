-- ROLLBACK DE SNAPSHOT. NO APROBADO PARA EJECUCION.
-- ADVERTENCIA: restaura las cuatro policies USING/WITH CHECK true y todos los
-- privilegios anon/authenticated, incluido TRUNCATE, del snapshot previo.
-- Reabre el riesgo cross-tenant y anon. Requiere decision y autorizacion expresas.
-- No usar como rutina ni para deshacer cambios posteriores de terceros.
-- Prefiera correccion hacia adelante si es viable. No contiene ni altera filas.
-- Ejecutar entero con cliente fail-fast; rollback por error, nunca omitir guards.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE public.productos IN ACCESS EXCLUSIVE MODE;

DO $product_rls_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PRODUCT_RLS_REQUIRES_REVIEWED_OWNER_ROLE';
  END IF;
  IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'PRODUCT_RLS_SERVER_VERSION_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.productos'::regclass
      AND relowner='postgres'::regrole AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'PRODUCT_RLS_FLAGS_OR_OWNER_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'PRODUCT_RLS_ROLE_BYPASS_REVIEW_REQUIRED';
  END IF;
  IF md5(pg_get_functiondef('public.tiene_permiso_empresa(uuid,text)'::regprocedure))
      IS DISTINCT FROM 'cf1fed566665fc8e2cfa204153d6ed6d' THEN
    RAISE EXCEPTION 'PRODUCT_RLS_PERMISSION_HELPER_DRIFT';
  END IF;
  IF (SELECT coalesce(jsonb_agg(jsonb_build_array(policyname, permissive, roles::text, cmd, qual, with_check) ORDER BY policyname), '[]'::jsonb)
       FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='productos') IS DISTINCT FROM '[["productos_minorista_select_tenant","PERMISSIVE","{authenticated}","SELECT","((auth.uid() IS NOT NULL) AND public.tiene_permiso_empresa(empresa_id, ''products.read''::text))",null]]'::jsonb THEN
    RAISE EXCEPTION 'PRODUCT_POLICY_DRIFT_REVIEW_REQUIRED';
  END IF;
  IF (SELECT array_agg(a::text ORDER BY a::text) FROM pg_class c CROSS JOIN LATERAL unnest(c.relacl) a WHERE c.oid='public.productos'::regclass) IS DISTINCT FROM ARRAY['postgres=arwdDxtm/postgres', 'service_role=arwdDxtm/postgres']::text[] THEN
    RAISE EXCEPTION 'PRODUCT_TABLE_ACL_DRIFT_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.productos'::regclass
       AND attnum>0 AND NOT attisdropped AND (
          CASE WHEN attname::text=ANY(ARRAY['id', 'empresa_id', 'nombre', 'codigo_interno', 'codigo_barras', 'activo', 'categoria', 'marca', 'stock_actual', 'costo_actual', 'costo_ultima_compra', 'precio_venta', 'iva_alicuota_id', 'iva_tasa', 'precio_incluye_iva']::text[])
            THEN attacl::text IS DISTINCT FROM '{authenticated=r/postgres}'
            ELSE attacl IS NOT NULL END))
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.productos'::regclass
       AND attnum>0 AND NOT attisdropped AND attname::text=ANY(ARRAY['id', 'empresa_id', 'nombre', 'codigo_interno', 'codigo_barras', 'activo', 'categoria', 'marca', 'stock_actual', 'costo_actual', 'costo_ultima_compra', 'precio_venta', 'iva_alicuota_id', 'iva_tasa', 'precio_incluye_iva']::text[])) <> 15 THEN
    RAISE EXCEPTION 'PRODUCT_COLUMN_ACL_DRIFT_REVIEW_REQUIRED';
  END IF;
END;
$product_rls_guard$;

REVOKE SELECT (id, empresa_id, nombre, codigo_interno, codigo_barras, activo, categoria, marca, stock_actual, costo_actual, costo_ultima_compra, precio_venta, iva_alicuota_id, iva_tasa, precio_incluye_iva) ON TABLE public.productos FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.productos FROM PUBLIC, anon, authenticated;
DROP POLICY productos_minorista_select_tenant ON public.productos;
CREATE POLICY editar_productos ON public.productos AS PERMISSIVE FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY eliminar_productos ON public.productos AS PERMISSIVE FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY insertar_productos ON public.productos AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY lectura_productos ON public.productos AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos NO FORCE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.productos TO anon, authenticated;

DO $product_rls_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PRODUCT_RLS_REQUIRES_REVIEWED_OWNER_ROLE';
  END IF;
  IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'PRODUCT_RLS_SERVER_VERSION_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.productos'::regclass
      AND relowner='postgres'::regrole AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'PRODUCT_RLS_FLAGS_OR_OWNER_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'PRODUCT_RLS_ROLE_BYPASS_REVIEW_REQUIRED';
  END IF;
  IF md5(pg_get_functiondef('public.tiene_permiso_empresa(uuid,text)'::regprocedure))
      IS DISTINCT FROM 'cf1fed566665fc8e2cfa204153d6ed6d' THEN
    RAISE EXCEPTION 'PRODUCT_RLS_PERMISSION_HELPER_DRIFT';
  END IF;
  IF (SELECT coalesce(jsonb_agg(jsonb_build_array(policyname, permissive, roles::text, cmd, qual, with_check) ORDER BY policyname), '[]'::jsonb)
       FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='productos') IS DISTINCT FROM '[["editar_productos","PERMISSIVE","{anon,authenticated}","UPDATE","true","true"],["eliminar_productos","PERMISSIVE","{anon,authenticated}","DELETE","true",null],["insertar_productos","PERMISSIVE","{anon,authenticated}","INSERT",null,"true"],["lectura_productos","PERMISSIVE","{anon,authenticated}","SELECT","true",null]]'::jsonb THEN
    RAISE EXCEPTION 'PRODUCT_POLICY_DRIFT_REVIEW_REQUIRED';
  END IF;
  IF (SELECT array_agg(a::text ORDER BY a::text) FROM pg_class c CROSS JOIN LATERAL unnest(c.relacl) a WHERE c.oid='public.productos'::regclass) IS DISTINCT FROM ARRAY['anon=arwdDxtm/postgres', 'authenticated=arwdDxtm/postgres', 'postgres=arwdDxtm/postgres', 'service_role=arwdDxtm/postgres']::text[] THEN
    RAISE EXCEPTION 'PRODUCT_TABLE_ACL_DRIFT_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.productos'::regclass
       AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'PRODUCT_COLUMN_ACL_REVIEW_REQUIRED';
  END IF;
END;
$product_rls_guard$;

COMMIT;
