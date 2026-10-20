-- SIGO: vinculación administrativa segura Usuario Cliente -> Cliente comercial.
-- Cierra el circuito Empresa -> Usuario client -> clientes_sigo sin exponer costos ni cruzar tenants.
-- Migración aditiva: no elimina productos, stock, ventas, compras ni históricos comerciales.

create or replace function public.listar_vinculos_portal_cliente_sigo(p_empresa_id uuid)
returns table (
  membresia_id uuid,
  user_id uuid,
  cliente_id uuid,
  cliente_nombre text,
  vinculos_activos integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'users.manage')
     and not public.es_superadmin_sigo() then
    raise exception 'USERS_MANAGE_FORBIDDEN';
  end if;

  return query
  select
    eu.id as membresia_id,
    eu.user_id,
    case when coalesce(v.cantidad, 0) = 1 then v.cliente_id else null end,
    case when coalesce(v.cantidad, 0) = 1 then v.cliente_nombre else null end,
    coalesce(v.cantidad, 0)::integer as vinculos_activos
  from public.empresa_usuarios eu
  left join lateral (
    select
      count(*)::integer as cantidad,
      (array_agg(pcu.cliente_id order by pcu.creado_en))[1] as cliente_id,
      (array_agg(c.nombre order by pcu.creado_en))[1]::text as cliente_nombre
    from public.portal_cliente_usuarios pcu
    left join public.clientes_sigo c
      on c.id = pcu.cliente_id
     and c.empresa_id = pcu.empresa_id
    where pcu.empresa_id = p_empresa_id
      and pcu.user_id = eu.user_id
      and pcu.activo = true
  ) v on true
  where eu.empresa_id = p_empresa_id
    and eu.rol = 'client'
  order by eu.created_at asc;
end;
$$;

create or replace function public.vincular_usuario_cliente_sigo(
  p_empresa_id uuid,
  p_membresia_id uuid,
  p_cliente_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'users.manage')
     and not public.es_superadmin_sigo() then
    raise exception 'USERS_MANAGE_FORBIDDEN';
  end if;

  select eu.user_id, eu.rol, eu.activo
    into v_target
  from public.empresa_usuarios eu
  where eu.id = p_membresia_id
    and eu.empresa_id = p_empresa_id
  for update;

  if not found then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;

  -- Permite desvincular incluso si el rol cambió, para poder reparar estados legacy.
  if p_cliente_id is null then
    update public.portal_cliente_usuarios
       set activo = false
     where empresa_id = p_empresa_id
       and user_id = v_target.user_id
       and activo = true;
    return null;
  end if;

  if v_target.rol <> 'client' or v_target.activo is not true then
    raise exception 'CLIENT_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.clientes_sigo c
    where c.id = p_cliente_id
      and c.empresa_id = p_empresa_id
      and c.activo = true
  ) then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  -- Un usuario client sólo puede representar un cliente activo por empresa.
  -- Primero desactiva cualquier vínculo previo/duplicado y luego activa el elegido.
  update public.portal_cliente_usuarios
     set activo = false
   where empresa_id = p_empresa_id
     and user_id = v_target.user_id
     and activo = true;

  insert into public.portal_cliente_usuarios (empresa_id, cliente_id, user_id, activo)
  values (p_empresa_id, p_cliente_id, v_target.user_id, true)
  on conflict (empresa_id, cliente_id, user_id)
  do update set activo = true, creado_en = now();

  return p_cliente_id;
end;
$$;

-- Si un usuario deja de ser client o queda inactivo, su acceso al portal se corta
-- automáticamente aunque el cambio provenga de otro flujo administrativo.
create or replace function public.sincronizar_portal_cliente_membresia_sigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists trg_sincronizar_portal_cliente_membresia_sigo on public.empresa_usuarios;
create trigger trg_sincronizar_portal_cliente_membresia_sigo
after update of rol, activo on public.empresa_usuarios
for each row
execute function public.sincronizar_portal_cliente_membresia_sigo();

-- Fail closed: el portal exige membresía client activa y exactamente un cliente
-- comercial activo vinculado dentro de la misma empresa.
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
  where s.empresa_id = p_empresa_id
    and s.cliente_id = v_cliente_id
    and s.publicado = true
  order by p.nombre asc;
end;
$$;

revoke all on function public.listar_vinculos_portal_cliente_sigo(uuid) from public;
grant execute on function public.listar_vinculos_portal_cliente_sigo(uuid) to authenticated;
revoke all on function public.vincular_usuario_cliente_sigo(uuid, uuid, uuid) from public;
grant execute on function public.vincular_usuario_cliente_sigo(uuid, uuid, uuid) to authenticated;
revoke all on function public.portal_cliente_catalogo_sigo(uuid) from public;
grant execute on function public.portal_cliente_catalogo_sigo(uuid) to authenticated;

comment on function public.vincular_usuario_cliente_sigo(uuid, uuid, uuid) is
  'SIGO: users.manage vincula un usuario client activo con exactamente un clientes_sigo del mismo tenant; null desvincula.';
comment on function public.portal_cliente_catalogo_sigo(uuid) is
  'SIGO Portal Cliente: exige membresía client activa y vínculo único a cliente activo; nunca expone costos ni márgenes.';
