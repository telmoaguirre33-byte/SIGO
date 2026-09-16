-- SIGO: alta mínima y segura de dos artículos físicos escaneados en Cristina que no
-- existen en el Excel fuente de Librería. Se registran con precio/stock/costos en cero
-- para que el scanner los identifique sin inventar valores comerciales.

do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('cristina.veron@hotmail.com')
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'CRISTINA_VERON_USER_NOT_FOUND_SCANNER';
  end if;

  select e.id into v_empresa_id
  from public.empresas e
  join public.empresa_usuarios eu
    on eu.empresa_id = e.id
   and eu.user_id = v_user_id
   and eu.activo = true
  where e.activa = true
    and lower(trim(e.nombre)) = lower('cristina.veron')
  order by e.created_at asc
  limit 1;

  if v_empresa_id is null then
    raise exception 'CRISTINA_VERON_COMPANY_NOT_FOUND_SCANNER';
  end if;

  -- Mantiene intactas las guardas tenant durante esta migración.
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  if not exists (
    select 1 from public.productos p
    where p.empresa_id = v_empresa_id
      and (p.codigo_barras = '7795513044728' or p.codigo_interno = '7795513044728')
  ) then
    insert into public.productos (
      empresa_id, codigo_interno, codigo_barras, nombre, descripcion, categoria, marca, proveedor,
      costo_actual, costo_ultima_compra, precio_venta, margen_ganancia, margen_porcentaje,
      stock_actual, stock_minimo, stock_maximo, activo
    ) values (
      v_empresa_id, null, '7795513044728', 'LAPIZ COLOR FILGO X12 LARGO',
      'Alta desde escaneo físico. No estaba en Resguardo_stock_SIGO.xlsx; precio y stock pendientes de completar.',
      'Librería', 'FILGO', null,
      0, 0, 0, 0, 0,
      0, 0, 0, true
    );
  end if;

  if not exists (
    select 1 from public.productos p
    where p.empresa_id = v_empresa_id
      and (p.codigo_barras = '714604085393' or p.codigo_interno = '714604085393')
  ) then
    insert into public.productos (
      empresa_id, codigo_interno, codigo_barras, nombre, descripcion, categoria, marca, proveedor,
      costo_actual, costo_ultima_compra, precio_venta, margen_ganancia, margen_porcentaje,
      stock_actual, stock_minimo, stock_maximo, activo
    ) values (
      v_empresa_id, null, '714604085393', 'MARCADOR KIRUKI X10 CLASICO',
      'Alta desde escaneo físico. No estaba en Resguardo_stock_SIGO.xlsx; precio y stock pendientes de completar.',
      'Librería', 'KIRUKI', null,
      0, 0, 0, 0, 0,
      0, 0, 0, true
    );
  end if;
end
$$;
