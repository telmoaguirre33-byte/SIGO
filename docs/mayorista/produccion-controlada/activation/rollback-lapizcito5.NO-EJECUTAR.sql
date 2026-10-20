-- PREPARADO, NO EJECUTADO. Compensación de configuración, no borrado de operaciones.
-- Requiere expectedBefore y expectedAfter EXACTOS capturados; sin ellos falla cerrada.
-- Operador DML autorizado y actor Superadmin atribuible. No agrega grants ni cambia RLS.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $rollback_activation$
DECLARE
 p jsonb:=nullif(current_setting('sigo.prep.activation_plan',true),'')::jsonb;
 e uuid; actual jsonb; previo jsonb; restored jsonb;
BEGIN
 IF p IS NULL OR p->>'rollbackApproved' IS DISTINCT FROM 'true' OR p->>'targetLabel' IS DISTINCT FROM 'lapizcito5'
 OR p->>'reviewedBaseHead' IS DISTINCT FROM 'a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b'
 OR coalesce(p->>'head','') !~ '^[a-f0-9]{40}$'
 OR jsonb_typeof(p->'expectedBefore') IS DISTINCT FROM 'object'
 OR jsonb_typeof(p->'expectedAfter') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'ROLLBACK_PLAN_INCOMPLETE_OR_UNAPPROVED'; END IF;
 e:=nullif(p->>'empresaId','')::uuid; previo:=p->'expectedBefore';
 IF e IS NULL OR e::text ~ '^30000000-0000-4000-8000-' OR auth.uid() IS NULL
 OR auth.uid() IS DISTINCT FROM nullif(p->>'expectedActorId','')::uuid OR NOT public.es_superadmin_sigo()
 THEN RAISE EXCEPTION 'ROLLBACK_TARGET_OR_ACTOR_INVALID'; END IF;
 LOCK TABLE public.sigo_empresa_tipo_negocio,public.sigo_empresa_modulos,
 public.sigo_mayorista_destinos,public.sigo_mayorista_destino_predeterminado IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.empresas WHERE id=e FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROLLBACK_COMPANY_MISSING'; END IF;
 SELECT jsonb_build_object('target',jsonb_build_object(
  'tipo',(SELECT to_jsonb(t) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id=e),
  'modulo',(SELECT to_jsonb(m) FROM public.sigo_empresa_modulos m WHERE empresa_id=e AND modulo_clave='mayorista_distribuidora'),
  'destino',(SELECT to_jsonb(d) FROM public.sigo_mayorista_destinos d WHERE empresa_id=e)),
 'protected',jsonb_build_object(
  'other_modules_md5',(SELECT md5(coalesce(string_agg(to_jsonb(m)::text,E'\n' ORDER BY empresa_id,modulo_clave),'')) FROM public.sigo_empresa_modulos m WHERE NOT(empresa_id=e AND modulo_clave='mayorista_distribuidora')),
  'other_types_md5',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id<>e),
  'other_destinations_md5',(SELECT md5(coalesce(string_agg(to_jsonb(d)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_mayorista_destinos d WHERE empresa_id<>e),
  'global_default',(SELECT to_jsonb(g) FROM public.sigo_mayorista_destino_predeterminado g WHERE id),
  'enabled_other_empresa_ids',(SELECT coalesce(jsonb_agg(empresa_id ORDER BY empresa_id),'[]'::jsonb) FROM public.sigo_empresa_modulos WHERE modulo_clave='mayorista_distribuidora' AND habilitado AND empresa_id<>e))) INTO actual;
 IF actual IS DISTINCT FROM p->'expectedAfter' OR previo->'protected' IS DISTINCT FROM actual->'protected'
 THEN RAISE EXCEPTION 'ROLLBACK_DRIFT_REQUIRES_RECONCILIATION'; END IF;
 -- Restaurar la presencia/ausencia original, con claves verificadas antes del DML.
 IF NOT(previo->'target' ?& ARRAY['tipo','modulo','destino']) THEN RAISE EXCEPTION 'ROLLBACK_SNAPSHOT_INVALID'; END IF;
 IF previo#>'{target,tipo}'<>'null'::jsonb AND previo#>>'{target,tipo,empresa_id}' IS DISTINCT FROM e::text
 OR previo#>'{target,modulo}'<>'null'::jsonb AND (previo#>>'{target,modulo,empresa_id}' IS DISTINCT FROM e::text OR previo#>>'{target,modulo,modulo_clave}' IS DISTINCT FROM 'mayorista_distribuidora')
 OR previo#>'{target,destino}'<>'null'::jsonb AND previo#>>'{target,destino,empresa_id}' IS DISTINCT FROM e::text
 THEN RAISE EXCEPTION 'ROLLBACK_SNAPSHOT_SCOPE_INVALID'; END IF;
 IF previo#>'{target,tipo}'='null'::jsonb THEN
  DELETE FROM public.sigo_empresa_tipo_negocio WHERE empresa_id=e;
 ELSE
  INSERT INTO public.sigo_empresa_tipo_negocio SELECT r.* FROM jsonb_populate_record(NULL::public.sigo_empresa_tipo_negocio,previo#>'{target,tipo}') r WHERE true
  ON CONFLICT(empresa_id) DO UPDATE SET tipo=excluded.tipo,actualizado_por=excluded.actualizado_por,actualizado_en=excluded.actualizado_en;
 END IF;
 IF previo#>'{target,modulo}'='null'::jsonb THEN
  DELETE FROM public.sigo_empresa_modulos WHERE empresa_id=e AND modulo_clave='mayorista_distribuidora';
 ELSE
  INSERT INTO public.sigo_empresa_modulos SELECT r.* FROM jsonb_populate_record(NULL::public.sigo_empresa_modulos,previo#>'{target,modulo}') r WHERE true
  ON CONFLICT(empresa_id,modulo_clave) DO UPDATE SET habilitado=excluded.habilitado,actualizado_por=excluded.actualizado_por,updated_at=excluded.updated_at;
 END IF;
 IF previo#>'{target,destino}'='null'::jsonb THEN
  DELETE FROM public.sigo_mayorista_destinos WHERE empresa_id=e;
 ELSE
  INSERT INTO public.sigo_mayorista_destinos SELECT r.* FROM jsonb_populate_record(NULL::public.sigo_mayorista_destinos,previo#>'{target,destino}') r WHERE true
  ON CONFLICT(empresa_id) DO UPDATE SET origen_aprobado=excluded.origen_aprobado,administracion_url=excluded.administracion_url,vendedor_url=excluded.vendedor_url,aplicacion_disponible=excluded.aplicacion_disponible,actualizado_por=excluded.actualizado_por,actualizado_en=excluded.actualizado_en;
 END IF;
 SELECT jsonb_build_object('tipo',(SELECT to_jsonb(t) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id=e),
  'modulo',(SELECT to_jsonb(m) FROM public.sigo_empresa_modulos m WHERE empresa_id=e AND modulo_clave='mayorista_distribuidora'),
  'destino',(SELECT to_jsonb(d) FROM public.sigo_mayorista_destinos d WHERE empresa_id=e)) INTO restored;
 IF restored IS DISTINCT FROM previo->'target' THEN RAISE EXCEPTION 'ROLLBACK_POSTCONDITION_FAILED'; END IF;
 INSERT INTO public.sigo_mayorista_activacion_auditoria(empresa_id,evento,anterior,nuevo,actor_id)
 VALUES(e,'rollback_activacion_pr78',actual->'target',restored,auth.uid());
 RAISE NOTICE 'ROLLBACK_RESTORED=%',restored::text;
END;
$rollback_activation$;
ROLLBACK;
