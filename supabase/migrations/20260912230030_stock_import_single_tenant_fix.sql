-- SIGO: corrección segura de la carga inicial de stock.
-- La migración 20260912230000 alcanzó producción y creó dos empresas auxiliares,
-- pero el primer lote de productos falló antes de insertar mercadería por la guarda de tenant.
-- Esta migración NO borra datos: oculta únicamente esas empresas auxiliares si siguen vacías
-- y redirige los lotes pendientes al tenant real "SIGO Administración" (una sola caja/empresa).

do $$
declare
  v_owner_id uuid;
  v_empresa_id uuid;
begin
  select eu.user_id, e.id
    into v_owner_id, v_empresa_id
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.rol = 'owner'
     and eu.activo = true
   where lower(trim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   order by e.created_at asc
   limit 1;

  if v_owner_id is null or v_empresa_id is null then
    raise exception 'SIGO_STOCK_IMPORT_MAIN_TENANT_NOT_FOUND';
  end if;

  -- Las dos empresas fueron creadas por la migración anterior y el primer lote falló
  -- antes de insertar productos. Se desactivan solo si continúan vacías y pertenecen
  -- al mismo owner. No se eliminan empresas, membresías, productos ni históricos.
  update public.empresas e
     set activa = false,
         updated_at = now()
   where lower(trim(e.nombre)) in (lower('Lápiz y Papel'), lower('Sertec'))
     and e.id <> v_empresa_id
     and e.created_by = v_owner_id
     and not exists (select 1 from public.productos p where p.empresa_id = e.id);
end
$$;

create or replace function public.sigo_importar_stock_resguardo(
  p_empresa_nombre text,
  p_import_key text,
  p_payload text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_empresa_id uuid;
  v_line text;
  v_a text[];
  v_codigo_barras text;
  v_codigo_interno text;
  v_nombre text;
  v_precio numeric;
  v_stock numeric;
  v_proveedor text;
  v_costo numeric;
  v_descripcion text;
  v_categoria text;
  v_source_rows integer := 0;
  v_inserted integer := 0;
  v_verified integer := 0;
  v_rowcount integer;
begin
  if nullif(btrim(p_import_key), '') is null then raise exception 'IMPORT_KEY_REQUIRED'; end if;
  if nullif(p_payload, '') is null then return 0; end if;

  select eu.user_id, e.id
    into v_owner_id, v_empresa_id
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.rol = 'owner'
     and eu.activo = true
   where lower(trim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   order by e.created_at asc
   limit 1;

  if v_owner_id is null or v_empresa_id is null then
    raise exception 'SIGO_STOCK_IMPORT_MAIN_TENANT_NOT_FOUND';
  end if;

  -- La guarda histórica de public.productos exige auth.uid(). Durante una migración no
  -- existe JWT, por eso establecemos de forma LOCAL a esta transacción el uid del owner.
  -- La función sigue revocada al público y solo se usa para este bootstrap controlado.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  for v_line in
    select line
      from regexp_split_to_table(p_payload, E'\n') line
     where btrim(line) <> ''
  loop
    v_source_rows := v_source_rows + 1;
    v_a := regexp_split_to_array(v_line, E'\t');

    if cardinality(v_a) <> 9 then
      raise exception 'SIGO_STOCK_IMPORT_BAD_ROW_%: %', v_source_rows, v_line;
    end if;

    v_codigo_barras := nullif(btrim(v_a[1]), '');
    v_codigo_interno := nullif(btrim(v_a[2]), '');
    v_nombre := nullif(btrim(v_a[3]), '');
    v_precio := coalesce(nullif(v_a[4], '')::numeric, 0);
    v_stock := coalesce(nullif(v_a[5], '')::numeric, 0);
    v_proveedor := nullif(btrim(v_a[6]), '');
    v_costo := nullif(v_a[7], '')::numeric;
    v_descripcion := nullif(btrim(v_a[8]), '');
    v_categoria := nullif(btrim(v_a[9]), '');

    if v_nombre is null or (v_codigo_barras is null and v_codigo_interno is null) then
      raise exception 'SIGO_STOCK_IMPORT_IDENTITY_REQUIRED_%', v_source_rows;
    end if;
    if v_precio < 0 or v_stock < 0 or (v_costo is not null and v_costo < 0) then
      raise exception 'SIGO_STOCK_IMPORT_NEGATIVE_VALUE_%', v_source_rows;
    end if;

    if not exists (
      select 1
        from public.productos p
       where p.empresa_id = v_empresa_id
         and (
           (v_codigo_barras is not null and (p.codigo_barras = v_codigo_barras or p.codigo_interno = v_codigo_barras))
           or
           (v_codigo_interno is not null and (p.codigo_interno = v_codigo_interno or p.codigo_barras = v_codigo_interno))
         )
    ) then
      insert into public.productos (
        empresa_id, codigo_interno, codigo_barras, nombre, descripcion, categoria, marca, proveedor,
        costo_actual, costo_ultima_compra, precio_venta, margen_ganancia, margen_porcentaje,
        stock_actual, stock_minimo, stock_maximo, activo
      ) values (
        v_empresa_id, v_codigo_interno, v_codigo_barras, v_nombre, v_descripcion, v_categoria, null, v_proveedor,
        v_costo, v_costo, v_precio,
        case when v_costo is null then null else greatest(v_precio - v_costo, 0) end,
        case when v_costo is null or v_costo = 0 then null else round(greatest((v_precio - v_costo) / v_costo * 100, 0), 4) end,
        v_stock, null, null, true
      );
      get diagnostics v_rowcount = row_count;
      v_inserted := v_inserted + v_rowcount;
    end if;

    if exists (
      select 1
        from public.productos p
       where p.empresa_id = v_empresa_id
         and (
           (v_codigo_barras is not null and (p.codigo_barras = v_codigo_barras or p.codigo_interno = v_codigo_barras))
           or
           (v_codigo_interno is not null and (p.codigo_interno = v_codigo_interno or p.codigo_barras = v_codigo_interno))
         )
    ) then
      v_verified := v_verified + 1;
    else
      raise exception 'SIGO_STOCK_IMPORT_ROW_NOT_MATCHED_%: %', v_source_rows, v_nombre;
    end if;
  end loop;

  insert into public.sigo_importaciones_stock (
    import_key, empresa_id, source_file, source_rows, inserted_rows, skipped_existing, verified_rows, notes
  ) values (
    p_import_key, v_empresa_id, 'Resguardo_stock_SIGO.xlsx', v_source_rows,
    v_inserted, v_source_rows - v_inserted, v_verified,
    'Importación idempotente en tenant único SIGO Administración. Sector fuente: ' || coalesce(nullif(trim(p_empresa_nombre), ''), 'sin etiqueta') || '. No sobrescribe productos ni stock preexistentes.'
  )
  on conflict (import_key) do update
    set empresa_id = excluded.empresa_id,
        inserted_rows = excluded.inserted_rows,
        skipped_existing = excluded.skipped_existing,
        verified_rows = excluded.verified_rows,
        notes = excluded.notes;

  if v_verified <> v_source_rows then
    raise exception 'SIGO_STOCK_IMPORT_VERIFY_FAILED: %/%', v_verified, v_source_rows;
  end if;

  return v_inserted;
end
$$;

revoke all on function public.sigo_importar_stock_resguardo(text, text, text) from public;

comment on function public.sigo_importar_stock_resguardo(text, text, text) is
  'SIGO: helper interno temporal para importar Librería y Computación dentro de un único tenant/caja SIGO Administración.';
