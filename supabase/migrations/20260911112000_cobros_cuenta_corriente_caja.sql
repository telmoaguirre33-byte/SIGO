-- SIGO: cobros de cuenta corriente consistentes con Caja.
-- Migración aditiva: conserva históricos y agrega una RPC v2 segura.

create or replace function public.registrar_cobro_cliente_sigo_v2(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_importe numeric,
  p_medio_pago text default 'efectivo',
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
  v_importe numeric(14,2) := round(coalesce(p_importe, 0), 2);
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'clients.write') then raise exception 'CLIENTS_WRITE_FORBIDDEN'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if v_importe <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;

  select saldo_actual into v_saldo
  from public.clientes_sigo
  where id = p_cliente_id and empresa_id = p_empresa_id and activo = true
  for update;

  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_saldo <= 0 then raise exception 'CLIENT_WITHOUT_DEBT'; end if;
  if v_importe > v_saldo then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;

  insert into public.cliente_movimientos_sigo
    (empresa_id, cliente_id, tipo, importe, concepto, created_by)
  values
    (p_empresa_id, p_cliente_id, 'haber', v_importe,
     coalesce(nullif(trim(p_concepto), ''), 'Cobro cuenta corriente'), v_user_id)
  returning id into v_movimiento_id;

  update public.clientes_sigo
  set saldo_actual = saldo_actual - v_importe,
      updated_at = now()
  where id = p_cliente_id and empresa_id = p_empresa_id;

  insert into public.caja_movimientos_sigo
    (empresa_id, venta_id, tipo, medio_pago, importe, concepto, created_by)
  values
    (p_empresa_id, null, 'ingreso', p_medio_pago, v_importe,
     coalesce(nullif(trim(p_concepto), ''), 'Cobro cuenta corriente'), v_user_id);

  return v_movimiento_id;
end;
$$;

revoke all on function public.registrar_cobro_cliente_sigo_v2(uuid, uuid, numeric, text, text) from public;
grant execute on function public.registrar_cobro_cliente_sigo_v2(uuid, uuid, numeric, text, text) to authenticated;

comment on function public.registrar_cobro_cliente_sigo_v2(uuid, uuid, numeric, text, text) is
  'SIGO: registra cobro de cuenta corriente, impide sobrecobro y genera ingreso de caja en la misma transaccion.';
