-- LOCAL CANDIDATE ONLY. NOT A MIGRATION. NO PRODUCTION AUTHORIZATION.
-- Commit RPC intentionally disabled until all stale-writer guards are integrated.
BEGIN;
ALTER TABLE public.productos ADD COLUMN unidad_revision bigint NOT NULL DEFAULT 0 CHECK(unidad_revision>=0);
CREATE SCHEMA sigo_correccion_inicial;
REVOKE ALL ON SCHEMA sigo_correccion_inicial FROM PUBLIC, anon, authenticated;
CREATE TABLE sigo_correccion_inicial.configuracion (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), habilitada boolean NOT NULL DEFAULT false
);
INSERT INTO sigo_correccion_inicial.configuracion VALUES(true,false);
CREATE TABLE sigo_correccion_inicial.auditoria (
  empresa_id uuid NOT NULL, request_id uuid NOT NULL, producto_id uuid NOT NULL,
  actor_id uuid NOT NULL, creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL CHECK(revision>0), snapshot text NOT NULL, declaracion text NOT NULL, antes jsonb NOT NULL, despues jsonb NOT NULL,
  PRIMARY KEY(empresa_id,request_id), UNIQUE(empresa_id,producto_id,revision)
);
ALTER TABLE sigo_correccion_inicial.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigo_correccion_inicial.auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sigo_correccion_inicial FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sigo_correccion_inicial.autorizar(p_empresa_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_empresa_id IS NULL OR NOT coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false)
 OR NOT coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.write'),false)
 OR NOT coalesce(public.tiene_permiso_empresa(p_empresa_id,'costs.read'),false)
 OR NOT (coalesce(public.tiene_permiso_empresa(p_empresa_id,'price_lists.read'),false)
         OR coalesce(public.tiene_permiso_empresa(p_empresa_id,'sales.write'),false))
 THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END $$;

CREATE FUNCTION sigo_correccion_inicial.historial(p_producto_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.venta_items_sigo WHERE producto_id=p_producto_id)
 OR EXISTS(SELECT 1 FROM public.compra_items_sigo WHERE producto_id=p_producto_id)
 OR EXISTS(SELECT 1 FROM public.devolucion_items_sigo WHERE producto_id=p_producto_id)
 OR EXISTS(SELECT 1 FROM public.movimientos_stock WHERE producto_id=p_producto_id)
 OR EXISTS(SELECT 1 FROM public.detalle_compras WHERE producto_id=p_producto_id)
 OR EXISTS(SELECT 1 FROM public.compra_cambios_sigo WHERE lower(datos_anteriores::text) LIKE '%'||p_producto_id::text||'%')
 OR EXISTS(SELECT 1 FROM public.compra_ia_confirmaciones WHERE lower(solicitud::text||resultado::text) LIKE '%'||p_producto_id::text||'%');
$$;
CREATE FUNCTION sigo_correccion_inicial.valores(p public.productos) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('stock_actual',p.stock_actual,'stock_minimo',p.stock_minimo,
 'stock_maximo',p.stock_maximo,'precio_venta',p.precio_venta,
 'costo_actual',p.costo_actual,'costo_ultima_compra',p.costo_ultima_compra);
$$;
CREATE FUNCTION sigo_correccion_inicial.snapshot(p public.productos) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex');
$$;
CREATE FUNCTION sigo_correccion_inicial.validar(p public.productos,p_destino text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n numeric; precision_destino integer;
BEGIN
 precision_destino:=public.sigo_precision_unidad(p_destino);
 IF precision_destino IS NULL OR p_destino IS DISTINCT FROM lower(btrim(p_destino)) THEN RAISE EXCEPTION 'UNIT_INVALID';END IF;
 IF lower(btrim(p.unidad_medida))=p_destino THEN RAISE EXCEPTION 'UNIT_UNCHANGED';END IF;
 IF NOT p.activo OR coalesce((to_jsonb(p)->>'archivado_comercial')::boolean,false) OR precision_destino IS NULL OR public.sigo_precision_unidad(p.unidad_medida) IS NULL OR lower(btrim(p.unidad_medida))=p_destino
 THEN RAISE EXCEPTION 'INITIAL_UNIT_CORRECTION_NOT_ELIGIBLE'; END IF;
 IF p.fecha_ultima_compra IS NOT NULL OR p.fecha_ultima_venta IS NOT NULL
 OR sigo_correccion_inicial.historial(p.id) THEN RAISE EXCEPTION 'UNIT_CHANGE_REQUIRES_HISTORY_REVIEW'; END IF;
 FOREACH n IN ARRAY ARRAY[p.stock_actual,p.stock_minimo,p.precio_venta,p.costo_actual,p.costo_ultima_compra] LOOP
  IF n IS NULL OR n::text IN('NaN','Infinity','-Infinity') OR n<0 THEN RAISE EXCEPTION 'PRODUCT_VALUE_INVALID'; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY[p.stock_actual,p.stock_minimo,p.stock_maximo] LOOP
  IF n IS NOT NULL AND (n>99999999999.999 OR n<>round(n,precision_destino)) THEN RAISE EXCEPTION 'PRODUCT_VALUE_NOT_REPRESENTABLE'; END IF;
 END LOOP;
 IF p.stock_maximo IS NOT NULL AND (p.stock_maximo::text IN('NaN','Infinity','-Infinity') OR p.stock_maximo<0)
 THEN RAISE EXCEPTION 'PRODUCT_VALUE_INVALID'; END IF;
END $$;

CREATE FUNCTION public.previsualizar_correccion_unidad_inicial_sigo(p_empresa_id uuid,p_producto_id uuid,p_unidad_destino text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos;
BEGIN
 PERFORM sigo_correccion_inicial.autorizar(p_empresa_id);
 IF NOT coalesce((SELECT habilitada FROM sigo_correccion_inicial.configuracion WHERE singleton),false) THEN RAISE EXCEPTION 'INITIAL_UNIT_CORRECTION_NOT_ENABLED'; END IF;
 SELECT * INTO p FROM public.productos WHERE id=p_producto_id AND empresa_id=p_empresa_id AND activo=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
 PERFORM sigo_correccion_inicial.validar(p,p_unidad_destino);
 RETURN jsonb_build_object('empresaId',p.empresa_id,'productoId',p.id,'nombre',p.nombre,
 'unidad',lower(btrim(p.unidad_medida)),'unidadDestino',p_unidad_destino,'revision',p.unidad_revision::text,'elegible',true,'snapshot',sigo_correccion_inicial.snapshot(p),'valores',sigo_correccion_inicial.valores(p));
END $$;

CREATE FUNCTION public.corregir_unidad_inicial_sigo(p_empresa_id uuid,p_producto_id uuid,p_request_id uuid,p_snapshot text,p_declaracion text,p_unidad_destino text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos; a sigo_correccion_inicial.auditoria; antes jsonb; despues jsonb;
BEGIN
 PERFORM sigo_correccion_inicial.autorizar(p_empresa_id);
 IF p_producto_id IS NULL OR p_request_id IS NULL OR p_snapshot IS NULL OR length(p_snapshot)<>64
 OR p_declaracion IS DISTINCT FROM 'CONFIRMO_CARGA_INICIAL_SIN_MOVIMIENTOS_Y_VALORES_YA_EN_UNIDAD_DESTINO'
 THEN RAISE EXCEPTION 'INITIAL_UNIT_CORRECTION_CONFIRMATION_REQUIRED'; END IF;
 -- This local lock serializes the key, while the row lock coordinates with V4 writers.
 PERFORM pg_advisory_xact_lock(hashtextextended('unit-correction|'||p_empresa_id::text||'|'||p_request_id::text,0));
 SELECT * INTO a FROM sigo_correccion_inicial.auditoria WHERE empresa_id=p_empresa_id AND request_id=p_request_id;
 IF FOUND THEN
  IF a.producto_id IS DISTINCT FROM p_producto_id OR a.snapshot IS DISTINCT FROM p_snapshot OR a.declaracion IS DISTINCT FROM p_declaracion OR a.despues->>'unidad' IS DISTINCT FROM p_unidad_destino
  THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN a.despues; -- Exact committed receipt; not a new correction and not current stock.
 END IF;
 IF NOT coalesce((SELECT habilitada FROM sigo_correccion_inicial.configuracion WHERE singleton),false)
 THEN RAISE EXCEPTION 'INITIAL_UNIT_CORRECTION_NOT_ENABLED'; END IF;
 SELECT * INTO p FROM public.productos WHERE id=p_producto_id AND empresa_id=p_empresa_id AND activo=true FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
 IF sigo_correccion_inicial.snapshot(p) IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'PRODUCT_CHANGED_RELOAD'; END IF;
 PERFORM sigo_correccion_inicial.validar(p,p_unidad_destino);
 antes:=jsonb_build_object('unidad_medida',p.unidad_medida,'nombre',p.nombre,'updated_at',p.updated_at,'valores',sigo_correccion_inicial.valores(p));
 INSERT INTO sigo_correccion_inicial.operaciones(tx,empresa_id,producto_id,actor_id,unidad,revision,correccion) VALUES(txid_current(),p_empresa_id,p_producto_id,auth.uid(),p_unidad_destino,p.unidad_revision+1,true);
 UPDATE public.productos SET unidad_medida=p_unidad_destino,unidad_revision=unidad_revision+1 WHERE id=p_producto_id AND empresa_id=p_empresa_id RETURNING * INTO p;
 despues:=jsonb_build_object('empresaId',p_empresa_id,'productoId',p_producto_id,'requestId',p_request_id,'unidad',p_unidad_destino,'revision',p.unidad_revision::text,
  'snapshot',p_snapshot,'valores',sigo_correccion_inicial.valores(p));
 INSERT INTO sigo_correccion_inicial.auditoria(empresa_id,request_id,producto_id,actor_id,revision,snapshot,declaracion,antes,despues)
 VALUES(p_empresa_id,p_request_id,p_producto_id,auth.uid(),p.unidad_revision,p_snapshot,p_declaracion,antes,despues);
 PERFORM sigo_correccion_inicial.limpiar_actual();
 RETURN despues;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sigo_correccion_inicial FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.previsualizar_correccion_unidad_inicial_sigo(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.corregir_unidad_inicial_sigo(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
-- Candidate has NO client grants. Integration and deployment review must authorize them.
COMMIT;

