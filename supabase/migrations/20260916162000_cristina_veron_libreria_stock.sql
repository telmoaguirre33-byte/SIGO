-- SIGO: carga exacta del Excel Librería para cristina.veron@hotmail.com.
-- Fuente operativa validada: 976 productos que conservan categoría Librería +
-- 7 registros del mismo Excel reclasificados luego como NO_VENDIBLE
-- (6 Fotocopias + Film impresora) = 983 registros originales.
-- No borra ni sobrescribe productos existentes del cliente.
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
   where lower(trim(e.nombre)) = lower('SIGO Administración')
   order by e.created_at asc
   limit 1;

  if v_source_empresa is null then
    raise exception 'SIGO_ADMIN_SOURCE_COMPANY_NOT_FOUND';
  end if;

  select count(*)
    into v_source_rows
    from public.productos p
   where p.empresa_id = v_source_empresa
     and (
       lower(btrim(coalesce(p.categoria, ''))) = lower('Librería')
       or (
         upper(btrim(coalesce(p.categoria, ''))) = 'NO_VENDIBLE'
         and (
           lower(btrim(p.nombre)) like 'fotocopia%'
           or lower(btrim(p.nombre)) = 'film impresora'
         )
       )
     );

  if v_source_rows <> 983 then
    raise exception 'LIBRERIA_SOURCE_COUNT_MISMATCH: expected 983, got %', v_source_rows;
  end if;

  -- Preferimos la empresa exacta creada para cristina.veron.
  select count(*)
    into v_target_matches
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.user_id = v_user_id
     and eu.activo = true
   where e.activa = true
     and lower(trim(e.nombre)) = lower('cristina.veron');

  if v_target_matches = 1 then
    select e.id
      into v_target_empresa
      from public.empresas e
      join public.empresa_usuarios eu
        on eu.empresa_id = e.id
       and eu.user_id = v_user_id
       and eu.activo = true
     where e.activa = true
       and lower(trim(e.nombre)) = lower('cristina.veron')
     order by e.created_at asc
     limit 1;
  else
    -- Fallback únicamente si Cristina tiene una sola empresa activa.
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

  -- Mantener las guardas tenant del backend: durante esta transacción únicamente,
  -- las escrituras se ejecutan con la identidad ya validada de Cristina.
  -- No se desactiva RLS ni ningún trigger y el contexto desaparece al finalizar.
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- Si un código ya existe en Cristina con otra identidad, se cancela todo.
  if exists (
    select 1
      from public.productos s
      join public.productos t
        on t.empresa_id = v_target_empresa
       and (
         (nullif(btrim(s.codigo_barras), '') is not null and (
            t.codigo_barras = s.codigo_barras or t.codigo_interno = s.codigo_barras
         ))
         or
         (nullif(btrim(s.codigo_interno), '') is not null and (
            t.codigo_interno = s.codigo_interno or t.codigo_barras = s.codigo_interno
         ))
       )
     where s.empresa_id = v_source_empresa
       and (
         lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
         or (
           upper(btrim(coalesce(s.categoria, ''))) = 'NO_VENDIBLE'
           and (
             lower(btrim(s.nombre)) like 'fotocopia%'
             or lower(btrim(s.nombre)) = 'film impresora'
           )
         )
       )
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
    and (
      lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
      or (
        upper(btrim(coalesce(s.categoria, ''))) = 'NO_VENDIBLE'
        and (
          lower(btrim(s.nombre)) like 'fotocopia%'
          or lower(btrim(s.nombre)) = 'film impresora'
        )
      )
    )
    and not exists (
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

  get diagnostics v_inserted = row_count;

  select count(*)
    into v_verified
    from public.productos s
   where s.empresa_id = v_source_empresa
     and (
       lower(btrim(coalesce(s.categoria, ''))) = lower('Librería')
       or (
         upper(btrim(coalesce(s.categoria, ''))) = 'NO_VENDIBLE'
         and (
           lower(btrim(s.nombre)) like 'fotocopia%'
           or lower(btrim(s.nombre)) = 'film impresora'
         )
       )
     )
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
    format(
      'Carga solicitada para cristina.veron@hotmail.com. Antes=%s. Fuente completa: 976 Librería + 7 NO_VENDIBLE del Excel original. No sobrescribe productos existentes.',
      v_before
    )
  )
  on conflict (import_key) do update
    set empresa_id = excluded.empresa_id,
        inserted_rows = excluded.inserted_rows,
        skipped_existing = excluded.skipped_existing,
        verified_rows = excluded.verified_rows,
        notes = excluded.notes;

  raise notice 'CRISTINA_VERON_LIBRERIA_IMPORT_OK inserted=% verified=% source=983 before=%',
    v_inserted, v_verified, v_before;
end
$$;
