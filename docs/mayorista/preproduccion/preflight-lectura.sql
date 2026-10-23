-- PREPARADO, NO EJECUTADO. Sólo inventario del esquema; sin filas comerciales ni secretos.
-- Ejecutar únicamente en el destino elegido y autorizado. Un resultado ausente es un bloqueo.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_user AS executor_role, version() AS postgres_version;
SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest(ARRAY[
 'auth.users','auth.sessions','public.empresas','public.empresa_usuarios',
 'public.sigo_modulos_catalogo','public.sigo_empresa_modulos','public.productos',
 'public.clientes_sigo','public.ventas_sigo','public.venta_items_sigo','public.caja_movimientos_sigo',
 'public.arca_config'
]) name;
SELECT name, to_regprocedure(name) IS NOT NULL AS present FROM unnest(ARRAY[
 'auth.uid()','auth.jwt()','public.es_superadmin_sigo()',
 'public.listar_modulos_empresa_sigo(uuid)','public.tiene_permiso_empresa(uuid,text)'
]) name;
SELECT table_schema,table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('empresas','empresa_usuarios','sigo_empresa_modulos','productos','clientes_sigo','ventas_sigo','caja_movimientos_sigo')
ORDER BY table_name,ordinal_position;
SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles
WHERE rolname IN ('anon','authenticated',current_user);
-- Revisar manualmente historial de migraciones, firmas/columnas/constraints y grants reales.
-- Este archivo no valida compatibilidad por sí solo ni presupone un esquema vacío.
ROLLBACK;
