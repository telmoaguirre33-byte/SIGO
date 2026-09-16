-- SIGO: carga controlada del stock de Librería para cristina.veron@hotmail.com.
-- Copia exactamente los 983 productos de categoría Librería ya validados en SIGO Administración.
-- Idempotente: no borra ni sobrescribe productos existentes del cliente.

do $$
declare
  v_user_id uuid;
  v_source_empresa uuid;
  v_target_empresa uuid;
  v_target_matches integer;
  v_source_rows integer;
  v_before integer;
  v_inserted integer;
  v_verified integer;
begin
  select u.id
    into v_user_id
    from auth.users u
   where lower(u.email) = lower('cristina.veron@hotmail.com')
   order by u.created_at asc
   limit 1;

  if v_user_id is null then
    raise exception 'CRISTINA_VERON_USER_NOT_FOUND';
  end if;

  select e.id
    into v_source_empresa
    from public.empresas e
   where lower(e.nombre) = lower('SIGO Administración')
   order by e.created_at asc
   limit 1;

  if v_source_empresa is null then
    raise exception 'SIGO_ADMIN_SOURCE_COMPANY_NOT_FOUND';
  end if;

  select count(*)
    into v_source_rows
    from public.productos p
   where p.empresa_id = v_source_empresa
     and lower(btrim(coalesce(p.categoria, ''))) = lower('Librería');

  if v_source_rows <> 983 then
    raise exception 'LIBRERIA_SOURCE_COUNT_MISMATCH: expected 983, got %', v_source_rows;
  end if;

  -- Preferimos la empresa que SIGO creó con el nombre del usuario.
  select count(*)
    into v_target_matches
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.user_id = v_user_id
     and eu.activo = true
   where e.activa = true
     and lower(e.nombre) = lower('cristina.veron');

  if v_target_matches = 1 then
    select e.id
      into v_target_empresa
      from public.empresas e
      join public.empresa_usuarios eu
        on eu.empresa_id = e.id
       and eu.user_id = v_user_id
       and eu.activo = true
     where e.activa = true
       and lower(e.nombre) = lower('cristina.veron')
     order by e.created_at asc
     limit 1;
  else
    -- Fallback sólo si el usuario tiene una única empresa activa.
    select count(*)
      into v_target_matches
      from public.empresas e
      join public.empresa_usuarios eu
        on eu.empresa_id = e.id
       and eu.user_id = v_user_id
       and eu.activo = true
     where e.activa = true;

    if v_target_matches <> 1 then
      raise exception 'CRISTINA_VERON_TARGET_COMPANY_AMBIGUOUS: % active companies', v_target_matches;
    end if;

    select e.id
      into v_target_empresa
      from public.empresas e
      join public.empresa_usuarios eu
        on eu.empresa_id = e.id
       and eu.user_id = v_user_id
       and eu.activo = true
     where e.activa = true
     order by e.created_at asc
     limit 1;
  end if;

  if v_target_empresa is null then
    raise exception 'CRISTINA_VERON_TARGET_COMPANY_NOT_FOUND';
  end if;

  if v_target_empresa = v_source_empresa then
    raise exception 'CRISTINA_VERON_TARGET_EQUALS_SOURCE';
  end if;

  -- Si ya existe el mismo código pero con otra identidad, no hacemos ninguna carga.
  if exists (
    select 1
      from public.productos s
      join public.productos t
        on t.empresa_id = v_target_empresa
       and s.empresa_id = v_source_empresa
       and (
         (nullif(btrim(s.codigo_barras), '') is not null and (
            t.codigo_barras = s.codigo_barras or t.codigo_interno = s.codigo_barras
         ))
         or
         (nullif(btrim(s.codigo_interno), '') is not null and (
            t.codigo_interno = s.codigo_interno or t.codigo_barras = s.codigo_interno
         ))
       )
     where lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
       and lower(btrim(coalesce(t.nombre, ''))) <> lower(btrim(coalesce(s.nombre, '')))
  ) then
    raise exception 'CRISTINA_VERON_IMPORT_IDENTITY_CONFLICT';
  end if;

  select count(*) into v_before
    from public.productos
   where empresa_id = v_target_empresa;

  insert into public.productos (
    empresa_id,
    codigo_interno,
    codigo_barras,
    nombre,
    descripcion,
    categoria,
    marca,
    proveedor,
    costo_actual,
    costo_ultima_compra,
    precio_venta,
    margen_ganancia,
    margen_porcentaje,
    stock_actual,
    stock_minimo,
    stock_maximo,
    activo
  )
  select
    v_target_empresa,
    s.codigo_interno,
    s.codigo_barras,
    s.nombre,
    s.descripcion,
    s.categoria,
    s.marca,
    s.proveedor,
    s.costo_actual,
    s.costo_ultima_compra,
    s.precio_venta,
    s.margen_ganancia,
    s.margen_porcentaje,
    s.stock_actual,
    s.stock_minimo,
    s.stock_maximo,
    s.activo
  from public.productos s
  where s.empresa_id = v_source_empresa
    and lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
    and not exists (
      select 1
        from public.productos t
       where t.empresa_id = v_target_empresa
         and (
           (nullif(btrim(s.codigo_barras), '') is not null and (
              t.codigo_barras = s.codigo_barras or t.codigo_interno = s.codigo_barras
           ))
           or
           (nullif(btrim(s.codigo_interno), '') is not null and (
              t.codigo_interno = s.codigo_interno or t.codigo_barras = s.codigo_interno
           ))
         )
    );

  get diagnostics v_inserted = row_count;

  select count(*)
    into v_verified
    from public.productos s
   where s.empresa_id = v_source_empresa
     and lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
     and exists (
       select 1
         from public.productos t
        where t.empresa_id = v_target_empresa
          and lower(btrim(coalesce(t.nombre, ''))) = lower(btrim(coalesce(s.nombre, '')))
          and (
            (nullif(btrim(s.codigo_barras), '') is not null and (
               t.codigo_barras = s.codigo_barras or t.codigo_interno = s.codigo_barras
            ))
            or
            (nullif(btrim(s.codigo_interno), '') is not null and (
               t.codigo_interno = s.codigo_interno or t.codigo_barras = s.codigo_interno
            ))
          )
     );

  if v_verified <> 983 then
    raise exception 'CRISTINA_VERON_IMPORT_VERIFY_FAILED: %/983', v_verified;
  end if;

  insert into public.sigo_importaciones_stock (
    import_key,
    empresa_id,
    source_file,
    source_rows,
    inserted_rows,
    skipped_existing,
    verified_rows,
    notes
  ) values (
    'cristina-veron-libreria-983-2026-09-16',
    v_target_empresa,
    'Resguardo_stock_SIGO.xlsx / Librería',
    983,
    v_inserted,
    983 - v_inserted,
    v_verified,
    format('Carga solicitada para cristina.veron@hotmail.com. Antes=%s. Fuente: SIGO Administración / categoría Librería. No sobrescribe productos existentes.', v_before)
  )
  on conflict (import_key) do update
    set inserted_rows = excluded.inserted_rows,
        skipped_existing = excluded.skipped_existing,
        verified_rows = excluded.verified_rows,
        notes = excluded.notes;
end
$$;
