-- Ampliación transaccional: usa productos, ventas, Caja y cuenta corriente SIGO existentes.
-- NO crea stock, productos, clientes, cuentas ni facturación paralelos. Revisar antes de migración real.
begin;
create table public.sigo_mayorista_comercio_fuente (
 empresa_id uuid primary key references public.empresas(id),fuente text not null default 'qa' check(fuente in ('qa','sigo')),
 backend_revision text not null check(backend_revision ~ '^[0-9a-f]{40}$'),actor_id uuid references auth.users(id),fecha timestamptz not null default now()
);
alter table public.sigo_mayorista_comercio_fuente enable row level security;
revoke all on public.sigo_mayorista_comercio_fuente from public,anon,authenticated;
create table public.sigo_mayorista_entregas_comerciales (
 empresa_id uuid not null references public.empresas(id),comando_id uuid not null,pedido_id uuid not null,
 cliente_id uuid not null references public.clientes_sigo(id),vendedor_id uuid,ruta_id uuid,
 solicitud jsonb not null,huella text not null,estado text not null check(estado in ('recibido','requiere_autorizacion','aprobado','rechazado','confirmado')),
 detalle jsonb not null,total numeric(14,2) not null check(total>0),venta_id uuid references public.ventas_sigo(id),
 recibido_por uuid not null references auth.users(id),recibido_en timestamptz not null default now(),
 autorizado_por uuid references auth.users(id),autorizado_en timestamptz,motivo text,respuesta jsonb,
 primary key(empresa_id,comando_id),check((estado='confirmado')=(venta_id is not null))
);
create index sigo_mayorista_entregas_pedido on public.sigo_mayorista_entregas_comerciales(empresa_id,pedido_id);
create table public.sigo_mayorista_cobros_vinculos (
 empresa_id uuid not null references public.empresas(id),comando_id uuid not null,pedido_id uuid,
 cliente_id uuid not null references public.clientes_sigo(id),huella text not null,movimiento_id uuid not null references public.cliente_movimientos_sigo(id),
 respuesta jsonb not null,actor_id uuid not null references auth.users(id),fecha timestamptz not null default now(),comprobante text not null,
 primary key(empresa_id,comando_id),unique(empresa_id,comprobante)
);
alter table public.sigo_mayorista_entregas_comerciales enable row level security;
alter table public.sigo_mayorista_cobros_vinculos enable row level security;
revoke all on public.sigo_mayorista_entregas_comerciales,public.sigo_mayorista_cobros_vinculos from public,anon,authenticated;

create function public.sigo_mayorista_operador_comercial(p_empresa_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;v_session uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUTH_REQUIRED';end if;
 v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
 if v_session is null or not exists(select 1 from auth.sessions s where s.id=v_session and s.user_id=auth.uid()) then raise exception 'SESSION_REVOKED';end if;
 if coalesce((auth.jwt()->>'exp')::bigint,0)<=extract(epoch from now()) then raise exception 'SESSION_EXPIRED';end if;
 select eu.rol into v_rol from public.empresa_usuarios eu join public.empresas e on e.id=eu.empresa_id
 where eu.empresa_id=p_empresa_id and eu.user_id=auth.uid() and eu.activo and e.activa and eu.rol in ('owner','admin');
 if v_rol is null or not exists(select 1 from public.sigo_empresa_modulos m where m.empresa_id=p_empresa_id and m.modulo_clave='mayorista_distribuidora' and m.habilitado) then raise exception 'MAYORISTA_FORBIDDEN';end if;
 if not exists(select 1 from public.sigo_mayorista_comercio_fuente f where f.empresa_id=p_empresa_id and f.fuente='sigo') then raise exception 'SHARED_SOURCE_NOT_READY';end if;
 if not public.tiene_permiso_empresa(p_empresa_id,'sales.write') or not public.tiene_permiso_empresa(p_empresa_id,'clients.read') then raise exception 'MAYORISTA_FORBIDDEN';end if;
 return v_rol;
end $$;

create function public.registrar_entrega_mayorista_sigo(p_empresa_id uuid,p_comando_id uuid,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rol text;v_hash text;v_old public.sigo_mayorista_entregas_comerciales%rowtype;
 v_cliente public.clientes_sigo%rowtype;v_producto public.productos%rowtype;v_line jsonb;v_detalle jsonb:='[]';
 v_qty numeric;v_price numeric;v_subtotal numeric;v_total numeric(14,2):=0;v_discount numeric;v_venta uuid;v_answer jsonb;
 v_cliente_id uuid;v_pedido uuid;v_medio text;v_product_id uuid;v_faltante boolean:=false;
begin
 v_rol:=public.sigo_mayorista_operador_comercial(p_empresa_id);
 if p_comando_id is null or jsonb_typeof(p_datos) is distinct from 'object' or pg_column_size(p_datos)>262144 then raise exception 'DELIVERY_INVALID';end if;
 v_cliente_id:=(p_datos->>'clienteId')::uuid;v_pedido:=(p_datos->>'pedidoId')::uuid;v_medio:=p_datos->>'medioPago';
 if v_cliente_id is null or v_pedido is null or v_medio is null or v_medio not in ('efectivo','transferencia','cuenta_corriente') or jsonb_typeof(p_datos->'lineas') is distinct from 'array' then raise exception 'DELIVERY_INVALID';end if;
 if jsonb_array_length(p_datos->'lineas') not between 1 and 200 then raise exception 'DELIVERY_INVALID';end if;
 v_hash:=md5(p_datos::text);
 perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text||p_comando_id::text,0));
 if exists(select 1 from public.sigo_mayorista_cobros_vinculos where empresa_id=p_empresa_id and comando_id=p_comando_id) then raise exception 'IDEMPOTENCY_TYPE_CONFLICT';end if;
 select * into v_old from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and comando_id=p_comando_id for update;
 if found then
  if v_old.huella<>v_hash then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if v_old.estado in ('confirmado','rechazado','requiere_autorizacion') then return v_old.respuesta;end if;
 end if;
 select * into v_cliente from public.clientes_sigo where id=v_cliente_id and empresa_id=p_empresa_id and activo for update;
 if not found then raise exception 'CLIENT_NOT_FOUND';end if;
 if (select count(*) from jsonb_array_elements(p_datos->'lineas'))<>(select count(distinct value->>'productoId') from jsonb_array_elements(p_datos->'lineas')) then raise exception 'DELIVERY_DUPLICATE_PRODUCT';end if;
 -- Orden estable de bloqueos; stock se descuenta SOLO al confirmar esta entrega/venta.
 for v_line in select value from jsonb_array_elements(p_datos->'lineas') order by value->>'productoId' loop
  v_product_id:=(v_line->>'productoId')::uuid;v_qty:=(v_line->>'cantidad')::numeric;
  if v_product_id is null or v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty>1000000 or trunc(v_qty)<>v_qty then raise exception 'DELIVERY_QUANTITY_INVALID';end if;
  select * into v_producto from public.productos where id=v_product_id and empresa_id=p_empresa_id and activo for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
  if v_producto.precio_venta is null or v_producto.precio_venta<=0 or v_producto.stock_actual is null then raise exception 'PRODUCT_NOT_READY';end if;
  if v_producto.stock_actual<v_qty then v_faltante:=true;end if;
  select descuento_porcentaje into v_discount from public.ofertas_productos_sigo where empresa_id=p_empresa_id and producto_id=v_product_id
   and fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1 for share;
  v_price:=round(v_producto.precio_venta*(1-coalesce(v_discount,0)/100),2);
  -- El contrato no acepta un precio arbitrario: conserva el pedido y pide revisión si cambió.
  if (v_line->>'precioUnitario')::numeric is distinct from v_price then
   return jsonb_build_object('estado','requiere_revision','motivo','precio_cambiado','pedidoId',v_pedido,'comandoId',p_comando_id);
  end if;
  v_subtotal:=round(v_qty*v_price,2);v_total:=v_total+v_subtotal;
  v_detalle:=v_detalle||jsonb_build_array(jsonb_build_object('productoId',v_product_id,'cantidad',v_qty,'precioUnitario',v_price,'subtotal',v_subtotal));
 end loop;
 if v_total<=0 then raise exception 'DELIVERY_AMOUNT_INVALID';end if;
 if v_old.comando_id is null then
  insert into public.sigo_mayorista_entregas_comerciales(empresa_id,comando_id,pedido_id,cliente_id,vendedor_id,ruta_id,solicitud,huella,estado,detalle,total,recibido_por)
  values(p_empresa_id,p_comando_id,v_pedido,v_cliente_id,nullif(p_datos->>'vendedorId','')::uuid,nullif(p_datos->>'rutaId','')::uuid,p_datos,v_hash,'recibido',v_detalle,v_total,auth.uid());
 end if;
 if v_faltante then
  return jsonb_build_object('estado','requiere_revision','motivo','stock_insuficiente','pedidoId',v_pedido,'comandoId',p_comando_id);
 end if;
 if v_medio='cuenta_corriente' and v_cliente.limite_credito is not null and v_cliente.saldo_actual+v_total>v_cliente.limite_credito and v_old.autorizado_por is null then
  v_answer:=jsonb_build_object('estado','requiere_autorizacion','pedidoId',v_pedido,'comandoId',p_comando_id,'limite',v_cliente.limite_credito,'utilizado',v_cliente.saldo_actual,'disponible',greatest(0,v_cliente.limite_credito-v_cliente.saldo_actual),'total',v_total);
  update public.sigo_mayorista_entregas_comerciales set estado='requiere_autorizacion',respuesta=v_answer where empresa_id=p_empresa_id and comando_id=p_comando_id;
  return v_answer;
 end if;
 -- Mismas tablas SIGO; no se altera confirmar_venta_sigo_v2 ni los flujos Minorista.
 insert into public.ventas_sigo(empresa_id,cliente_id,total,medio_pago,idempotency_key,request_fingerprint,created_by)
 values(p_empresa_id,v_cliente_id,v_total,v_medio,'mayorista:'||p_comando_id::text,v_hash,auth.uid()) returning id into v_venta;
 for v_line in select value from jsonb_array_elements(v_detalle) loop
  insert into public.venta_items_sigo(venta_id,empresa_id,producto_id,cantidad,precio_unitario,subtotal)
   values(v_venta,p_empresa_id,(v_line->>'productoId')::uuid,(v_line->>'cantidad')::numeric,(v_line->>'precioUnitario')::numeric,(v_line->>'subtotal')::numeric);
  update public.productos set stock_actual=stock_actual-(v_line->>'cantidad')::numeric where empresa_id=p_empresa_id and id=(v_line->>'productoId')::uuid;
 end loop;
 if v_medio='cuenta_corriente' then
  insert into public.cliente_movimientos_sigo(empresa_id,cliente_id,venta_id,tipo,importe,concepto,created_by) values(p_empresa_id,v_cliente_id,v_venta,'debe',v_total,'Entrega Mayorista '||v_pedido::text,auth.uid());
  update public.clientes_sigo set saldo_actual=saldo_actual+v_total,updated_at=now() where empresa_id=p_empresa_id and id=v_cliente_id;
 else
  insert into public.caja_movimientos_sigo(empresa_id,venta_id,tipo,medio_pago,importe,concepto,created_by) values(p_empresa_id,v_venta,'ingreso',v_medio,v_total,'Entrega Mayorista '||v_pedido::text,auth.uid());
 end if;
 v_answer:=jsonb_build_object('estado','confirmado','empresaId',p_empresa_id,'pedidoId',v_pedido,'comandoId',p_comando_id,'ventaId',v_venta,'total',v_total,'facturacion','pendiente');
 update public.sigo_mayorista_entregas_comerciales set estado='confirmado',venta_id=v_venta,respuesta=v_answer where empresa_id=p_empresa_id and comando_id=p_comando_id;
 return v_answer;
end $$;

create function public.autorizar_credito_mayorista_sigo(p_empresa_id uuid,p_comando_id uuid,p_aprobar boolean,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.sigo_mayorista_entregas_comerciales%rowtype;v_result jsonb;
begin
 if public.sigo_mayorista_operador_comercial(p_empresa_id)<>'owner' then raise exception 'MANAGEMENT_REQUIRED';end if;
 if p_aprobar is null or nullif(btrim(p_motivo),'') is null or length(p_motivo)>1000 then raise exception 'AUTHORIZATION_INVALID';end if;
 select * into v_row from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and comando_id=p_comando_id for update;
 if not found then raise exception 'DELIVERY_NOT_FOUND';end if;
 if v_row.estado in ('aprobado','rechazado') then
  if (v_row.estado='aprobado') is distinct from p_aprobar or v_row.motivo<>p_motivo then raise exception 'AUTHORIZATION_CONFLICT';end if;return v_row.respuesta;
 end if;
 if v_row.estado<>'requiere_autorizacion' then raise exception 'AUTHORIZATION_STATE_INVALID';end if;
 v_result:=jsonb_build_object('estado',case when p_aprobar then 'aprobado' else 'rechazado' end,'comandoId',p_comando_id,'pedidoId',v_row.pedido_id,'responsable',auth.uid(),'fecha',now());
 update public.sigo_mayorista_entregas_comerciales set estado=case when p_aprobar then 'aprobado' else 'rechazado' end,autorizado_por=auth.uid(),autorizado_en=now(),motivo=p_motivo,respuesta=v_result where empresa_id=p_empresa_id and comando_id=p_comando_id;
 return v_result;
end $$;

create function public.registrar_cobro_mayorista_sigo(p_empresa_id uuid,p_comando_id uuid,p_cliente_id uuid,p_pedido_id uuid,p_centavos bigint,p_medio text,p_comprobante text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_hash text;v_old public.sigo_mayorista_cobros_vinculos%rowtype;v_id uuid;v_result jsonb;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 if p_comando_id is null or p_cliente_id is null or p_centavos is null or p_centavos not between 1 and 99999999999999 or p_medio is null or p_medio not in ('efectivo','transferencia') or nullif(btrim(p_comprobante),'') is null or length(p_comprobante)>160 then raise exception 'COLLECTION_INVALID';end if;
 if not exists(select 1 from public.clientes_sigo where empresa_id=p_empresa_id and id=p_cliente_id and activo) then raise exception 'CLIENT_NOT_FOUND';end if;
 v_hash:=md5(jsonb_build_object('cliente',p_cliente_id,'pedido',p_pedido_id,'centavos',p_centavos,'medio',p_medio,'comprobante',p_comprobante)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text||p_comando_id::text,0));
 if exists(select 1 from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and comando_id=p_comando_id) then raise exception 'IDEMPOTENCY_TYPE_CONFLICT';end if;
 select * into v_old from public.sigo_mayorista_cobros_vinculos where empresa_id=p_empresa_id and comando_id=p_comando_id;
 if found then if v_old.huella<>v_hash then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_old.respuesta;end if;
 if exists(select 1 from public.sigo_mayorista_cobros_vinculos where empresa_id=p_empresa_id and comprobante=btrim(p_comprobante)) then raise exception 'COLLECTION_ALREADY_REGISTERED';end if;
 if p_pedido_id is not null and not exists(select 1 from public.sigo_mayorista_entregas_comerciales where empresa_id=p_empresa_id and pedido_id=p_pedido_id and cliente_id=p_cliente_id and estado='confirmado') then raise exception 'ORDER_ACCOUNT_MISMATCH';end if;
 v_id:=public.registrar_cobro_cliente_sigo_v2(p_empresa_id,p_cliente_id,p_centavos::numeric/100,p_medio,p_comprobante);
 v_result:=jsonb_build_object('estado','confirmado','empresaId',p_empresa_id,'comandoId',p_comando_id,'movimientoId',v_id);
 insert into public.sigo_mayorista_cobros_vinculos values(p_empresa_id,p_comando_id,p_pedido_id,p_cliente_id,v_hash,v_id,v_result,auth.uid(),now(),btrim(p_comprobante));
 return v_result;
end $$;
create function public.leer_comercio_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 return jsonb_build_object('empresaId',p_empresa_id,'operaciones',coalesce((select jsonb_agg(jsonb_build_object('pedidoId',e.pedido_id,'comandoId',e.comando_id,'estado',e.estado,'resultado',coalesce(e.respuesta,jsonb_build_object('estado',e.estado,'comandoId',e.comando_id,'pedidoId',e.pedido_id)),'autorizadoPor',e.autorizado_por,'autorizadoEn',e.autorizado_en) order by e.recibido_en) from public.sigo_mayorista_entregas_comerciales e where e.empresa_id=p_empresa_id),'[]'::jsonb),
 'cuentas',coalesce((select jsonb_agg(jsonb_build_object('clienteId',c.id,'saldoCentavos',(c.saldo_actual*100)::bigint::text)) from public.clientes_sigo c where c.empresa_id=p_empresa_id and c.activo),'[]'::jsonb),
 'cobros',coalesce((select jsonb_agg(jsonb_build_object('clienteId',c.cliente_id,'comandoId',c.comando_id,'comprobante',c.comprobante,'resultado',c.respuesta,'fecha',c.fecha)) from public.sigo_mayorista_cobros_vinculos c where c.empresa_id=p_empresa_id),'[]'::jsonb));
end $$;
revoke all on function public.sigo_mayorista_operador_comercial(uuid),public.registrar_entrega_mayorista_sigo(uuid,uuid,jsonb),public.autorizar_credito_mayorista_sigo(uuid,uuid,boolean,text),public.registrar_cobro_mayorista_sigo(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon;
grant execute on function public.registrar_entrega_mayorista_sigo(uuid,uuid,jsonb),public.autorizar_credito_mayorista_sigo(uuid,uuid,boolean,text),public.registrar_cobro_mayorista_sigo(uuid,uuid,uuid,uuid,bigint,text,text) to authenticated;
revoke all on function public.leer_comercio_mayorista_sigo(uuid) from public,anon;
grant execute on function public.leer_comercio_mayorista_sigo(uuid) to authenticated;
rollback;
