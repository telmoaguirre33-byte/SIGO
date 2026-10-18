-- PREPARADO, NO EJECUTADO. Inventario de seguridad posterior a una migración futura autorizada.
BEGIN TRANSACTION READ ONLY;
SELECT n.nspname AS schema_name,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND (n.nspname IN ('mayorista','mayorista_private') OR n.nspname='public' AND c.relname LIKE 'sigo_mayorista_%' OR n.nspname='public' AND c.relname='sigo_empresa_tipo_negocio')
ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname IN ('mayorista','mayorista_private') OR schemaname='public' AND tablename LIKE 'sigo_mayorista_%'
ORDER BY 1,2,3;
SELECT n.nspname AS schema_name,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef,p.proconfig,p.proacl,pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('mayorista','mayorista_private') OR n.nspname='public' AND p.proname LIKE '%mayorista%'
ORDER BY 1,2,3;
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname IN ('mayorista','mayorista_private') OR schemaname='public' AND tablename LIKE 'sigo_mayorista_%'
ORDER BY 1,2,3;
-- Revisar RLS/ACL, SECURITY DEFINER/search_path/owner y predicados por empresa.
-- Las pruebas con dos empresas y roles distintos se ejecutan aparte en contexto sintético aprobado.
ROLLBACK;
