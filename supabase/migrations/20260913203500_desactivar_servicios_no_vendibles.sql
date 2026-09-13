-- SIGO: preservar el histórico pero sacar del catálogo vendible servicios que el negocio
-- indicó expresamente que no son mercadería: fotocopias y Film impresora.
-- No borra productos, no altera stock ni costos, y no afecta films autoadhesivos vendibles.
do $$
declare
  v_empresa_id uuid;
  v_changed integer := 0;
begin
  select e.id
    into v_empresa_id
    from public.empresas e
   where lower(btrim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   limit 1;

  if v_empresa_id is null then
    raise exception 'SIGO_NONSELLABLE_CLEANUP_TENANT_NOT_FOUND';
  end if;

  update public.productos p
     set activo = false
   where p.empresa_id = v_empresa_id
     and p.activo = true
     and (
       lower(btrim(p.nombre)) like 'fotocopia%'
       or lower(btrim(p.nombre)) = 'film impresora'
     );

  get diagnostics v_changed = row_count;
  raise notice 'SIGO_NONSELLABLE_SERVICES_DISABLED changed=%', v_changed;
end
$$;
