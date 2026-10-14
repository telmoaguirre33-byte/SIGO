-- Requiere 006 y asignaciones Mayorista en la misma DB SIGO. Propuesta; no producción.
begin;
create function public.sigo_mayorista_lector(p_empresa_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()) then raise exception 'SESSION_REVOKED';end if;
 if coalesce((auth.jwt()->>'exp')::bigint,0)<=extract(epoch from now()) then raise exception 'SESSION_EXPIRED';end if;
 select u.rol into v_rol from public.empresa_usuarios u join public.empresas e on e.id=u.empresa_id and e.activa
 where u.empresa_id=p_empresa_id and u.user_id=auth.uid() and u.activo;
 if v_rol is null or not exists(select 1 from public.sigo_empresa_modulos m where m.empresa_id=p_empresa_id and m.modulo_clave='mayorista_distribuidora' and m.habilitado)
 or not exists(select 1 from public.sigo_mayorista_comercio_fuente f where f.empresa_id=p_empresa_id and f.fuente='sigo') then raise exception 'MAYORISTA_FORBIDDEN';end if;
 return v_rol;
end $$;
create function public.leer_catalogo_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;v_vendedor uuid;
begin
 v_rol:=public.sigo_mayorista_lector(p_empresa_id);
 if v_rol not in ('owner','admin','vendedor') then raise exception 'CATALOG_FORBIDDEN';end if;
 select m.vendedor_id into v_vendedor from mayorista.miembros m where m.empresa_id=p_empresa_id and m.user_id=auth.uid() and m.activo;
 if v_rol='vendedor' and v_vendedor is null then raise exception 'SELLER_REQUIRED';end if;
 if exists(select 1 from mayorista.clientes a where a.empresa_id=p_empresa_id and a.habilitado and (v_rol<>'vendedor' or a.vendedor_id=v_vendedor) and a.lista_id is not null) then raise exception 'SHARED_PRICE_LIST_NOT_READY';end if;
 return jsonb_build_object('empresaId',p_empresa_id,'vendedorId',v_vendedor,'descargadoEn',now(),
 'clientes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'vendedorId',a.vendedor_id,'rutaId',a.ruta_id,'listaId',null,'latitud',a.latitud,'longitud',a.longitud,'limiteCredito',c.limite_credito,'saldo',c.saldo_actual)) from public.clientes_sigo c join mayorista.clientes a on a.empresa_id=c.empresa_id and a.cliente_id=c.id where c.empresa_id=p_empresa_id and c.activo and a.habilitado and (v_rol<>'vendedor' or a.vendedor_id=v_vendedor)),'[]'::jsonb),
 'productos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre)) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'precios',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'productoId',p.id,'listaId',null,'presentacion','unidad','unidadesBase',1,'precioBase',p.precio_venta,'precio',round(p.precio_venta*(1-coalesce((select o.descuento_porcentaje from public.ofertas_productos_sigo o where o.empresa_id=p_empresa_id and o.producto_id=p.id and o.fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and o.fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1),0)/100),2))) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'rutas',coalesce((select jsonb_agg(jsonb_build_object('id',r.ruta_id,'nombre',r.nombre,'zona',r.zona)) from mayorista.rutas r where r.empresa_id=p_empresa_id and (v_rol<>'vendedor' or exists(select 1 from mayorista.clientes a where a.empresa_id=p_empresa_id and a.ruta_id=r.ruta_id and a.vendedor_id=v_vendedor and a.habilitado))),'[]'::jsonb),'ofertas','[]'::jsonb,'objetivos','[]'::jsonb);
end $$;
create function public.leer_stock_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 return jsonb_build_object('empresaId',p_empresa_id,'productos',coalesce((select jsonb_agg(jsonb_build_object('productoId',p.id,'unidades',p.stock_actual,'reservadas',0,'disponibles',p.stock_actual)) from public.productos p where p.empresa_id=p_empresa_id and p.activo),'[]'::jsonb));
end $$;
revoke all on function public.sigo_mayorista_lector(uuid) from public,anon,authenticated;
revoke all on function public.leer_catalogo_mayorista_sigo(uuid),public.leer_stock_mayorista_sigo(uuid) from public,anon;
grant execute on function public.leer_catalogo_mayorista_sigo(uuid),public.leer_stock_mayorista_sigo(uuid) to authenticated;
rollback;
