-- SIGO: corrige el diagnóstico de tenant para que el analizador de PostgreSQL
-- pueda validar la función sin interpretar el array FOREACH como un nombre de tabla.
-- No modifica datos ni políticas; sólo reemplaza una función de lectura/diagnóstico.

create or replace function public.sigo_tenant_diagnostico()
returns table (
  tabla text,
  filas_sin_empresa bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_count bigint;
begin
  for v_table in
    select unnest(array[
      'productos',
      'stock',
      'compras',
      'compra_detalles',
      'ventas',
      'venta_detalles',
      'clientes',
      'proveedores'
    ]::text[])
  loop
    if to_regclass(format('public.%I', v_table)) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = v_table
           and c.column_name = 'empresa_id'
       ) then
      execute format(
        'select count(*) from public.%I where empresa_id is null',
        v_table
      ) into v_count;

      tabla := v_table;
      filas_sin_empresa := v_count;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.sigo_tenant_diagnostico() from public;
grant execute on function public.sigo_tenant_diagnostico() to authenticated;

comment on function public.sigo_tenant_diagnostico() is
  'SIGO: cuenta filas legacy sin empresa_id antes de activar RLS multiempresa; implementación compatible con lint de producción.';
