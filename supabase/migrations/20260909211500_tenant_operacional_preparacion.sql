-- SIGO: preparación segura de tablas operativas para aislamiento multiempresa.
-- Objetivo: incorporar empresa_id sin borrar, reasignar ni ocultar datos existentes.
-- Esta migración NO activa RLS en tablas con datos legacy sin tenant; el endurecimiento
-- se realiza en una migración posterior una vez que cada fila tenga empresa_id válido.

create extension if not exists pgcrypto;

-- Agrega empresa_id únicamente a tablas que ya existan.
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
    if to_regclass('public.' || v_table) is not null then
      execute format(
        'alter table public.%I add column if not exists empresa_id uuid references public.empresas(id) on delete restrict',
        v_table
      );

      execute format(
        'create index if not exists %I on public.%I (empresa_id)',
        v_table || '_empresa_id_idx',
        v_table
      );
    end if;
  end loop;
end;
$$;

-- Diagnóstico reutilizable: permite saber qué tablas todavía tienen filas sin empresa.
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
  'SIGO: cuenta filas legacy sin empresa_id antes de activar RLS multiempresa.';

-- Helpers de validación para futuras escrituras.
create or replace function public.sigo_empresa_es_accesible(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_empresa_id is not null
     and public.es_miembro_empresa(p_empresa_id);
$$;

revoke all on function public.sigo_empresa_es_accesible(uuid) from public;
grant execute on function public.sigo_empresa_es_accesible(uuid) to authenticated;

comment on function public.sigo_empresa_es_accesible(uuid) is
  'SIGO: valida que el tenant solicitado pertenezca al usuario autenticado.';

-- Importante:
-- 1) No se asigna automáticamente ninguna fila existente a una empresa.
-- 2) No se activa RLS aquí para evitar dejar invisibles productos/stock legacy.
-- 3) Próximo paso: backfill explícito y auditable por empresa; luego empresa_id NOT NULL + RLS.
