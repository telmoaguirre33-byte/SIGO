-- COMERCIAL: el padrón comercial ya existe en producción (migración 20260919164124).
create schema if not exists sigo_comercial_privado;
revoke all on schema sigo_comercial_privado from public, anon, authenticated;
grant usage on schema sigo_comercial_privado to authenticated;

-- El titular puede leer su registro, pero solo el flujo administrativo puede escribirlo.
drop policy if exists cliente_propietario_alta on public.sigo_clientes_comerciales;
drop policy if exists cliente_propietario_edicion on public.sigo_clientes_comerciales;
revoke insert, update, delete, truncate on public.sigo_clientes_comerciales from public, anon, authenticated;

create unique index if not exists sigo_clientes_comerciales_empresa_uidx
  on public.sigo_clientes_comerciales (empresa_id) where empresa_id is not null;

create table sigo_comercial_privado.pagos (
  operacion_id uuid primary key,
  empresa_id uuid not null references public.empresas(id),
  registrado_por uuid not null,
  importe_ars numeric(14,2) not null check (importe_ars > 0),
  registrado_en timestamptz not null default now(),
  vencimiento_anterior date,
  proximo_pago date not null
);
alter table sigo_comercial_privado.pagos enable row level security;
create index pagos_empresa_fecha_idx on sigo_comercial_privado.pagos (empresa_id, registrado_en desc);

create function sigo_comercial_privado.estado_empresa(
  activa boolean, habilitado boolean, estado text, estado_pago text,
  fecha_proximo_pago date, inicio_prueba timestamptz
)
returns text language sql stable set search_path = '' as $$
  select case
    when activa is not true or habilitado is false or estado in ('suspended', 'suspendido', 'disabled', 'inactive', 'cancelled') then 'suspendida'
    when estado = 'active' and estado_pago = 'pagado'
      and fecha_proximo_pago > (now() at time zone 'America/Argentina/Buenos_Aires')::date then 'pagada'
    when estado_pago = 'pagado' or estado = 'active' then 'pago_vencido'
    when inicio_prueba < timestamptz '2026-09-20 17:00:00+00' then 'anterior'
    when now() >= inicio_prueba + interval '720 hours' then 'prueba_vencida'
    else 'prueba'
  end
$$;

create function sigo_comercial_privado.mis_accesos()
returns table (empresa_id uuid, estado text)
language sql stable security definer set search_path = '' as $$
  select e.id, case when eu.activo then
    sigo_comercial_privado.estado_empresa(e.activa, c.habilitado, c.estado,
      c.estado_pago, c.fecha_proximo_pago, coalesce(titular.created_at, e.created_at))
    else 'suspendida' end
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  left join auth.users titular on titular.id = e.created_by
  left join public.sigo_clientes_comerciales c on c.empresa_id = e.id
  where eu.user_id = auth.uid()
  union all
  select null, 'superadmin' where public.es_superadmin_sigo()
$$;

create function public.mis_accesos_comerciales_sigo()
returns table (empresa_id uuid, estado text)
language sql stable security invoker set search_path = '' as $$
  select * from sigo_comercial_privado.mis_accesos()
$$;

create function sigo_comercial_privado.matriz_accesos()
returns table (empresa_id uuid, estado text, fecha_proximo_pago date, inicio_prueba timestamptz, historial jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, sigo_comercial_privado.estado_empresa(e.activa, c.habilitado,
    c.estado, c.estado_pago, c.fecha_proximo_pago, coalesce(titular.created_at, e.created_at)),
    c.fecha_proximo_pago, coalesce(titular.created_at, e.created_at),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.registrado_en desc) from (
      select importe_ars, registrado_en, proximo_pago
      from sigo_comercial_privado.pagos where empresa_id = e.id
      order by registrado_en desc, operacion_id desc limit 10
    ) p), '[]'::jsonb)
  from public.empresas e
  left join auth.users titular on titular.id = e.created_by
  left join public.sigo_clientes_comerciales c on c.empresa_id = e.id
  where auth.uid() is not null and public.es_superadmin_sigo()
$$;

create function public.matriz_accesos_comerciales_sigo()
returns table (empresa_id uuid, estado text, fecha_proximo_pago date, inicio_prueba timestamptz, historial jsonb)
language sql stable security invoker set search_path = '' as $$
  select * from sigo_comercial_privado.matriz_accesos()
$$;

create function sigo_comercial_privado.registrar_pago(
  p_empresa_id uuid, p_operacion_id uuid, p_importe numeric, p_proximo_pago date
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa public.empresas%rowtype;
  v_cliente public.sigo_clientes_comerciales%rowtype;
  v_pago sigo_comercial_privado.pagos%rowtype;
begin
  if auth.uid() is null or not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_operacion_id is null or p_importe is null or p_importe <= 0
    or p_importe >= 1000000000000 or p_importe <> round(p_importe, 2)
    or p_proximo_pago is null or not isfinite(p_proximo_pago) then
    raise exception 'PAGO_INVALIDO';
  end if;

  select * into strict v_empresa from public.empresas where id = p_empresa_id for update;
  select * into v_pago from sigo_comercial_privado.pagos where operacion_id = p_operacion_id;
  if found then
    if v_pago.empresa_id = p_empresa_id and v_pago.importe_ars = p_importe
      and v_pago.proximo_pago = p_proximo_pago and v_pago.registrado_por = auth.uid() then
      return;
    end if;
    raise exception 'OPERACION_DUPLICADA';
  end if;

  select * into v_cliente from public.sigo_clientes_comerciales where empresa_id = p_empresa_id for update;
  if v_empresa.activa is not true or v_cliente.habilitado is false
    or v_cliente.estado in ('suspended', 'suspendido', 'disabled', 'inactive', 'cancelled') then
    raise exception 'EMPRESA_SUSPENDIDA';
  end if;
  if p_proximo_pago <= (now() at time zone 'America/Argentina/Buenos_Aires')::date
    or (v_cliente.estado_pago = 'pagado' and p_proximo_pago <= v_cliente.fecha_proximo_pago) then
    raise exception 'VENCIMIENTO_INVALIDO';
  end if;

  if v_cliente.user_id is null then
    select eu.user_id into v_cliente.user_id
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id and eu.activo and eu.rol = 'owner'
    order by (eu.user_id = v_empresa.created_by) desc nulls last, eu.created_at, eu.user_id limit 1;
    if v_cliente.user_id is null then raise exception 'EMPRESA_SIN_TITULAR'; end if;
    insert into public.sigo_clientes_comerciales (user_id, empresa_id, email, plan, estado,
      habilitado, estado_pago, importe_pendiente, fecha_ultimo_pago, fecha_proximo_pago)
    select u.id, p_empresa_id, u.email, 'Mensual', 'active', true, 'pagado', 0, now(), p_proximo_pago
    from auth.users u where u.id = v_cliente.user_id;
  else
    update public.sigo_clientes_comerciales
    set plan = case when lower(plan) like 'prueba%' then 'Mensual' else plan end,
      estado = 'active', habilitado = true, estado_pago = 'pagado', importe_pendiente = 0,
      fecha_ultimo_pago = now(), fecha_proximo_pago = p_proximo_pago, updated_at = now()
    where empresa_id = p_empresa_id;
  end if;

  insert into sigo_comercial_privado.pagos
    (operacion_id, empresa_id, registrado_por, importe_ars, vencimiento_anterior, proximo_pago)
  values (p_operacion_id, p_empresa_id, auth.uid(), p_importe, v_cliente.fecha_proximo_pago, p_proximo_pago);
end
$$;

create function public.matriz_registrar_pago_sigo(
  p_empresa_id uuid, p_operacion_id uuid, p_importe numeric, p_proximo_pago date
)
returns void language sql security invoker set search_path = '' as $$
  select sigo_comercial_privado.registrar_pago(p_empresa_id, p_operacion_id, p_importe, p_proximo_pago)
$$;

revoke all on all functions in schema sigo_comercial_privado from public, anon, authenticated;
grant execute on function sigo_comercial_privado.mis_accesos(),
  sigo_comercial_privado.matriz_accesos(),
  sigo_comercial_privado.registrar_pago(uuid, uuid, numeric, date) to authenticated;
revoke all on function public.mis_accesos_comerciales_sigo(),
  public.matriz_accesos_comerciales_sigo(),
  public.matriz_registrar_pago_sigo(uuid, uuid, numeric, date) from public, anon, authenticated;
grant execute on function public.mis_accesos_comerciales_sigo(),
  public.matriz_accesos_comerciales_sigo(),
  public.matriz_registrar_pago_sigo(uuid, uuid, numeric, date) to authenticated;
