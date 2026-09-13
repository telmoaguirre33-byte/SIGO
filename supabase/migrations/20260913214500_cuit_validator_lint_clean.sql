-- SIGO: elimina warning de lint del validador CUIT manteniendo la misma regla funcional.
create or replace function public.sigo_cuit_argentino_valido(p_cuit text)
returns boolean
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_cuit text;
  v_pesos integer[] := array[5,4,3,2,7,6,5,4,3,2];
  v_suma integer := 0;
  v_resto integer;
  v_esperado integer;
begin
  v_cuit := regexp_replace(p_cuit, '[^0-9]', '', 'g');
  if length(v_cuit) <> 11 then
    return false;
  end if;

  for i in 1..10 loop
    v_suma := v_suma + (substr(v_cuit, i, 1)::integer * v_pesos[i]);
  end loop;

  v_resto := 11 - (v_suma % 11);
  v_esperado := case when v_resto = 11 then 0 when v_resto = 10 then 9 else v_resto end;
  return substr(v_cuit, 11, 1)::integer = v_esperado;
exception when others then
  return false;
end;
$$;

do $$
declare
  v_guard_count integer;
begin
  select count(*) into v_guard_count
    from pg_trigger t
   where t.tgname in (
     'proveedores_sigo_integridad_guard',
     'compras_sigo_cabecera_integridad_guard',
     'compra_items_sigo_integridad_guard',
     'arca_config_integridad_guard'
   )
     and not t.tgisinternal;

  if v_guard_count <> 4 then
    raise exception 'SIGO_GO_LIVE_GUARDS_RECERTIFICATION_FAILED count=%', v_guard_count;
  end if;

  raise notice 'SIGO_GO_LIVE_GUARDS_RECERTIFIED count=4 cuit_validator=LINT_CLEAN';
end
$$;
