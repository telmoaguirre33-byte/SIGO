-- SIGO: clientes + cuenta corriente + venta a crédito asociada.
-- Migración aditiva: no elimina ni reescribe datos existentes.

create table if not exists public.clientes_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  nombre text not null,
  documento text,
  telefono text,
  email text,
  direccion text,
  limite_credito numeric(14,2),
  saldo_actual numeric(14,2) not null default 0,
  activo boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clientes_sigo_empresa_nombre_idx
  on public.clientes_sigo(empresa_id, nombre);
create unique index if not exists clientes_sigo_empresa_documento_uidx
  on public.clientes_sigo(empresa_id, documento)
  where documento is not null and btrim(documento) <> '';

create table if not exists public.cliente_movimientos_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  cliente_id uuid not null references public.clientes_sigo(id) on delete restrict,
  venta_id uuid references public.ventas_sigo(id) on delete restrict,
  tipo text not null check (tipo in ('debe','haber')),
  importe numeric(14,2) not null check (importe > 0),
  concepto text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists cliente_movimientos_empresa_cliente_fecha_idx
  on public.cliente_movimientos_sigo(empresa_id, cliente_id, created_at desc);

alter table public.ventas_sigo
  add column if not exists cliente_id uuid references public.clientes_sigo(id) on delete restrict;
create index if not exists ventas_sigo_cliente_idx on public.ventas_sigo(empresa_id, cliente_id, created_at desc);

alter table public.clientes_sigo enable row level security;
alter table public.cliente_movimientos_sigo enable row level security;

drop policy if exists clientes_sigo_select on public.clientes_sigo;
create policy clientes_sigo_select on public.clientes_sigo
for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'clients.read'));

drop policy if exists clientes_sigo_insert on public.clientes_sigo;
create policy clientes_sigo_insert on public.clientes_sigo
for insert to authenticated
with check (public.tiene_permiso_empresa(empresa_id, 'clients.write'));

drop policy if exists clientes_sigo_update on public.clientes_sigo;
create policy clientes_sigo_update on public.clientes_sigo
for update to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'clients.write'))
with check (public.tiene_permiso_empresa(empresa_id, 'clients.write'));

drop policy if exists clientes_sigo_delete on public.clientes_sigo;
create policy clientes_sigo_delete on public.clientes_sigo
for delete to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'clients.write'));

drop policy if exists cliente_movimientos_sigo_select on public.cliente_movimientos_sigo;
create policy cliente_movimientos_sigo_select on public.cliente_movimientos_sigo
for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'clients.read'));

-- La cuenta corriente se escribe únicamente mediante RPCs transaccionales.
drop policy if exists cliente_movimientos_sigo_insert_blocked on public.cliente_movimientos_sigo;
create policy cliente_movimientos_sigo_insert_blocked on public.cliente_movimientos_sigo
for insert to authenticated with check (false);

create or replace function public.registrar_cobro_cliente_sigo(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_importe numeric,
  p_concepto text default 'Cobro cuenta corriente'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_movimiento_id uuid;
  v_saldo numeric(14,2);
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'clients.write') then raise exception 'CLIENTS_WRITE_FORBIDDEN'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;

  select saldo_actual into v_saldo
  from public.clientes_sigo
  where id = p_cliente_id and empresa_id = p_empresa_id and activo = true
  for update;

  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  insert into public.cliente_movimientos_sigo (empresa_id, cliente_id, tipo, importe, concepto, created_by)
  values (p_empresa_id, p_cliente_id, 'haber', round(p_importe, 2), coalesce(nullif(trim(p_concepto), ''), 'Cobro cuenta corriente'), v_user_id)
  returning id into v_movimiento_id;

  update public.clientes_sigo
  set saldo_actual = saldo_actual - round(p_importe, 2), updated_at = now()
  where id = p_cliente_id and empresa_id = p_empresa_id;

  return v_movimiento_id;
end;
$$;

create or replace function public.confirmar_venta_sigo_v2(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago text default 'efectivo',
  p_idempotency_key text default null,
  p_cliente_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_item jsonb;
  v_producto record;
  v_cliente record;
  v_cantidad numeric(14,3);
  v_total numeric(14,2) := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','cuenta_corriente','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;

  if p_medio_pago = 'cuenta_corriente' then
    if p_cliente_id is null then raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT'; end if;
    if not public.tiene_permiso_empresa(p_empresa_id, 'clients.read') then raise exception 'CLIENTS_READ_FORBIDDEN'; end if;
    select id, saldo_actual, limite_credito into v_cliente
    from public.clientes_sigo
    where id = p_cliente_id and empresa_id = p_empresa_id and activo = true
    for update;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  elsif p_cliente_id is not null then
    select id into v_cliente
    from public.clientes_sigo
    where id = p_cliente_id and empresa_id = p_empresa_id and activo = true;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  end if;

  select id into v_venta_id
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_venta_id is not null then return v_venta_id; end if;

  insert into public.ventas_sigo (empresa_id, cliente_id, total, medio_pago, idempotency_key, created_by)
  values (p_empresa_id, p_cliente_id, 0, p_medio_pago, v_key, v_user_id)
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

  if p_medio_pago = 'cuenta_corriente' and v_cliente.limite_credito is not null
     and v_cliente.saldo_actual + v_total > v_cliente.limite_credito then
    raise exception 'CREDIT_LIMIT_EXCEEDED';
  end if;

  update public.ventas_sigo set total = v_total, cliente_id = p_cliente_id where id = v_venta_id;

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
    select id into v_venta_id from public.ventas_sigo where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_venta_id is not null then return v_venta_id; end if;
    raise;
end;
$$;

revoke all on function public.registrar_cobro_cliente_sigo(uuid, uuid, numeric, text) from public;
grant execute on function public.registrar_cobro_cliente_sigo(uuid, uuid, numeric, text) to authenticated;
revoke all on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) from public;
grant execute on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) to authenticated;

comment on table public.clientes_sigo is 'SIGO: clientes aislados por empresa con saldo de cuenta corriente.';
comment on table public.cliente_movimientos_sigo is 'SIGO: movimientos debe/haber de cuenta corriente por cliente.';
comment on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) is
  'SIGO: venta atomica con cliente opcional; cuenta corriente exige cliente, respeta limite y genera deuda.';
