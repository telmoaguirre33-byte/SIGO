-- Ampliación Mayorista sobre 006/007. Solo propuestas y fixtures QA; no producción.
begin;
create table public.sigo_mayorista_cobradores(empresa_id uuid not null references public.empresas(id),user_id uuid not null references auth.users(id),activo boolean not null,limite_centavos bigint not null check(limite_centavos>0),autorizado_por uuid not null references auth.users(id),autorizado_en timestamptz not null default now(),primary key(empresa_id,user_id));
alter table public.sigo_mayorista_cobradores enable row level security;
revoke all on public.sigo_mayorista_cobradores from public,anon,authenticated;
create function public.configurar_cobrador_mayorista_sigo(p_empresa_id uuid,p_usuario uuid,p_activo boolean,p_limite bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.sigo_mayorista_operador_comercial(p_empresa_id)<>'owner' then raise exception 'MANAGEMENT_REQUIRED';end if;
 if p_activo is null or p_limite is null or p_limite<=0 or p_limite>99999999999999 or not exists(select 1 from public.empresa_usuarios u join mayorista.miembros m on m.empresa_id=u.empresa_id and m.user_id=u.user_id where u.empresa_id=p_empresa_id and u.user_id=p_usuario and u.activo and m.activo and u.rol in ('vendedor','chofer') and m.rol=u.rol) then raise exception 'COLLECTOR_INVALID';end if;
 insert into public.sigo_mayorista_cobradores values(p_empresa_id,p_usuario,p_activo,p_limite,auth.uid(),now()) on conflict(empresa_id,user_id) do update set activo=excluded.activo,limite_centavos=excluded.limite_centavos,autorizado_por=excluded.autorizado_por,autorizado_en=now();
 return jsonb_build_object('usuario',p_usuario,'activo',p_activo,'limiteCentavos',p_limite,'responsable',auth.uid());
end $$;
create function public.sigo_mayorista_cliente_visible(p_empresa_id uuid,p_cliente uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare r text;
begin
 r:=public.sigo_mayorista_lector(p_empresa_id);
 if not exists(select 1 from public.clientes_sigo where empresa_id=p_empresa_id and id=p_cliente) then raise exception 'CLIENT_NOT_FOUND';end if;
 if r in ('owner','admin') then return r;end if;
 if r='vendedor' and exists(select 1 from mayorista.clientes c join mayorista.miembros m on m.empresa_id=c.empresa_id and m.vendedor_id=c.vendedor_id where c.empresa_id=p_empresa_id and c.cliente_id=p_cliente and c.habilitado and m.user_id=auth.uid() and m.activo) then return r;end if;
 if r='chofer' and exists(select 1 from mayorista.cargas_operativas l cross join lateral jsonb_each(l.datos->'pedidos') p where l.empresa_id=p_empresa_id and l.chofer_user_id=auth.uid() and (p.value->>'clienteId')::uuid=p_cliente) then return r;end if;
 raise exception 'CLIENT_FORBIDDEN';
end $$;
revoke all on function public.sigo_mayorista_cliente_visible(uuid,uuid) from public,anon,authenticated;
create function public.leer_ficha_mayorista_sigo(p_empresa_id uuid,p_cliente uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text;devoluciones jsonb:=null;habituales jsonb;
begin
 r:=public.sigo_mayorista_cliente_visible(p_empresa_id,p_cliente);
 if to_regclass('public.devoluciones_sigo') is not null then
  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc),'[]') into devoluciones from public.devoluciones_sigo d join public.ventas_sigo v on v.empresa_id=d.empresa_id and v.id=d.venta_id where v.empresa_id=p_empresa_id and v.cliente_id=p_cliente;
 end if;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.unidades desc),'[]') into habituales from (select i.producto_id as "productoId",p.nombre,sum(i.cantidad) as unidades,count(distinct v.id) as compras,max(v.created_at) as "ultimaCompra" from public.ventas_sigo v join public.venta_items_sigo i on i.empresa_id=v.empresa_id and i.venta_id=v.id join public.productos p on p.id=i.producto_id and p.empresa_id=i.empresa_id where v.empresa_id=p_empresa_id and v.cliente_id=p_cliente and v.estado='confirmada' group by i.producto_id,p.nombre order by sum(i.cantidad) desc limit 20) h;
 return jsonb_build_object('empresaId',p_empresa_id,'cliente',(select to_jsonb(c) from public.clientes_sigo c where c.empresa_id=p_empresa_id and c.id=p_cliente),'deudaVencida',null,
 'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',pedido_id,'fecha',creado_en,'vendedorId',vendedor_id,'lineas',lineas,'estado',estado) order by creado_en desc) from mayorista.pedidos where empresa_id=p_empresa_id and cliente_id=p_cliente),'[]'),
 'compras',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('lineas',(select jsonb_agg(to_jsonb(i)) from public.venta_items_sigo i where i.empresa_id=p_empresa_id and i.venta_id=v.id)) order by v.created_at desc) from public.ventas_sigo v where v.empresa_id=p_empresa_id and v.cliente_id=p_cliente),'[]'),
 'visitas',coalesce((select jsonb_agg(datos order by recibida_en desc) from mayorista.visitas where empresa_id=p_empresa_id and cliente_id=p_cliente),'[]'),
 'cuentaCorriente',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.cliente_movimientos_sigo m where m.empresa_id=p_empresa_id and m.cliente_id=p_cliente),'[]'),
 'cobranzas',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.cliente_movimientos_sigo m where m.empresa_id=p_empresa_id and m.cliente_id=p_cliente and m.tipo='haber' and m.venta_id is null),'[]'),
 'devoluciones',devoluciones,'controlDevoluciones',coalesce((select jsonb_agg(jsonb_build_object('devolucionId',d.devolucion_id,'lineas',d.lineas,'notaCredito',d.nota_credito,'historial',d.historial)) from public.sigo_mayorista_devoluciones_control d join public.ventas_sigo v on v.empresa_id=d.empresa_id and v.id=d.venta_id where v.empresa_id=p_empresa_id and v.cliente_id=p_cliente),'[]'),'productosHabituales',habituales,'ultimaVisita',(select max(recibida_en) from mayorista.visitas where empresa_id=p_empresa_id and cliente_id=p_cliente),'ultimoPedido',(select max(creado_en) from mayorista.pedidos where empresa_id=p_empresa_id and cliente_id=p_cliente));
end $$;
create function public.cobrar_mayorista_autorizado_sigo(p_empresa_id uuid,p_comando uuid,p_cliente uuid,p_pedido uuid,p_centavos bigint,p_medio text,p_comprobante text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;old public.sigo_mayorista_cobros_vinculos%rowtype;h text;mov uuid;saldo numeric;respuesta jsonb;limite bigint;
begin
 r:=public.sigo_mayorista_cliente_visible(p_empresa_id,p_cliente);
 if r in ('owner','admin') then return public.registrar_cobro_mayorista_sigo(p_empresa_id,p_comando,p_cliente,p_pedido,p_centavos,p_medio,p_comprobante);end if;
 select limite_centavos into limite from public.sigo_mayorista_cobradores where empresa_id=p_empresa_id and user_id=auth.uid() and activo;
 if limite is null then raise exception 'COLLECTION_FORBIDDEN';end if;
 if p_comando is null or p_centavos is null or p_centavos<=0 or p_centavos>limite or p_medio not in ('efectivo','transferencia') or p_medio is null or nullif(btrim(p_comprobante),'') is null or length(p_comprobante)>160 then raise exception 'COLLECTION_INVALID';end if;
 h:=md5(jsonb_build_object('cliente',p_cliente,'pedido',p_pedido,'centavos',p_centavos,'medio',p_medio,'comprobante',p_comprobante)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text||p_comando::text,0));
 select * into old from public.sigo_mayorista_cobros_vinculos where empresa_id=p_empresa_id and comando_id=p_comando;
 if found then if old.huella<>h or old.actor_id<>auth.uid() then raise exception 'IDEMPOTENCY_CONFLICT';end if;return old.respuesta;end if;
 if exists(select 1 from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and comando_id=p_comando) then raise exception 'IDEMPOTENCY_TYPE_CONFLICT';end if;
 if exists(select 1 from public.sigo_mayorista_cobros_vinculos where empresa_id=p_empresa_id and comprobante=btrim(p_comprobante)) then raise exception 'COLLECTION_ALREADY_REGISTERED';end if;
 if p_pedido is not null and not exists(select 1 from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and pedido_id=p_pedido and cliente_id=p_cliente and estado='confirmado') then raise exception 'ORDER_ACCOUNT_MISMATCH';end if;
 select saldo_actual into saldo from public.clientes_sigo where empresa_id=p_empresa_id and id=p_cliente and activo for update;
 if saldo is null or saldo<=0 or p_centavos::numeric/100>saldo then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
 -- Misma contabilidad canónica. Extensión de autorización limitada, sin suplantar auth.uid().
 insert into public.cliente_movimientos_sigo(empresa_id,cliente_id,tipo,importe,concepto,created_by) values(p_empresa_id,p_cliente,'haber',p_centavos::numeric/100,p_comprobante,auth.uid()) returning id into mov;
 update public.clientes_sigo set saldo_actual=saldo_actual-p_centavos::numeric/100,updated_at=now() where empresa_id=p_empresa_id and id=p_cliente;
 insert into public.caja_movimientos_sigo(empresa_id,tipo,medio_pago,importe,concepto,created_by) values(p_empresa_id,'ingreso',p_medio,p_centavos::numeric/100,p_comprobante,auth.uid());
 respuesta:=jsonb_build_object('estado','confirmado','empresaId',p_empresa_id,'comandoId',p_comando,'movimientoId',mov);
 insert into public.sigo_mayorista_cobros_vinculos values(p_empresa_id,p_comando,p_pedido,p_cliente,h,mov,respuesta,auth.uid(),now(),btrim(p_comprobante));return respuesta;
end $$;
create function public.permiso_cobro_mayorista_sigo(p_empresa_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text;g public.sigo_mayorista_cobradores%rowtype;
begin
 r:=public.sigo_mayorista_lector(p_empresa_id);select * into g from public.sigo_mayorista_cobradores where empresa_id=p_empresa_id and user_id=auth.uid();
 return jsonb_build_object('autorizado',r in ('owner','admin') or (coalesce(g.activo,false) and r in ('vendedor','chofer')),'limiteCentavos',g.limite_centavos,'recibos',coalesce((select jsonb_agg(jsonb_build_object('id',comando_id,'clienteId',cliente_id,'centavos',(select importe*100 from public.cliente_movimientos_sigo where id=v.movimiento_id),'fecha',fecha,'comprobante',comprobante)) from public.sigo_mayorista_cobros_vinculos v where empresa_id=p_empresa_id and actor_id=auth.uid()),'[]'));
end $$;
revoke all on function public.permiso_cobro_mayorista_sigo(uuid) from public,anon;grant execute on function public.permiso_cobro_mayorista_sigo(uuid) to authenticated;
revoke all on function public.configurar_cobrador_mayorista_sigo(uuid,uuid,boolean,bigint),public.leer_ficha_mayorista_sigo(uuid,uuid),public.cobrar_mayorista_autorizado_sigo(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon;
grant execute on function public.configurar_cobrador_mayorista_sigo(uuid,uuid,boolean,bigint),public.leer_ficha_mayorista_sigo(uuid,uuid),public.cobrar_mayorista_autorizado_sigo(uuid,uuid,uuid,uuid,bigint,text,text) to authenticated;
create table public.sigo_mayorista_devoluciones_control(empresa_id uuid not null references public.empresas(id),comando_id uuid not null,venta_id uuid not null references public.ventas_sigo(id),devolucion_id uuid not null references public.devoluciones_sigo(id),solicitud jsonb not null,huella text not null,lineas jsonb not null,nota_credito jsonb not null,historial jsonb not null,primary key(empresa_id,comando_id));
alter table public.sigo_mayorista_devoluciones_control enable row level security;revoke all on public.sigo_mayorista_devoluciones_control from public,anon,authenticated;
create function public.devolver_mayorista_sigo(p_empresa_id uuid,p_comando uuid,p_datos jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.sigo_mayorista_devoluciones_control%rowtype;linea jsonb;items jsonb:='[]';v_id uuid;v_venta uuid;h text;nc jsonb;v_producto uuid;v_precio numeric;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 if p_comando is null or jsonb_typeof(p_datos) is distinct from 'object' or jsonb_typeof(p_datos->'lineas') is distinct from 'array' or jsonb_array_length(p_datos->'lineas') not between 1 and 200 then raise exception 'RETURN_INVALID';end if;
 v_venta:=(p_datos->>'ventaId')::uuid;
 if not exists(select 1 from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and venta_id=v_venta and estado='confirmado') then raise exception 'RETURN_SALE_FORBIDDEN';end if;
 h:=md5(p_datos::text);perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text||p_comando::text,0));
 select * into old from public.sigo_mayorista_devoluciones_control where empresa_id=p_empresa_id and comando_id=p_comando;
 if found then if old.huella<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('devolucionId',old.devolucion_id,'lineas',old.lineas,'notaCredito',old.nota_credito);end if;
 if (select count(*) from jsonb_array_elements(p_datos->'lineas'))<>(select count(distinct value->>'ventaItemId') from jsonb_array_elements(p_datos->'lineas')) then raise exception 'RETURN_DUPLICATE_ITEM';end if;
 for linea in select value from jsonb_array_elements(p_datos->'lineas') order by value->>'ventaItemId' loop
  if (linea->>'disposicion') is null or (linea->>'disposicion') not in ('vendible','averiada','revision') or (linea->>'cantidad')::numeric<=0 or (linea->>'cantidad')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'RETURN_CLASSIFICATION_INVALID';end if;
  select producto_id into v_producto from public.venta_items_sigo where empresa_id=p_empresa_id and venta_id=v_venta and id=(linea->>'ventaItemId')::uuid;
  if v_producto is null then raise exception 'RETURN_ITEM_FORBIDDEN';end if;
  perform 1 from public.productos where empresa_id=p_empresa_id and id=v_producto for update;
  items:=items||jsonb_build_array(jsonb_build_object('venta_item_id',linea->>'ventaItemId','cantidad',linea->'cantidad'));
 end loop;
 -- RPC SIGO existente conserva cantidades, venta, cuenta y Caja originales.
 v_id:=public.registrar_devolucion_sigo(p_empresa_id,v_venta,items,p_datos->>'motivo','mayorista_devolucion:'||p_comando::text,false);
 for linea in select value from jsonb_array_elements(p_datos->'lineas') loop
  if linea->>'disposicion'<>'vendible' then
   update public.productos set stock_actual=stock_actual-(linea->>'cantidad')::numeric where empresa_id=p_empresa_id and id=(select producto_id from public.venta_items_sigo where empresa_id=p_empresa_id and venta_id=v_venta and id=(linea->>'ventaItemId')::uuid);
  end if;
 end loop;
 nc:=jsonb_build_object('estado','sin_factura_fiscal');
 if to_regclass('public.arca_comprobantes') is not null then
  select jsonb_build_object('estado','pendiente_homologacion','facturaId',id,'caeOriginal',cae,'devolucionId',v_id,'tipoCbte',case tipo_cbte when 1 then 3 when 6 then 8 when 11 then 13 end) into nc from public.arca_comprobantes where empresa_id=p_empresa_id and venta_id=v_venta and cae is not null limit 1;
  nc:=coalesce(nc,jsonb_build_object('estado','sin_factura_fiscal'));
 end if;
 insert into public.sigo_mayorista_devoluciones_control values(p_empresa_id,p_comando,v_venta,v_id,p_datos,h,p_datos->'lineas',nc,jsonb_build_array(jsonb_build_object('tipo','devolucion','responsable',auth.uid(),'fecha',now(),'lineas',p_datos->'lineas')));
 return jsonb_build_object('devolucionId',v_id,'lineas',p_datos->'lineas','notaCredito',nc);
end $$;
create function public.clasificar_devolucion_mayorista_sigo(p_empresa_id uuid,p_devolucion uuid,p_item uuid,p_disposicion text,p_motivo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;registro public.sigo_mayorista_devoluciones_control%rowtype;linea jsonb;nuevas jsonb:='[]';pid uuid;
begin
 r:=public.sigo_mayorista_lector(p_empresa_id);
 if p_disposicion is null or p_disposicion not in ('vendible','averiada') or length(coalesce(p_motivo,''))<3 then raise exception 'INSPECTION_INVALID';end if;
 select * into registro from public.sigo_mayorista_devoluciones_control where empresa_id=p_empresa_id and devolucion_id=p_devolucion for update;
 if not found then raise exception 'RETURN_NOT_FOUND';end if;
 if r not in ('owner','admin') and not (r='armador' and exists(select 1 from mayorista.cargas_operativas l cross join lateral jsonb_each(l.datos->'pedidos') pedido join public.sigo_mayorista_entregas_comerciales e on e.empresa_id=l.empresa_id and e.pedido_id=(pedido.value->>'pedidoId')::uuid where l.empresa_id=p_empresa_id and l.armador_user_id=auth.uid() and e.venta_id=registro.venta_id)) then raise exception 'INSPECTION_FORBIDDEN';end if;
 if not exists(select 1 from jsonb_array_elements(registro.lineas) x where (x->>'ventaItemId')::uuid=p_item) then raise exception 'RETURN_ITEM_FORBIDDEN';end if;
 for linea in select value from jsonb_array_elements(registro.lineas) loop
  if (linea->>'ventaItemId')::uuid=p_item then
   if linea->>'disposicion'=p_disposicion then return jsonb_build_object('devolucionId',p_devolucion,'lineas',registro.lineas);end if;
   if linea->>'disposicion'<>'revision' then raise exception 'INSPECTION_STATE_INVALID';end if;
   if p_disposicion='vendible' then update public.productos set stock_actual=stock_actual+(linea->>'cantidad')::numeric where empresa_id=p_empresa_id and id=(select producto_id from public.venta_items_sigo where empresa_id=p_empresa_id and id=p_item);end if;
   linea:=linea||jsonb_build_object('disposicion',p_disposicion);
  end if;
  nuevas:=nuevas||jsonb_build_array(linea);
 end loop;
 update public.sigo_mayorista_devoluciones_control set lineas=nuevas,historial=historial||jsonb_build_array(jsonb_build_object('tipo','inspeccion','item',p_item,'disposicion',p_disposicion,'motivo',p_motivo,'responsable',auth.uid(),'fecha',now())) where empresa_id=p_empresa_id and comando_id=registro.comando_id;
 return jsonb_build_object('devolucionId',p_devolucion,'lineas',nuevas);
end $$;
revoke all on function public.devolver_mayorista_sigo(uuid,uuid,jsonb),public.clasificar_devolucion_mayorista_sigo(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.devolver_mayorista_sigo(uuid,uuid,jsonb),public.clasificar_devolucion_mayorista_sigo(uuid,uuid,uuid,text,text) to authenticated;
rollback;
