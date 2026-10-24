SET log_min_messages=notice;

SET ROLE postgres;

CREATE TABLE public.sigo_superadmins(user_id uuid NOT NULL,activo boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid);

CREATE OR REPLACE FUNCTION public.sigo_cuit_argentino_valido(p_cuit text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_cuit text := regexp_replace(coalesce(p_cuit, ''), '[^0-9]+', '', 'g');
  v_suma integer;
  v_resto integer;
  v_esperado integer;
begin
  if length(v_cuit) <> 11 then
    return false;
  end if;
 
  v_suma :=
      substring(v_cuit, 1, 1)::integer * 5
    + substring(v_cuit, 2, 1)::integer * 4
    + substring(v_cuit, 3, 1)::integer * 3
    + substring(v_cuit, 4, 1)::integer * 2
    + substring(v_cuit, 5, 1)::integer * 7
    + substring(v_cuit, 6, 1)::integer * 6
    + substring(v_cuit, 7, 1)::integer * 5
    + substring(v_cuit, 8, 1)::integer * 4
    + substring(v_cuit, 9, 1)::integer * 3
    + substring(v_cuit, 10, 1)::integer * 2;
 
  v_resto := 11 - (v_suma % 11);
  v_esperado := case when v_resto = 11 then 0 when v_resto = 10 then 9 else v_resto end;
  return v_esperado = substring(v_cuit, 11, 1)::integer;
exception
  when others then
    return false;
end;
$function$;

ALTER TABLE public."clientes_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."clientes_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."clientes_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."clientes_sigo" TO "service_role";

CREATE POLICY "clientes_sigo_delete" ON public."clientes_sigo" AS PERMISSIVE FOR DELETE TO authenticated USING (tiene_permiso_empresa(empresa_id, 'clients.write'::text));

CREATE POLICY "clientes_sigo_insert" ON public."clientes_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (tiene_permiso_empresa(empresa_id, 'clients.write'::text));

CREATE POLICY "clientes_sigo_select" ON public."clientes_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'clients.read'::text));

CREATE POLICY "clientes_sigo_update" ON public."clientes_sigo" AS PERMISSIVE FOR UPDATE TO authenticated USING (tiene_permiso_empresa(empresa_id, 'clients.write'::text)) WITH CHECK (tiene_permiso_empresa(empresa_id, 'clients.write'::text));

ALTER TABLE public."proveedores_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."proveedores_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."proveedores_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."proveedores_sigo" TO "service_role";

CREATE POLICY "proveedores_sigo_insert" ON public."proveedores_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (tiene_permiso_empresa(empresa_id, 'suppliers.write'::text));

CREATE POLICY "proveedores_sigo_select" ON public."proveedores_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'suppliers.read'::text));

CREATE POLICY "proveedores_sigo_update" ON public."proveedores_sigo" AS PERMISSIVE FOR UPDATE TO authenticated USING (tiene_permiso_empresa(empresa_id, 'suppliers.write'::text)) WITH CHECK (tiene_permiso_empresa(empresa_id, 'suppliers.write'::text));

ALTER TABLE public."sigo_superadmins" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."sigo_superadmins" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."sigo_superadmins" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."sigo_superadmins" TO "service_role";

CREATE POLICY "sigo_superadmins_select_self" ON public."sigo_superadmins" AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND (activo = true)));

REVOKE ALL ON FUNCTION public.anular_venta_sigo(p_empresa_id uuid, p_venta_id uuid, p_motivo text, p_idempotency_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.anular_venta_sigo(p_empresa_id uuid, p_venta_id uuid, p_motivo text, p_idempotency_key text) TO "anon";

GRANT EXECUTE ON FUNCTION public.anular_venta_sigo(p_empresa_id uuid, p_venta_id uuid, p_motivo text, p_idempotency_key text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.anular_venta_sigo(p_empresa_id uuid, p_venta_id uuid, p_motivo text, p_idempotency_key text) TO "service_role";

REVOKE ALL ON FUNCTION public.buscar_producto_codigo_sigo(p_empresa_id uuid, p_codigo text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.buscar_producto_codigo_sigo(p_empresa_id uuid, p_codigo text) TO "anon";

GRANT EXECUTE ON FUNCTION public.buscar_producto_codigo_sigo(p_empresa_id uuid, p_codigo text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.buscar_producto_codigo_sigo(p_empresa_id uuid, p_codigo text) TO "service_role";

REVOKE ALL ON FUNCTION public.calcular_margen_producto() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.calcular_margen_producto() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.calcular_margen_producto() TO "anon";

GRANT EXECUTE ON FUNCTION public.calcular_margen_producto() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.calcular_margen_producto() TO "service_role";

REVOKE ALL ON FUNCTION public.cambiar_compra_sigo(p_empresa_id uuid, p_compra_id uuid, p_accion text, p_proveedor_id uuid, p_fecha date, p_tipo text, p_numero text, p_items jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.cambiar_compra_sigo(p_empresa_id uuid, p_compra_id uuid, p_accion text, p_proveedor_id uuid, p_fecha date, p_tipo text, p_numero text, p_items jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.cambiar_compra_sigo(p_empresa_id uuid, p_compra_id uuid, p_accion text, p_proveedor_id uuid, p_fecha date, p_tipo text, p_numero text, p_items jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date, p_tipo_comprobante text, p_numero_comprobante text, p_idempotency_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date, p_tipo_comprobante text, p_numero_comprobante text, p_idempotency_key text) TO "anon";

GRANT EXECUTE ON FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date, p_tipo_comprobante text, p_numero_comprobante text, p_idempotency_key text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date, p_tipo_comprobante text, p_numero_comprobante text, p_idempotency_key text) TO "service_role";

REVOKE ALL ON FUNCTION public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text) TO "anon";

GRANT EXECUTE ON FUNCTION public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text) TO "service_role";

REVOKE ALL ON FUNCTION public.confirmar_venta_sigo_v2(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text, p_cliente_id uuid, p_descuento_pct numeric) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.confirmar_venta_sigo_v2(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text, p_cliente_id uuid, p_descuento_pct numeric) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.confirmar_venta_sigo_v2(p_empresa_id uuid, p_items jsonb, p_medio_pago text, p_idempotency_key text, p_cliente_id uuid, p_descuento_pct numeric) TO "service_role";

REVOKE ALL ON FUNCTION public.es_miembro_empresa(p_empresa_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.es_miembro_empresa(p_empresa_id uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.es_miembro_empresa(p_empresa_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.es_miembro_empresa(p_empresa_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.es_miembro_empresa(p_empresa_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.es_owner_empresa(p_empresa_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.es_owner_empresa(p_empresa_id uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.es_owner_empresa(p_empresa_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.es_owner_empresa(p_empresa_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.es_owner_empresa(p_empresa_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.guard_compra_documento_normalizado_sigo() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.guard_compra_documento_normalizado_sigo() TO "anon";

GRANT EXECUTE ON FUNCTION public.guard_compra_documento_normalizado_sigo() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.guard_compra_documento_normalizado_sigo() TO "service_role";

REVOKE ALL ON FUNCTION public.guardar_compra_ia_sigo(p_empresa_id uuid, p_idempotency_key text, p_compra jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.guardar_compra_ia_sigo(p_empresa_id uuid, p_idempotency_key text, p_compra jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.guardar_compra_ia_sigo(p_empresa_id uuid, p_idempotency_key text, p_compra jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.guardar_producto_sigo(p_empresa_id uuid, p_producto_id uuid, p_codigo_interno text, p_codigo_barras text, p_nombre text, p_descripcion text, p_categoria text, p_marca text, p_proveedor text, p_costo_actual numeric, p_costo_ultima_compra numeric, p_precio_venta numeric, p_margen_ganancia numeric, p_margen_porcentaje numeric, p_stock_actual numeric, p_stock_minimo numeric, p_stock_maximo numeric) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.guardar_producto_sigo(p_empresa_id uuid, p_producto_id uuid, p_codigo_interno text, p_codigo_barras text, p_nombre text, p_descripcion text, p_categoria text, p_marca text, p_proveedor text, p_costo_actual numeric, p_costo_ultima_compra numeric, p_precio_venta numeric, p_margen_ganancia numeric, p_margen_porcentaje numeric, p_stock_actual numeric, p_stock_minimo numeric, p_stock_maximo numeric) TO "anon";

GRANT EXECUTE ON FUNCTION public.guardar_producto_sigo(p_empresa_id uuid, p_producto_id uuid, p_codigo_interno text, p_codigo_barras text, p_nombre text, p_descripcion text, p_categoria text, p_marca text, p_proveedor text, p_costo_actual numeric, p_costo_ultima_compra numeric, p_precio_venta numeric, p_margen_ganancia numeric, p_margen_porcentaje numeric, p_stock_actual numeric, p_stock_minimo numeric, p_stock_maximo numeric) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.guardar_producto_sigo(p_empresa_id uuid, p_producto_id uuid, p_codigo_interno text, p_codigo_barras text, p_nombre text, p_descripcion text, p_categoria text, p_marca text, p_proveedor text, p_costo_actual numeric, p_costo_ultima_compra numeric, p_precio_venta numeric, p_margen_ganancia numeric, p_margen_porcentaje numeric, p_stock_actual numeric, p_stock_minimo numeric, p_stock_maximo numeric) TO "service_role";

REVOKE ALL ON FUNCTION public.listar_productos_sigo(p_empresa_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.listar_productos_sigo(p_empresa_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.listar_productos_sigo(p_empresa_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.listar_productos_sigo(p_empresa_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.proteger_producto_inactivo_sigo() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.proteger_producto_inactivo_sigo() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.proteger_producto_inactivo_sigo() TO "anon";

GRANT EXECUTE ON FUNCTION public.proteger_producto_inactivo_sigo() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.proteger_producto_inactivo_sigo() TO "service_role";

REVOKE ALL ON FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean) TO "anon";

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_compra_items_max_300_guard() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_compra_items_max_300_guard() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_compra_items_max_300_guard() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_compra_items_max_300_guard() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_compra_items_max_300_guard() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_empresa_es_accesible(p_empresa_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_empresa_es_accesible(p_empresa_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_empresa_es_accesible(p_empresa_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_empresa_es_accesible(p_empresa_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_guard_compra_cabecera_integridad() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_cabecera_integridad() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_cabecera_integridad() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_cabecera_integridad() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_cabecera_integridad() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_guard_compra_documento_canonico() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_documento_canonico() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_documento_canonico() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_documento_canonico() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_documento_canonico() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_guard_compra_item_integridad() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_integridad() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_integridad() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_integridad() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_integridad() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_guard_compra_item_limites() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_limites() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_limites() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_limites() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_guard_compra_item_limites() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_normalizar_documento_compra(p_valor text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_normalizar_documento_compra(p_valor text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_normalizar_documento_compra(p_valor text) TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_normalizar_documento_compra(p_valor text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_normalizar_documento_compra(p_valor text) TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_productos_costos_no_nulos_guard() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_productos_costos_no_nulos_guard() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sigo_productos_costos_no_nulos_guard() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_productos_costos_no_nulos_guard() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_productos_costos_no_nulos_guard() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_validar_empresa_operativa() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_validar_empresa_operativa() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_validar_empresa_operativa() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_validar_empresa_operativa() TO "service_role";

REVOKE ALL ON FUNCTION public.sigo_validar_producto_movimiento() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sigo_validar_producto_movimiento() TO "anon";

GRANT EXECUTE ON FUNCTION public.sigo_validar_producto_movimiento() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sigo_validar_producto_movimiento() TO "service_role";

REVOKE ALL ON FUNCTION public.tiene_permiso_empresa(p_empresa_id uuid, p_permiso text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.tiene_permiso_empresa(p_empresa_id uuid, p_permiso text) TO "anon";

GRANT EXECUTE ON FUNCTION public.tiene_permiso_empresa(p_empresa_id uuid, p_permiso text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.tiene_permiso_empresa(p_empresa_id uuid, p_permiso text) TO "service_role";

REVOKE ALL ON FUNCTION public.validar_codigo_producto_unico_sigo() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.validar_codigo_producto_unico_sigo() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.validar_codigo_producto_unico_sigo() TO "anon";

GRANT EXECUTE ON FUNCTION public.validar_codigo_producto_unico_sigo() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.validar_codigo_producto_unico_sigo() TO "service_role";

REVOKE ALL ON FUNCTION public.validar_precio_venta_item_sigo() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.validar_precio_venta_item_sigo() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.validar_precio_venta_item_sigo() TO "anon";

GRANT EXECUTE ON FUNCTION public.validar_precio_venta_item_sigo() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.validar_precio_venta_item_sigo() TO "service_role";

-- SIGO Venta por medidas: migración propuesta, NO aplicada.
-- Se aprovecha productos.unidad_medida existente. No se altera stock ni precios.
-- Aplicar únicamente tras validar los valores históricos de unidad_medida.
create or replace function public.listar_unidades_producto_sigo(p_empresa_id uuid)
returns table(producto_id uuid, unidad_medida text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read')
     or not public.tiene_permiso_empresa(p_empresa_id, 'sales.read') then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.unidad_medida), ''), 'unidad')
    from public.productos p
    where p.empresa_id = p_empresa_id and p.activo = true;
end;
$$;
revoke all on function public.listar_unidades_producto_sigo(uuid) from public;
grant execute on function public.listar_unidades_producto_sigo(uuid) to authenticated;
 
create or replace function public.configurar_unidad_producto_sigo(
  p_empresa_id uuid, p_producto_id uuid, p_unidad text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_unidad is null or p_unidad not in
    ('unidad','kg','g','l','ml','m','cm','m2','m3','docena','caja','bolsa','paquete','rollo','bandeja','atado') then
    raise exception 'UNIDAD_INVALIDA';
  end if;
  update public.productos
     set unidad_medida = p_unidad
   where id = p_producto_id and empresa_id = p_empresa_id and activo = true;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.configurar_unidad_producto_sigo(uuid,uuid,text) from public;
grant execute on function public.configurar_unidad_producto_sigo(uuid,uuid,text) to authenticated;

