-- SIGO: arquitectura modular por empresa.
-- Conserva activas las funciones ya existentes y permite habilitar/deshabilitar
-- módulos opcionales desde Configuración sin mezclar funciones de otros rubros.

create table if not exists public.sigo_modulos_catalogo (
  clave text primary key,
  nombre text not null,
  descripcion text not null,
  categoria text not null,
  disponible boolean not null default true,
  obligatorio boolean not null default false,
  orden integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sigo_empresa_modulos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  modulo_clave text not null references public.sigo_modulos_catalogo(clave) on delete restrict,
  habilitado boolean not null default false,
  actualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, modulo_clave)
);

alter table public.sigo_modulos_catalogo enable row level security;
alter table public.sigo_empresa_modulos enable row level security;
-- Acceso por RPC SECURITY DEFINER: no se habilitan políticas directas para authenticated.

insert into public.sigo_modulos_catalogo (clave, nombre, descripcion, categoria, disponible, obligatorio, orden)
values
  ('ventas', 'Ventas', 'Caja, carrito y cobro de operaciones.', 'Operación', true, true, 10),
  ('productos', 'Productos', 'Maestro de productos, códigos y administración del catálogo.', 'Operación', true, true, 20),
  ('stock', 'Stock', 'Inventario, mínimos, máximos y alertas de quiebre.', 'Operación', true, false, 30),
  ('lista_precios', 'Lista de precios', 'Precios, márgenes, cambios masivos, Excel y etiquetas.', 'Comercial', true, false, 40),
  ('scanner', 'Código de barras', 'Lectura con cámara, pistola USB/Bluetooth y búsqueda manual.', 'Operación', true, false, 50),
  ('compras', 'Compras / Proveedores', 'Ingreso de mercadería y gestión de proveedores.', 'Administración', true, false, 60),
  ('clientes', 'Clientes', 'Contactos, clientes y datos comerciales.', 'Administración', true, false, 70),
  ('cuentas_corrientes', 'Cuentas corrientes', 'Saldos, cobranzas y crédito a clientes.', 'Administración', true, false, 80),
  ('arca', 'ARCA / Facturación', 'Facturación electrónica y emisión fiscal.', 'Fiscal', true, false, 90),
  ('informes', 'Informes', 'Reportes, ingresos, indicadores y análisis gerencial.', 'Gestión', true, false, 100),
  ('portal_cliente', 'Portal Cliente', 'Consulta de stock, sugerencias y estado comercial para clientes.', 'Gestión', true, false, 110),
  ('precio_libre', 'Precio libre', 'Permite ingresar el precio en el momento de la venta.', 'Gastronomía / Especiales', false, false, 200),
  ('venta_peso', 'Venta por peso', 'Venta por kg/gramos para fiambrería, carnicería y similares.', 'Gastronomía / Especiales', false, false, 210),
  ('combos_adicionales', 'Combos y adicionales', 'Productos base con agregados, extras y variantes.', 'Gastronomía / Especiales', false, false, 220),
  ('mesas_comandas', 'Mesas y comandas', 'Gestión de mesas, pedidos y comandas gastronómicas.', 'Gastronomía / Especiales', false, false, 230),
  ('delivery', 'Delivery', 'Pedidos, preparación, reparto y seguimiento de entregas.', 'Gastronomía / Especiales', false, false, 240)
on conflict (clave) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  disponible = excluded.disponible,
  obligatorio = excluded.obligatorio,
  orden = excluded.orden,
  updated_at = now();

-- Mantener comportamiento actual para empresas ya creadas: lo que SIGO ya ofrece queda activo.
insert into public.sigo_empresa_modulos (empresa_id, modulo_clave, habilitado)
select e.id, m.clave,
  case
    when m.obligatorio then true
    when m.disponible and m.clave in (
      'stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes','portal_cliente'
    ) then true
    else false
  end
from public.empresas e
cross join public.sigo_modulos_catalogo m
on conflict (empresa_id, modulo_clave) do nothing;

create or replace function public.listar_modulos_empresa_sigo(p_empresa_id uuid)
returns table (
  clave text,
  nombre text,
  descripcion text,
  categoria text,
  disponible boolean,
  obligatorio boolean,
  habilitado boolean,
  orden integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null then raise exception 'EMPRESA_REQUIRED'; end if;
  if not exists (
    select 1 from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
  ) then
    raise exception 'FORBIDDEN';
  end if;

  -- Autocompletado lógico para módulos agregados a futuro: si no hay override,
  -- sólo los obligatorios nacen activos.
  return query
  select
    m.clave,
    m.nombre,
    m.descripcion,
    m.categoria,
    m.disponible,
    m.obligatorio,
    case when m.obligatorio then true else coalesce(em.habilitado, false) end,
    m.orden
  from public.sigo_modulos_catalogo m
  left join public.sigo_empresa_modulos em
    on em.empresa_id = p_empresa_id and em.modulo_clave = m.clave
  order by m.categoria, m.orden, m.nombre;
end;
$$;

create or replace function public.actualizar_modulo_empresa_sigo(
  p_empresa_id uuid,
  p_modulo_clave text,
  p_habilitado boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modulo public.sigo_modulos_catalogo%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or nullif(btrim(coalesce(p_modulo_clave, '')), '') is null or p_habilitado is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if not exists (
    select 1 from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and eu.rol in ('owner','admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_modulo from public.sigo_modulos_catalogo where clave = p_modulo_clave;
  if not found then raise exception 'MODULE_NOT_FOUND'; end if;
  if v_modulo.obligatorio and not p_habilitado then raise exception 'MODULE_REQUIRED'; end if;
  if p_habilitado and not v_modulo.disponible then raise exception 'MODULE_NOT_AVAILABLE'; end if;

  insert into public.sigo_empresa_modulos (empresa_id, modulo_clave, habilitado, actualizado_por, updated_at)
  values (p_empresa_id, p_modulo_clave, p_habilitado, auth.uid(), now())
  on conflict (empresa_id, modulo_clave)
  do update set
    habilitado = excluded.habilitado,
    actualizado_por = excluded.actualizado_por,
    updated_at = now();

  return true;
end;
$$;

create or replace function public.aplicar_preset_modulos_sigo(
  p_empresa_id uuid,
  p_preset text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claves text[];
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and eu.rol in ('owner','admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  case lower(btrim(coalesce(p_preset, '')))
    when 'kiosco' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes'];
    when 'almacen' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes'];
    when 'libreria' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes'];
    when 'mayorista' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes','portal_cliente'];
    when 'fiambreria' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes'];
    when 'gastronomia' then v_claves := array['ventas','productos','stock','lista_precios','compras','clientes','arca','informes'];
    when 'mixto' then v_claves := array['ventas','productos','stock','lista_precios','scanner','compras','clientes','cuentas_corrientes','arca','informes','portal_cliente'];
    else raise exception 'PRESET_INVALID';
  end case;

  insert into public.sigo_empresa_modulos (empresa_id, modulo_clave, habilitado, actualizado_por, updated_at)
  select
    p_empresa_id,
    m.clave,
    case
      when m.obligatorio then true
      when not m.disponible then false
      else m.clave = any(v_claves)
    end,
    auth.uid(),
    now()
  from public.sigo_modulos_catalogo m
  on conflict (empresa_id, modulo_clave)
  do update set
    habilitado = excluded.habilitado,
    actualizado_por = excluded.actualizado_por,
    updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.listar_modulos_empresa_sigo(uuid) from public;
revoke all on function public.actualizar_modulo_empresa_sigo(uuid, text, boolean) from public;
revoke all on function public.aplicar_preset_modulos_sigo(uuid, text) from public;
grant execute on function public.listar_modulos_empresa_sigo(uuid) to authenticated;
grant execute on function public.actualizar_modulo_empresa_sigo(uuid, text, boolean) to authenticated;
grant execute on function public.aplicar_preset_modulos_sigo(uuid, text) to authenticated;

comment on table public.sigo_empresa_modulos is 'SIGO: módulos habilitados por empresa/tenant.';
comment on function public.actualizar_modulo_empresa_sigo(uuid, text, boolean) is 'SIGO: owner/admin activa o desactiva un módulo disponible de su empresa.';
comment on function public.aplicar_preset_modulos_sigo(uuid, text) is 'SIGO: aplica una configuración base de módulos según tipo de negocio.';