-- SIGO: devoluciones/anulaciones transaccionales con restitución de stock y contrapartida contable.
-- Aditiva: conserva venta original y todo su detalle; nunca borra históricos.

alter table public.ventas_sigo
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_by uuid references auth.users(id) on delete restrict,
  add column if not exists motivo_anulacion text;

create table if not exists public.devoluciones_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  venta_id uuid not null references public.ventas_sigo(id) on delete restrict,
  tipo text not null check (tipo in ('parcial','total')),
  total numeric(14,2) not null default 0 check (total >= 0),
  motivo text not null,
  idempotency_key text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (empresa_id, idempotency_key)
);

create table if not exists public.devolucion_items_sigo (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references public.devoluciones_sigo(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  venta_item_id uuid not null references public.venta_items_sigo(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  unique (devolucion_id, venta_item_id)
);

create index if not exists devoluciones_sigo_empresa_fecha_idx
  on public.devoluciones_sigo(empresa_id, created_at desc);
create index if not exists devoluciones_sigo_venta_idx
  on public.devoluciones_sigo(venta_id, created_at desc);
create index if not exists devolucion_items_sigo_venta_item_idx
  on public.devolucion_items_sigo(venta_item_id);

alter table public.caja_movimientos_sigo
  add column if not exists devolucion_id uuid references public.devoluciones_sigo(id) on delete restrict;
alter table public.cliente_movimientos_sigo
  add column if not exists devolucion_id uuid references public.devoluciones_sigo(id) on delete restrict;

alter table public.devoluciones_sigo enable row level security;
alter table public.devolucion_items_sigo enable row level security;

drop policy if exists devoluciones_sigo_select on public.devoluciones_sigo;
create policy devoluciones_sigo_select on public.devoluciones_sigo
for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'sales.read'));

drop policy if exists devolucion_items_sigo_select on public.devolucion_items_sigo;
create policy devolucion_items_sigo_select on public.devolucion_items_sigo
for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'sales.read'));

-- Toda escritura de devoluciones pasa por RPC atómica.
drop policy if exists devoluciones_sigo_insert_blocked on public.devoluciones_sigo;
create policy devoluciones_sigo_insert_blocked on public.devoluciones_sigo
for insert to authenticated with check (false);
drop policy if exists devolucion_items_sigo_insert_blocked on public.devolucion_items_sigo;
create policy devolucion_items_sigo_insert_blocked on public.devolucion_items_sigo
for insert to authenticated with check (false);

create or replace function public.registrar_devolucion_sigo(
  p_empresa_id uuid,
  p_venta_id uuid,
  p_items jsonb,
  p_motivo text,
  p_idempotency_key text,
  p_anular_total boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.anular_venta_sigo(
  p_empresa_id uuid,
  p_venta_id uuid,
  p_motivo text,
  p_idempotency_key text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.registrar_devolucion_sigo(
    p_empresa_id,
    p_venta_id,
    '[]'::jsonb,
    p_motivo,
    p_idempotency_key,
    true
  );
$$;

revoke all on function public.registrar_devolucion_sigo(uuid, uuid, jsonb, text, text, boolean) from public;
grant execute on function public.registrar_devolucion_sigo(uuid, uuid, jsonb, text, text, boolean) to authenticated;
revoke all on function public.anular_venta_sigo(uuid, uuid, text, text) from public;
grant execute on function public.anular_venta_sigo(uuid, uuid, text, text) to authenticated;

comment on table public.devoluciones_sigo is 'SIGO: cabecera auditable de devoluciones y anulaciones de ventas.';
comment on function public.registrar_devolucion_sigo(uuid, uuid, jsonb, text, text, boolean) is
  'SIGO: devuelve parcial o totalmente una venta, restituye stock y genera contrapartida de caja/cuenta corriente de forma atómica.';
comment on function public.anular_venta_sigo(uuid, uuid, text, text) is
  'SIGO: anula una venta confirmada mediante devolución total del remanente, sin borrar historial.';
