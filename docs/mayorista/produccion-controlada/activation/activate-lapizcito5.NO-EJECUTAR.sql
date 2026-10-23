-- PREPARADO, NO EJECUTADO. Plantilla de ensayo; siempre ROLLBACK.
-- Requiere JSON concreto revisado en sigo.prep.activation_plan para ESTA transacción.
-- Sin credenciales, SET ROLE, JWT inyectado, DDL, seeds ni conexiones implícitas.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $activation$
DECLARE
 p jsonb:=nullif(current_setting('sigo.prep.activation_plan',true),'')::jsonb;
 e uuid; actual jsonb; posterior jsonb; origin text;
BEGIN
 IF p IS NULL OR p->>'approved' IS DISTINCT FROM 'true'
 OR p->>'reviewedBaseHead' IS DISTINCT FROM 'a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b'
 OR coalesce(p->>'head','') !~ '^[a-f0-9]{40}$'
 OR p->>'targetLabel' IS DISTINCT FROM 'lapizcito5' OR p->>'sigoOrigin' IS DISTINCT FROM 'https://www.sigo-gestion.com'
 OR p->>'targetIdentityReviewed' IS DISTINCT FROM 'true' OR nullif(p->>'targetIdentityEvidence','') IS NULL
 OR p->>'desiredTipo' IS DISTINCT FROM 'mixto' OR p->>'strictExclusivityGuardVerified' IS DISTINCT FROM 'true'
 OR nullif(p->>'exclusiveGuardEvidence','') IS NULL OR nullif(p->>'runtimeReadinessEvidence','') IS NULL
 OR nullif(p->>'sourceCoherenceEvidence','') IS NULL OR coalesce(p->>'runtimeProfileSha256','') !~ '^[a-f0-9]{64}$'
 OR p->>'changeGlobalDefault' IS DISTINCT FROM 'false' OR p->>'changeLicensesSubscriptionsPermissions' IS DISTINCT FROM 'false'
 OR jsonb_typeof(p->'expectedBefore') IS DISTINCT FROM 'object'
 OR jsonb_typeof(p->'existingEnabledOtherEmpresaIds') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'ACTIVATION_PLAN_INCOMPLETE_OR_UNAPPROVED'; END IF;
 e:=nullif(p->>'empresaId','')::uuid; origin:=p->>'publicOrigin';
 IF e IS NULL OR e::text ~ '^30000000-0000-4000-8000-' OR origin IS NULL
 OR origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
 OR origin ~* '(qa|localhost|\.invalid|\.test|\.example|\.vercel\.app)'
 THEN RAISE EXCEPTION 'TARGET_OR_ORIGIN_NOT_COMMERCIAL'; END IF;
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM nullif(p->>'expectedActorId','')::uuid
 OR NOT public.es_superadmin_sigo() THEN RAISE EXCEPTION 'ATTRIBUTABLE_MATRIZ_SUPERADMIN_REQUIRED'; END IF;
 -- Bloqueo breve sólo de tablas de configuración: evita drift de otros tenants durante la comparación.
 LOCK TABLE public.sigo_empresa_tipo_negocio,public.sigo_empresa_modulos,
 public.sigo_mayorista_destinos,public.sigo_mayorista_destino_predeterminado IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.empresas WHERE id=e AND activa FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_COMPANY_MISSING_OR_INACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sigo_modulos_catalogo WHERE clave='mayorista_distribuidora' AND disponible AND NOT obligatorio)
 THEN RAISE EXCEPTION 'OPTIONAL_MODULE_NOT_AVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=e AND fuente<>'sigo')
 THEN RAISE EXCEPTION 'CANONICAL_SOURCE_RECONCILIATION_REQUIRED'; END IF;
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
 IF actual IS DISTINCT FROM p->'expectedBefore' THEN RAISE EXCEPTION 'ACTIVATION_BASELINE_DRIFT'; END IF;
 IF actual#>'{protected,enabled_other_empresa_ids}' IS DISTINCT FROM p->'existingEnabledOtherEmpresaIds'
 THEN RAISE EXCEPTION 'UNREVIEWED_EXISTING_ACTIVATIONS'; END IF;
 IF actual#>>'{target,tipo,tipo}'='mayorista' AND p->>'reviewedMayoristaToMixto' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'EXISTING_MAYORISTA_TYPE_REQUIRES_REVIEW'; END IF;
 -- RPC existentes: tipo real + override explícito Matriz + destino sólo para e.
 PERFORM public.declarar_tipo_negocio_sigo(e,'mixto');
 IF NOT EXISTS(SELECT 1 FROM public.sigo_empresa_modulos WHERE empresa_id=e AND modulo_clave='mayorista_distribuidora' AND habilitado) THEN
  PERFORM public.matriz_actualizar_modulo_empresa_sigo(e,'mayorista_distribuidora',true);
 END IF;
 PERFORM public.matriz_configurar_destino_mayorista_sigo(e,origin,true);
 SELECT jsonb_build_object('target',jsonb_build_object(
  'tipo',(SELECT to_jsonb(t) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id=e),
  'modulo',(SELECT to_jsonb(m) FROM public.sigo_empresa_modulos m WHERE empresa_id=e AND modulo_clave='mayorista_distribuidora'),
  'destino',(SELECT to_jsonb(d) FROM public.sigo_mayorista_destinos d WHERE empresa_id=e)),
 'protected',jsonb_build_object(
  'other_modules_md5',(SELECT md5(coalesce(string_agg(to_jsonb(m)::text,E'\n' ORDER BY empresa_id,modulo_clave),'')) FROM public.sigo_empresa_modulos m WHERE NOT(empresa_id=e AND modulo_clave='mayorista_distribuidora')),
  'other_types_md5',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_empresa_tipo_negocio t WHERE empresa_id<>e),
  'other_destinations_md5',(SELECT md5(coalesce(string_agg(to_jsonb(d)::text,E'\n' ORDER BY empresa_id),'')) FROM public.sigo_mayorista_destinos d WHERE empresa_id<>e),
  'global_default',(SELECT to_jsonb(g) FROM public.sigo_mayorista_destino_predeterminado g WHERE id),
  'enabled_other_empresa_ids',(SELECT coalesce(jsonb_agg(empresa_id ORDER BY empresa_id),'[]'::jsonb) FROM public.sigo_empresa_modulos WHERE modulo_clave='mayorista_distribuidora' AND habilitado AND empresa_id<>e))) INTO posterior;
 IF posterior->'protected' IS DISTINCT FROM actual->'protected'
 OR posterior#>>'{target,tipo,tipo}' IS DISTINCT FROM 'mixto' OR posterior#>>'{target,modulo,habilitado}' IS DISTINCT FROM 'true'
 OR posterior#>>'{target,destino,aplicacion_disponible}' IS DISTINCT FROM 'true'
 OR posterior#>>'{target,destino,origen_aprobado}' IS DISTINCT FROM origin
 OR posterior#>>'{target,destino,administracion_url}' IS DISTINCT FROM origin||'/portal.html'
 OR posterior#>>'{target,destino,vendedor_url}' IS DISTINCT FROM origin||'/secure.html'
 THEN RAISE EXCEPTION 'ACTIVATION_POSTCONDITION_FAILED'; END IF;
 RAISE NOTICE 'ACTIVATION_AFTER=%',posterior::text;
END;
$activation$;
ROLLBACK;
