-- SIGO: códigos alternativos por producto/empresa para resolver códigos físicos que
-- difieren del código histórico importado, sin pisar identidad, precio ni stock.

create table if not exists public.producto_codigos_alias_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  codigo text not null,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create index if not exists producto_codigos_alias_sigo_producto_idx
  on public.producto_codigos_alias_sigo (empresa_id, producto_id);

alter table public.producto_codigos_alias_sigo enable row level security;

drop policy if exists producto_codigos_alias_sigo_select on public.producto_codigos_alias_sigo;
create policy producto_codigos_alias_sigo_select
on public.producto_codigos_alias_sigo
for select
to authenticated
using (public.es_miembro_empresa(empresa_id));

-- El scanner sigue validando permisos a través de listar_productos_sigo().
create or replace function public.buscar_producto_codigo_sigo(
  p_empresa_id uuid,
  p_codigo text
)
returns table (
  id uuid,
  empresa_id uuid,
  codigo_interno text,
  codigo_barras text,
  nombre text,
  descripcion text,
  categoria text,
  marca text,
  proveedor text,
  costo_actual numeric,
  costo_ultima_compra numeric,
  precio_venta numeric,
  margen_ganancia numeric,
  margen_porcentaje numeric,
  stock_actual numeric,
  stock_minimo numeric,
  stock_maximo numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.buscar_producto_codigo_sigo(uuid, text) from public;
grant execute on function public.buscar_producto_codigo_sigo(uuid, text) to authenticated;

comment on function public.buscar_producto_codigo_sigo(uuid, text) is
  'SIGO: lookup tenant-aware por código principal, interno o alias físico del mismo producto.';

-- Evidencia recibida del cliente Cristina: el Outliner físico usa 7798100965093,
-- mientras el resguardo histórico lo tenía con otro código. Se agrega como alias,
-- sin cambiar el producto original ni sus valores.
do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
  v_producto_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('cristina.veron@hotmail.com')
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'CRISTINA_VERON_USER_NOT_FOUND_ALIAS';
  end if;

  select e.id into v_empresa_id
  from public.empresas e
  join public.empresa_usuarios eu
    on eu.empresa_id = e.id
   and eu.user_id = v_user_id
   and eu.activo = true
  where e.activa = true
    and lower(trim(e.nombre)) = lower('cristina.veron')
  order by e.created_at asc
  limit 1;

  if v_empresa_id is null then
    raise exception 'CRISTINA_VERON_COMPANY_NOT_FOUND_ALIAS';
  end if;

  select p.id into v_producto_id
  from public.productos p
  where p.empresa_id = v_empresa_id
    and lower(trim(p.nombre)) = lower('MARCADOR FILGO OUTLINER DOBLE PUNTA')
  order by p.created_at asc nulls last, p.id
  limit 1;

  if v_producto_id is null then
    raise exception 'CRISTINA_OUTLINER_PRODUCT_NOT_FOUND';
  end if;

  insert into public.producto_codigos_alias_sigo (empresa_id, producto_id, codigo)
  values (v_empresa_id, v_producto_id, '7798100965093')
  on conflict (empresa_id, codigo) do update
    set producto_id = excluded.producto_id;
end
$$;
