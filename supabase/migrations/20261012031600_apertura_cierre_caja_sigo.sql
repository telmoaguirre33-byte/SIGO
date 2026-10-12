-- Turnos de caja SIGO, aislados por empresa y caja.
-- Toda escritura de estado pasa por RPC transaccionales; los cierres son inmutables.

create table if not exists public.caja_turnos_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  caja_id text not null default 'principal' check (length(trim(caja_id)) between 1 and 80),
  estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
  usuario_apertura uuid not null references auth.users(id) on delete restrict,
  fecha_apertura timestamptz not null default now(),
  fondo_inicial numeric(14,2) not null check (fondo_inicial >= 0),
  usuario_cierre uuid references auth.users(id) on delete restrict,
  fecha_cierre timestamptz,
  efectivo_contado numeric(14,2) check (efectivo_contado >= 0),
  efectivo_esperado numeric(14,2) check (efectivo_esperado >= 0),
  diferencia numeric(14,2),
  motivo_diferencia text,
  clave_apertura text not null,
  clave_cierre text,
  created_at timestamptz not null default now(),
  unique (empresa_id, clave_apertura),
  unique (empresa_id, clave_cierre),
  check (
    (estado = 'abierta' and usuario_cierre is null and fecha_cierre is null and efectivo_contado is null and efectivo_esperado is null and diferencia is null)
    or
    (estado = 'cerrada' and usuario_cierre is not null and fecha_cierre is not null and efectivo_contado is not null and efectivo_esperado is not null and diferencia is not null)
  )
);

create unique index if not exists caja_turnos_sigo_una_abierta_por_caja
  on public.caja_turnos_sigo (empresa_id, caja_id) where estado = 'abierta';
create index if not exists caja_turnos_sigo_historial_idx
  on public.caja_turnos_sigo (empresa_id, fecha_apertura desc);

create table if not exists public.caja_ajustes_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  turno_id uuid not null references public.caja_turnos_sigo(id) on delete restrict,
  tipo text not null check (tipo in ('ingreso','retiro')),
  importe numeric(14,2) not null check (importe > 0),
  motivo text not null check (length(trim(motivo)) between 3 and 300),
  usuario_id uuid not null references auth.users(id) on delete restrict,
  fecha timestamptz not null default now(),
  clave_idempotencia text not null,
  unique (empresa_id, clave_idempotencia)
);
create index if not exists caja_ajustes_sigo_turno_idx on public.caja_ajustes_sigo (turno_id, fecha);

alter table public.caja_movimientos_sigo
  add column if not exists turno_id uuid references public.caja_turnos_sigo(id) on delete restrict;
create index if not exists caja_movimientos_sigo_turno_idx
  on public.caja_movimientos_sigo (turno_id, created_at);

alter table public.caja_turnos_sigo enable row level security;
alter table public.caja_ajustes_sigo enable row level security;

drop policy if exists caja_turnos_sigo_select on public.caja_turnos_sigo;
create policy caja_turnos_sigo_select on public.caja_turnos_sigo
  for select to authenticated using (public.tiene_permiso_empresa(empresa_id, 'sales.read'));
drop policy if exists caja_ajustes_sigo_select on public.caja_ajustes_sigo;
create policy caja_ajustes_sigo_select on public.caja_ajustes_sigo
  for select to authenticated using (public.tiene_permiso_empresa(empresa_id, 'sales.read'));
drop policy if exists caja_turnos_sigo_insert_blocked on public.caja_turnos_sigo;
create policy caja_turnos_sigo_insert_blocked on public.caja_turnos_sigo
  for insert to authenticated with check (false);
drop policy if exists caja_turnos_sigo_update_blocked on public.caja_turnos_sigo;
create policy caja_turnos_sigo_update_blocked on public.caja_turnos_sigo
  for update to authenticated using (false) with check (false);
drop policy if exists caja_ajustes_sigo_insert_blocked on public.caja_ajustes_sigo;
create policy caja_ajustes_sigo_insert_blocked on public.caja_ajustes_sigo
  for insert to authenticated with check (false);

grant select on public.caja_turnos_sigo, public.caja_ajustes_sigo to authenticated;

-- Cada movimiento de una venta/devolución queda asociado al turno abierto al registrar.
-- El bloqueo de fila serializa ventas y cierres; si el cierre gana la carrera, la venta
-- aborta completa y puede reintentarse con la misma clave tras abrir el próximo turno.
create or replace function public.asignar_turno_movimiento_caja_sigo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_turno_id uuid;
begin
  if new.medio_pago = 'cuenta_corriente' then return new; end if;
  if new.turno_id is not null then return new; end if;

  select t.id into v_turno_id
    from public.caja_turnos_sigo t
   where t.empresa_id = new.empresa_id
     and t.caja_id = 'principal'
     and t.estado = 'abierta'
   for update;

  if v_turno_id is null then raise exception 'CASH_SESSION_REQUIRED'; end if;
  new.turno_id := v_turno_id;
  return new;
end;
$$;

drop trigger if exists caja_movimientos_asignar_turno_sigo on public.caja_movimientos_sigo;
create trigger caja_movimientos_asignar_turno_sigo
  before insert on public.caja_movimientos_sigo
  for each row execute function public.asignar_turno_movimiento_caja_sigo();

create or replace function public.abrir_turno_caja_sigo(
  p_empresa_id uuid,
  p_fondo_inicial numeric,
  p_clave_idempotencia text,
  p_caja_id text default 'principal'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_existente public.caja_turnos_sigo%rowtype;
  v_caja text := coalesce(nullif(trim(p_caja_id), ''), 'principal');
  v_key text := nullif(trim(p_clave_idempotencia), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'CASH_WRITE_FORBIDDEN'; end if;
  if p_fondo_inicial is null or p_fondo_inicial < 0 or p_fondo_inicial::text in ('NaN','Infinity','-Infinity') then raise exception 'CASH_AMOUNT_INVALID'; end if;
  if v_key is null or length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if length(v_caja) > 80 then raise exception 'CASH_REGISTER_INVALID'; end if;

  select * into v_existente from public.caja_turnos_sigo where empresa_id = p_empresa_id and clave_apertura = v_key;
  if found then
    if v_existente.fondo_inicial is distinct from round(p_fondo_inicial,2) or v_existente.caja_id is distinct from v_caja then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_existente.id;
  end if;
  insert into public.caja_turnos_sigo (empresa_id, caja_id, usuario_apertura, fondo_inicial, clave_apertura)
  values (p_empresa_id, v_caja, v_user, round(p_fondo_inicial, 2), v_key)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  select * into v_existente from public.caja_turnos_sigo where empresa_id = p_empresa_id and clave_apertura = v_key;
  if found then
    if v_existente.fondo_inicial is distinct from round(p_fondo_inicial,2) or v_existente.caja_id is distinct from v_caja then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_existente.id;
  end if;
  raise exception 'CASH_SESSION_ALREADY_OPEN';
end;
$$;

create or replace function public.ajustar_efectivo_caja_sigo(
  p_empresa_id uuid,
  p_turno_id uuid,
  p_tipo text,
  p_importe numeric,
  p_motivo text,
  p_clave_idempotencia text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ajuste_id uuid;
  v_turno public.caja_turnos_sigo%rowtype;
  v_key text := nullif(trim(p_clave_idempotencia), '');
  v_motivo text := nullif(trim(p_motivo), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'CASH_WRITE_FORBIDDEN'; end if;
  if p_tipo not in ('ingreso','retiro') then raise exception 'CASH_ADJUSTMENT_TYPE_INVALID'; end if;
  if p_importe is null or p_importe <= 0 or p_importe::text in ('NaN','Infinity','-Infinity') then raise exception 'CASH_AMOUNT_INVALID'; end if;
  if length(coalesce(v_motivo,'')) < 3 or length(v_motivo) > 300 then raise exception 'CASH_REASON_REQUIRED'; end if;
  if v_key is null or length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  select id into v_ajuste_id from public.caja_ajustes_sigo
   where empresa_id = p_empresa_id and clave_idempotencia = v_key
     and turno_id = p_turno_id and tipo = p_tipo and importe = round(p_importe,2) and motivo = v_motivo;
  if v_ajuste_id is not null then return v_ajuste_id; end if;
  if exists (select 1 from public.caja_ajustes_sigo where empresa_id = p_empresa_id and clave_idempotencia = v_key) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  select * into v_turno from public.caja_turnos_sigo
   where id = p_turno_id and empresa_id = p_empresa_id and estado = 'abierta' for update;
  if not found then raise exception 'CASH_SESSION_CLOSED'; end if;

  insert into public.caja_ajustes_sigo (empresa_id, turno_id, tipo, importe, motivo, usuario_id, clave_idempotencia)
  values (p_empresa_id, p_turno_id, p_tipo, round(p_importe,2), v_motivo, v_user, v_key)
  returning id into v_ajuste_id;
  insert into public.caja_movimientos_sigo (empresa_id, turno_id, tipo, medio_pago, importe, concepto, created_by)
  values (p_empresa_id, p_turno_id, case when p_tipo='retiro' then 'egreso' else 'ingreso' end,
          'efectivo', round(p_importe,2), 'Ajuste de caja: ' || v_motivo, v_user);
  return v_ajuste_id;
exception when unique_violation then
  select id into v_ajuste_id from public.caja_ajustes_sigo
   where empresa_id = p_empresa_id and clave_idempotencia = v_key
     and turno_id = p_turno_id and tipo = p_tipo and importe = round(p_importe,2) and motivo = v_motivo;
  if v_ajuste_id is not null then return v_ajuste_id; end if;
  if exists (select 1 from public.caja_ajustes_sigo where empresa_id = p_empresa_id and clave_idempotencia = v_key) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  raise;
end;
$$;

create or replace function public.cerrar_turno_caja_sigo(
  p_empresa_id uuid,
  p_turno_id uuid,
  p_efectivo_contado numeric,
  p_motivo_diferencia text,
  p_clave_idempotencia text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_turno public.caja_turnos_sigo%rowtype;
  v_esperado numeric(14,2);
  v_diferencia numeric(14,2);
  v_motivo text := nullif(trim(p_motivo_diferencia), '');
  v_key text := nullif(trim(p_clave_idempotencia), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'CASH_WRITE_FORBIDDEN'; end if;
  if p_efectivo_contado is null or p_efectivo_contado < 0 or p_efectivo_contado::text in ('NaN','Infinity','-Infinity') then raise exception 'CASH_AMOUNT_INVALID'; end if;
  if v_key is null or length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;

  select * into v_turno from public.caja_turnos_sigo
   where id = p_turno_id and empresa_id = p_empresa_id for update;
  if not found then raise exception 'CASH_SESSION_NOT_FOUND'; end if;
  if v_turno.estado = 'cerrada' then
    if v_turno.clave_cierre = v_key then
      if v_turno.efectivo_contado is distinct from round(p_efectivo_contado,2)
         or v_turno.motivo_diferencia is distinct from v_motivo then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return jsonb_build_object('turno_id',v_turno.id,'efectivo_esperado',v_turno.efectivo_esperado,'efectivo_contado',v_turno.efectivo_contado,'diferencia',v_turno.diferencia);
    end if;
    raise exception 'CASH_SESSION_ALREADY_CLOSED';
  end if;

  select round(v_turno.fondo_inicial + coalesce(sum(
    case when medio_pago = 'efectivo' and tipo = 'ingreso' then importe
         when medio_pago = 'efectivo' and tipo = 'egreso' then -importe else 0 end
  ),0),2)
    into v_esperado
    from public.caja_movimientos_sigo
   where empresa_id = p_empresa_id and turno_id = p_turno_id;
  v_diferencia := round(p_efectivo_contado - v_esperado,2);
  if abs(v_diferencia) >= 0.01 and length(coalesce(v_motivo,'')) < 3 then raise exception 'CASH_DIFFERENCE_REASON_REQUIRED'; end if;

  update public.caja_turnos_sigo
     set estado='cerrada', usuario_cierre=v_user, fecha_cierre=now(),
         efectivo_contado=round(p_efectivo_contado,2), efectivo_esperado=v_esperado,
         diferencia=v_diferencia, motivo_diferencia=v_motivo, clave_cierre=v_key
   where id=p_turno_id and empresa_id=p_empresa_id and estado='abierta';
  return jsonb_build_object('turno_id',p_turno_id,'efectivo_esperado',v_esperado,'efectivo_contado',round(p_efectivo_contado,2),'diferencia',v_diferencia);
end;
$$;

-- Valida el billete recibido contra el total calculado en servidor dentro de la
-- misma transacción. Si queda corto, se revierte también la venta y su descuento de stock.
create or replace function public.confirmar_venta_caja_sigo(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago text,
  p_idempotency_key text,
  p_cliente_id uuid,
  p_descuento_pct numeric,
  p_efectivo_recibido numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_venta_id uuid;
  v_total numeric(14,2);
begin
  if p_medio_pago = 'efectivo' and (p_efectivo_recibido is null or p_efectivo_recibido < 0
     or p_efectivo_recibido::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'CASH_AMOUNT_INVALID';
  end if;
  select public.confirmar_venta_sigo_v2(
    p_empresa_id, p_items, p_medio_pago, p_idempotency_key, p_cliente_id, p_descuento_pct
  ) into v_venta_id;
  if p_medio_pago = 'efectivo' then
    select total into v_total from public.ventas_sigo where id = v_venta_id and empresa_id = p_empresa_id;
    if p_efectivo_recibido < v_total then raise exception 'CASH_RECEIVED_INSUFFICIENT'; end if;
  end if;
  return v_venta_id;
end;
$$;

revoke all on function public.abrir_turno_caja_sigo(uuid,numeric,text,text) from public, anon;
revoke all on function public.ajustar_efectivo_caja_sigo(uuid,uuid,text,numeric,text,text) from public, anon;
revoke all on function public.cerrar_turno_caja_sigo(uuid,uuid,numeric,text,text) from public, anon;
revoke all on function public.confirmar_venta_caja_sigo(uuid,jsonb,text,text,uuid,numeric,numeric) from public, anon;
grant execute on function public.abrir_turno_caja_sigo(uuid,numeric,text,text) to authenticated;
grant execute on function public.ajustar_efectivo_caja_sigo(uuid,uuid,text,numeric,text,text) to authenticated;
grant execute on function public.cerrar_turno_caja_sigo(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.confirmar_venta_caja_sigo(uuid,jsonb,text,text,uuid,numeric,numeric) to authenticated;

comment on table public.caja_turnos_sigo is 'Turnos de caja SIGO por empresa y punto de caja; los cierres quedan inmutables.';
comment on table public.caja_ajustes_sigo is 'Ingresos y retiros auditables de efectivo de cada turno de caja.';
