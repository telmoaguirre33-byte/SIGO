-- Edición y anulación conservan historial y ajustan inventario de forma atómica.
create table if not exists public.compra_cambios_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  compra_id uuid not null references public.compras_sigo(id),
  accion text not null check (accion in ('modificar','anular')),
  datos_anteriores jsonb not null,
  cambiado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now()
);
alter table public.compra_cambios_sigo enable row level security;
revoke all on public.compra_cambios_sigo from anon, authenticated;

create or replace function public.cambiar_compra_sigo(
  p_empresa_id uuid, p_compra_id uuid, p_accion text,
  p_proveedor_id uuid default null, p_fecha date default null,
  p_tipo text default null, p_numero text default null, p_items jsonb default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $function$
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
revoke all on function public.cambiar_compra_sigo(uuid,uuid,text,uuid,date,text,text,jsonb) from public, anon;
grant execute on function public.cambiar_compra_sigo(uuid,uuid,text,uuid,date,text,text,jsonb) to authenticated;
