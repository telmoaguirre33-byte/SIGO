-- SIGO: proveedores + compras operativas tenant-safe.
-- Toda recepción de mercadería se confirma mediante RPC transaccional para evitar
-- compras guardadas sin stock o stock modificado sin cabecera/detalle.

create table if not exists public.proveedores_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  razon_social text not null,
  nombre_fantasia text,
  cuit text,
  telefono text,
  email text,
  direccion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proveedores_sigo_empresa_idx on public.proveedores_sigo(empresa_id);
create unique index if not exists proveedores_sigo_empresa_cuit_uidx
  on public.proveedores_sigo(empresa_id, cuit) where cuit is not null and cuit <> '';

create table if not exists public.compras_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores_sigo(id) on delete restrict,
  fecha_compra date not null default current_date,
  tipo_comprobante text,
  numero_comprobante text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  estado text not null default 'confirmada' check (estado in ('confirmada','anulada')),
  origen text not null default 'manual',
  idempotency_key text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists compras_sigo_idempotency_uidx
  on public.compras_sigo(empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists compras_sigo_empresa_fecha_idx on public.compras_sigo(empresa_id, fecha_compra desc);

create table if not exists public.compra_items_sigo (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras_sigo(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad numeric(14,3) not null check (cantidad > 0),
  costo_unitario numeric(14,4) not null check (costo_unitario >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);
create index if not exists compra_items_sigo_compra_idx on public.compra_items_sigo(compra_id);
create index if not exists compra_items_sigo_empresa_idx on public.compra_items_sigo(empresa_id);

alter table public.proveedores_sigo enable row level security;
alter table public.compras_sigo enable row level security;
alter table public.compra_items_sigo enable row level security;

drop policy if exists proveedores_sigo_select on public.proveedores_sigo;
create policy proveedores_sigo_select on public.proveedores_sigo for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'suppliers.read'));

drop policy if exists proveedores_sigo_insert on public.proveedores_sigo;
create policy proveedores_sigo_insert on public.proveedores_sigo for insert to authenticated
with check (public.tiene_permiso_empresa(empresa_id, 'suppliers.write'));

drop policy if exists proveedores_sigo_update on public.proveedores_sigo;
create policy proveedores_sigo_update on public.proveedores_sigo for update to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'suppliers.write'))
with check (public.tiene_permiso_empresa(empresa_id, 'suppliers.write'));

drop policy if exists compras_sigo_select on public.compras_sigo;
create policy compras_sigo_select on public.compras_sigo for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'purchases.read'));

drop policy if exists compra_items_sigo_select on public.compra_items_sigo;
create policy compra_items_sigo_select on public.compra_items_sigo for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'purchases.read'));

-- Escrituras directas de compra/detalle cerradas: recepción solo por RPC atómica.
drop policy if exists compras_sigo_insert_bloqueado on public.compras_sigo;
create policy compras_sigo_insert_bloqueado on public.compras_sigo for insert to authenticated with check (false);
drop policy if exists compras_sigo_update_bloqueado on public.compras_sigo;
create policy compras_sigo_update_bloqueado on public.compras_sigo for update to authenticated using (false);
drop policy if exists compras_sigo_delete_bloqueado on public.compras_sigo;
create policy compras_sigo_delete_bloqueado on public.compras_sigo for delete to authenticated using (false);
drop policy if exists compra_items_sigo_insert_bloqueado on public.compra_items_sigo;
create policy compra_items_sigo_insert_bloqueado on public.compra_items_sigo for insert to authenticated with check (false);
drop policy if exists compra_items_sigo_update_bloqueado on public.compra_items_sigo;
create policy compra_items_sigo_update_bloqueado on public.compra_items_sigo for update to authenticated using (false);
drop policy if exists compra_items_sigo_delete_bloqueado on public.compra_items_sigo;
create policy compra_items_sigo_delete_bloqueado on public.compra_items_sigo for delete to authenticated using (false);

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
  v_cantidad numeric;
  v_costo numeric;
  v_subtotal numeric := 0;
  v_existente uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'purchases.write') then raise exception 'FORBIDDEN'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then raise exception 'STOCK_WRITE_REQUIRED'; end if;

  if p_idempotency_key is not null then
    select id into v_existente from public.compras_sigo
      where empresa_id = p_empresa_id and idempotency_key = p_idempotency_key;
    if v_existente is not null then return v_existente; end if;
  end if;

  if not exists (
    select 1 from public.proveedores_sigo
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true
  ) then raise exception 'SUPPLIER_NOT_FOUND'; end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  -- Validación previa y bloqueo de productos. Cualquier error revierte toda la transacción.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cantidad := nullif(v_item->>'cantidad','')::numeric;
    v_costo := nullif(v_item->>'costo_unitario','')::numeric;
    if coalesce(v_cantidad,0) <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    if coalesce(v_costo,-1) < 0 then raise exception 'INVALID_COST'; end if;

    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid and empresa_id = p_empresa_id
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_subtotal := v_subtotal + (v_cantidad * v_costo);
  end loop;

  insert into public.compras_sigo(
    empresa_id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante,
    subtotal, total, estado, origen, idempotency_key, created_by
  ) values (
    p_empresa_id, p_proveedor_id, coalesce(p_fecha,current_date), nullif(trim(p_tipo_comprobante),''),
    nullif(trim(p_numero_comprobante),''), round(v_subtotal,2), round(v_subtotal,2),
    'confirmada','manual',nullif(trim(p_idempotency_key),''),auth.uid()
  ) returning id into v_compra_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_costo := (v_item->>'costo_unitario')::numeric;

    insert into public.compra_items_sigo(compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal)
    values (v_compra_id, p_empresa_id, (v_item->>'producto_id')::uuid, v_cantidad, v_costo, round(v_cantidad*v_costo,2));

    update public.productos
      set stock_actual = coalesce(stock_actual,0) + v_cantidad,
          costo_actual = v_costo,
          costo_ultima_compra = v_costo
      where id = (v_item->>'producto_id')::uuid and empresa_id = p_empresa_id;
  end loop;

  return v_compra_id;
end;
$$;

revoke all on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) from public;
grant execute on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) to authenticated;

comment on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) is
  'SIGO: confirma compra y actualiza stock/costo en una sola transacción tenant-safe e idempotente.';
