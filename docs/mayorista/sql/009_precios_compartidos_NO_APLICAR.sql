-- Solo metadata comercial Mayorista. El precio base y ofertas continúan en SIGO.
begin;
alter table mayorista.pedidos add column comerciales jsonb not null default '{}'::jsonb;
create table public.sigo_mayorista_presentaciones(empresa_id uuid not null references public.empresas(id),precio_id uuid not null,producto_id uuid not null references public.productos(id),lista_id uuid,presentacion text not null check(length(presentacion) between 1 and 80),unidades_base integer not null check(unidades_base between 1 and 1000000),ajuste_porcentaje numeric not null check(ajuste_porcentaje between -95 and 500),min_unidades integer not null check(min_unidades between 1 and 1000000),desde timestamptz not null,hasta timestamptz not null,activa boolean not null,actor_id uuid not null references auth.users(id),fecha timestamptz not null default now(),primary key(empresa_id,precio_id),foreign key(empresa_id,lista_id) references mayorista.listas(empresa_id,lista_id),check(hasta>desde),check(precio_id<>producto_id));
alter table public.sigo_mayorista_presentaciones enable row level security;revoke all on public.sigo_mayorista_presentaciones from public,anon,authenticated;
create function public.configurar_precio_mayorista_sigo(p_empresa_id uuid,p_datos jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);k:=p_datos->>'tipo';
 if k='lista' then
  if length(coalesce(p_datos->>'nombre','')) not between 1 and 160 or (p_datos->>'id')::uuid is null then raise exception 'PRICE_LIST_INVALID';end if;
  insert into mayorista.listas(empresa_id,lista_id,nombre,activa) values(p_empresa_id,(p_datos->>'id')::uuid,p_datos->>'nombre',(p_datos->>'activa')::boolean) on conflict(empresa_id,lista_id) do update set nombre=excluded.nombre,activa=excluded.activa;
 elsif k='presentacion' then
  if not exists(select 1 from public.productos where empresa_id=p_empresa_id and id=(p_datos->>'productoId')::uuid and activo) then raise exception 'PRODUCT_FORBIDDEN';end if;
  if nullif(p_datos->>'listaId','') is not null and not exists(select 1 from mayorista.listas where empresa_id=p_empresa_id and lista_id=(p_datos->>'listaId')::uuid and activa) then raise exception 'PRICE_LIST_FORBIDDEN';end if;
  insert into public.sigo_mayorista_presentaciones values(p_empresa_id,(p_datos->>'id')::uuid,(p_datos->>'productoId')::uuid,nullif(p_datos->>'listaId','')::uuid,p_datos->>'presentacion',(p_datos->>'unidadesBase')::integer,(p_datos->>'ajustePorcentaje')::numeric,coalesce((p_datos->>'minUnidades')::integer,1),(p_datos->>'desde')::timestamptz,(p_datos->>'hasta')::timestamptz,coalesce((p_datos->>'activa')::boolean,true),auth.uid(),now()) on conflict(empresa_id,precio_id) do update set producto_id=excluded.producto_id,lista_id=excluded.lista_id,presentacion=excluded.presentacion,unidades_base=excluded.unidades_base,ajuste_porcentaje=excluded.ajuste_porcentaje,min_unidades=excluded.min_unidades,desde=excluded.desde,hasta=excluded.hasta,activa=excluded.activa,actor_id=auth.uid(),fecha=now();
 else raise exception 'PRICE_CONFIGURATION_INVALID';end if;
 return jsonb_build_object('estado','guardado','id',p_datos->>'id');
end $$;
create function public.precio_unitario_mayorista_sigo(p_empresa_id uuid,p_cliente uuid,p_producto uuid,p_precio uuid,p_cantidad numeric) returns numeric language plpgsql stable security definer set search_path='' as $$
declare asignada uuid;config public.sigo_mayorista_presentaciones%rowtype;base numeric;oferta numeric;
begin
 perform public.sigo_mayorista_cliente_visible(p_empresa_id,p_cliente);
 select lista_id into asignada from mayorista.clientes where empresa_id=p_empresa_id and cliente_id=p_cliente and habilitado;
 select precio_venta into base from public.productos where empresa_id=p_empresa_id and id=p_producto and activo;
 if base is null or base<=0 or p_cantidad is null or p_cantidad<=0 then raise exception 'PRICE_NOT_AVAILABLE';end if;
 select descuento_porcentaje into oferta from public.ofertas_productos_sigo where empresa_id=p_empresa_id and producto_id=p_producto and fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1;
 if p_precio is null or p_precio=p_producto then
  if asignada is not null then raise exception 'PRICE_LIST_REQUIRED';end if;
  return round(base*(1-coalesce(oferta,0)/100),2);
 end if;
 select * into config from public.sigo_mayorista_presentaciones where empresa_id=p_empresa_id and precio_id=p_precio and producto_id=p_producto and lista_id is not distinct from asignada and activa and desde<=now() and hasta>now() and min_unidades<=p_cantidad;
 if not found then raise exception 'PRESENTATION_NOT_AVAILABLE';end if;
 if asignada is not null and not exists(select 1 from mayorista.listas where empresa_id=p_empresa_id and lista_id=asignada and activa) then raise exception 'PRICE_LIST_INACTIVE';end if;
 return round(base*(1-coalesce(oferta,0)/100)*(1+config.ajuste_porcentaje/100),2);
end $$;
create function public.cotizar_pedido_mayorista_sigo(p_empresa_id uuid,p_cliente uuid,p_lineas jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l jsonb;respuesta jsonb:='[]';precio numeric;cantidad numeric;
begin
 perform public.sigo_mayorista_cliente_visible(p_empresa_id,p_cliente);
 if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) not between 1 and 200 then raise exception 'QUOTE_INVALID';end if;
 for l in select value from jsonb_array_elements(p_lineas) loop
  cantidad:=(l->>'cantidad')::numeric;
  if cantidad is null or cantidad::text in ('NaN','Infinity','-Infinity') or cantidad<=0 or cantidad>1000000 or trunc(cantidad)<>cantidad then raise exception 'QUOTE_QUANTITY_INVALID';end if;
  precio:=public.precio_unitario_mayorista_sigo(p_empresa_id,p_cliente,(l->>'productoId')::uuid,nullif(l->>'precioId','')::uuid,cantidad);
  respuesta:=respuesta||jsonb_build_array(jsonb_build_object('productoId',l->'productoId','precioId',l->'precioId','cantidad',cantidad,'precioUnitario',precio,'subtotal',round(precio*cantidad,2)));
 end loop;return respuesta;
end $$;
revoke all on function public.cotizar_pedido_mayorista_sigo(uuid,uuid,jsonb) from public,anon;grant execute on function public.cotizar_pedido_mayorista_sigo(uuid,uuid,jsonb) to authenticated;
revoke all on function public.precio_unitario_mayorista_sigo(uuid,uuid,uuid,uuid,numeric) from public,anon,authenticated;
alter function public.leer_catalogo_mayorista_sigo(uuid) rename to leer_catalogo_mayorista_sigo_base;
revoke all on function public.leer_catalogo_mayorista_sigo_base(uuid) from public,anon,authenticated;
create function public.leer_catalogo_mayorista_sigo(p_empresa_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare catalogo jsonb;precios jsonb;ofertas jsonb;lista jsonb;
begin
 catalogo:=public.leer_catalogo_mayorista_sigo_base(p_empresa_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',m.precio_id,'productoId',m.producto_id,'listaId',m.lista_id,'presentacion',m.presentacion,'unidadesBase',m.unidades_base,'minUnidades',m.min_unidades,'ajustePorcentaje',m.ajuste_porcentaje,'precio',round(p.precio_venta*(1-coalesce((select o.descuento_porcentaje from public.ofertas_productos_sigo o where o.empresa_id=p_empresa_id and o.producto_id=m.producto_id and o.fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and o.fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1),0)/100)*(1+m.ajuste_porcentaje/100),2)*m.unidades_base)),'[]') into precios from public.sigo_mayorista_presentaciones m join public.productos p on p.empresa_id=m.empresa_id and p.id=m.producto_id where m.empresa_id=p_empresa_id and m.activa and m.desde<=now() and m.hasta>now() and p.activo and (m.lista_id is null or exists(select 1 from jsonb_array_elements(catalogo->'clientes') c where (c->>'listaId')::uuid=m.lista_id));
 select coalesce(jsonb_agg(jsonb_build_object('id',l.lista_id,'nombre',l.nombre,'activa',l.activa)),'[]') into lista from mayorista.listas l where l.empresa_id=p_empresa_id and (public.sigo_mayorista_lector(p_empresa_id) in ('owner','admin') or exists(select 1 from jsonb_array_elements(catalogo->'clientes') c where (c->>'listaId')::uuid=l.lista_id));
 select coalesce(jsonb_agg(jsonb_build_object('productoId',o.producto_id,'nombre',p.nombre,'descuento',o.descuento_porcentaje,'desde',o.fecha_inicio,'hasta',o.fecha_fin+1)),'[]') into ofertas from public.ofertas_productos_sigo o join public.productos p on p.empresa_id=o.empresa_id and p.id=o.producto_id where o.empresa_id=p_empresa_id and o.fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and o.fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date;
 return catalogo||jsonb_build_object('precios',(catalogo->'precios')||precios,'listas',lista,'ofertas',ofertas);
end $$;
revoke all on function public.configurar_precio_mayorista_sigo(uuid,jsonb),public.leer_catalogo_mayorista_sigo(uuid) from public,anon;
grant execute on function public.configurar_precio_mayorista_sigo(uuid,jsonb),public.leer_catalogo_mayorista_sigo(uuid) to authenticated;
rollback;
