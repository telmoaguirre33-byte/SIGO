-- SIGO: guardas de tenant para nuevas escrituras operativas.
-- Seguro para transición: no modifica filas legacy ni activa RLS antes del backfill.

create or replace function public.sigo_validar_empresa_operativa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.empresa_id is null then
    raise exception 'SIGO: empresa_id es obligatorio para nuevas operaciones';
  end if;

  if not public.es_miembro_empresa(new.empresa_id) then
    raise exception 'SIGO: usuario sin acceso a la empresa indicada';
  end if;

  return new;
end;
$$;

revoke all on function public.sigo_validar_empresa_operativa() from public;

-- Instala la guarda solo en tablas existentes que ya tengan empresa_id.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'productos',
    'stock',
    'compras',
    'compra_detalles',
    'ventas',
    'venta_detalles',
    'clientes',
    'proveedores'
  ]
  loop
    if to_regclass('public.' || v_table) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_table
           and column_name = 'empresa_id'
       ) then
      execute format('drop trigger if exists sigo_tenant_insert_guard on public.%I', v_table);
      execute format(
        'create trigger sigo_tenant_insert_guard before insert on public.%I for each row execute function public.sigo_validar_empresa_operativa()',
        v_table
      );
    end if;
  end loop;
end;
$$;

comment on function public.sigo_validar_empresa_operativa() is
  'SIGO: impide nuevas filas operativas sin tenant o en empresas ajenas durante la transición a RLS estricta.';
