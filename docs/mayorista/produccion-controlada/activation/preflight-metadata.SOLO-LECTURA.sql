-- PREPARADO, NO EJECUTADO. psql variable empresa_id = UUID REAL ya resuelto.
-- Exclusivamente esquema y configuración. No resuelve empresa por nombre ni lista datos comerciales.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT current_database() AS database_name,current_user AS executor_role;
SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest(ARRAY[
 'public.empresas','public.sigo_empresa_tipo_negocio','public.sigo_empresa_modulos',
 'public.sigo_mayorista_destinos','public.sigo_mayorista_destino_predeterminado',
 'public.sigo_mayorista_activacion_auditoria','public.sigo_mayorista_comercio_fuente',
 'mayorista_private.release_binding','mayorista_private.release_migrations'
]) name;
SELECT name,to_regprocedure(name) IS NOT NULL AS present FROM unnest(ARRAY[
 'public.leer_tipo_negocio_sigo(uuid)','public.declarar_tipo_negocio_sigo(uuid,text)',
 'public.matriz_actualizar_modulo_empresa_sigo(uuid,text,boolean)',
 'public.matriz_configurar_destino_mayorista_sigo(uuid,text,boolean)',
 'public.obtener_acceso_mayorista_sigo(uuid)','public.es_superadmin_sigo()'
]) name;
SELECT id,activa FROM public.empresas WHERE id=:'empresa_id'::uuid;
-- Sólo catálogo de configuración; si falta/está obligatorio/no disponible: bloquear.
SELECT clave,disponible,obligatorio FROM public.sigo_modulos_catalogo WHERE clave='mayorista_distribuidora';
SELECT jsonb_build_object(
 'target',jsonb_build_object(
  'tipo',(SELECT to_jsonb(t) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id=:'empresa_id'::uuid),
  'modulo',(SELECT to_jsonb(m) FROM public.sigo_empresa_modulos m WHERE empresa_id=:'empresa_id'::uuid AND modulo_clave='mayorista_distribuidora'),
  'destino',(SELECT to_jsonb(d) FROM public.sigo_mayorista_destinos d WHERE empresa_id=:'empresa_id'::uuid)),
 'protected',jsonb_build_object(
  'other_modules_md5',(SELECT md5(coalesce(string_agg(to_jsonb(m)::text,E'\n' ORDER BY empresa_id,modulo_clave),'')) FROM public.sigo_empresa_modulos m WHERE NOT(empresa_id=:'empresa_id'::uuid AND modulo_clave='mayorista_distribuidora')),
  'other_types_md5',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id<>:'empresa_id'::uuid),
  'other_destinations_md5',(SELECT md5(coalesce(string_agg(to_jsonb(d)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_mayorista_destinos d WHERE empresa_id<>:'empresa_id'::uuid),
  'global_default',(SELECT to_jsonb(g) FROM public.sigo_mayorista_destino_predeterminado g WHERE id),
  'enabled_other_empresa_ids',(SELECT coalesce(jsonb_agg(empresa_id ORDER BY empresa_id),'[]'::jsonb) FROM public.sigo_empresa_modulos WHERE modulo_clave='mayorista_distribuidora' AND habilitado AND empresa_id<>:'empresa_id'::uuid))
) AS snapshot;
-- Registry/binding/ledger = metadata de fuente/release. No consultar filas de stock, ventas o catálogo.
SELECT empresa_id,fuente,backend_revision FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=:'empresa_id'::uuid;
SELECT profile_hash,project_id,environment_id FROM mayorista_private.release_binding WHERE id;
SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef,p.proconfig,
 md5(pg_get_functiondef(p.oid)) AS deployed_definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN('declarar_tipo_negocio_sigo','matriz_actualizar_modulo_empresa_sigo','matriz_configurar_destino_mayorista_sigo','obtener_acceso_mayorista_sigo','leer_tipo_negocio_sigo');
ROLLBACK;
