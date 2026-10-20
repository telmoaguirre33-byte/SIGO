-- SIGO: infraestructura temporal y auditable para cargar el stock histórico inicial.
-- Crea Lápiz y Papel y Sertec como tenants separados bajo el mismo owner de SIGO Administración.
-- No sobrescribe productos, stock ni históricos existentes.

create table if not exists public.sigo_importaciones_stock (
  import_key text primary key,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  source_file text not null,
  source_rows integer not null check (source_rows >= 0),
  inserted_rows integer not null check (inserted_rows >= 0),
  skipped_existing integer not null check (skipped_existing >= 0),
  verified_rows integer not null check (verified_rows >= 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.sigo_importaciones_stock enable row level security;

drop policy if exists sigo_importaciones_stock_select on public.sigo_importaciones_stock;
create policy sigo_importaciones_stock_select
on public.sigo_importaciones_stock
for select
to authenticated
using (public.es_superadmin_sigo() or public.es_owner_empresa(empresa_id));

do $$
declare
  v_owner_id uuid;
  v_empresa_id uuid;
  v_nombre text;
begin
  select eu.user_id
    into v_owner_id
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.rol = 'owner'
     and eu.activo = true
   where lower(e.nombre) = lower('SIGO Administración')
   order by e.created_at asc
   limit 1;

  if v_owner_id is null then
    raise exception 'SIGO_STOCK_IMPORT_OWNER_NOT_FOUND';
  end if;

  foreach v_nombre in array array['Lápiz y Papel', 'Sertec']
  loop
    select e.id
      into v_empresa_id
      from public.empresas e
      join public.empresa_usuarios eu
        on eu.empresa_id = e.id
       and eu.user_id = v_owner_id
       and eu.rol = 'owner'
     where lower(e.nombre) = lower(v_nombre)
     order by e.created_at asc
     limit 1;

    if v_empresa_id is null then
      insert into public.empresas (nombre, activa, created_by)
      values (v_nombre, true, v_owner_id)
      returning id into v_empresa_id;

      insert into public.empresa_usuarios (empresa_id, user_id, rol, activo)
      values (v_empresa_id, v_owner_id, 'owner', true);
    else
      update public.empresas set activa = true where id = v_empresa_id;
      update public.empresa_usuarios
         set activo = true, rol = 'owner', updated_at = now()
       where empresa_id = v_empresa_id
         and user_id = v_owner_id;
    end if;
  end loop;
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

  select eu.user_id
    into v_owner_id
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.rol = 'owner'
     and eu.activo = true
   where lower(e.nombre) = lower('SIGO Administración')
   order by e.created_at asc
   limit 1;

  select e.id
    into v_empresa_id
    from public.empresas e
    join public.empresa_usuarios eu
      on eu.empresa_id = e.id
     and eu.user_id = v_owner_id
     and eu.rol = 'owner'
     and eu.activo = true
   where lower(e.nombre) = lower(p_empresa_nombre)
   order by e.created_at asc
   limit 1;

  if v_empresa_id is null then raise exception 'SIGO_STOCK_IMPORT_COMPANY_NOT_FOUND: %', p_empresa_nombre; end if;

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
    'Importación idempotente: no sobrescribe productos ni stock preexistentes.'
  )
  on conflict (import_key) do update
    set inserted_rows = excluded.inserted_rows,
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
  'SIGO: helper interno temporal para la carga inicial controlada del stock histórico.';