-- SIGO: verificación final de la carga inicial de stock y cierre del helper temporal.
-- El resguardo de Librería + Computación debe quedar dentro de UNA sola empresa/caja:
-- SIGO Administración. Las etiquetas de origen solo identifican el sector de cada lote.
do $$
declare
  v_empresa_id uuid;
  v_libreria_source integer;
  v_libreria_verified integer;
  v_sertec_source integer;
  v_sertec_verified integer;
  v_empresas_importadas integer;
  v_aux_activas integer;
begin
  select e.id
    into v_empresa_id
    from public.empresas e
   where lower(trim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   order by e.created_at asc
   limit 1;

  if v_empresa_id is null then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_MAIN_TENANT_NOT_FOUND';
  end if;

  select coalesce(sum(source_rows),0), coalesce(sum(verified_rows),0)
    into v_libreria_source, v_libreria_verified
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%';

  select coalesce(sum(source_rows),0), coalesce(sum(verified_rows),0)
    into v_sertec_source, v_sertec_verified
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%';

  select count(distinct empresa_id)
    into v_empresas_importadas
    from public.sigo_importaciones_stock
   where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'
      or import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%';

  if v_libreria_source <> 983 or v_libreria_verified <> 983 then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_LIBRERIA_FAILED source=% verified=%', v_libreria_source, v_libreria_verified;
  end if;

  if v_sertec_source <> 417 or v_sertec_verified <> 417 then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_SERTEC_FAILED source=% verified=%', v_sertec_source, v_sertec_verified;
  end if;

  if v_libreria_source + v_sertec_source <> 1400 then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_TOTAL_FAILED: %', v_libreria_source + v_sertec_source;
  end if;

  if v_empresas_importadas <> 1 or exists (
    select 1
      from public.sigo_importaciones_stock i
     where (i.import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'
         or i.import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%')
       and i.empresa_id <> v_empresa_id
  ) then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_TENANT_SPLIT_DETECTED';
  end if;

  select count(*)
    into v_aux_activas
    from public.empresas e
   where lower(trim(e.nombre)) in (lower('Lápiz y Papel'), lower('Sertec'))
     and e.id <> v_empresa_id
     and e.activa = true
     and not exists (select 1 from public.productos p where p.empresa_id = e.id);

  if v_aux_activas <> 0 then
    raise exception 'SIGO_STOCK_IMPORT_FINAL_AUX_TENANT_ACTIVE';
  end if;

  raise notice 'SIGO_STOCK_IMPORT_FINAL_OK SIGO Administración: Librería=983/983 Computación=417/417 Total=1400/1400 tenant=1';
end
$$;

drop function if exists public.sigo_importar_stock_resguardo(text, text, text);
