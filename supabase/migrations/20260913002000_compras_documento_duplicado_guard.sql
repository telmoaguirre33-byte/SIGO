-- SIGO: bloqueo atomico de comprobantes de compra repetidos.
-- Evita que una factura/ticket ya confirmado vuelva a sumar stock si se reescanea
-- o se carga nuevamente con otra idempotency key. No modifica historicos existentes.

create or replace function public.confirmar_compra_sigo(
  p_empresa_id uuid,
  p_proveedor_id uuid,
  p_items jsonb,
  p_fecha date default current_date,
  p_tipo_comprobante text default null,
  p_numero_comprobante text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra_id uuid;
  v_item jsonb;
  v_producto public.productos%rowtype;
  v_producto_id uuid;
  v_cantidad numeric;
  v_costo numeric;
  v_subtotal numeric := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_seen uuid[] := array[]::uuid[];
  v_existente_proveedor uuid;
  v_existente_fecha date;
  v_existente_tipo text;
  v_existente_numero text;
  v_existente_total numeric;
  v_existente_fingerprint text;
  v_request_fingerprint text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo text := nullif(trim(coalesce(p_tipo_comprobante, '')), '');
  v_numero text := nullif(trim(coalesce(p_numero_comprobante, '')), '');
  v_document_lock text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'purchases.write') then raise exception 'FORBIDDEN'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then raise exception 'STOCK_WRITE_REQUIRED'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'TOO_MANY_ITEMS'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID_ITEM'; end if;
    begin
      v_producto_id := nullif(trim(v_item->>'producto_id'), '')::uuid;
      v_cantidad := nullif(trim(v_item->>'cantidad'), '')::numeric;
      v_costo := nullif(trim(v_item->>'costo_unitario'), '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'INVALID_ITEM';
    end;
    if v_producto_id is null then raise exception 'INVALID_ITEM'; end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY'; end if;
    if v_costo is null or v_costo < 0 or v_costo::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_COST'; end if;
    if v_producto_id = any(v_seen) then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
    v_seen := array_append(v_seen, v_producto_id);
    v_subtotal := v_subtotal + round(v_cantidad * v_costo, 2);
  end loop;
  v_subtotal := round(v_subtotal, 2);

  select md5(
    coalesce(jsonb_agg(
      jsonb_build_object(
        'producto_id', n.producto_id::text,
        'cantidad', to_char(n.cantidad, 'FM999999999999990.000'),
        'costo_unitario', to_char(n.costo_unitario, 'FM999999999999990.0000')
      ) order by n.producto_id
    )::text, '[]')
    || '|' || coalesce(p_proveedor_id::text, '')
    || '|' || coalesce(v_fecha::text, '')
    || '|' || coalesce(v_tipo, '')
    || '|' || coalesce(v_numero, '')
  )
  into v_request_fingerprint
  from (
    select
      (trim(j.value->>'producto_id'))::uuid as producto_id,
      (trim(j.value->>'cantidad'))::numeric(14,3) as cantidad,
      (trim(j.value->>'costo_unitario'))::numeric(14,4) as costo_unitario
    from jsonb_array_elements(p_items) j(value)
  ) n;

  -- Un retry legitimo con la misma key se resuelve antes del bloqueo de documento.
  select id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante, total, request_fingerprint
    into v_compra_id, v_existente_proveedor, v_existente_fecha, v_existente_tipo, v_existente_numero, v_existente_total, v_existente_fingerprint
  from public.compras_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;

  if v_compra_id is not null then
    if v_existente_proveedor is distinct from p_proveedor_id
       or v_existente_fecha is distinct from v_fecha
       or v_existente_tipo is distinct from v_tipo
       or v_existente_numero is distinct from v_numero
       or round(v_existente_total, 2) is distinct from v_subtotal
       or v_existente_fingerprint is distinct from v_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_compra_id;
  end if;

  if not exists (
    select 1 from public.proveedores_sigo
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true
  ) then raise exception 'SUPPLIER_NOT_FOUND'; end if;

  -- Un mismo comprobante puede llegar desde IA, camara, carga manual o un reintento
  -- posterior con otra key. Serializamos por empresa/proveedor/tipo/numero y rechazamos
  -- la segunda confirmacion antes de tocar stock.
  if v_numero is not null then
    v_document_lock := p_empresa_id::text || '|' || p_proveedor_id::text || '|' || lower(coalesce(v_tipo, '')) || '|' || lower(v_numero);
    perform pg_advisory_xact_lock(hashtextextended(v_document_lock, 0));

    select c.id
      into v_compra_id
      from public.compras_sigo c
     where c.empresa_id = p_empresa_id
       and c.proveedor_id = p_proveedor_id
       and lower(coalesce(nullif(trim(c.tipo_comprobante), ''), '')) = lower(coalesce(v_tipo, ''))
       and lower(nullif(trim(c.numero_comprobante), '')) = lower(v_numero)
       and c.estado = 'confirmada'
     order by c.created_at asc
     limit 1;

    if v_compra_id is not null then
      raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%', v_compra_id;
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    select * into v_producto from public.productos
      where id = v_producto_id and empresa_id = p_empresa_id and activo = true
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end loop;

  insert into public.compras_sigo(
    empresa_id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante,
    subtotal, total, estado, origen, idempotency_key, request_fingerprint, created_by
  ) values (
    p_empresa_id, p_proveedor_id, v_fecha, v_tipo, v_numero,
    v_subtotal, v_subtotal, 'confirmada', 'manual', v_key, v_request_fingerprint, auth.uid()
  ) returning id into v_compra_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    v_cantidad := (trim(v_item->>'cantidad'))::numeric;
    v_costo := (trim(v_item->>'costo_unitario'))::numeric;

    insert into public.compra_items_sigo(compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal)
    values (v_compra_id, p_empresa_id, v_producto_id, v_cantidad, v_costo, round(v_cantidad * v_costo, 2));

    update public.productos
      set stock_actual = coalesce(stock_actual, 0) + v_cantidad,
          costo_actual = v_costo,
          costo_ultima_compra = v_costo
      where id = v_producto_id and empresa_id = p_empresa_id and activo = true;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end loop;

  return v_compra_id;
exception
  when unique_violation then
    select id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante, total, request_fingerprint
      into v_compra_id, v_existente_proveedor, v_existente_fecha, v_existente_tipo, v_existente_numero, v_existente_total, v_existente_fingerprint
    from public.compras_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;

    if v_compra_id is not null then
      if v_existente_proveedor is distinct from p_proveedor_id
         or v_existente_fecha is distinct from v_fecha
         or v_existente_tipo is distinct from v_tipo
         or v_existente_numero is distinct from v_numero
         or round(v_existente_total, 2) is distinct from v_subtotal
         or v_existente_fingerprint is distinct from v_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_compra_id;
    end if;
    raise;
end;
$$;

revoke all on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) from public;
grant execute on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) to authenticated;

comment on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) is
  'SIGO: compra atomica tenant-safe; idempotencia ligada al payload; comprobante de proveedor protegido contra doble carga; stock/costos consistentes.';
