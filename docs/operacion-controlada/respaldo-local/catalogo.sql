-- Candidato #121. Sólo definición de lectura e índices; no modifica filas de negocio.
-- Aplicar únicamente tras backup, revisión del estado real y autorización de producción.
begin;
set local lock_timeout = '2s';
create schema if not exists sigo_catalogo_privado;
revoke all on schema sigo_catalogo_privado from public, anon;
grant usage on schema sigo_catalogo_privado to authenticated;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function sigo_catalogo_privado.normalizar(texto text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(coalesce(texto, '')), 'áéíóúüñ', 'aeiouun');
$$;
revoke all on function sigo_catalogo_privado.normalizar(text) from public, anon;

create index if not exists productos_catalogo121_orden_idx
  on public.productos (empresa_id, nombre, id) where activo = true;
-- pg_trgm puede estar instalado en extensions o en otro esquema existente.
do $index$
declare v_esquema text;
begin
  select n.nspname into strict v_esquema from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  execute format($ddl$create index if not exists productos_catalogo121_texto_idx on public.productos using gin
    (sigo_catalogo_privado.normalizar(nombre || ' ' || coalesce(marca, '') || ' ' || coalesce(codigo_interno, '') || ' ' || coalesce(codigo_barras, '') || ' ' || coalesce(categoria, '')) %I.gin_trgm_ops)
    where activo = true$ddl$, v_esquema);
end;
$index$;

-- SECURITY DEFINER permanece en esquema privado, con el contrato de ACL granular
-- existente y filtro tenant explícito. El endpoint público es SECURITY INVOKER.
create or replace function sigo_catalogo_privado.consultar(
  p_empresa_id uuid, p_busqueda text default '', p_offset integer default 0,
  p_limite integer default 51, p_ids uuid[] default null, p_solo_codigo boolean default false
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
  stock_maximo numeric,
  unidad_medida text
)
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = force_custom_plan as $$
declare
  v_costos boolean;
  v_margenes boolean;
  v_stock boolean;
  v_listas boolean;
  v_ventas_lectura boolean;
  v_ventas_escritura boolean;
  v_patrones text[];
  v_codigo_patron text;
  v_ids uuid[] := p_ids;
  v_codigo text := btrim(coalesce(p_busqueda, ''));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.read'), false) then
    raise exception 'FORBIDDEN';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 501 or p_offset is null or p_offset < 0
     or length(v_codigo) > 256 or cardinality(p_ids) > 100 or p_solo_codigo is null
     or (p_solo_codigo and (v_codigo = '' or p_ids is not null)) then
    raise exception 'CATALOG_QUERY_INVALID';
  end if;
  v_costos := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'costs.read'), false);
  v_margenes := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'margins.read'), false);
  v_stock := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'stock.read'), false);
  v_listas := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read'), false);
  v_ventas_lectura := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.read'), false);
  v_ventas_escritura := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.write'), false);
  if p_solo_codigo then
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids from (
      select p.id from public.productos p where p.empresa_id = p_empresa_id and p.activo = true and p.codigo_barras is not null and btrim(p.codigo_barras) <> '' and p.codigo_barras = v_codigo
      union
      select p.id from public.productos p where p.empresa_id = p_empresa_id and p.activo = true and p.codigo_interno is not null and btrim(p.codigo_interno) <> '' and p.codigo_interno = v_codigo
      union
      select a.producto_id from public.producto_codigos_alias_sigo a where a.empresa_id = p_empresa_id and a.codigo = v_codigo
    ) c;
  end if;
  -- Tratar %, _ y barra como texto literal, nunca como comodines del usuario.
  -- Todas las palabras deben coincidir, aunque se escriban en distinto orden.
  -- La palabra más larga sirve de ancla indexable para evitar escanear el catálogo.
  select array_agg('%' || replace(replace(replace(t, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' order by length(t) desc, t)
    into v_patrones
  from unnest(regexp_split_to_array(sigo_catalogo_privado.normalizar(v_codigo), E'\\s+')) t
  where t <> '';
  v_codigo_patron := '%' || replace(replace(replace(sigo_catalogo_privado.normalizar(v_codigo), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
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
    case when v_costos then p.costo_actual else null end,
    case when v_costos then p.costo_ultima_compra else null end,
    case
      when v_listas
        or v_ventas_lectura
        or v_ventas_escritura
        then p.precio_venta
      else null
    end,
    case when v_margenes then p.margen_ganancia else null end,
    case when v_margenes then p.margen_porcentaje else null end,
    case when v_stock then p.stock_actual else null end,
    case when v_stock then p.stock_minimo else null end,
    case when v_stock then p.stock_maximo else null end,
    case when lower(btrim(p.unidad_medida)) in ('unidad','kg','g','l','ml','m','cm','m2','m3','docena','caja','bolsa','paquete','rollo','bandeja','atado')
      then lower(btrim(p.unidad_medida)) else null::text end
  from public.productos p
  where p.empresa_id = p_empresa_id and p.activo = true
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
    and (v_ids is null or p.id = any(v_ids))
    and case when p_solo_codigo then true
    else v_codigo = '' or (
      sigo_catalogo_privado.normalizar(p.nombre || ' ' || coalesce(p.marca, '') || ' ' || coalesce(p.codigo_interno, '') || ' ' || coalesce(p.codigo_barras, '') || ' ' || coalesce(p.categoria, '')) like v_patrones[1] escape E'\\'
      and (
        sigo_catalogo_privado.normalizar(p.nombre || ' ' || coalesce(p.marca, '') || ' ' || coalesce(p.categoria, '')) like all(v_patrones)
        or sigo_catalogo_privado.normalizar(p.codigo_interno) like v_codigo_patron escape E'\\'
        or sigo_catalogo_privado.normalizar(p.codigo_barras) like v_codigo_patron escape E'\\'
      )
    )
    end
  order by p.nombre, p.id
  limit p_limite offset p_offset;
end;
$$;
revoke all on function sigo_catalogo_privado.consultar(uuid,text,integer,integer,uuid[],boolean) from public, anon;
grant execute on function sigo_catalogo_privado.consultar(uuid,text,integer,integer,uuid[],boolean) to authenticated;

create or replace function public.consultar_productos_sigo(
  p_empresa_id uuid, p_busqueda text default '', p_offset integer default 0,
  p_limite integer default 51, p_ids uuid[] default null, p_solo_codigo boolean default false
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
  stock_maximo numeric,
  unidad_medida text
)
language sql stable security invoker set search_path = '' as $$
  select * from sigo_catalogo_privado.consultar(p_empresa_id,p_busqueda,p_offset,p_limite,p_ids,p_solo_codigo);
$$;
revoke all on function public.consultar_productos_sigo(uuid,text,integer,integer,uuid[],boolean) from public, anon;
grant execute on function public.consultar_productos_sigo(uuid,text,integer,integer,uuid[],boolean) to authenticated;

-- Compatibilidad con exportaciones e informes: mantiene firma y máscaras existentes,
-- pero calcula permisos una vez por llamada, no hasta diez veces por cada fila.
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
set search_path = ''
as $$
declare
  v_costos boolean;
  v_margenes boolean;
  v_stock boolean;
  v_listas boolean;
  v_ventas_lectura boolean;
  v_ventas_escritura boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read') then
    raise exception 'FORBIDDEN';
  end if;

  v_costos := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'costs.read'), false);
  v_margenes := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'margins.read'), false);
  v_stock := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'stock.read'), false);
  v_listas := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read'), false);
  v_ventas_lectura := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.read'), false);
  v_ventas_escritura := coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.write'), false);

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
    case when v_costos then p.costo_actual else null end,
    case when v_costos then p.costo_ultima_compra else null end,
    case
      when v_listas
        or v_ventas_lectura
        or v_ventas_escritura
        then p.precio_venta
      else null
    end,
    case when v_margenes then p.margen_ganancia else null end,
    case when v_margenes then p.margen_porcentaje else null end,
    case when v_stock then p.stock_actual else null end,
    case when v_stock then p.stock_minimo else null end,
    case when v_stock then p.stock_maximo else null end
  from public.productos p
  where p.empresa_id = p_empresa_id
    and p.activo = true
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
  order by p.nombre asc, p.id asc;
end;
$$;

revoke all on function public.listar_productos_sigo(uuid) from public;
grant execute on function public.listar_productos_sigo(uuid) to authenticated;

comment on function public.listar_productos_sigo(uuid) is
  'SIGO: catálogo operativo tenant-aware de productos activos y vendibles; conserva fuera del circuito servicios NO_VENDIBLE.';


notify pgrst, 'reload schema';
commit;
