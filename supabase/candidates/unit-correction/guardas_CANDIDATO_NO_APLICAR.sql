-- LOCAL CANDIDATE, install after core only in synthetic fixture. No enable flag/grants.
BEGIN;
CREATE TABLE sigo_correccion_inicial.operaciones (
 tx bigint NOT NULL, empresa_id uuid NOT NULL, producto_id uuid NOT NULL,
 actor_id uuid NOT NULL, unidad text NOT NULL CHECK(unidad='kg'), PRIMARY KEY(tx,producto_id)
);
ALTER TABLE sigo_correccion_inicial.operaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sigo_correccion_inicial.operaciones FROM PUBLIC,anon,authenticated;
CREATE FUNCTION sigo_correccion_inicial.autorizar_operacion(p_empresa_id uuid,p_producto_id uuid,p_unidad_esperada text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE u text;
BEGIN
 -- Always lock before reading the correction mark; a stale writer waiting for correction
 -- must see the newly committed mark. Functions call this only after their own ACL checks.
 SELECT lower(btrim(unidad_medida)) INTO u FROM public.productos
 WHERE id=p_producto_id AND empresa_id=p_empresa_id AND activo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM sigo_correccion_inicial.auditoria WHERE empresa_id=p_empresa_id AND producto_id=p_producto_id) THEN
  IF auth.uid() IS NULL OR p_unidad_esperada IS DISTINCT FROM u OR u IS DISTINCT FROM 'kg'
  THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED'; END IF;
  INSERT INTO sigo_correccion_inicial.operaciones VALUES(txid_current(),p_empresa_id,p_producto_id,auth.uid(),u)
  ON CONFLICT(tx,producto_id) DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION sigo_correccion_inicial.validar_compra(p_empresa_id uuid,p_producto_id uuid,p_cantidad numeric,p_costo numeric) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sigo_correccion_inicial.auditoria WHERE empresa_id=p_empresa_id AND producto_id=p_producto_id) THEN
  IF p_cantidad IS NULL OR p_cantidad::text IN('NaN','Infinity','-Infinity') OR p_cantidad<=0 OR p_cantidad>1000000 OR p_cantidad<>round(p_cantidad,3)
  THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_QUANTITY_INVALID'; END IF;
  IF p_costo IS NULL OR p_costo::text IN('NaN','Infinity','-Infinity') OR p_costo<0 OR p_costo>1000000000
  THEN RAISE EXCEPTION 'INVALID_COST'; END IF;
 END IF;
END $$;
CREATE FUNCTION sigo_correccion_inicial.limpiar_actual() RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ DELETE FROM sigo_correccion_inicial.operaciones WHERE tx=txid_current() AND actor_id=auth.uid(); $$;
CREATE FUNCTION sigo_correccion_inicial.limpiar_operacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN DELETE FROM sigo_correccion_inicial.operaciones WHERE tx=NEW.tx AND producto_id=NEW.producto_id; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER limpiar_operacion_al_commit AFTER INSERT ON sigo_correccion_inicial.operaciones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.limpiar_operacion();
CREATE FUNCTION sigo_correccion_inicial.exigir_operacion(p_producto_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e uuid;
BEGIN
 -- KEY SHARE coexists with ordinary non-key updates, conflicts with correction FOR UPDATE.
 SELECT empresa_id INTO e FROM public.productos WHERE id=p_producto_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM sigo_correccion_inicial.auditoria WHERE empresa_id=e AND producto_id=p_producto_id)
 AND NOT EXISTS(SELECT 1 FROM sigo_correccion_inicial.operaciones WHERE tx=txid_current()
  AND producto_id=p_producto_id AND empresa_id=e AND actor_id=auth.uid() AND unidad='kg')
 THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED'; END IF;
END $$;
CREATE FUNCTION sigo_correccion_inicial.guardar_dimensiones_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sigo_correccion_inicial.auditoria WHERE producto_id=OLD.id AND empresa_id=OLD.empresa_id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_HISTORY_PRESERVE'; END IF;
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.id IS DISTINCT FROM OLD.id
   OR lower(btrim(NEW.unidad_medida)) IS DISTINCT FROM 'kg'
  THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_HISTORY_PRESERVE'; END IF;
  IF ROW(NEW.stock_actual,NEW.stock_minimo,NEW.stock_maximo,NEW.precio_venta,NEW.costo_actual,NEW.costo_ultima_compra,NEW.margen_ganancia)
   IS DISTINCT FROM ROW(OLD.stock_actual,OLD.stock_minimo,OLD.stock_maximo,OLD.precio_venta,OLD.costo_actual,OLD.costo_ultima_compra,OLD.margen_ganancia)
  THEN PERFORM sigo_correccion_inicial.exigir_operacion(OLD.id); END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER corrected_product_dimensions_guard BEFORE UPDATE OR DELETE ON public.productos
FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.guardar_dimensiones_guard();
CREATE FUNCTION sigo_correccion_inicial.historia_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.producto_id IS NOT NULL THEN PERFORM sigo_correccion_inicial.exigir_operacion(OLD.producto_id); END IF;
 IF TG_OP<>'DELETE' AND NEW.producto_id IS NOT NULL THEN PERFORM sigo_correccion_inicial.exigir_operacion(NEW.producto_id); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER corrected_product_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.venta_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_guard();
CREATE TRIGGER corrected_product_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.compra_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_guard();
CREATE TRIGGER corrected_product_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.devolucion_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_guard();
CREATE TRIGGER corrected_product_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.movimientos_stock FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_guard();
CREATE TRIGGER corrected_product_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.detalle_compras FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_guard();
CREATE FUNCTION sigo_correccion_inicial.historia_json_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE contenido text:=''; pid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN contenido:=contenido||to_jsonb(OLD)::text; END IF;
 IF TG_OP<>'DELETE' THEN contenido:=contenido||to_jsonb(NEW)::text; END IF;
 -- Audit snapshots can hold product UUIDs both as JSON keys and values.
 FOR pid IN SELECT p.id FROM public.productos p WHERE p.id IN (
  SELECT m[1]::uuid FROM regexp_matches(lower(contenido),'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})','g') m
 ) ORDER BY p.id FOR KEY SHARE LOOP
  PERFORM sigo_correccion_inicial.exigir_operacion(pid);
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER corrected_product_json_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.compra_cambios_sigo FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_json_guard();
CREATE TRIGGER corrected_product_json_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.compra_ia_confirmaciones FOR EACH ROW EXECUTE FUNCTION sigo_correccion_inicial.historia_json_guard();
CREATE FUNCTION sigo_correccion_inicial.truncate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sigo_correccion_inicial.auditoria) THEN RAISE EXCEPTION 'CORRECTED_PRODUCT_HISTORY_PRESERVE'; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.productos FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.venta_items_sigo FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.compra_items_sigo FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.devolucion_items_sigo FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.movimientos_stock FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.detalle_compras FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.compra_cambios_sigo FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
CREATE TRIGGER corrected_product_truncate_guard BEFORE TRUNCATE ON public.compra_ia_confirmaciones FOR EACH STATEMENT EXECUTE FUNCTION sigo_correccion_inicial.truncate_guard();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sigo_correccion_inicial FROM PUBLIC,anon,authenticated;
COMMIT;
