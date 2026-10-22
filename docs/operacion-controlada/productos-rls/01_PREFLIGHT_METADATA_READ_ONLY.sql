-- SOLO LECTURA. Metadatos; no lee filas comerciales.
-- Ejecutar inmediatamente antes de una operacion expresamente autorizada,
-- guardar resultado bajo control del operador y comparar con snapshot_baseline.json.
-- Los archivos APPLY/ROLLBACK verifican nuevamente el contrato bajo lock.
SELECT current_setting('server_version') AS postgres_version, current_user AS execution_role;
SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner,
  array_agg(a::text ORDER BY a::text) AS table_acl
FROM pg_catalog.pg_class c CROSS JOIN LATERAL unnest(c.relacl) a
WHERE c.oid='public.productos'::regclass
GROUP BY c.relrowsecurity,c.relforcerowsecurity,c.relowner;
SELECT policyname,permissive,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='productos' ORDER BY policyname;
SELECT attname AS column_name,attacl::text AS column_acl FROM pg_catalog.pg_attribute
WHERE attrelid='public.productos'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum;
SELECT rolname,rolsuper,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated');
SELECT md5(pg_get_functiondef('public.tiene_permiso_empresa(uuid,text)'::regprocedure)) AS permission_helper_md5;
SELECT r.role_name,has_schema_privilege(r.role_name,'public','USAGE') AS schema_usage,
  has_table_privilege(r.role_name,'public.productos','SELECT') AS table_select,
  has_table_privilege(r.role_name,'public.productos','INSERT,UPDATE,DELETE') AS table_dml,
  has_table_privilege(r.role_name,'public.productos','TRUNCATE') AS table_truncate
FROM (VALUES ('anon'),('authenticated')) r(role_name);
