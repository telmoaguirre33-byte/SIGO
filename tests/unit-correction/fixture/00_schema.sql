SET log_min_messages=notice;

SET ROLE postgres;

SET check_function_bodies=false;

CREATE SCHEMA auth;

CREATE TABLE auth.users(id uuid PRIMARY KEY);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid $$;

GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;

CREATE TABLE public."alias_productos" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "producto_id" uuid NOT NULL, "texto_alias" text NOT NULL, "origen" text DEFAULT 'USUARIO'::text, "confianza" numeric(5,2) DEFAULT 100, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."arca_puntos_venta" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "numero" integer NOT NULL, "nombre" text, "ambiente" text DEFAULT 'homologacion'::text NOT NULL, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."caja_movimientos_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "venta_id" uuid, "tipo" text NOT NULL, "medio_pago" text NOT NULL, "importe" numeric(14,2) NOT NULL, "concepto" text NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "devolucion_id" uuid);

CREATE TABLE public."cliente_movimientos_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "cliente_id" uuid NOT NULL, "venta_id" uuid, "tipo" text NOT NULL, "importe" numeric(14,2) NOT NULL, "concepto" text NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "devolucion_id" uuid);

CREATE TABLE public."compra_borradores_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "documento" jsonb NOT NULL, "estado" text DEFAULT 'pendiente'::text NOT NULL, "compra_id" uuid, "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."compra_cambios_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "compra_id" uuid NOT NULL, "accion" text NOT NULL, "datos_anteriores" jsonb NOT NULL, "cambiado_por" uuid NOT NULL, "creado_en" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."compra_ia_confirmaciones" ("empresa_id" uuid NOT NULL, "idempotency_key" text NOT NULL, "solicitud" jsonb NOT NULL, "compra_id" uuid NOT NULL, "resultado" jsonb NOT NULL, "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."compra_items_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "compra_id" uuid NOT NULL, "empresa_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "cantidad" numeric(14,3) NOT NULL, "costo_unitario" numeric(14,4) NOT NULL, "subtotal" numeric(14,2) NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."compras" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "proveedor_id" uuid, "tipo_comprobante" text, "punto_venta" text, "numero_comprobante" text, "fecha_compra" timestamp with time zone DEFAULT now() NOT NULL, "subtotal" numeric(14,2) DEFAULT 0 NOT NULL, "descuento" numeric(14,2) DEFAULT 0 NOT NULL, "iva" numeric(14,2) DEFAULT 0 NOT NULL, "total" numeric(14,2) DEFAULT 0 NOT NULL, "estado" text DEFAULT 'BORRADOR'::text NOT NULL, "documento_url" text, "origen" text DEFAULT 'MANUAL'::text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "empresa_id" uuid);

CREATE TABLE public."compras_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "proveedor_id" uuid NOT NULL, "fecha_compra" date DEFAULT CURRENT_DATE NOT NULL, "tipo_comprobante" text, "numero_comprobante" text, "subtotal" numeric(14,2) DEFAULT 0 NOT NULL, "total" numeric(14,2) DEFAULT 0 NOT NULL, "estado" text DEFAULT 'confirmada'::text NOT NULL, "origen" text DEFAULT 'manual'::text NOT NULL, "idempotency_key" text, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "request_fingerprint" text);

CREATE TABLE public."detalle_compras" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "compra_id" uuid NOT NULL, "producto_id" uuid, "descripcion_factura" text, "cantidad" numeric(14,3) DEFAULT 0 NOT NULL, "precio_unitario" numeric(14,2) DEFAULT 0 NOT NULL, "descuento" numeric(14,2) DEFAULT 0 NOT NULL, "iva" numeric(14,2) DEFAULT 0 NOT NULL, "subtotal" numeric(14,2) DEFAULT 0 NOT NULL, "estado_match" text DEFAULT 'NUEVO'::text, "confianza_match" numeric(5,2), "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."devolucion_items_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "devolucion_id" uuid NOT NULL, "empresa_id" uuid NOT NULL, "venta_item_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "cantidad" numeric(14,3) NOT NULL, "precio_unitario" numeric(14,2) NOT NULL, "subtotal" numeric(14,2) NOT NULL);

CREATE TABLE public."devoluciones_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "venta_id" uuid NOT NULL, "tipo" text NOT NULL, "total" numeric(14,2) DEFAULT 0 NOT NULL, "motivo" text NOT NULL, "idempotency_key" text NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."documentos_compra" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "compra_id" uuid, "archivo_url" text, "tipo_archivo" text, "estado" text DEFAULT 'PENDIENTE'::text NOT NULL, "proveedor_detectado" text, "cuit_detectado" text, "fecha_detectada" date, "total_detectado" numeric(14,2), "datos_ia" jsonb, "error" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."empresa_usuarios" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "user_id" uuid NOT NULL, "rol" text NOT NULL, "permisos_extra" text[] DEFAULT '{}'::text[] NOT NULL, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "permisos_denegados" text[] DEFAULT '{}'::text[] NOT NULL);

CREATE TABLE public."empresas" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "nombre" text NOT NULL, "razon_social" text, "cuit" text, "activa" boolean DEFAULT true NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."movimientos_stock" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "producto_id" uuid NOT NULL, "tipo" text NOT NULL, "cantidad" numeric(14,3) NOT NULL, "stock_anterior" numeric(14,3) NOT NULL, "stock_nuevo" numeric(14,3) NOT NULL, "referencia_tipo" text, "referencia_id" uuid, "observaciones" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."ofertas_productos_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "fecha_inicio" date NOT NULL, "fecha_fin" date NOT NULL, "descuento_porcentaje" numeric(5,2) NOT NULL, "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."perfiles" ("id" uuid NOT NULL, "nombre" text, "apellido" text, "rol" text DEFAULT 'VENDEDOR'::text NOT NULL, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."portal_cliente_usuarios" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "cliente_id" uuid NOT NULL, "user_id" uuid NOT NULL, "activo" boolean DEFAULT true NOT NULL, "creado_en" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."portal_stock_publicado" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "cliente_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "publicado" boolean DEFAULT true NOT NULL, "stock_comercial" numeric, "consumo_diario_estimado" numeric, "dias_objetivo" numeric DEFAULT 15 NOT NULL, "umbral_amarillo" numeric DEFAULT 7 NOT NULL, "actualizado_en" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."producto_codigos_alias_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "codigo" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."productos" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "codigo_interno" text, "nombre" text NOT NULL, "descripcion" text, "marca_id" uuid, "categoria_id" uuid, "proveedor_principal_id" uuid, "unidad_medida" text DEFAULT 'UNIDAD'::text NOT NULL, "costo_actual" numeric(14,2) DEFAULT 0 NOT NULL, "costo_ultima_compra" numeric(14,2) DEFAULT 0 NOT NULL, "precio_venta" numeric(14,2) DEFAULT 0 NOT NULL, "margen_ganancia" numeric(14,2) DEFAULT 0 NOT NULL, "margen_porcentaje" numeric(8,2) DEFAULT 0 NOT NULL, "iva_porcentaje" numeric(5,2) DEFAULT 21 NOT NULL, "stock_actual" numeric(14,3) DEFAULT 0 NOT NULL, "stock_minimo" numeric(14,3) DEFAULT 0 NOT NULL, "stock_maximo" numeric(14,3), "imagen_url" text, "activo" boolean DEFAULT true NOT NULL, "fecha_ultima_compra" timestamp with time zone, "fecha_ultima_venta" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "codigo_barras" text, "categoria" text, "marca" text, "proveedor" text, "empresa_id" uuid, "iva_alicuota_id" integer, "iva_tasa" numeric(6,3), "precio_incluye_iva" boolean);

CREATE TABLE public."sigo_empresa_modulos" ("empresa_id" uuid NOT NULL, "modulo_clave" text NOT NULL, "habilitado" boolean DEFAULT false NOT NULL, "actualizado_por" uuid, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."sigo_importaciones_stock" ("import_key" text NOT NULL, "empresa_id" uuid NOT NULL, "source_file" text NOT NULL, "source_rows" integer NOT NULL, "inserted_rows" integer NOT NULL, "skipped_existing" integer NOT NULL, "verified_rows" integer NOT NULL, "notes" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."venta_items_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "venta_id" uuid NOT NULL, "empresa_id" uuid NOT NULL, "producto_id" uuid NOT NULL, "cantidad" numeric(14,3) NOT NULL, "precio_unitario" numeric(14,2) NOT NULL, "subtotal" numeric(14,2) NOT NULL);

CREATE TABLE public."ventas_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "numero" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL, "estado" text DEFAULT 'confirmada'::text NOT NULL, "medio_pago" text DEFAULT 'efectivo'::text NOT NULL, "total" numeric(14,2) NOT NULL, "idempotency_key" text NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "cliente_id" uuid, "request_fingerprint" text, "anulada_at" timestamp with time zone, "anulada_by" uuid, "motivo_anulacion" text);

CREATE TABLE public."categorias" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "nombre" text NOT NULL, "descripcion" text, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."clientes_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "nombre" text NOT NULL, "documento" text, "telefono" text, "email" text, "direccion" text, "limite_credito" numeric(14,2), "saldo_actual" numeric(14,2) DEFAULT 0 NOT NULL, "activo" boolean DEFAULT true NOT NULL, "created_by" uuid DEFAULT auth.uid() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "arca_doc_tipo" integer, "condicion_iva_receptor_id" integer);

CREATE TABLE public."marcas" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "nombre" text NOT NULL, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE public."proveedores" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "razon_social" text NOT NULL, "nombre_fantasia" text, "cuit" text, "telefono" text, "email" text, "direccion" text, "ciudad" text, "provincia" text, "observaciones" text, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "empresa_id" uuid);

CREATE TABLE public."proveedores_sigo" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "empresa_id" uuid NOT NULL, "razon_social" text NOT NULL, "nombre_fantasia" text, "cuit" text, "telefono" text, "email" text, "direccion" text, "activo" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);

CREATE OR REPLACE FUNCTION public.anular_venta_sigo(p_empresa_id uuid, p_venta_id uuid, p_motivo text, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.registrar_devolucion_sigo(
    p_empresa_id,
    p_venta_id,
    '[]'::jsonb,
    p_motivo,
    p_idempotency_key,
    true
  );
$function$;

CREATE OR REPLACE FUNCTION public.buscar_producto_codigo_sigo(p_empresa_id uuid, p_codigo text)
 RETURNS TABLE(id uuid, empresa_id uuid, codigo_interno text, codigo_barras text, nombre text, descripcion text, categoria text, marca text, proveedor text, costo_actual numeric, costo_ultima_compra numeric, precio_venta numeric, margen_ganancia numeric, margen_porcentaje numeric, stock_actual numeric, stock_minimo numeric, stock_maximo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
 
  v_codigo := btrim(coalesce(p_codigo, ''));
  if v_codigo = '' then
    raise exception 'CODIGO_REQUIRED';
  end if;
 
  if length(v_codigo) > 128 then
    raise exception 'CODIGO_INVALIDO';
  end if;
 
  return query
  select p.*
  from public.listar_productos_sigo(p_empresa_id) p
  where p.codigo_barras = v_codigo
     or p.codigo_interno = v_codigo
     or exists (
       select 1
       from public.producto_codigos_alias_sigo a
       where a.empresa_id = p_empresa_id
         and a.producto_id = p.id
         and a.codigo = v_codigo
     )
  order by
    case when p.codigo_barras = v_codigo then 0
         when p.codigo_interno = v_codigo then 1
         else 2 end,
    p.nombre asc
  limit 10;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_compra_sigo(p_empresa_id uuid, p_compra_id uuid, p_accion text, p_proveedor_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_numero text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_compra public.compras_sigo%rowtype;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric;
  v_costo numeric;
  v_nuevos jsonb := '{}'::jsonb;
  v_previos jsonb := '{}'::jsonb;
  v_ids uuid[];
  v_id uuid;
  v_delta numeric;
  v_total numeric := 0;
  v_nuevo_costo numeric;
  v_ultimo_costo numeric;
  v_precio numeric;
  v_numero text := nullif(btrim(p_numero),'');
  v_tipo text := nullif(btrim(p_tipo),'');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'purchases.write'),false)
    or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.write'),false) then raise exception 'FORBIDDEN'; end if;
  if p_accion not in ('modificar','anular') then raise exception 'INVALID_ACTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('compra-edit|'||p_empresa_id::text,0));
  select * into v_compra from public.compras_sigo where id=p_compra_id and empresa_id=p_empresa_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_compra.estado='anulada' and p_accion='anular' then return jsonb_build_object('compra_id',p_compra_id,'estado','anulada'); end if;
  if v_compra.estado<>'confirmada' then raise exception 'PURCHASE_NOT_ACTIVE'; end if;
  if p_accion='modificar' then
    if p_proveedor_id is null or not exists(select 1 from public.proveedores_sigo where id=p_proveedor_id and empresa_id=p_empresa_id and activo)
      then raise exception 'SUPPLIER_NOT_FOUND'; end if;
    if p_fecha is null or length(coalesce(v_tipo,''))>100 or length(coalesce(v_numero,''))>200 then raise exception 'INVALID_HEADER'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 300 then raise exception 'INVALID_ITEM'; end if;
    if v_numero is not null and exists(
      select 1 from public.compras_sigo c where c.empresa_id=p_empresa_id and c.id<>p_compra_id and c.proveedor_id=p_proveedor_id and c.estado='confirmada'
      and regexp_replace(upper(c.numero_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_numero),'[^A-Z0-9]','','g')
      and (v_tipo is null or nullif(btrim(c.tipo_comprobante),'') is null or regexp_replace(upper(c.tipo_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_tipo),'[^A-Z0-9]','','g'))
    ) then raise exception 'PURCHASE_DOCUMENT_DUPLICATE'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ITEM'; end if;
      v_producto_id:=nullif(v_item->>'producto_id','')::uuid;
      v_cantidad:=(v_item->>'cantidad')::numeric;
      v_costo:=(v_item->>'costo_unitario')::numeric;
      if v_producto_id is null or v_cantidad is null or v_cantidad<=0 or v_cantidad>1000000 or v_cantidad::text in ('NaN','Infinity','-Infinity')
        or v_costo is null or v_costo<0 or v_costo>1000000000 or v_costo::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_ITEM'; end if;
      if v_nuevos ? v_producto_id::text then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
      v_nuevos:=v_nuevos||jsonb_build_object(v_producto_id::text,jsonb_build_object('cantidad',v_cantidad,'costo_unitario',v_costo));
      v_total:=v_total+round(v_cantidad*v_costo,2);
    end loop;
  end if;
  select coalesce(jsonb_object_agg(i.producto_id::text,jsonb_build_object('cantidad',i.cantidad,'costo_unitario',i.costo_unitario)),'{}'::jsonb)
    into v_previos from public.compra_items_sigo i where i.empresa_id=p_empresa_id and i.compra_id=p_compra_id;
  select array_agg(k::uuid order by k::uuid) into v_ids from (
    select jsonb_object_keys(v_previos) k union select jsonb_object_keys(v_nuevos) k
  ) ids;
  -- Lock in stable order; refuse to remove units already sold.
  foreach v_id in array v_ids loop
    perform 1 from public.productos where id=v_id and empresa_id=p_empresa_id and activo for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end loop;
  foreach v_id in array v_ids loop
    v_delta:=coalesce((v_nuevos->v_id::text->>'cantidad')::numeric,0)-coalesce((v_previos->v_id::text->>'cantidad')::numeric,0);
    update public.productos set stock_actual=stock_actual+v_delta
    where id=v_id and empresa_id=p_empresa_id and stock_actual+v_delta>=0;
    if not found then raise exception 'STOCK_INSUFFICIENT_TO_REVERSE'; end if;
  end loop;
  insert into public.compra_cambios_sigo(empresa_id,compra_id,accion,datos_anteriores,cambiado_por)
    values(p_empresa_id,p_compra_id,p_accion,jsonb_build_object('cabecera',to_jsonb(v_compra),'items',v_previos),auth.uid());
  if p_accion='anular' then
    update public.compras_sigo set estado='anulada' where id=p_compra_id and empresa_id=p_empresa_id;
  else
    delete from public.compra_items_sigo where compra_id=p_compra_id and empresa_id=p_empresa_id;
    foreach v_id in array v_ids loop
      if v_nuevos ? v_id::text then
        v_cantidad:=(v_nuevos->v_id::text->>'cantidad')::numeric;
        v_costo:=(v_nuevos->v_id::text->>'costo_unitario')::numeric;
        insert into public.compra_items_sigo(compra_id,empresa_id,producto_id,cantidad,costo_unitario,subtotal)
          values(p_compra_id,p_empresa_id,v_id,v_cantidad,v_costo,round(v_cantidad*v_costo,2));
      end if;
    end loop;
    update public.compras_sigo set proveedor_id=p_proveedor_id,fecha_compra=p_fecha,tipo_comprobante=v_tipo,numero_comprobante=v_numero,
      subtotal=round(v_total,2),total=round(v_total,2) where id=p_compra_id and empresa_id=p_empresa_id;
  end if;
  -- Restore the most recent confirmed purchase cost when possible; prices remain customer-set.
  foreach v_id in array v_ids loop
    select i.costo_unitario into v_ultimo_costo from public.compra_items_sigo i join public.compras_sigo c on c.id=i.compra_id
      where i.empresa_id=p_empresa_id and i.producto_id=v_id and c.estado='confirmada'
      order by c.created_at desc, i.created_at desc limit 1;
    if found then
      update public.productos set costo_actual=v_ultimo_costo,costo_ultima_compra=v_ultimo_costo
        where id=v_id and empresa_id=p_empresa_id;
    end if;
  end loop;
  return jsonb_build_object('compra_id',p_compra_id,'estado',case when p_accion='anular' then 'anulada' else 'confirmada' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date DEFAULT CURRENT_DATE, p_tipo_comprobante text DEFAULT NULL::text, p_numero_comprobante text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_compra_id uuid; v_item jsonb; v_producto public.productos%rowtype; v_producto_id uuid; v_cantidad numeric; v_costo numeric; v_subtotal numeric:=0;
 v_key text:=nullif(trim(coalesce(p_idempotency_key,'')),''); v_seen uuid[]:=array[]::uuid[];
 v_existente_proveedor uuid; v_existente_fecha date; v_existente_tipo text; v_existente_numero text; v_existente_total numeric;
 v_existente_fingerprint text; v_request_fingerprint text; v_fecha date:=coalesce(p_fecha,current_date);
 v_tipo text:=nullif(trim(coalesce(p_tipo_comprobante,'')),''); v_numero text:=nullif(trim(coalesce(p_numero_comprobante,'')),''); v_document_lock text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.tiene_permiso_empresa(p_empresa_id,'purchases.write') then raise exception 'FORBIDDEN'; end if;
 if not public.tiene_permiso_empresa(p_empresa_id,'stock.write') then raise exception 'STOCK_WRITE_REQUIRED'; end if;
 if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 if length(v_key)>200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'ITEMS_REQUIRED'; end if;
 if jsonb_array_length(p_items)>500 then raise exception 'TOO_MANY_ITEMS'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  begin v_producto_id:=nullif(trim(v_item->>'producto_id'),'')::uuid; v_cantidad:=nullif(trim(v_item->>'cantidad'),'')::numeric; v_costo:=nullif(trim(v_item->>'costo_unitario'),'')::numeric;
  exception when invalid_text_representation then raise exception 'INVALID_ITEM'; end;
  if v_producto_id is null then raise exception 'INVALID_ITEM'; end if;
  if v_cantidad is null or v_cantidad<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if v_costo is null or v_costo<0 then raise exception 'INVALID_COST'; end if;
  if v_producto_id=any(v_seen) then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
  v_seen:=array_append(v_seen,v_producto_id); v_subtotal:=v_subtotal+round(v_cantidad*v_costo,2);
 end loop; v_subtotal:=round(v_subtotal,2);
 select md5(coalesce(jsonb_agg(jsonb_build_object('producto_id',n.producto_id::text,'cantidad',to_char(n.cantidad,'FM999999999999990.000'),'costo_unitario',to_char(n.costo_unitario,'FM999999999999990.0000')) order by n.producto_id)::text,'[]')||'|'||coalesce(p_proveedor_id::text,'')||'|'||coalesce(v_fecha::text,'')||'|'||coalesce(v_tipo,'')||'|'||coalesce(v_numero,''))
 into v_request_fingerprint from (select (trim(j.value->>'producto_id'))::uuid producto_id,(trim(j.value->>'cantidad'))::numeric(14,3) cantidad,(trim(j.value->>'costo_unitario'))::numeric(14,4) costo_unitario from jsonb_array_elements(p_items) j(value)) n;
 select id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,total,request_fingerprint into v_compra_id,v_existente_proveedor,v_existente_fecha,v_existente_tipo,v_existente_numero,v_existente_total,v_existente_fingerprint from public.compras_sigo where empresa_id=p_empresa_id and idempotency_key=v_key;
 if v_compra_id is not null then
  if v_existente_proveedor is distinct from p_proveedor_id or v_existente_fecha is distinct from v_fecha or v_existente_tipo is distinct from v_tipo or v_existente_numero is distinct from v_numero or round(v_existente_total,2) is distinct from v_subtotal or v_existente_fingerprint is distinct from v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_compra_id;
 end if;
 if not exists(select 1 from public.proveedores_sigo where id=p_proveedor_id and empresa_id=p_empresa_id and activo=true) then raise exception 'SUPPLIER_NOT_FOUND'; end if;
 if v_numero is not null then
  v_document_lock:=p_empresa_id::text||'|'||p_proveedor_id::text||'|'||lower(coalesce(v_tipo,''))||'|'||lower(v_numero); perform pg_advisory_xact_lock(hashtextextended(v_document_lock,0));
  select c.id into v_compra_id from public.compras_sigo c where c.empresa_id=p_empresa_id and c.proveedor_id=p_proveedor_id and lower(coalesce(nullif(trim(c.tipo_comprobante),''),''))=lower(coalesce(v_tipo,'')) and lower(nullif(trim(c.numero_comprobante),''))=lower(v_numero) and c.estado='confirmada' limit 1;
  if v_compra_id is not null then raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%',v_compra_id; end if;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_producto_id:=(trim(v_item->>'producto_id'))::uuid; select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo=true for update; if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 end loop;
 insert into public.compras_sigo(empresa_id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,subtotal,total,estado,origen,idempotency_key,request_fingerprint,created_by)
 values(p_empresa_id,p_proveedor_id,v_fecha,v_tipo,v_numero,v_subtotal,v_subtotal,'confirmada','manual',v_key,v_request_fingerprint,auth.uid()) returning id into v_compra_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_producto_id:=(trim(v_item->>'producto_id'))::uuid; v_cantidad:=(trim(v_item->>'cantidad'))::numeric; v_costo:=(trim(v_item->>'costo_unitario'))::numeric;
  insert into public.compra_items_sigo(compra_id,empresa_id,producto_id,cantidad,costo_unitario,subtotal) values(v_compra_id,p_empresa_id,v_producto_id,v_cantidad,v_costo,round(v_cantidad*v_costo,2));
  update public.productos set
   stock_actual=coalesce(stock_actual,0)+v_cantidad,
   precio_venta=case when v_costo>coalesce(costo_actual,0) and coalesce(precio_venta,0)>0 then round(v_costo*(1+coalesce(margen_porcentaje,case when coalesce(costo_actual,0)>0 then ((precio_venta-costo_actual)/costo_actual)*100 else 0 end)/100),2) else precio_venta end,
   margen_ganancia=case when v_costo>coalesce(costo_actual,0) and coalesce(precio_venta,0)>0 then round(v_costo*(1+coalesce(margen_porcentaje,case when coalesce(costo_actual,0)>0 then ((precio_venta-costo_actual)/costo_actual)*100 else 0 end)/100),2)-v_costo else margen_ganancia end,
   costo_actual=v_costo,costo_ultima_compra=v_costo where id=v_producto_id and empresa_id=p_empresa_id and activo=true;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 end loop; return v_compra_id;
exception when unique_violation then
 select id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,total,request_fingerprint into v_compra_id,v_existente_proveedor,v_existente_fecha,v_existente_tipo,v_existente_numero,v_existente_total,v_existente_fingerprint from public.compras_sigo where empresa_id=p_empresa_id and idempotency_key=v_key;
 if v_compra_id is not null then
  if v_existente_proveedor is distinct from p_proveedor_id or v_existente_fecha is distinct from v_fecha or v_existente_tipo is distinct from v_tipo or v_existente_numero is distinct from v_numero or round(v_existente_total,2) is distinct from v_subtotal or v_existente_fingerprint is distinct from v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_compra_id;
 end if; raise;
end; $function$;

CREATE OR REPLACE FUNCTION public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text DEFAULT 'efectivo'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_item jsonb;
  v_producto record;
  v_cantidad numeric(14,3);
  v_total numeric(14,2) := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','otro') then
    if p_medio_pago = 'cuenta_corriente' then
      raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT';
    end if;
    raise exception 'PAYMENT_METHOD_INVALID';
  end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;
 
  select id into v_venta_id
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_venta_id is not null then return v_venta_id; end if;
 
  insert into public.ventas_sigo (empresa_id, total, medio_pago, idempotency_key, created_by)
  values (p_empresa_id, 0, p_medio_pago, v_key, v_user_id)
  returning id into v_venta_id;
 
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_cantidad := nullif((v_item->>'cantidad')::numeric, 0);
    if v_cantidad is null or v_cantidad <= 0 then raise exception 'SALE_QUANTITY_INVALID'; end if;
 
    select id, empresa_id, nombre, precio_venta, stock_actual
      into v_producto
      from public.productos
      where id = (v_item->>'producto_id')::uuid
        and empresa_id = p_empresa_id
      for update;
 
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_producto.precio_venta is null then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual is null then raise exception 'PRODUCT_STOCK_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual < v_cantidad then raise exception 'INSUFFICIENT_STOCK: %', v_producto.nombre; end if;
 
    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_producto.precio_venta, round(v_producto.precio_venta * v_cantidad, 2));
 
    update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = v_producto.id and empresa_id = p_empresa_id;
 
    v_total := v_total + round(v_producto.precio_venta * v_cantidad, 2);
  end loop;
 
  update public.ventas_sigo set total = v_total where id = v_venta_id;
 
  insert into public.caja_movimientos_sigo (empresa_id, venta_id, tipo, medio_pago, importe, concepto, created_by)
  values (p_empresa_id, v_venta_id, 'ingreso', p_medio_pago, v_total, 'Venta SIGO', v_user_id);
 
  return v_venta_id;
exception
  when unique_violation then
    select id into v_venta_id
    from public.ventas_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_venta_id is not null then return v_venta_id; end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_venta_sigo_v2(p_empresa_id uuid, p_items jsonb, p_medio_pago text DEFAULT 'efectivo'::text, p_idempotency_key text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_existente_medio text;
  v_existente_cliente uuid;
  v_existente_fingerprint text;
  v_request_fingerprint text;
  v_request_fingerprint_legacy text;
  v_request_payload text;
  v_item jsonb;
  v_producto record;
  v_producto_id uuid;
  v_cliente record;
  v_cantidad numeric(14,3);
  v_total numeric(14,2) := 0;
  v_descuento_oferta numeric(5,2);
  v_precio_unitario numeric(14,2);
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','mercado_pago','cuenta_corriente','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if p_descuento_pct is null or p_descuento_pct < 0 or p_descuento_pct >= 100
     or p_descuento_pct::text in ('NaN','Infinity','-Infinity') then
    raise exception 'SALE_DISCOUNT_INVALID';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'SALE_TOO_MANY_ITEMS'; end if;
 
  -- Validacion de forma previa: permite construir una huella canonica sin depender del stock mutable.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'SALE_ITEM_INVALID'; end if;
    begin
      v_producto_id := nullif(trim(v_item->>'producto_id'), '')::uuid;
      v_cantidad := nullif(trim(v_item->>'cantidad'), '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'SALE_ITEM_INVALID';
    end;
    if v_producto_id is null then raise exception 'SALE_ITEM_INVALID'; end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity') then
      raise exception 'SALE_QUANTITY_INVALID';
    end if;
  end loop;
 
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'producto_id', n.producto_id::text,
        'cantidad', to_char(n.cantidad, 'FM999999999999990.000')
      ) order by n.producto_id
    )::text, '[]')
    || '|' || coalesce(p_medio_pago, '')
    || '|' || coalesce(p_cliente_id::text, '')
  into v_request_payload
  from (
    select
      (trim(j.value->>'producto_id'))::uuid as producto_id,
      sum((trim(j.value->>'cantidad'))::numeric)::numeric(14,3) as cantidad
    from jsonb_array_elements(p_items) j(value)
    group by (trim(j.value->>'producto_id'))::uuid
  ) n;
  v_request_fingerprint_legacy := md5(v_request_payload);
  v_request_fingerprint := md5(v_request_payload || '|discount=' || to_char(p_descuento_pct, 'FM990.00'));
 
  select id, medio_pago, cliente_id, request_fingerprint
    into v_venta_id, v_existente_medio, v_existente_cliente, v_existente_fingerprint
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;
 
  if v_venta_id is not null then
    if v_existente_medio is distinct from p_medio_pago
       or v_existente_cliente is distinct from p_cliente_id
       or not (
         v_existente_fingerprint = v_request_fingerprint
         or (p_descuento_pct = 0 and v_existente_fingerprint = v_request_fingerprint_legacy)
       ) then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_venta_id;
  end if;
 
  if p_cliente_id is not null then
    if not public.tiene_permiso_empresa(p_empresa_id, 'clients.read') then raise exception 'CLIENTS_READ_FORBIDDEN'; end if;
    select id, saldo_actual, limite_credito into v_cliente
    from public.clientes_sigo
    where id = p_cliente_id and empresa_id = p_empresa_id and activo = true
    for update;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  elsif p_medio_pago = 'cuenta_corriente' then
    raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT';
  end if;
 
  insert into public.ventas_sigo (empresa_id, cliente_id, total, medio_pago, idempotency_key, request_fingerprint, created_by)
  values (p_empresa_id, p_cliente_id, 0, p_medio_pago, v_key, v_request_fingerprint, v_user_id)
  returning id into v_venta_id;
 
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    v_cantidad := (trim(v_item->>'cantidad'))::numeric;
 
    select id, empresa_id, nombre, precio_venta, stock_actual
    into v_producto
    from public.productos
    where id = v_producto_id
      and empresa_id = p_empresa_id
      and activo = true
    for update;
 
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_producto.precio_venta is null then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual is null then raise exception 'PRODUCT_STOCK_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual < v_cantidad then raise exception 'INSUFFICIENT_STOCK: %', v_producto.nombre; end if;
 
    -- El descuento se determina en el servidor al confirmar, según el día en Argentina.
    -- El precio habitual del catálogo no se modifica.
    select descuento_porcentaje into v_descuento_oferta
    from public.ofertas_productos_sigo
    where empresa_id = p_empresa_id and producto_id = v_producto.id
      and fecha_inicio <= (now() at time zone 'America/Argentina/Cordoba')::date
      and fecha_fin >= (now() at time zone 'America/Argentina/Cordoba')::date
    limit 1 for share;
    v_precio_unitario := case when v_descuento_oferta is null then v_producto.precio_venta
      else round(v_producto.precio_venta * (1 - v_descuento_oferta / 100), 2) end;
    v_precio_unitario := round(v_precio_unitario * (1 - p_descuento_pct / 100), 2);
    if v_precio_unitario <= 0 then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
 
    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_precio_unitario, round(v_precio_unitario * v_cantidad, 2));
 
    update public.productos
    set stock_actual = stock_actual - v_cantidad
    where id = v_producto.id and empresa_id = p_empresa_id and activo = true;
 
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_total := v_total + round(v_precio_unitario * v_cantidad, 2);
  end loop;
 
  -- IMPORTANTE: no acceder a v_cliente salvo que sea una venta en cuenta corriente.
  -- PostgreSQL no puede resolver campos de un RECORD nunca asignado, aunque aparezcan
  -- a la derecha de un AND cuyo primer termino sea falso.
  if p_medio_pago = 'cuenta_corriente' then
    if v_cliente.limite_credito is not null
       and v_cliente.saldo_actual + v_total > v_cliente.limite_credito then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;
 
  update public.ventas_sigo
  set total = v_total, cliente_id = p_cliente_id
  where id = v_venta_id and empresa_id = p_empresa_id;
 
  if p_medio_pago = 'cuenta_corriente' then
    insert into public.cliente_movimientos_sigo (empresa_id, cliente_id, venta_id, tipo, importe, concepto, created_by)
    values (p_empresa_id, p_cliente_id, v_venta_id, 'debe', v_total, 'Venta SIGO', v_user_id);
 
    update public.clientes_sigo
    set saldo_actual = saldo_actual + v_total, updated_at = now()
    where id = p_cliente_id and empresa_id = p_empresa_id;
  else
    insert into public.caja_movimientos_sigo (empresa_id, venta_id, tipo, medio_pago, importe, concepto, created_by)
    values (p_empresa_id, v_venta_id, 'ingreso', p_medio_pago, v_total, 'Venta SIGO', v_user_id);
  end if;
 
  return v_venta_id;
exception
  when unique_violation then
    select id, medio_pago, cliente_id, request_fingerprint
      into v_venta_id, v_existente_medio, v_existente_cliente, v_existente_fingerprint
    from public.ventas_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;
 
    if v_venta_id is not null then
      if v_existente_medio is distinct from p_medio_pago
         or v_existente_cliente is distinct from p_cliente_id
         or not (
         v_existente_fingerprint = v_request_fingerprint
         or (p_descuento_pct = 0 and v_existente_fingerprint = v_request_fingerprint_legacy)
       ) then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_venta_id;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.es_miembro_empresa(p_empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_owner_empresa(p_empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and eu.rol = 'owner'
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_compra_documento_normalizado_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero text;
  v_tipo text;
  v_existente uuid;
begin
  if new.estado is distinct from 'confirmada' then
    return new;
  end if;
 
  v_numero := public.normalizar_identificador_comercial_sigo(new.numero_comprobante);
  if v_numero is null then
    return new;
  end if;
  v_tipo := coalesce(public.normalizar_identificador_comercial_sigo(new.tipo_comprobante), '');
 
  select c.id
    into v_existente
    from public.compras_sigo c
   where c.empresa_id = new.empresa_id
     and c.proveedor_id = new.proveedor_id
     and c.estado = 'confirmada'
     and coalesce(public.normalizar_identificador_comercial_sigo(c.tipo_comprobante), '') = v_tipo
     and public.normalizar_identificador_comercial_sigo(c.numero_comprobante) = v_numero
     and c.id is distinct from new.id
   order by c.created_at asc
   limit 1;
 
  if v_existente is not null then
    raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%', v_existente;
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_compra_ia_sigo(p_empresa_id uuid, p_idempotency_key text, p_compra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_anterior public.compra_ia_confirmaciones%rowtype;
  v_proveedor_id uuid;
  v_ids uuid[];
  v_nombre_proveedor text := nullif(btrim(p_compra->>'proveedor_nombre'), '');
  v_cuit text := nullif(regexp_replace(coalesce(p_compra->>'proveedor_cuit',''), '\D', '', 'g'), '');
  v_nombre text;
  v_codigo text;
  v_barras text;
  v_producto public.productos%rowtype;
  v_producto_id uuid;
  v_item jsonb;
  v_cantidad numeric;
  v_costo numeric;
  v_precio numeric;
  v_margen numeric;
  v_items jsonb := '[]'::jsonb;
  v_resumen jsonb := '[]'::jsonb;
  v_compra_id uuid;
  v_resultado jsonb;
  v_precios_existentes jsonb := '{}'::jsonb;
  v_precio_item record;
  v_numero text := nullif(btrim(p_compra->>'numero_comprobante'), '');
  v_tipo text := nullif(btrim(p_compra->>'tipo_comprobante'), '');
  v_fecha date;
  v_suma integer;
  v_digito integer;
  v_i integer;
  v_pesos integer[] := array[5,4,3,2,7,6,5,4,3,2];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'purchases.write'),false) then raise exception 'FORBIDDEN'; end if;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.write'),false) then raise exception 'STOCK_WRITE_REQUIRED'; end if;
  if v_key is null or length(v_key)>197 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if p_compra is null or jsonb_typeof(p_compra) is distinct from 'object' or jsonb_typeof(p_compra->'items') is distinct from 'array' then raise exception 'INVALID_ITEM'; end if;
  if jsonb_array_length(p_compra->'items') not between 1 and 300 then raise exception 'INVALID_ITEM'; end if;
  if octet_length(p_compra::text)>1000000 then raise exception 'INVALID_ITEM'; end if;
 
  -- Serialize only Compra IA saves in the same tenant, including code generation.
  perform pg_advisory_xact_lock(hashtextextended('compra-ia|'||p_empresa_id::text,0));
  select * into v_anterior from public.compra_ia_confirmaciones where empresa_id=p_empresa_id and idempotency_key=v_key;
  if found then
    if v_anterior.solicitud is distinct from p_compra then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    v_resultado:=v_anterior.resultado;
    if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.read'),false) then
      select jsonb_agg(j||jsonb_build_object('stock_antes',null)) into v_resumen from jsonb_array_elements(v_resultado->'items') j;
      v_resultado:=jsonb_set(v_resultado,'{items}',v_resumen);
    end if;
    return v_resultado;
  end if;
 
  if v_nombre_proveedor is null or length(v_nombre_proveedor)>300 then raise exception 'SUPPLIER_REQUIRED'; end if;
  if v_cuit is not null then
    if length(v_cuit)<>11 then raise exception 'SUPPLIER_CUIT_INVALID'; end if;
    v_suma:=0;
    for v_i in 1..10 loop v_suma:=v_suma+substring(v_cuit,v_i,1)::integer*v_pesos[v_i]; end loop;
    v_digito:=11-(v_suma%11);
    if v_digito=11 then v_digito:=0; elsif v_digito=10 then v_digito:=9; end if;
    if v_digito<>substring(v_cuit,11,1)::integer then raise exception 'SUPPLIER_CUIT_INVALID'; end if;
  end if;
  v_fecha:=coalesce(nullif(p_compra->>'fecha','')::date,current_date);
  if length(coalesce(v_numero,''))>200 or length(coalesce(v_tipo,''))>100 then raise exception 'INVALID_ITEM'; end if;
 
  select array_agg(id) into v_ids from public.proveedores_sigo
  where empresa_id=p_empresa_id and activo and v_cuit is not null and regexp_replace(coalesce(cuit,''),'\D','','g')=v_cuit;
  if coalesce(cardinality(v_ids),0)=0 then
    select array_agg(id) into v_ids from public.proveedores_sigo where empresa_id=p_empresa_id and activo
      and regexp_replace(translate(lower(razon_social),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')=regexp_replace(translate(lower(v_nombre_proveedor),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
      and (v_cuit is null or nullif(regexp_replace(coalesce(cuit,''),'\D','','g'),'') is null or regexp_replace(cuit,'\D','','g')=v_cuit);
  end if;
  if coalesce(cardinality(v_ids),0)>1 then raise exception 'SUPPLIER_AMBIGUOUS'; end if;
  v_proveedor_id:=v_ids[1];
  if v_proveedor_id is null then
    if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'suppliers.write'),false) then raise exception 'FORBIDDEN'; end if;
    insert into public.proveedores_sigo(empresa_id,razon_social,cuit) values(p_empresa_id,v_nombre_proveedor,v_cuit) returning id into v_proveedor_id;
  end if;
 
  -- Number is optional. An actual duplicate must never be forced through.
  if v_numero is not null and exists (
    select 1 from public.compras_sigo c where c.empresa_id=p_empresa_id and c.proveedor_id=v_proveedor_id and c.estado='confirmada'
    and regexp_replace(upper(c.numero_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_numero),'[^A-Z0-9]','','g')
    and (v_tipo is null or nullif(btrim(c.tipo_comprobante),'') is null or regexp_replace(upper(c.tipo_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_tipo),'[^A-Z0-9]','','g'))
  ) then raise exception 'PURCHASE_DOCUMENT_DUPLICATE'; end if;
 
  for v_item in select value from jsonb_array_elements(p_compra->'items') loop
    v_nombre:=nullif(btrim(v_item->>'nombre'),'');
    v_codigo:=nullif(btrim(v_item->>'codigo_interno'),'');
    v_barras:=nullif(btrim(v_item->>'codigo_barras'),'');
    v_cantidad:=round((v_item->>'cantidad')::numeric,3);
    v_costo:=round((v_item->>'costo_unitario')::numeric,4);
    if v_nombre is null or length(v_nombre)>500 or length(coalesce(v_codigo,''))>200 or length(coalesce(v_barras,''))>200
      or v_cantidad is null or v_cantidad<=0 or v_cantidad>1000000
      or v_costo is null or v_costo<=0 or v_costo>1000000000 then raise exception 'INVALID_ITEM'; end if;
    v_producto_id:=nullif(v_item->>'producto_id','')::uuid;
    if v_producto_id is not null then
      select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo for update;
      if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    else
      select array_agg(id) into v_ids from public.productos where empresa_id=p_empresa_id and activo and
        ((v_barras is not null and (codigo_barras=v_barras or codigo_interno=v_barras)) or (v_codigo is not null and (codigo_interno=v_codigo or codigo_barras=v_codigo)));
      if coalesce(cardinality(v_ids),0)=0 then
        select array_agg(id) into v_ids from public.productos where empresa_id=p_empresa_id and activo
        and btrim(regexp_replace(translate(lower(nombre),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'))=btrim(regexp_replace(translate(lower(v_nombre),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'));
      end if;
      if coalesce(cardinality(v_ids),0)>1 then raise exception 'PRODUCT_AMBIGUOUS'; end if;
      v_producto_id:=v_ids[1];
      if v_producto_id is not null then
        select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo for update;
        if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
      end if;
    end if;
 
    if v_producto_id is not null and nullif(v_item->>'precio_venta','') is not null then
      v_precio:=round((v_item->>'precio_venta')::numeric,2);
      if v_precio is null or v_precio<v_costo or v_precio>1000000000 then raise exception 'INVALID_ITEM'; end if;
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'sales.write'),false) then raise exception 'PRICE_PERMISSION_REQUIRED'; end if;
      if v_precios_existentes ? v_producto_id::text and (v_precios_existentes->>v_producto_id::text)::numeric <> v_precio then raise exception 'PRICE_CONFLICT'; end if;
      v_precios_existentes:=v_precios_existentes||jsonb_build_object(v_producto_id::text,v_precio);
    end if;
 
    if v_producto_id is null then
      v_precio:=round((v_item->>'precio_venta')::numeric,2);
      if v_precio is null or v_precio<v_costo or v_precio>1000000000 then raise exception 'INVALID_ITEM'; end if;
      v_margen:=(v_precio/v_costo-1)*100;
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) then raise exception 'FORBIDDEN'; end if;
      -- Registrar compras y crear productos autoriza el precio inicial de esta compra concreta.
      -- No amplía el acceso de lectura general a costos, márgenes ni listas de precios.
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'sales.write'),false) then raise exception 'PRICE_PERMISSION_REQUIRED'; end if;
      if v_codigo is null then
        loop
          v_codigo:='SIGO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
          exit when not exists(select 1 from public.productos where empresa_id=p_empresa_id and (codigo_interno=v_codigo or codigo_barras=v_codigo));
        end loop;
      end if;
      v_producto_id:=public.guardar_producto_sigo(p_empresa_id=>p_empresa_id,p_nombre=>v_nombre,p_codigo_interno=>v_codigo,p_codigo_barras=>v_barras,
        p_proveedor=>v_nombre_proveedor,p_costo_actual=>v_costo,p_costo_ultima_compra=>v_costo,p_precio_venta=>v_precio,p_margen_ganancia=>v_precio-v_costo,p_margen_porcentaje=>v_margen,p_stock_actual=>0);
      -- guardar_producto_sigo oculta costo/margen a usuarios sin permisos de lectura.
      -- Completar sólo el producto recién creado dentro de esta transacción autorizada.
      update public.productos set costo_actual=v_costo, costo_ultima_compra=v_costo,
        precio_venta=v_precio, margen_ganancia=v_precio-v_costo, margen_porcentaje=v_margen
      where id=v_producto_id and empresa_id=p_empresa_id;
      select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id for update;
      if v_producto.precio_venta is distinct from v_precio or v_producto.costo_actual is distinct from v_costo then raise exception 'PRICE_PERMISSION_REQUIRED'; end if;
    end if;
 
    -- Reuse existing identifiers: do not overwrite them with a supplier's code.
    if upper(coalesce(v_producto.codigo_interno,'')) like 'LEGACY-DUP-%' or upper(coalesce(v_producto.codigo_barras,'')) like 'LEGACY-DUP-%' then raise exception 'PRODUCT_LEGACY_PENDING'; end if;
    if v_producto.stock_actual is null or v_producto.costo_actual is null
      or v_producto.stock_actual::text in ('NaN','Infinity','-Infinity') or v_producto.costo_actual::text in ('NaN','Infinity','-Infinity') then raise exception 'PRODUCT_VALUES_INVALID'; end if;
    if exists(select 1 from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.id<>v_producto_id and
      ((nullif(btrim(v_producto.codigo_interno),'') is not null and regexp_replace(upper(p.codigo_interno),'[^A-Z0-9]','','g')=regexp_replace(upper(v_producto.codigo_interno),'[^A-Z0-9]','','g'))
      or (nullif(btrim(v_producto.codigo_barras),'') is not null and regexp_replace(upper(p.codigo_barras),'[^A-Z0-9]','','g')=regexp_replace(upper(v_producto.codigo_barras),'[^A-Z0-9]','','g')))) then raise exception 'PRODUCT_AMBIGUOUS'; end if;
    if nullif(btrim(v_producto.codigo_interno),'') is null then
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) then raise exception 'FORBIDDEN'; end if;
      loop
        v_codigo:='SIGO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
        exit when not exists(select 1 from public.productos where empresa_id=p_empresa_id and (codigo_interno=v_codigo or codigo_barras=v_codigo));
      end loop;
      update public.productos set codigo_interno=v_codigo where id=v_producto_id and empresa_id=p_empresa_id;
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('producto_id',v_producto_id,'cantidad',v_cantidad,'costo_unitario',v_costo));
    v_resumen:=v_resumen||jsonb_build_array(jsonb_build_object('producto_id',v_producto_id,'cantidad',v_cantidad,'costo_unitario',v_costo,'stock_antes',v_producto.stock_actual));
  end loop;
 
  -- Duplicate lines for the SAME resolved product are consolidated, not new products.
  select jsonb_agg(jsonb_build_object('producto_id',producto_id,'cantidad',cantidad,'costo_unitario',costo_unitario) order by producto_id),
         jsonb_agg(jsonb_build_object('producto_id',producto_id,'cantidad',cantidad,'costo_unitario',costo_unitario,'stock_antes',stock_antes) order by producto_id)
  into v_items,v_resumen from (
    select j->>'producto_id' producto_id,sum((j->>'cantidad')::numeric) cantidad,
      round(sum((j->>'cantidad')::numeric*(j->>'costo_unitario')::numeric)/sum((j->>'cantidad')::numeric),4) costo_unitario,
      min((j->>'stock_antes')::numeric) stock_antes
    from jsonb_array_elements(v_resumen) j group by j->>'producto_id'
  ) agrupadas;
  if exists(select 1 from jsonb_array_elements(v_items) j where (j->>'cantidad')::numeric>1000000) then raise exception 'INVALID_ITEM'; end if;
  v_compra_id:=public.confirmar_compra_sigo(p_empresa_id,v_proveedor_id,v_items,v_fecha,v_tipo,v_numero,'ia:'||v_key);
  update public.compras_sigo set origen='ia' where id=v_compra_id and empresa_id=p_empresa_id;
  -- Explicit customer prices override only products included in this confirmed purchase.
  for v_precio_item in select key, value from jsonb_each_text(v_precios_existentes) loop
    update public.productos p set precio_venta=v_precio_item.value::numeric,
      margen_ganancia=v_precio_item.value::numeric-p.costo_actual,
      margen_porcentaje=round((v_precio_item.value::numeric/p.costo_actual-1)*100,2)
    where p.id=v_precio_item.key::uuid and p.empresa_id=p_empresa_id and p.costo_actual>0;
  end loop;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.read'),false) then
    select jsonb_agg(j||jsonb_build_object('stock_antes',null)) into v_resumen from jsonb_array_elements(v_resumen) j;
  end if;
  v_resultado:=jsonb_build_object('compra_id',v_compra_id,'items',v_resumen);
  insert into public.compra_ia_confirmaciones(empresa_id,idempotency_key,solicitud,compra_id,resultado,created_by)
    values(p_empresa_id,v_key,p_compra,v_compra_id,v_resultado,auth.uid());
  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_producto_sigo(p_empresa_id uuid, p_producto_id uuid DEFAULT NULL::uuid, p_codigo_interno text DEFAULT NULL::text, p_codigo_barras text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_marca text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_costo_actual numeric DEFAULT NULL::numeric, p_costo_ultima_compra numeric DEFAULT NULL::numeric, p_precio_venta numeric DEFAULT NULL::numeric, p_margen_ganancia numeric DEFAULT NULL::numeric, p_margen_porcentaje numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT NULL::numeric, p_stock_minimo numeric DEFAULT NULL::numeric, p_stock_maximo numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_nombre text;
  v_puede_precio boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;
 
  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
 
  if p_costo_actual is not null and p_costo_actual < 0 then raise exception 'COSTO_ACTUAL_INVALID'; end if;
  if p_costo_ultima_compra is not null and p_costo_ultima_compra < 0 then raise exception 'COSTO_ULTIMA_COMPRA_INVALID'; end if;
  if p_precio_venta is not null and p_precio_venta < 0 then raise exception 'PRECIO_VENTA_INVALID'; end if;
  if p_margen_ganancia is not null and p_margen_ganancia < 0 then raise exception 'MARGEN_GANANCIA_INVALID'; end if;
  if p_margen_porcentaje is not null and p_margen_porcentaje < 0 then raise exception 'MARGEN_PORCENTAJE_INVALID'; end if;
  if p_stock_actual is not null and p_stock_actual < 0 then raise exception 'STOCK_ACTUAL_INVALID'; end if;
  if p_stock_minimo is not null and p_stock_minimo < 0 then raise exception 'STOCK_MINIMO_INVALID'; end if;
  if p_stock_maximo is not null and p_stock_maximo < 0 then raise exception 'STOCK_MAXIMO_INVALID'; end if;
  if p_stock_minimo is not null and p_stock_maximo is not null and p_stock_maximo < p_stock_minimo then raise exception 'STOCK_RANGE_INVALID'; end if;
  if p_stock_actual is not null and p_stock_maximo is not null and p_stock_actual > p_stock_maximo then raise exception 'STOCK_ABOVE_MAXIMUM'; end if;
 
  v_puede_precio := public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
    or public.tiene_permiso_empresa(p_empresa_id, 'sales.write');
 
  if p_producto_id is null then
    insert into public.productos (
      empresa_id, codigo_interno, codigo_barras, nombre, descripcion, categoria, marca, proveedor,
      costo_actual, costo_ultima_compra, precio_venta, margen_ganancia, margen_porcentaje,
      stock_actual, stock_minimo, stock_maximo
    ) values (
      p_empresa_id,
      nullif(btrim(p_codigo_interno), ''),
      nullif(btrim(p_codigo_barras), ''),
      v_nombre,
      nullif(btrim(p_descripcion), ''),
      nullif(btrim(p_categoria), ''),
      nullif(btrim(p_marca), ''),
      nullif(btrim(p_proveedor), ''),
      case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then coalesce(p_costo_actual, 0) else 0 end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then coalesce(p_costo_ultima_compra, 0) else 0 end,
      case when v_puede_precio then coalesce(p_precio_venta, 0) else 0 end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then coalesce(p_margen_ganancia, 0) else 0 end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then coalesce(p_margen_porcentaje, 0) else 0 end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then coalesce(p_stock_actual, 0) else 0 end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then coalesce(p_stock_minimo, 0) else 0 end,
      case
        when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then
          coalesce(p_stock_maximo, greatest(coalesce(p_stock_actual, 0), coalesce(p_stock_minimo, 0)))
        else 0
      end
    ) returning id into v_id;
  else
    update public.productos p
       set codigo_interno = nullif(btrim(p_codigo_interno), ''),
           codigo_barras = nullif(btrim(p_codigo_barras), ''),
           nombre = v_nombre,
           descripcion = nullif(btrim(p_descripcion), ''),
           categoria = nullif(btrim(p_categoria), ''),
           marca = nullif(btrim(p_marca), ''),
           proveedor = nullif(btrim(p_proveedor), ''),
           costo_actual = case
             when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') and p_costo_actual is not null then p_costo_actual
             else p.costo_actual
           end,
           costo_ultima_compra = case
             when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') and p_costo_ultima_compra is not null then p_costo_ultima_compra
             else p.costo_ultima_compra
           end,
           precio_venta = case when v_puede_precio and p_precio_venta is not null then p_precio_venta else p.precio_venta end,
           margen_ganancia = case
             when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') and p_margen_ganancia is not null then p_margen_ganancia
             else p.margen_ganancia
           end,
           margen_porcentaje = case
             when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') and p_margen_porcentaje is not null then p_margen_porcentaje
             else p.margen_porcentaje
           end,
           stock_actual = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') and p_stock_actual is not null then p_stock_actual
             else p.stock_actual
           end,
           stock_minimo = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') and p_stock_minimo is not null then p_stock_minimo
             else p.stock_minimo
           end,
           stock_maximo = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') and p_stock_maximo is not null then p_stock_maximo
             else p.stock_maximo
           end
     where p.id = p_producto_id and p.empresa_id = p_empresa_id
     returning p.id into v_id;
 
    if v_id is null then raise exception 'PRODUCT_NOT_FOUND_IN_TENANT'; end if;
  end if;
 
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.listar_productos_sigo(p_empresa_id uuid)
 RETURNS TABLE(id uuid, empresa_id uuid, codigo_interno text, codigo_barras text, nombre text, descripcion text, categoria text, marca text, proveedor text, costo_actual numeric, costo_ultima_compra numeric, precio_venta numeric, margen_ganancia numeric, margen_porcentaje numeric, stock_actual numeric, stock_minimo numeric, stock_maximo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
 
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read') then
    raise exception 'FORBIDDEN';
  end if;
 
  return query
  select
    p.id,
    p.empresa_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.descripcion,
    p.categoria,
    p.marca,
    p.proveedor,
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_ultima_compra else null end,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')
        then p.precio_venta
      else null
    end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_ganancia else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_porcentaje else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_minimo else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_maximo else null end
  from public.productos p
  where p.empresa_id = p_empresa_id
    and p.activo = true
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
  order by p.nombre asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.proteger_producto_inactivo_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.activo = true and new.activo = false and coalesce(old.stock_actual, 0) <> 0 then
    raise exception 'PRODUCT_HAS_STOCK';
  end if;
 
  if old.activo = false and (
    new.stock_actual is distinct from old.stock_actual
    or new.costo_actual is distinct from old.costo_actual
    or new.costo_ultima_compra is distinct from old.costo_ultima_compra
  ) then
    raise exception 'PRODUCT_INACTIVE';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_venta record;
  v_item jsonb;
  v_venta_item record;
  v_devolucion_id uuid;
  v_cantidad numeric(14,3);
  v_ya_devuelto numeric(14,3);
  v_disponible numeric(14,3);
  v_total numeric(14,2) := 0;
  v_lineas integer := 0;
  v_pendientes integer := 0;
  v_cliente_saldo numeric(14,2);
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if v_key is null or length(v_key) > 160 then raise exception 'RETURN_IDEMPOTENCY_KEY_INVALID'; end if;
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'RETURN_REASON_REQUIRED'; end if;
 
  select id into v_devolucion_id
  from public.devoluciones_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_devolucion_id is not null then return v_devolucion_id; end if;
 
  select id, numero, empresa_id, cliente_id, medio_pago, total, estado
    into v_venta
    from public.ventas_sigo
   where id = p_venta_id and empresa_id = p_empresa_id
   for update;
 
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  if v_venta.estado = 'anulada' then raise exception 'SALE_ALREADY_VOIDED'; end if;
  if v_venta.estado <> 'confirmada' then raise exception 'SALE_NOT_RETURNABLE'; end if;
 
  if not p_anular_total then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'RETURN_ITEMS_REQUIRED';
    end if;
  end if;
 
  insert into public.devoluciones_sigo
    (empresa_id, venta_id, tipo, total, motivo, idempotency_key, created_by)
  values
    (p_empresa_id, p_venta_id, 'parcial', 0, v_motivo, v_key, v_user_id)
  returning id into v_devolucion_id;
 
  if p_anular_total then
    for v_venta_item in
      select vi.id, vi.producto_id, vi.cantidad, vi.precio_unitario
        from public.venta_items_sigo vi
       where vi.empresa_id = p_empresa_id and vi.venta_id = p_venta_id
       order by vi.id
       for update
    loop
      select coalesce(sum(di.cantidad), 0)
        into v_ya_devuelto
        from public.devolucion_items_sigo di
        join public.devoluciones_sigo d on d.id = di.devolucion_id
       where d.empresa_id = p_empresa_id
         and d.venta_id = p_venta_id
         and di.venta_item_id = v_venta_item.id
         and d.id <> v_devolucion_id;
 
      v_disponible := v_venta_item.cantidad - v_ya_devuelto;
      if v_disponible <= 0 then continue; end if;
 
      insert into public.devolucion_items_sigo
        (devolucion_id, empresa_id, venta_item_id, producto_id, cantidad, precio_unitario, subtotal)
      values
        (v_devolucion_id, p_empresa_id, v_venta_item.id, v_venta_item.producto_id,
         v_disponible, v_venta_item.precio_unitario, round(v_disponible * v_venta_item.precio_unitario, 2));
 
      update public.productos
         set stock_actual = coalesce(stock_actual, 0) + v_disponible
       where id = v_venta_item.producto_id and empresa_id = p_empresa_id;
 
      v_total := v_total + round(v_disponible * v_venta_item.precio_unitario, 2);
      v_lineas := v_lineas + 1;
    end loop;
  else
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      if nullif(btrim(coalesce(v_item->>'venta_item_id', '')), '') is null then
        raise exception 'RETURN_ITEM_INVALID';
      end if;
      begin
        v_cantidad := (v_item->>'cantidad')::numeric;
      exception when others then
        raise exception 'RETURN_QUANTITY_INVALID';
      end;
      if v_cantidad is null or v_cantidad <= 0 then raise exception 'RETURN_QUANTITY_INVALID'; end if;
 
      select vi.id, vi.producto_id, vi.cantidad, vi.precio_unitario
        into v_venta_item
        from public.venta_items_sigo vi
       where vi.id = (v_item->>'venta_item_id')::uuid
         and vi.empresa_id = p_empresa_id
         and vi.venta_id = p_venta_id
       for update;
      if not found then raise exception 'RETURN_ITEM_NOT_FOUND'; end if;
 
      select coalesce(sum(di.cantidad), 0)
        into v_ya_devuelto
        from public.devolucion_items_sigo di
        join public.devoluciones_sigo d on d.id = di.devolucion_id
       where d.empresa_id = p_empresa_id
         and d.venta_id = p_venta_id
         and di.venta_item_id = v_venta_item.id
         and d.id <> v_devolucion_id;
 
      v_disponible := v_venta_item.cantidad - v_ya_devuelto;
      if v_cantidad > v_disponible then raise exception 'RETURN_QUANTITY_EXCEEDS_AVAILABLE'; end if;
 
      insert into public.devolucion_items_sigo
        (devolucion_id, empresa_id, venta_item_id, producto_id, cantidad, precio_unitario, subtotal)
      values
        (v_devolucion_id, p_empresa_id, v_venta_item.id, v_venta_item.producto_id,
         v_cantidad, v_venta_item.precio_unitario, round(v_cantidad * v_venta_item.precio_unitario, 2));
 
      update public.productos
         set stock_actual = coalesce(stock_actual, 0) + v_cantidad
       where id = v_venta_item.producto_id and empresa_id = p_empresa_id;
 
      v_total := v_total + round(v_cantidad * v_venta_item.precio_unitario, 2);
      v_lineas := v_lineas + 1;
    end loop;
  end if;
 
  if v_lineas = 0 or v_total <= 0 then raise exception 'NOTHING_TO_RETURN'; end if;
 
  -- Determinar si, sumando esta devolución, ya no queda cantidad pendiente de devolver.
  select count(*)
    into v_pendientes
    from public.venta_items_sigo vi
   where vi.empresa_id = p_empresa_id
     and vi.venta_id = p_venta_id
     and vi.cantidad > (
       select coalesce(sum(di.cantidad), 0)
         from public.devolucion_items_sigo di
         join public.devoluciones_sigo d on d.id = di.devolucion_id
        where d.empresa_id = p_empresa_id
          and d.venta_id = p_venta_id
          and di.venta_item_id = vi.id
     );
 
  update public.devoluciones_sigo
     set total = v_total,
         tipo = case when v_pendientes = 0 then 'total' else 'parcial' end
   where id = v_devolucion_id;
 
  if v_venta.medio_pago = 'cuenta_corriente' then
    if v_venta.cliente_id is null then raise exception 'RETURN_CLIENT_REQUIRED'; end if;
 
    select saldo_actual into v_cliente_saldo
      from public.clientes_sigo
     where id = v_venta.cliente_id and empresa_id = p_empresa_id
     for update;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
    if v_cliente_saldo < v_total then raise exception 'ACCOUNT_RETURN_REQUIRES_MANUAL_REVIEW'; end if;
 
    insert into public.cliente_movimientos_sigo
      (empresa_id, cliente_id, venta_id, devolucion_id, tipo, importe, concepto, created_by)
    values
      (p_empresa_id, v_venta.cliente_id, p_venta_id, v_devolucion_id, 'haber', v_total,
       'Devolución venta SIGO', v_user_id);
 
    update public.clientes_sigo
       set saldo_actual = saldo_actual - v_total, updated_at = now()
     where id = v_venta.cliente_id and empresa_id = p_empresa_id;
  else
    insert into public.caja_movimientos_sigo
      (empresa_id, venta_id, devolucion_id, tipo, medio_pago, importe, concepto, created_by)
    values
      (p_empresa_id, p_venta_id, v_devolucion_id, 'egreso', v_venta.medio_pago, v_total,
       'Devolución venta SIGO', v_user_id);
  end if;
 
  if v_pendientes = 0 then
    update public.ventas_sigo
       set estado = 'anulada', anulada_at = now(), anulada_by = v_user_id, motivo_anulacion = v_motivo
     where id = p_venta_id and empresa_id = p_empresa_id and estado = 'confirmada';
  end if;
 
  return v_devolucion_id;
exception
  when unique_violation then
    select id into v_devolucion_id
      from public.devoluciones_sigo
     where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_devolucion_id is not null then return v_devolucion_id; end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_compra_items_max_300_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_items integer;
begin
  select count(*)
    into v_items
    from public.compra_items_sigo ci
   where ci.compra_id = new.compra_id;
 
  if v_items >= 300 then
    raise exception 'TOO_MANY_ITEMS';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_empresa_es_accesible(p_empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_empresa_id is not null
     and public.es_miembro_empresa(p_empresa_id);
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_compra_cabecera_integridad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_cuit text;
begin
  select p.cuit
    into v_cuit
    from public.proveedores_sigo p
   where p.id = new.proveedor_id
     and p.empresa_id = new.empresa_id
     and p.activo = true;
 
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;
 
  if nullif(btrim(coalesce(v_cuit, '')), '') is not null
     and not public.sigo_cuit_argentino_valido(v_cuit) then
    raise exception 'SUPPLIER_CUIT_INVALID';
  end if;
 
  if new.subtotal is null or new.total is null or new.subtotal < 0 or new.total < 0 then
    raise exception 'PURCHASE_TOTAL_INVALID';
  end if;
 
  -- El modelo actual no aplica impuestos/descuentos separados: cabecera y detalle deben cerrar.
  if abs(new.total - new.subtotal) > 0.01 then
    raise exception 'PURCHASE_HEADER_TOTAL_MISMATCH';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_compra_documento_canonico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_numero text;
  v_lock text;
  v_existente uuid;
begin
  if new.estado is distinct from 'confirmada' then
    return new;
  end if;
 
  v_numero := public.sigo_normalizar_documento_compra(new.numero_comprobante);
  if v_numero = '' then
    return new;
  end if;
  v_tipo := public.sigo_normalizar_documento_compra(new.tipo_comprobante);
  v_lock := new.empresa_id::text || '|' || new.proveedor_id::text || '|' || v_tipo || '|' || v_numero;
 
  -- Serializa cargas concurrentes del mismo documento aun si vienen por IA/manual con formato distinto.
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));
 
  select c.id
    into v_existente
    from public.compras_sigo c
   where c.empresa_id = new.empresa_id
     and c.proveedor_id = new.proveedor_id
     and c.estado = 'confirmada'
     and (new.id is null or c.id <> new.id)
     and public.sigo_normalizar_documento_compra(c.tipo_comprobante) = v_tipo
     and public.sigo_normalizar_documento_compra(c.numero_comprobante) = v_numero
   order by c.created_at asc
   limit 1;
 
  if v_existente is not null then
    raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%', v_existente;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_compra_item_integridad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_producto public.productos%rowtype;
  v_estado_compra text;
begin
  if new.cantidad is null or new.cantidad <= 0 or new.costo_unitario is null or new.costo_unitario < 0 then
    raise exception 'PURCHASE_ITEM_INVALID';
  end if;
  if new.subtotal is null or abs(new.subtotal - round(new.cantidad * new.costo_unitario, 2)) > 0.01 then
    raise exception 'PURCHASE_ITEM_SUBTOTAL_MISMATCH';
  end if;
 
  select c.estado
    into v_estado_compra
    from public.compras_sigo c
   where c.id = new.compra_id
     and c.empresa_id = new.empresa_id;
  if not found or v_estado_compra <> 'confirmada' then
    raise exception 'PURCHASE_HEADER_NOT_CONFIRMED';
  end if;
 
  select *
    into v_producto
    from public.productos p
   where p.id = new.producto_id
     and p.empresa_id = new.empresa_id
     and p.activo = true;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
 
  if upper(btrim(coalesce(v_producto.categoria, ''))) = 'NO_VENDIBLE' then
    raise exception 'PRODUCT_NOT_SELLABLE';
  end if;
  if upper(btrim(coalesce(v_producto.codigo_interno, ''))) like 'LEGACY-DUP-%'
     or upper(btrim(coalesce(v_producto.codigo_barras, ''))) like 'LEGACY-DUP-%' then
    raise exception 'PRODUCT_IDENTITY_PENDING';
  end if;
  if v_producto.stock_actual is null or v_producto.costo_actual is null then
    raise exception 'PRODUCT_OPERATIONAL_VALUES_REQUIRED';
  end if;
 
  if exists (
    select 1
      from public.compra_items_sigo ci
     where ci.compra_id = new.compra_id
       and ci.producto_id = new.producto_id
       and ci.id is distinct from new.id
  ) then
    raise exception 'DUPLICATE_PRODUCT_ITEM';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_compra_item_limites()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.cantidad is null or new.cantidad <= 0 or new.cantidad::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_QUANTITY_INVALID';
  end if;
  if new.cantidad > 1000000 then
    raise exception 'PURCHASE_QUANTITY_LIMIT';
  end if;
  if new.costo_unitario is null or new.costo_unitario < 0 or new.costo_unitario::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_COST_INVALID';
  end if;
  if new.costo_unitario > 1000000000000 then
    raise exception 'PURCHASE_COST_LIMIT';
  end if;
  if new.subtotal is null or new.subtotal < 0 or new.subtotal::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_SUBTOTAL_INVALID';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_normalizar_documento_compra(p_valor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select regexp_replace(lower(coalesce(trim(p_valor), '')), '[^[:alnum:]]+', '', 'g');
$function$;

CREATE OR REPLACE FUNCTION public.sigo_validar_empresa_operativa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.empresa_id is null then
    raise exception 'SIGO: empresa_id es obligatorio para nuevas operaciones';
  end if;
 
  if not public.es_miembro_empresa(new.empresa_id) then
    raise exception 'SIGO: usuario sin acceso a la empresa indicada';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_validar_producto_movimiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_producto record;
begin
  select id, empresa_id, activo, codigo_interno, categoria, stock_actual, costo_actual, precio_venta
    into v_producto
  from public.productos
  where id = new.producto_id
    and empresa_id = new.empresa_id;
 
  if not found or v_producto.activo is distinct from true then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
 
  if upper(trim(coalesce(v_producto.categoria, ''))) = 'NO_VENDIBLE' then
    raise exception 'PRODUCT_NOT_SELLABLE';
  end if;
 
  if upper(trim(coalesce(v_producto.codigo_interno, ''))) like 'LEGACY-DUP-%' then
    raise exception 'PRODUCT_IDENTITY_REVIEW_REQUIRED';
  end if;
 
  if v_producto.stock_actual is null then
    raise exception 'PRODUCT_STOCK_REQUIRED';
  end if;
 
  if v_producto.costo_actual is null then
    raise exception 'PRODUCT_COST_REQUIRED';
  end if;
 
  if tg_table_name = 'venta_items_sigo'
     and (v_producto.precio_venta is null or v_producto.precio_venta <= 0) then
    raise exception 'PRODUCT_PRICE_REQUIRED';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tiene_permiso_empresa(p_empresa_id uuid, p_permiso text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and public.permiso_sigo_valido(p_permiso)
      and not (p_permiso = any(coalesce(eu.permisos_denegados, '{}'::text[])))
      and (
        p_permiso = any(coalesce(eu.permisos_extra, '{}'::text[]))
        or case eu.rol
          when 'owner' then p_permiso = any(array[
            'companies.manage','users.manage',
            'products.read','products.write',
            'stock.read','stock.write',
            'sales.read','sales.write',
            'purchases.read','purchases.write',
            'clients.read','clients.write',
            'suppliers.read','suppliers.write',
            'reports.read',
            'costs.read','margins.read','price_lists.read',
            'arca.configure','invoices.issue',
            'client_portal.read'
          ]::text[])
          when 'admin' then p_permiso = any(array[
            'users.manage',
            'products.read','products.write',
            'stock.read','stock.write',
            'sales.read','sales.write',
            'purchases.read','purchases.write',
            'clients.read','clients.write',
            'suppliers.read','suppliers.write',
            'reports.read','invoices.issue'
          ]::text[])
          when 'seller' then p_permiso = any(array[
            'products.read','stock.read',
            'sales.read','sales.write',
            'clients.read','invoices.issue'
          ]::text[])
          when 'warehouse' then p_permiso = any(array[
            'products.read','stock.read','stock.write'
          ]::text[])
          when 'client' then p_permiso = 'client_portal.read'
          else false
        end
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.validar_precio_venta_item_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.precio_unitario is null or new.precio_unitario <= 0 then
    raise exception 'PRODUCT_PRICE_REQUIRED';
  end if;
  if new.subtotal is null or new.subtotal <= 0 then
    raise exception 'SALE_SUBTOTAL_INVALID';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_margen_producto()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin

  if new.precio_venta > 0 then

    new.margen_ganancia :=
      new.precio_venta - new.costo_actual;
 
    new.margen_porcentaje :=
      ((new.precio_venta - new.costo_actual)
      / new.precio_venta) * 100;
 
  else

    new.margen_ganancia := 0;
    new.margen_porcentaje := 0;
 
  end if;
 
  new.updated_at := now();
 
  return new;
 
end;
$function$;

CREATE OR REPLACE FUNCTION public.permisos_sigo_validos(p_permisos text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(bool_and(public.permiso_sigo_valido(p)), true)
  from unnest(coalesce(p_permisos, '{}'::text[])) as p;
$function$;

CREATE OR REPLACE FUNCTION public.sigo_productos_costos_no_nulos_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.costo_actual := coalesce(new.costo_actual, 0);
  new.costo_ultima_compra := coalesce(new.costo_ultima_compra, 0);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_portal_cliente_membresia_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.rol <> 'client' or new.activo is not true then
    update public.portal_cliente_usuarios
       set activo = false
     where empresa_id = new.empresa_id
       and user_id = new.user_id
       and activo = true;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_codigo_producto_unico_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo_barras text := nullif(btrim(coalesce(new.codigo_barras, '')), '');
  v_codigo_interno text := nullif(btrim(coalesce(new.codigo_interno, '')), '');
begin
  if new.empresa_id is null then
    raise exception 'EMPRESA_REQUIRED';
  end if;
 
  -- Guardamos los códigos normalizados en bordes para que pistola/manual/cámara
  -- consulten exactamente la misma identidad comercial.
  new.codigo_barras := v_codigo_barras;
  new.codigo_interno := v_codigo_interno;
 
  if v_codigo_barras is not null and exists (
    select 1
    from public.productos p
    where p.empresa_id = new.empresa_id
      and p.id <> coalesce(new.id, gen_random_uuid())
      and nullif(btrim(coalesce(p.codigo_barras, '')), '') = v_codigo_barras
  ) then
    raise exception 'BARCODE_DUPLICATE_IN_COMPANY';
  end if;
 
  if v_codigo_interno is not null and exists (
    select 1
    from public.productos p
    where p.empresa_id = new.empresa_id
      and p.id <> coalesce(new.id, gen_random_uuid())
      and nullif(btrim(coalesce(p.codigo_interno, '')), '') = v_codigo_interno
  ) then
    raise exception 'INTERNAL_CODE_DUPLICATE_IN_COMPANY';
  end if;
 
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.es_superadmin_sigo()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.sigo_superadmins sa
    where sa.user_id = auth.uid()
      and sa.activo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.normalizar_identificador_comercial_sigo(p_valor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select nullif(regexp_replace(lower(trim(coalesce(p_valor, ''))), '[^a-z0-9]+', '', 'g'), '');
$function$;

CREATE OR REPLACE FUNCTION public.permiso_sigo_valido(p_permiso text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_permiso = any (array[
    'companies.manage',
    'users.manage',
    'products.read',
    'products.write',
    'stock.read',
    'stock.write',
    'sales.read',
    'sales.write',
    'purchases.read',
    'purchases.write',
    'clients.read',
    'clients.write',
    'suppliers.read',
    'suppliers.write',
    'reports.read',
    'costs.read',
    'margins.read',
    'price_lists.read',
    'arca.configure',
    'invoices.issue',
    'client_portal.read'
  ]::text[]);
$function$;

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_importe_check" CHECK (importe >= 0::numeric);

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_tipo_check" CHECK (tipo = ANY (ARRAY['ingreso'::text, 'egreso'::text]));

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_importe_check" CHECK (importe > 0::numeric);

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_tipo_check" CHECK (tipo = ANY (ARRAY['debe'::text, 'haber'::text]));

ALTER TABLE public."compra_cambios_sigo" ADD CONSTRAINT "compra_cambios_sigo_accion_check" CHECK (accion = ANY (ARRAY['modificar'::text, 'anular'::text]));

ALTER TABLE public."compra_cambios_sigo" ADD CONSTRAINT "compra_cambios_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."compra_ia_confirmaciones" ADD CONSTRAINT "compra_ia_confirmaciones_idempotency_key_check" CHECK (length(idempotency_key) >= 1 AND length(idempotency_key) <= 200);

ALTER TABLE public."compra_ia_confirmaciones" ADD CONSTRAINT "compra_ia_confirmaciones_pkey" PRIMARY KEY (empresa_id, idempotency_key);

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_cantidad_check" CHECK (cantidad > 0::numeric);

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_costo_unitario_check" CHECK (costo_unitario >= 0::numeric);

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_subtotal_check" CHECK (subtotal >= 0::numeric);

ALTER TABLE public."compras" ADD CONSTRAINT "compras_pkey" PRIMARY KEY (id);

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_estado_check" CHECK (estado = ANY (ARRAY['confirmada'::text, 'anulada'::text]));

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_subtotal_check" CHECK (subtotal >= 0::numeric);

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_total_check" CHECK (total >= 0::numeric);

ALTER TABLE public."detalle_compras" ADD CONSTRAINT "detalle_compras_pkey" PRIMARY KEY (id);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_cantidad_check" CHECK (cantidad > 0::numeric);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_devolucion_id_venta_item_id_key" UNIQUE (devolucion_id, venta_item_id);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_precio_unitario_check" CHECK (precio_unitario >= 0::numeric);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_subtotal_check" CHECK (subtotal >= 0::numeric);

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_empresa_id_idempotency_key_key" UNIQUE (empresa_id, idempotency_key);

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_tipo_check" CHECK (tipo = ANY (ARRAY['parcial'::text, 'total'::text]));

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_total_check" CHECK (total >= 0::numeric);

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_empresa_id_user_id_key" UNIQUE (empresa_id, user_id);

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_permisos_denegados_validos" CHECK (permisos_sigo_validos(permisos_denegados)) NOT VALID;

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_permisos_extra_validos" CHECK (permisos_sigo_validos(permisos_extra)) NOT VALID;

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_permisos_sin_conflictos" CHECK (NOT permisos_extra && permisos_denegados) NOT VALID;

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_pkey" PRIMARY KEY (id);

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_rol_check" CHECK (rol = ANY (ARRAY['owner'::text, 'admin'::text, 'seller'::text, 'warehouse'::text, 'client'::text]));

ALTER TABLE public."movimientos_stock" ADD CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY (id);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_iva_alicuota_id_rango" CHECK (iva_alicuota_id IS NULL OR iva_alicuota_id >= 1 AND iva_alicuota_id <= 99);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_iva_tasa_rango" CHECK (iva_tasa IS NULL OR iva_tasa >= 0::numeric AND iva_tasa <= 100::numeric);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_pkey" PRIMARY KEY (id);

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_cantidad_check" CHECK (cantidad > 0::numeric);

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_precio_unitario_check" CHECK (precio_unitario >= 0::numeric);

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_subtotal_check" CHECK (subtotal >= 0::numeric);

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_empresa_id_idempotency_key_key" UNIQUE (empresa_id, idempotency_key);

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_estado_check" CHECK (estado = ANY (ARRAY['confirmada'::text, 'anulada'::text]));

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_medio_pago_check" CHECK (medio_pago = ANY (ARRAY['efectivo'::text, 'debito'::text, 'credito'::text, 'transferencia'::text, 'mercado_pago'::text, 'cuenta_corriente'::text, 'otro'::text]));

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_total_check" CHECK (total >= 0::numeric);

ALTER TABLE public."categorias" ADD CONSTRAINT "categorias_nombre_key" UNIQUE (nombre);

ALTER TABLE public."categorias" ADD CONSTRAINT "categorias_pkey" PRIMARY KEY (id);

ALTER TABLE public."clientes_sigo" ADD CONSTRAINT "clientes_sigo_arca_doc_tipo_rango" CHECK (arca_doc_tipo IS NULL OR arca_doc_tipo >= 1 AND arca_doc_tipo <= 999);

ALTER TABLE public."clientes_sigo" ADD CONSTRAINT "clientes_sigo_condicion_iva_receptor_rango" CHECK (condicion_iva_receptor_id IS NULL OR condicion_iva_receptor_id >= 1 AND condicion_iva_receptor_id <= 99);

ALTER TABLE public."clientes_sigo" ADD CONSTRAINT "clientes_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."empresas" ADD CONSTRAINT "empresas_pkey" PRIMARY KEY (id);

ALTER TABLE public."marcas" ADD CONSTRAINT "marcas_nombre_key" UNIQUE (nombre);

ALTER TABLE public."marcas" ADD CONSTRAINT "marcas_pkey" PRIMARY KEY (id);

ALTER TABLE public."proveedores" ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY (id);

ALTER TABLE public."proveedores_sigo" ADD CONSTRAINT "proveedores_sigo_pkey" PRIMARY KEY (id);

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_devolucion_id_fkey" FOREIGN KEY (devolucion_id) REFERENCES devoluciones_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."caja_movimientos_sigo" ADD CONSTRAINT "caja_movimientos_sigo_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_devolucion_id_fkey" FOREIGN KEY (devolucion_id) REFERENCES devoluciones_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."cliente_movimientos_sigo" ADD CONSTRAINT "cliente_movimientos_sigo_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."compra_cambios_sigo" ADD CONSTRAINT "compra_cambios_sigo_cambiado_por_fkey" FOREIGN KEY (cambiado_por) REFERENCES auth.users(id);

ALTER TABLE public."compra_cambios_sigo" ADD CONSTRAINT "compra_cambios_sigo_compra_id_fkey" FOREIGN KEY (compra_id) REFERENCES compras_sigo(id);

ALTER TABLE public."compra_cambios_sigo" ADD CONSTRAINT "compra_cambios_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id);

ALTER TABLE public."compra_ia_confirmaciones" ADD CONSTRAINT "compra_ia_confirmaciones_compra_id_fkey" FOREIGN KEY (compra_id) REFERENCES compras_sigo(id);

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_compra_id_fkey" FOREIGN KEY (compra_id) REFERENCES compras_sigo(id) ON DELETE CASCADE;

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."compra_items_sigo" ADD CONSTRAINT "compra_items_sigo_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT;

ALTER TABLE public."compras" ADD CONSTRAINT "compras_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."compras" ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."compras_sigo" ADD CONSTRAINT "compras_sigo_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."detalle_compras" ADD CONSTRAINT "detalle_compras_compra_id_fkey" FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE;

ALTER TABLE public."detalle_compras" ADD CONSTRAINT "detalle_compras_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_devolucion_id_fkey" FOREIGN KEY (devolucion_id) REFERENCES devoluciones_sigo(id) ON DELETE CASCADE;

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT;

ALTER TABLE public."devolucion_items_sigo" ADD CONSTRAINT "devolucion_items_sigo_venta_item_id_fkey" FOREIGN KEY (venta_item_id) REFERENCES venta_items_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."devoluciones_sigo" ADD CONSTRAINT "devoluciones_sigo_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;

ALTER TABLE public."empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."movimientos_stock" ADD CONSTRAINT "movimientos_stock_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY (categoria_id) REFERENCES categorias(id);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."productos" ADD CONSTRAINT "productos_marca_id_fkey" FOREIGN KEY (marca_id) REFERENCES marcas(id);

ALTER TABLE public."productos" ADD CONSTRAINT "productos_proveedor_principal_id_fkey" FOREIGN KEY (proveedor_principal_id) REFERENCES proveedores(id);

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT;

ALTER TABLE public."venta_items_sigo" ADD CONSTRAINT "venta_items_sigo_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_sigo(id) ON DELETE CASCADE;

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_anulada_by_fkey" FOREIGN KEY (anulada_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes_sigo(id) ON DELETE RESTRICT;

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."ventas_sigo" ADD CONSTRAINT "ventas_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."clientes_sigo" ADD CONSTRAINT "clientes_sigo_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."clientes_sigo" ADD CONSTRAINT "clientes_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."empresas" ADD CONSTRAINT "empresas_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."proveedores" ADD CONSTRAINT "proveedores_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT;

ALTER TABLE public."proveedores_sigo" ADD CONSTRAINT "proveedores_sigo_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX alias_productos_pkey ON public.alias_productos USING btree (id);

CREATE UNIQUE INDEX alias_productos_producto_id_texto_alias_key ON public.alias_productos USING btree (producto_id, texto_alias);

CREATE INDEX idx_alias_productos_texto ON public.alias_productos USING btree (texto_alias);

CREATE UNIQUE INDEX arca_puntos_venta_empresa_id_ambiente_numero_key ON public.arca_puntos_venta USING btree (empresa_id, ambiente, numero);

CREATE INDEX arca_puntos_venta_empresa_idx ON public.arca_puntos_venta USING btree (empresa_id, ambiente, activo);

CREATE UNIQUE INDEX arca_puntos_venta_pkey ON public.arca_puntos_venta USING btree (id);

CREATE INDEX cliente_movimientos_empresa_cliente_fecha_idx ON public.cliente_movimientos_sigo USING btree (empresa_id, cliente_id, created_at DESC);

CREATE UNIQUE INDEX clientes_sigo_empresa_documento_uidx ON public.clientes_sigo USING btree (empresa_id, documento) WHERE ((documento IS NOT NULL) AND (btrim(documento) <> ''::text));

CREATE INDEX clientes_sigo_empresa_nombre_idx ON public.clientes_sigo USING btree (empresa_id, nombre);

CREATE INDEX compra_borradores_empresa_fecha_idx ON public.compra_borradores_sigo USING btree (empresa_id, created_at DESC);

CREATE UNIQUE INDEX compra_borradores_sigo_pkey ON public.compra_borradores_sigo USING btree (id);

CREATE INDEX compra_items_sigo_compra_idx ON public.compra_items_sigo USING btree (compra_id);

CREATE INDEX compra_items_sigo_empresa_idx ON public.compra_items_sigo USING btree (empresa_id);

CREATE INDEX compras_empresa_id_idx ON public.compras USING btree (empresa_id);

CREATE INDEX idx_compras_fecha ON public.compras USING btree (fecha_compra);

CREATE INDEX idx_compras_proveedor ON public.compras USING btree (proveedor_id);

CREATE INDEX compras_sigo_empresa_fecha_idx ON public.compras_sigo USING btree (empresa_id, fecha_compra DESC);

CREATE UNIQUE INDEX compras_sigo_idempotency_uidx ON public.compras_sigo USING btree (empresa_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX idx_detalle_compras_compra ON public.detalle_compras USING btree (compra_id);

CREATE INDEX idx_detalle_compras_producto ON public.detalle_compras USING btree (producto_id);

CREATE INDEX devolucion_items_sigo_venta_item_idx ON public.devolucion_items_sigo USING btree (venta_item_id);

CREATE INDEX devoluciones_sigo_empresa_fecha_idx ON public.devoluciones_sigo USING btree (empresa_id, created_at DESC);

CREATE INDEX devoluciones_sigo_venta_idx ON public.devoluciones_sigo USING btree (venta_id, created_at DESC);

CREATE UNIQUE INDEX documentos_compra_pkey ON public.documentos_compra USING btree (id);

CREATE INDEX empresa_usuarios_empresa_id_idx ON public.empresa_usuarios USING btree (empresa_id);

CREATE INDEX empresa_usuarios_user_id_idx ON public.empresa_usuarios USING btree (user_id);

CREATE INDEX idx_movimientos_stock_fecha ON public.movimientos_stock USING btree (created_at);

CREATE INDEX idx_movimientos_stock_producto ON public.movimientos_stock USING btree (producto_id);

CREATE INDEX ofertas_productos_empresa_producto_fecha_idx ON public.ofertas_productos_sigo USING btree (empresa_id, producto_id, fecha_inicio, fecha_fin);

CREATE UNIQUE INDEX ofertas_productos_sigo_pkey ON public.ofertas_productos_sigo USING btree (id);

CREATE UNIQUE INDEX portal_cliente_usuarios_empresa_id_cliente_id_user_id_key ON public.portal_cliente_usuarios USING btree (empresa_id, cliente_id, user_id);

CREATE UNIQUE INDEX portal_cliente_usuarios_pkey ON public.portal_cliente_usuarios USING btree (id);

CREATE INDEX portal_cliente_usuarios_user_idx ON public.portal_cliente_usuarios USING btree (user_id, empresa_id, cliente_id) WHERE (activo = true);

CREATE UNIQUE INDEX portal_stock_publicado_empresa_id_cliente_id_producto_id_key ON public.portal_stock_publicado USING btree (empresa_id, cliente_id, producto_id);

CREATE INDEX portal_stock_publicado_lookup_idx ON public.portal_stock_publicado USING btree (empresa_id, cliente_id, producto_id) WHERE (publicado = true);

CREATE UNIQUE INDEX portal_stock_publicado_pkey ON public.portal_stock_publicado USING btree (id);

CREATE UNIQUE INDEX producto_codigos_alias_sigo_empresa_id_codigo_key ON public.producto_codigos_alias_sigo USING btree (empresa_id, codigo);

CREATE UNIQUE INDEX producto_codigos_alias_sigo_pkey ON public.producto_codigos_alias_sigo USING btree (id);

CREATE INDEX producto_codigos_alias_sigo_producto_idx ON public.producto_codigos_alias_sigo USING btree (empresa_id, producto_id);

CREATE INDEX idx_productos_activo ON public.productos USING btree (activo);

CREATE INDEX idx_productos_categoria ON public.productos USING btree (categoria_id);

CREATE INDEX idx_productos_codigo_barras ON public.productos USING btree (codigo_barras);

CREATE INDEX idx_productos_codigo_interno ON public.productos USING btree (codigo_interno);

CREATE INDEX idx_productos_empresa_codigo_barras ON public.productos USING btree (empresa_id, codigo_barras) WHERE ((codigo_barras IS NOT NULL) AND (btrim(codigo_barras) <> ''::text));

CREATE INDEX idx_productos_empresa_codigo_interno ON public.productos USING btree (empresa_id, codigo_interno) WHERE ((codigo_interno IS NOT NULL) AND (btrim(codigo_interno) <> ''::text));

CREATE INDEX idx_productos_marca ON public.productos USING btree (marca_id);

CREATE INDEX idx_productos_nombre ON public.productos USING gin (to_tsvector('spanish'::regconfig, nombre));

CREATE UNIQUE INDEX productos_empresa_codigo_barras_uidx ON public.productos USING btree (empresa_id, codigo_barras) WHERE ((empresa_id IS NOT NULL) AND (NULLIF(btrim(codigo_barras), ''::text) IS NOT NULL));

CREATE UNIQUE INDEX productos_empresa_codigo_interno_uidx ON public.productos USING btree (empresa_id, codigo_interno) WHERE ((empresa_id IS NOT NULL) AND (NULLIF(btrim(codigo_interno), ''::text) IS NOT NULL));

CREATE INDEX productos_empresa_id_idx ON public.productos USING btree (empresa_id);

CREATE INDEX idx_proveedores_cuit ON public.proveedores USING btree (cuit);

CREATE INDEX idx_proveedores_razon_social ON public.proveedores USING btree (razon_social);

CREATE INDEX proveedores_empresa_id_idx ON public.proveedores USING btree (empresa_id);

CREATE UNIQUE INDEX proveedores_sigo_empresa_cuit_uidx ON public.proveedores_sigo USING btree (empresa_id, cuit) WHERE ((cuit IS NOT NULL) AND (cuit <> ''::text));

CREATE INDEX proveedores_sigo_empresa_idx ON public.proveedores_sigo USING btree (empresa_id);

CREATE UNIQUE INDEX sigo_empresa_modulos_pkey ON public.sigo_empresa_modulos USING btree (empresa_id, modulo_clave);

CREATE UNIQUE INDEX sigo_importaciones_stock_pkey ON public.sigo_importaciones_stock USING btree (import_key);

CREATE INDEX venta_items_sigo_venta_idx ON public.venta_items_sigo USING btree (venta_id);

CREATE INDEX ventas_sigo_cliente_idx ON public.ventas_sigo USING btree (empresa_id, cliente_id, created_at DESC);

CREATE INDEX ventas_sigo_empresa_fecha_idx ON public.ventas_sigo USING btree (empresa_id, created_at DESC);

CREATE TRIGGER compra_items_sigo_integridad_guard BEFORE INSERT OR UPDATE OF compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal ON compra_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_compra_item_integridad();

CREATE TRIGGER trg_sigo_compra_item_limites BEFORE INSERT OR UPDATE OF cantidad, costo_unitario, subtotal ON compra_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_compra_item_limites();

CREATE TRIGGER trg_sigo_compra_items_max_300 BEFORE INSERT ON compra_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_compra_items_max_300_guard();

CREATE TRIGGER trg_sigo_guard_compra_producto_operativo BEFORE INSERT OR UPDATE OF producto_id, empresa_id ON compra_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_validar_producto_movimiento();

CREATE TRIGGER sigo_tenant_insert_guard BEFORE INSERT ON compras FOR EACH ROW EXECUTE FUNCTION sigo_validar_empresa_operativa();

CREATE TRIGGER trigger_updated_at_compras BEFORE UPDATE ON compras FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER compras_sigo_cabecera_integridad_guard BEFORE INSERT OR UPDATE OF empresa_id, proveedor_id, subtotal, total ON compras_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_compra_cabecera_integridad();

CREATE TRIGGER trg_guard_compra_documento_normalizado_sigo BEFORE INSERT OR UPDATE OF empresa_id, proveedor_id, tipo_comprobante, numero_comprobante, estado ON compras_sigo FOR EACH ROW EXECUTE FUNCTION guard_compra_documento_normalizado_sigo();

CREATE TRIGGER trg_sigo_compra_documento_canonico BEFORE INSERT OR UPDATE OF empresa_id, proveedor_id, tipo_comprobante, numero_comprobante, estado ON compras_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_compra_documento_canonico();

CREATE TRIGGER trg_sincronizar_portal_cliente_membresia_sigo AFTER UPDATE OF rol, activo ON empresa_usuarios FOR EACH ROW EXECUTE FUNCTION sincronizar_portal_cliente_membresia_sigo();

CREATE TRIGGER productos_inactivos_proteccion_sigo BEFORE UPDATE OF activo, stock_actual, costo_actual, costo_ultima_compra ON productos FOR EACH ROW EXECUTE FUNCTION proteger_producto_inactivo_sigo();

CREATE TRIGGER sigo_tenant_insert_guard BEFORE INSERT ON productos FOR EACH ROW EXECUTE FUNCTION sigo_validar_empresa_operativa();

CREATE TRIGGER trg_sigo_productos_costos_no_nulos BEFORE INSERT OR UPDATE OF costo_actual, costo_ultima_compra ON productos FOR EACH ROW EXECUTE FUNCTION sigo_productos_costos_no_nulos_guard();

CREATE TRIGGER trg_validar_codigo_producto_unico_sigo BEFORE INSERT OR UPDATE OF empresa_id, codigo_barras, codigo_interno ON productos FOR EACH ROW EXECUTE FUNCTION validar_codigo_producto_unico_sigo();

CREATE TRIGGER trigger_calcular_margen BEFORE INSERT OR UPDATE OF costo_actual, precio_venta ON productos FOR EACH ROW EXECUTE FUNCTION calcular_margen_producto();

CREATE TRIGGER trigger_updated_at_productos BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_sigo_guard_venta_producto_operativo BEFORE INSERT OR UPDATE OF producto_id, empresa_id ON venta_items_sigo FOR EACH ROW EXECUTE FUNCTION sigo_validar_producto_movimiento();

CREATE TRIGGER trg_venta_item_precio_positivo BEFORE INSERT OR UPDATE OF precio_unitario, subtotal ON venta_items_sigo FOR EACH ROW EXECUTE FUNCTION validar_precio_venta_item_sigo();

CREATE POLICY "caja_movimientos_sigo_insert_blocked" ON public."caja_movimientos_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "caja_movimientos_sigo_select" ON public."caja_movimientos_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'sales.read'::text));

CREATE POLICY "cliente_movimientos_sigo_insert_blocked" ON public."cliente_movimientos_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "cliente_movimientos_sigo_select" ON public."cliente_movimientos_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'clients.read'::text));

CREATE POLICY "compra_items_sigo_delete_bloqueado" ON public."compra_items_sigo" AS PERMISSIVE FOR DELETE TO authenticated USING (false);

CREATE POLICY "compra_items_sigo_insert_bloqueado" ON public."compra_items_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "compra_items_sigo_select" ON public."compra_items_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'purchases.read'::text));

CREATE POLICY "compra_items_sigo_update_bloqueado" ON public."compra_items_sigo" AS PERMISSIVE FOR UPDATE TO authenticated USING (false);

CREATE POLICY "gestionar_compras" ON public."compras" AS PERMISSIVE FOR ALL TO anon,authenticated USING (true) WITH CHECK (true);

CREATE POLICY "compras_sigo_delete_bloqueado" ON public."compras_sigo" AS PERMISSIVE FOR DELETE TO authenticated USING (false);

CREATE POLICY "compras_sigo_insert_bloqueado" ON public."compras_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "compras_sigo_select" ON public."compras_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'purchases.read'::text));

CREATE POLICY "compras_sigo_update_bloqueado" ON public."compras_sigo" AS PERMISSIVE FOR UPDATE TO authenticated USING (false);

CREATE POLICY "gestionar_detalle_compras" ON public."detalle_compras" AS PERMISSIVE FOR ALL TO anon,authenticated USING (true) WITH CHECK (true);

CREATE POLICY "devolucion_items_sigo_insert_blocked" ON public."devolucion_items_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "devolucion_items_sigo_select" ON public."devolucion_items_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'sales.read'::text));

CREATE POLICY "devoluciones_sigo_insert_blocked" ON public."devoluciones_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "devoluciones_sigo_select" ON public."devoluciones_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'sales.read'::text));

CREATE POLICY "empresa_usuarios_delete_owner" ON public."empresa_usuarios" AS PERMISSIVE FOR DELETE TO authenticated USING ((es_owner_empresa(empresa_id) AND (user_id <> auth.uid())));

CREATE POLICY "empresa_usuarios_delete_superadmin" ON public."empresa_usuarios" AS PERMISSIVE FOR DELETE TO authenticated USING ((es_superadmin_sigo() AND (rol <> 'owner'::text)));

CREATE POLICY "empresa_usuarios_insert_owner" ON public."empresa_usuarios" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((es_owner_empresa(empresa_id) AND (rol <> 'owner'::text)));

CREATE POLICY "empresa_usuarios_insert_superadmin" ON public."empresa_usuarios" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((es_superadmin_sigo() AND (rol = ANY (ARRAY['admin'::text, 'seller'::text, 'warehouse'::text, 'client'::text]))));

CREATE POLICY "empresa_usuarios_select" ON public."empresa_usuarios" AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR es_owner_empresa(empresa_id)));

CREATE POLICY "empresa_usuarios_select_superadmin" ON public."empresa_usuarios" AS PERMISSIVE FOR SELECT TO authenticated USING (es_superadmin_sigo());

CREATE POLICY "empresa_usuarios_update_owner" ON public."empresa_usuarios" AS PERMISSIVE FOR UPDATE TO authenticated USING (es_owner_empresa(empresa_id)) WITH CHECK ((es_owner_empresa(empresa_id) AND (rol <> 'owner'::text)));

CREATE POLICY "empresa_usuarios_update_superadmin" ON public."empresa_usuarios" AS PERMISSIVE FOR UPDATE TO authenticated USING (es_superadmin_sigo()) WITH CHECK ((es_superadmin_sigo() AND (rol = ANY (ARRAY['admin'::text, 'seller'::text, 'warehouse'::text, 'client'::text]))));

CREATE POLICY "editar_productos" ON public."productos" AS PERMISSIVE FOR UPDATE TO anon,authenticated USING (true) WITH CHECK (true);

CREATE POLICY "eliminar_productos" ON public."productos" AS PERMISSIVE FOR DELETE TO anon,authenticated USING (true);

CREATE POLICY "insertar_productos" ON public."productos" AS PERMISSIVE FOR INSERT TO anon,authenticated WITH CHECK (true);

CREATE POLICY "lectura_productos" ON public."productos" AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);

CREATE POLICY "venta_items_sigo_insert_blocked" ON public."venta_items_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "venta_items_sigo_select" ON public."venta_items_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'sales.read'::text));

CREATE POLICY "ventas_sigo_insert_blocked" ON public."ventas_sigo" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "ventas_sigo_select" ON public."ventas_sigo" AS PERMISSIVE FOR SELECT TO authenticated USING (tiene_permiso_empresa(empresa_id, 'sales.read'::text));

ALTER TABLE public."caja_movimientos_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."caja_movimientos_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."caja_movimientos_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."caja_movimientos_sigo" TO "service_role";

ALTER TABLE public."cliente_movimientos_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."cliente_movimientos_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."cliente_movimientos_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."cliente_movimientos_sigo" TO "service_role";

ALTER TABLE public."compra_cambios_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compra_cambios_sigo" TO "service_role";

ALTER TABLE public."compra_ia_confirmaciones" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compra_ia_confirmaciones" TO "service_role";

ALTER TABLE public."compra_items_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compra_items_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compra_items_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compra_items_sigo" TO "service_role";

ALTER TABLE public."compras" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras" TO "service_role";

ALTER TABLE public."compras_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."compras_sigo" TO "service_role";

ALTER TABLE public."detalle_compras" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."detalle_compras" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."detalle_compras" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."detalle_compras" TO "service_role";

ALTER TABLE public."devolucion_items_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devolucion_items_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devolucion_items_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devolucion_items_sigo" TO "service_role";

ALTER TABLE public."devoluciones_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devoluciones_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devoluciones_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."devoluciones_sigo" TO "service_role";

ALTER TABLE public."empresa_usuarios" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."empresa_usuarios" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."empresa_usuarios" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."empresa_usuarios" TO "service_role";

ALTER TABLE public."movimientos_stock" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."movimientos_stock" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."movimientos_stock" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."movimientos_stock" TO "service_role";

ALTER TABLE public."productos" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."productos" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."productos" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."productos" TO "service_role";

ALTER TABLE public."venta_items_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."venta_items_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."venta_items_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."venta_items_sigo" TO "service_role";

ALTER TABLE public."ventas_sigo" ENABLE ROW LEVEL SECURITY;

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."ventas_sigo" TO "anon";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."ventas_sigo" TO "authenticated";

GRANT INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."ventas_sigo" TO "service_role";

CREATE SCHEMA qa;

GRANT USAGE ON SCHEMA qa TO authenticated,anon;

CREATE FUNCTION qa.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'ASSERTION_FAILED:%',label; END IF; RAISE NOTICE 'PASS:%',label; END $$;

CREATE FUNCTION qa.expect_error(statement text, expected text,label text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE err text; BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END; IF err IS NULL OR position(expected in err)=0 THEN RAISE EXCEPTION 'ASSERTION_FAILED:%:expected %,got %',label,expected,coalesce(err,'NO_ERROR'); END IF; RAISE NOTICE 'PASS:%:%',label,err; END $$;

