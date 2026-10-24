-- DISABLED CANDIDATE: no client execution until explicit installation approval.
BEGIN;
CREATE FUNCTION public.listar_revisiones_unidad_producto_sigo(p_empresa_id uuid)
RETURNS TABLE(producto_id uuid,unidad_medida text,unidad_revision text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF NOT coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.read'),false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN QUERY SELECT p.id,lower(btrim(p.unidad_medida)),p.unidad_revision::text FROM public.productos p WHERE p.empresa_id=p_empresa_id AND p.activo;
END $$;
CREATE FUNCTION public.guardar_producto_medida_revision_sigo(p_empresa_id uuid, p_producto_id uuid DEFAULT NULL::uuid, p_codigo_interno text DEFAULT NULL::text, p_codigo_barras text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_marca text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_costo_actual numeric DEFAULT NULL::numeric, p_costo_ultima_compra numeric DEFAULT NULL::numeric, p_precio_venta numeric DEFAULT NULL::numeric, p_margen_ganancia numeric DEFAULT NULL::numeric, p_margen_porcentaje numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT NULL::numeric, p_stock_minimo numeric DEFAULT NULL::numeric, p_stock_maximo numeric DEFAULT NULL::numeric, p_unidad_medida text DEFAULT NULL::text,p_unidad_revision text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF p_producto_id IS NOT NULL THEN
  PERFORM sigo_correccion_inicial.autorizar_operacion(p_empresa_id,p_producto_id,p_unidad_medida,p_unidad_revision);
 END IF;
 resultado:=public.guardar_producto_medida_sigo(p_empresa_id,p_producto_id,p_codigo_interno,p_codigo_barras,p_nombre,p_descripcion,p_categoria,p_marca,p_proveedor,p_costo_actual,p_costo_ultima_compra,p_precio_venta,p_margen_ganancia,p_margen_porcentaje,p_stock_actual,p_stock_minimo,p_stock_maximo,p_unidad_medida);
 PERFORM sigo_correccion_inicial.limpiar_actual();RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.listar_revisiones_unidad_producto_sigo(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guardar_producto_medida_revision_sigo(uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) FROM PUBLIC,anon,authenticated;
COMMIT;
