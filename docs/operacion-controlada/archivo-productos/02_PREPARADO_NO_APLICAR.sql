-- PREPARADO, NO AUTORIZADO PARA PRODUCCION. Ejecutar sólo en ensayo aislado.
-- Archivo comercial reversible. No cambia activo legacy, stock, unidad ni históricos.
begin;
alter table public.productos add column if not exists archivado_comercial boolean not null default false;

create table if not exists public.productos_archivo_auditoria_sigo (
 id bigint generated always as identity primary key,
 empresa_id uuid not null,
 producto_id uuid not null references public.productos(id) on delete restrict,
 usuario_id uuid not null,
 archivado boolean not null,
 stock_preservado numeric,
 unidad_preservada text,
 creado_en timestamptz not null default clock_timestamp()
);
alter table public.productos_archivo_auditoria_sigo enable row level security;
revoke all on public.productos_archivo_auditoria_sigo from public, anon, authenticated;
revoke all on sequence public.productos_archivo_auditoria_sigo_id_seq from public, anon, authenticated;

-- Cubre también UPDATE directo: ningún cambio de estado puede saltar permisos/auditoría.
create or replace function public.sigo_auditar_archivo_producto()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   if new.archivado_comercial then raise exception 'ARCHIVE_CREATE_AS_ACTIVE_FIRST'; end if;
   return new;
 end if;
 if new.archivado_comercial is not distinct from old.archivado_comercial then return new; end if;
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not coalesce(public.tiene_permiso_empresa(old.empresa_id, 'products.write'),false) then raise exception 'FORBIDDEN'; end if;
 if new.empresa_id is distinct from old.empresa_id or new.id is distinct from old.id
    or (to_jsonb(new) - array['archivado_comercial','updated_at']) is distinct from (to_jsonb(old) - array['archivado_comercial','updated_at']) then
   raise exception 'ARCHIVE_ONLY_STATE_CHANGE';
 end if;
 if old.activo is distinct from true then raise exception 'PRODUCT_LEGACY_INACTIVE_REVIEW'; end if;
 insert into public.productos_archivo_auditoria_sigo(empresa_id,producto_id,usuario_id,archivado,stock_preservado,unidad_preservada)
 values(old.empresa_id,old.id,auth.uid(),new.archivado_comercial,old.stock_actual,old.unidad_medida);
 return new;
end;
$$;
revoke all on function public.sigo_auditar_archivo_producto() from public, anon, authenticated;
drop trigger if exists sigo_archivo_producto_audit on public.productos;
create trigger sigo_archivo_producto_audit before insert or update on public.productos
for each row execute function public.sigo_auditar_archivo_producto();

create or replace function public.configurar_archivo_producto_sigo(p_empresa_id uuid,p_producto_id uuid,p_archivado boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_producto public.productos%rowtype;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_empresa_id is null or p_producto_id is null or p_archivado is null then raise exception 'INVALID_ARGUMENT'; end if;
 if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) then raise exception 'FORBIDDEN'; end if;
 select * into v_producto from public.productos where id=p_producto_id and empresa_id=p_empresa_id for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND_IN_TENANT'; end if;
 if v_producto.activo is distinct from true then raise exception 'PRODUCT_LEGACY_INACTIVE_REVIEW'; end if;
 if v_producto.archivado_comercial is distinct from p_archivado then
   update public.productos set archivado_comercial=p_archivado where id=p_producto_id and empresa_id=p_empresa_id
   returning * into v_producto;
   if not found then raise exception 'PRODUCT_ARCHIVE_NOT_APPLIED'; end if;
 end if;
 return jsonb_build_object('id',v_producto.id,'empresa_id',v_producto.empresa_id,'activo',v_producto.activo,'archivado_comercial',v_producto.archivado_comercial);
end;
$$;
revoke all on function public.configurar_archivo_producto_sigo(uuid,uuid,boolean) from public, anon;
grant execute on function public.configurar_archivo_producto_sigo(uuid,uuid,boolean) to authenticated;

create or replace function public.estado_comercial_producto_sigo(p_empresa_id uuid,p_producto_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_producto public.productos%rowtype;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.read'),false) then raise exception 'FORBIDDEN'; end if;
 select * into v_producto from public.productos where id=p_producto_id and empresa_id=p_empresa_id;
 if not found then raise exception 'PRODUCT_NOT_FOUND_IN_TENANT'; end if;
 return jsonb_build_object('id',v_producto.id,'empresa_id',v_producto.empresa_id,'activo',v_producto.activo,'archivado_comercial',v_producto.archivado_comercial);
end;
$$;
revoke all on function public.estado_comercial_producto_sigo(uuid,uuid) from public, anon;
grant execute on function public.estado_comercial_producto_sigo(uuid,uuid) to authenticated;

-- Barrera adicional para carrito/escáner obsoleto y carreras. No reemplaza guardas existentes.
-- No se aplica a devoluciones ni anulaciones, que conservan contrato/permisos previos.
create or replace function public.sigo_validar_producto_no_archivado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_archivado boolean;
begin
 select p.archivado_comercial into v_archivado from public.productos p
 where p.id=new.producto_id and p.empresa_id=new.empresa_id for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND_IN_TENANT'; end if;
 if v_archivado then raise exception 'PRODUCT_ARCHIVED'; end if;
 return new;
end;
$$;
revoke all on function public.sigo_validar_producto_no_archivado() from public, anon, authenticated;
drop trigger if exists sigo_venta_no_archivada on public.venta_items_sigo;
create trigger sigo_venta_no_archivada before insert or update of producto_id,empresa_id on public.venta_items_sigo
for each row execute function public.sigo_validar_producto_no_archivado();
drop trigger if exists sigo_compra_no_archivada on public.compra_items_sigo;
create trigger sigo_compra_no_archivada before insert or update of producto_id,empresa_id on public.compra_items_sigo
for each row execute function public.sigo_validar_producto_no_archivado();

create or replace function public.listar_productos_sigo(p_empresa_id uuid)
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
    and p.archivado_comercial = false
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
  order by p.nombre asc;
end;
$$;

-- CREATE OR REPLACE conserva ACL/owner existentes; no se cambia su acceso.

comment on function public.listar_productos_sigo(uuid) is
  'SIGO: catálogo operativo tenant-aware de productos activos y vendibles; conserva fuera del circuito servicios NO_VENDIBLE.';


create or replace function public.listar_inventario_productos_sigo(p_empresa_id uuid)
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
  stock_maximo numeric,
  unidad_medida text,
  activo boolean,
  archivado_comercial boolean,
  unidad_revision text
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_maximo else null end,
    p.unidad_medida, p.activo, p.archivado_comercial, coalesce(to_jsonb(p)->>'unidad_revision','0')
  from public.productos p
  where p.empresa_id = p_empresa_id
  order by p.nombre asc;
end;
$$;

revoke all on function public.listar_inventario_productos_sigo(uuid) from public;
grant execute on function public.listar_inventario_productos_sigo(uuid) to authenticated;

comment on function public.listar_inventario_productos_sigo(uuid) is 'Inventario físico con estados comerciales y máscaras de permisos; no usar como catálogo de ventas.';

create or replace function public.portal_cliente_catalogo_sigo(p_empresa_id uuid)
returns table (
  producto_id uuid,
  codigo_interno text,
  codigo_barras text,
  nombre text,
  marca text,
  categoria text,
  stock_comercial numeric,
  consumo_diario_estimado numeric,
  dias_cobertura numeric,
  semaforo text,
  sugerencia_compra numeric,
  actualizado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_vinculos integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  if not exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.rol = 'client'
      and eu.activo = true
  ) then
    raise exception 'PORTAL_FORBIDDEN';
  end if;

  select count(*)::integer
    into v_vinculos
  from public.portal_cliente_usuarios pcu
  join public.clientes_sigo c
    on c.id = pcu.cliente_id
   and c.empresa_id = pcu.empresa_id
   and c.activo = true
  where pcu.user_id = auth.uid()
    and pcu.empresa_id = p_empresa_id
    and pcu.activo = true;

  if coalesce(v_vinculos, 0) = 0 then raise exception 'PORTAL_FORBIDDEN'; end if;
  if v_vinculos <> 1 then raise exception 'PORTAL_LINK_AMBIGUOUS'; end if;

  select pcu.cliente_id
    into v_cliente_id
  from public.portal_cliente_usuarios pcu
  join public.clientes_sigo c
    on c.id = pcu.cliente_id
   and c.empresa_id = pcu.empresa_id
   and c.activo = true
  where pcu.user_id = auth.uid()
    and pcu.empresa_id = p_empresa_id
    and pcu.activo = true
  limit 1;

  return query
  select
    p.id as producto_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.marca,
    p.categoria,
    s.stock_comercial,
    s.consumo_diario_estimado,
    case
      when coalesce(s.consumo_diario_estimado, 0) > 0
        then round(s.stock_comercial / s.consumo_diario_estimado, 1)
      else null
    end as dias_cobertura,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 'SIN_DATOS'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.dias_objetivo then 'VERDE'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.umbral_amarillo then 'AMARILLO'
      else 'ROJO'
    end as semaforo,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 0::numeric
      else greatest(0::numeric, ceil((s.dias_objetivo * s.consumo_diario_estimado) - s.stock_comercial))
    end as sugerencia_compra,
    s.actualizado_en
  from public.portal_stock_publicado s
  join public.productos p
    on p.id = s.producto_id
   and p.empresa_id = s.empresa_id
   and p.activo = true
   and p.archivado_comercial = false
  where s.empresa_id = p_empresa_id
    and s.cliente_id = v_cliente_id
    and s.publicado = true
  order by p.nombre asc;
end;
$$;
-- CREATE OR REPLACE conserva ACL/owner existentes; auth/vínculo siguen verificándose.

create or replace function public.buscar_producto_inventario_sigo(p_empresa_id uuid,p_codigo text)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_codigo text := btrim(coalesce(p_codigo,''));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if v_codigo='' or length(v_codigo)>128 then raise exception 'CODIGO_INVALIDO'; end if;
 return query select to_jsonb(p) from public.listar_inventario_productos_sigo(p_empresa_id) p
 where p.codigo_barras=v_codigo or p.codigo_interno=v_codigo or exists(
  select 1 from public.producto_codigos_alias_sigo a where a.empresa_id=p_empresa_id and a.producto_id=p.id and a.codigo=v_codigo)
 order by p.nombre,p.id limit 10;
end;
$$;
revoke all on function public.buscar_producto_inventario_sigo(uuid,text) from public, anon;
grant execute on function public.buscar_producto_inventario_sigo(uuid,text) to authenticated;
commit;
