-- CANDIDATO DE OPERACION CONTROLADA. NO APROBADO PARA EJECUCION.
-- Preparado localmente; NO se ejecuto en COMERCIAL. Fuera de supabase/migrations.
-- Requiere autorizacion explicita para cambiar RLS/ACL de public.productos.
-- Confirmar consumidores externos antes de ejecutar. Mantiene costos/stock/precio
-- visibles dentro del tenant con products.read; NO resuelve masking intratenant.
-- Ejecutar este archivo completo con cliente fail-fast (psql -v ON_ERROR_STOP=1).
-- Un fallo antes de COMMIT exige ROLLBACK y revisar, nunca saltar los guards.
-- La transaccion bloquea brevemente productos; falla al superar lock_timeout.

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

REVOKE ALL PRIVILEGES ON TABLE public.productos FROM PUBLIC, anon, authenticated;

DROP POLICY editar_productos ON public.productos;
DROP POLICY eliminar_productos ON public.productos;
DROP POLICY insertar_productos ON public.productos;
DROP POLICY lectura_productos ON public.productos;

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
GRANT SELECT (id, empresa_id, nombre, codigo_interno, codigo_barras, activo, categoria, marca, stock_actual, costo_actual, costo_ultima_compra, precio_venta, iva_alicuota_id, iva_tasa, precio_incluye_iva) ON TABLE public.productos TO authenticated;

CREATE POLICY productos_minorista_select_tenant
  ON public.productos AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.tiene_permiso_empresa(empresa_id, 'products.read'));

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

DO $effective_privileges$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(role_name)
       WHERE has_table_privilege(r.role_name, 'public.productos',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) THEN
    RAISE EXCEPTION 'PRODUCT_INHERITED_TABLE_PRIVILEGES_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.productos'::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND (
        has_column_privilege('anon',a.attrelid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_column_privilege('authenticated',a.attrelid,a.attnum,'INSERT,UPDATE,REFERENCES')
        OR has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')
           IS DISTINCT FROM (a.attname::text=ANY(ARRAY['id', 'empresa_id', 'nombre', 'codigo_interno', 'codigo_barras', 'activo', 'categoria', 'marca', 'stock_actual', 'costo_actual', 'costo_ultima_compra', 'precio_venta', 'iva_alicuota_id', 'iva_tasa', 'precio_incluye_iva']::text[])))) THEN
    RAISE EXCEPTION 'PRODUCT_EFFECTIVE_COLUMN_PRIVILEGES_REVIEW_REQUIRED';
  END IF;
END;
$effective_privileges$;

COMMIT;
