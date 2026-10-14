-- Requiere 006 y asignaciones Mayorista en la misma DB SIGO. Propuesta; no producción.
begin;
create table mayorista.codigos_compartidos(empresa_id uuid not null,codigo text not null,producto_id uuid not null references public.productos(id),unidades_base integer not null check(unidades_base>0),primary key(empresa_id,codigo));
alter table mayorista.codigos_compartidos enable row level security;
alter table mayorista.codigos_compartidos force row level security;
create policy codigos_compartidos_read on mayorista.codigos_compartidos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion','armador','chofer']));
create policy codigos_compartidos_insert on mayorista.codigos_compartidos for insert to authenticated with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
grant select,insert on mayorista.codigos_compartidos to authenticated;
create function mayorista_private.validar_codigo_compartido() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.sigo_mayorista_operador_comercial(NEW.empresa_id);
 if not exists(select 1 from public.productos p where p.id=NEW.producto_id and p.empresa_id=NEW.empresa_id and p.activo) then raise exception 'PRODUCT_NOT_FOUND';end if;
 return NEW;
end $$;
revoke all on function mayorista_private.validar_codigo_compartido() from public,anon,authenticated;
create trigger validar_codigo_compartido before insert on mayorista.codigos_compartidos for each row execute function mayorista_private.validar_codigo_compartido();
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
 'clientes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'vendedorId',a.vendedor_id,'rutaId',a.ruta_id,'listaId',null,'latitud',a.latitud,'longitud',a.longitud,'habilitado',coalesce(a.habilitado,false),'orden',coalesce((select (meta->>'orden')::integer from mayorista.administracion plan cross join lateral jsonb_array_elements(plan.datos->'clientes') meta where plan.empresa_id=p_empresa_id and meta->>'id'=c.id::text),0),'telefono',c.telefono,'documento',c.documento,'limiteCredito',c.limite_credito,'saldo',c.saldo_actual)) from public.clientes_sigo c left join mayorista.clientes a on a.empresa_id=c.empresa_id and a.cliente_id=c.id where c.empresa_id=p_empresa_id and c.activo and (v_rol<>'vendedor' or (a.habilitado and a.vendedor_id=v_vendedor))),'[]'::jsonb),
 'productos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'marca',to_jsonb(p)->>'marca','codigoInterno',to_jsonb(p)->>'codigo_interno','ean',to_jsonb(p)->>'codigo_barras')) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'precios',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'productoId',p.id,'listaId',null,'presentacion','unidad','unidadesBase',1,'precioBase',p.precio_venta,'precio',round(p.precio_venta*(1-coalesce((select o.descuento_porcentaje from public.ofertas_productos_sigo o where o.empresa_id=p_empresa_id and o.producto_id=p.id and o.fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and o.fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1),0)/100),2))) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'rutas',coalesce((select jsonb_agg(jsonb_build_object('id',r.ruta_id,'nombre',r.nombre,'zona',r.zona,'dias',coalesce((select meta->'dias' from mayorista.administracion plan cross join lateral jsonb_array_elements(plan.datos->'rutas') meta where plan.empresa_id=p_empresa_id and meta->>'id'=r.ruta_id::text),'[]'::jsonb))) from mayorista.rutas r where r.empresa_id=p_empresa_id and (v_rol<>'vendedor' or exists(select 1 from mayorista.clientes a where a.empresa_id=p_empresa_id and a.ruta_id=r.ruta_id and a.vendedor_id=v_vendedor and a.habilitado))),'[]'::jsonb),'ofertas','[]'::jsonb,'objetivos','[]'::jsonb);
end $$;
create function public.leer_stock_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 return jsonb_build_object('empresaId',p_empresa_id,'productos',coalesce((select jsonb_agg(jsonb_build_object('productoId',p.id,'unidades',p.stock_actual,'reservadas',0,'disponibles',p.stock_actual)) from public.productos p where p.empresa_id=p_empresa_id and p.activo),'[]'::jsonb));
end $$;
revoke all on function public.sigo_mayorista_lector(uuid) from public,anon,authenticated;
create function public.leer_metricas_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;v_vendedor uuid;v_catalogo jsonb;v_facturas jsonb:=null;v_ledger jsonb:='[]';v_stock jsonb:='[]';
begin
 v_rol:=public.sigo_mayorista_lector(p_empresa_id);
 if v_rol not in ('owner','admin','vendedor') then raise exception 'METRICS_FORBIDDEN';end if;
 v_catalogo:=public.leer_catalogo_mayorista_sigo(p_empresa_id);v_vendedor:=(v_catalogo->>'vendedorId')::uuid;
 if to_regclass('public.arca_comprobantes') is not null then
  select coalesce(jsonb_agg(jsonb_build_object('empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',a.emitido_at,'estado','confirmada','centavos',(v.total*100)::bigint)),'[]') into v_facturas
  from public.arca_comprobantes a join public.sigo_mayorista_entregas_comerciales e on e.empresa_id=a.empresa_id and e.venta_id=a.venta_id join public.ventas_sigo v on v.id=a.venta_id and v.empresa_id=a.empresa_id
  where a.empresa_id=p_empresa_id and a.cae~'^[0-9]{14}$' and a.resultado='A' and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor);
 end if;
 if v_rol in ('owner','admin') then
  select coalesce(jsonb_agg(jsonb_build_object('clienteId',m.cliente_id,'tipo',case when m.tipo='haber' then 'cobranza' else 'debito' end,'centavos',(m.importe*100*(case when m.tipo='haber' then -1 else 1 end))::bigint,'fecha',m.created_at)),'[]') into v_ledger
  from public.cliente_movimientos_sigo m where m.empresa_id=p_empresa_id and exists(select 1 from mayorista.clientes c where c.empresa_id=p_empresa_id and c.cliente_id=m.cliente_id and c.habilitado);
  v_stock:=public.leer_stock_mayorista_sigo(p_empresa_id)->'productos';
 end if;
 return jsonb_build_object('empresaId',p_empresa_id,'customers',v_catalogo->'clientes','products',v_catalogo->'productos','invoices',v_facturas,'ledger',v_ledger,'collections','[]'::jsonb,'inventory',v_stock,
 'sales',coalesce((select jsonb_agg(jsonb_build_object('empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',v.created_at,'estado',v.estado,'centavos',(v.total*100)::bigint,'unidades',(select sum(i.cantidad) from public.venta_items_sigo i where i.empresa_id=p_empresa_id and i.venta_id=v.id)))
 from public.sigo_mayorista_entregas_comerciales e join public.ventas_sigo v on v.id=e.venta_id and v.empresa_id=e.empresa_id where e.empresa_id=p_empresa_id and e.estado='confirmado' and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor)),'[]'::jsonb));
end $$;
revoke all on function public.leer_metricas_mayorista_sigo(uuid) from public,anon;
grant execute on function public.leer_metricas_mayorista_sigo(uuid) to authenticated;
revoke all on function public.leer_catalogo_mayorista_sigo(uuid),public.leer_stock_mayorista_sigo(uuid) from public,anon;
grant execute on function public.leer_catalogo_mayorista_sigo(uuid),public.leer_stock_mayorista_sigo(uuid) to authenticated;
rollback;
