-- SIGO readiness guard: certifica la carga inicial dentro de una sola caja y evita altas con costo_actual NULL.
-- No modifica stock, precios ni historicos. El ALTER solo agrega un valor por defecto y una restriccion de integridad.
do $$
declare
  v_empresa_id uuid;
  v_main_tenant_count integer;
  v_libreria_source integer;
  v_libreria_verified integer;
  v_computacion_source integer;
  v_computacion_verified integer;
  v_empresas_importadas integer;
  v_productos_tenant integer;
  v_costos_null_tenant integer;
  v_costos_null_global integer;
begin
  select count(*)
    into v_main_tenant_count
    from public.empresas e
   where lower(trim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true;

  if v_main_tenant_count <> 1 then
    raise exception 'SIGO_READINESS_MAIN_TENANT_COUNT_FAILED count=%', v_main_tenant_count;
  end if;

  select e.id
    into v_empresa_id
    from public.empresas e
   where lower(trim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   limit 1;

  select coalesce(sum(source_rows), 0), coalesce(sum(verified_rows), 0)
    into v_libreria_source, v_libreria_verified
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%';

  select coalesce(sum(source_rows), 0), coalesce(sum(verified_rows), 0)
    into v_computacion_source, v_computacion_verified
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%';

  select count(distinct empresa_id)
    into v_empresas_importadas
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'
      or import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%';

  if v_libreria_source <> 983 or v_libreria_verified <> 983 then
    raise exception 'SIGO_READINESS_LIBRERIA_FAILED source=% verified=%', v_libreria_source, v_libreria_verified;
  end if;

  if v_computacion_source <> 417 or v_computacion_verified <> 417 then
    raise exception 'SIGO_READINESS_COMPUTACION_FAILED source=% verified=%', v_computacion_source, v_computacion_verified;
  end if;

  if v_libreria_source + v_computacion_source <> 1400 then
    raise exception 'SIGO_READINESS_TOTAL_FAILED total=%', v_libreria_source + v_computacion_source;
  end if;

  if v_empresas_importadas <> 1 or exists (
    select 1
      from public.sigo_importaciones_stock i
     where (i.import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'
         or i.import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%')
       and i.empresa_id <> v_empresa_id
  ) then
    raise exception 'SIGO_READINESS_TENANT_SPLIT_DETECTED';
  end if;

  -- El ledger prueba las 1.400 filas fuente; este control adicional comprueba
  -- que el catálogo real del tenant no haya quedado por debajo de esa carga.
  select count(*)
    into v_productos_tenant
    from public.productos p
   where p.empresa_id = v_empresa_id;

  if v_productos_tenant < 1400 then
    raise exception 'SIGO_READINESS_CATALOG_COUNT_FAILED catalog=% expected_at_least=1400', v_productos_tenant;
  end if;

  select count(*)
    into v_costos_null_tenant
    from public.productos p
   where p.empresa_id = v_empresa_id
     and p.costo_actual is null;

  if v_costos_null_tenant <> 0 then
    raise exception 'SIGO_READINESS_NULL_CURRENT_COST_TENANT count=%', v_costos_null_tenant;
  end if;

  -- La restricción NOT NULL es global, por eso antes de aplicarla verificamos
  -- que ningún tenant existente vaya a romperse. No se hace backfill destructivo.
  select count(*)
    into v_costos_null_global
    from public.productos p
   where p.costo_actual is null;

  if v_costos_null_global <> 0 then
    raise exception 'SIGO_READINESS_NULL_CURRENT_COST_GLOBAL count=%', v_costos_null_global;
  end if;

  raise notice 'SIGO_READINESS_STOCK_COST_OK tenant=SIGO Administración libreria=983 computacion=417 total=1400 catalog=% costo_actual_null=0', v_productos_tenant;
end
$$;

alter table public.productos
  alter column costo_actual set default 0,
  alter column costo_actual set not null;
