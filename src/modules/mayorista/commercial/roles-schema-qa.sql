-- Esquema operativo propio. Solo en QA independiente; nunca en una base de SIGO.
begin;
alter table mayorista.miembros drop constraint miembros_rol_check;
alter table mayorista.miembros add constraint miembros_rol_check check(rol in ('administrador','gerencia','administracion','vendedor','armador','chofer'));
alter table mayorista.miembros alter column vendedor_id drop not null;
create table mayorista.empresas (empresa_id uuid primary key,nombre text not null,habilitada boolean not null default false);
alter table mayorista.empresas enable row level security;
alter table mayorista.empresas force row level security;
create policy empresa_propia on mayorista.empresas for select to authenticated using(exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.empresa_id=empresas.empresa_id and m.activo));
grant select on mayorista.empresas to authenticated;
create function mayorista.operador(e uuid,roles text[]) returns boolean language sql stable security invoker as $$
 select exists(select 1 from mayorista.miembros m join mayorista.empresas c using(empresa_id) where m.empresa_id=e and m.user_id=(select auth.uid()) and m.activo and c.habilitada and m.rol=any(roles))
$$;
revoke all on function mayorista.operador(uuid,text[]) from public;
grant execute on function mayorista.operador(uuid,text[]) to authenticated;
create table mayorista.cargas_operativas (
 empresa_id uuid not null,carga_id uuid not null,armador_user_id uuid not null,chofer_user_id uuid not null,
 armador_role text not null default 'armador' check(armador_role='armador'),chofer_role text not null default 'chofer' check(chofer_role='chofer'),
 version integer not null check(version>=0),datos jsonb not null,
 primary key(empresa_id,carga_id),
 foreign key(empresa_id,armador_user_id) references mayorista.miembros(empresa_id,user_id),
 foreign key(empresa_id,chofer_user_id) references mayorista.miembros(empresa_id,user_id),
 check(jsonb_typeof(datos)='object' and datos->>'id'=carga_id::text and datos->>'responsable'=armador_user_id::text and datos->>'chofer'=chofer_user_id::text)
);
-- Función privada: la autoconsulta RLS no permite al administrador consultar membresías
-- de otros empleados. El trigger verifica solo los dos responsables de su empresa;
-- no expone una consulta de usuarios, y las asignaciones históricas no bloquean cambio de rol.
create function mayorista_private.validar_responsables() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from mayorista.miembros m join mayorista.empresas e using(empresa_id) where m.empresa_id=new.empresa_id and m.user_id=auth.uid() and m.activo and e.habilitada and m.rol in ('gerencia','administracion')) then raise exception 'Asignación no autorizada' using errcode='42501'; end if;
 if not exists(select 1 from mayorista.miembros m where m.empresa_id=new.empresa_id and m.user_id=new.armador_user_id and m.activo and m.rol='armador' and exists(select 1 from mayorista_private.usuarios u where u.user_id=m.user_id and u.activo)) or not exists(select 1 from mayorista.miembros m where m.empresa_id=new.empresa_id and m.user_id=new.chofer_user_id and m.activo and m.rol='chofer' and exists(select 1 from mayorista_private.usuarios u where u.user_id=m.user_id and u.activo)) then raise exception 'Responsables no válidos' using errcode='23503'; end if;
 new.datos:=jsonb_set(new.datos,'{choferNombre}',to_jsonb((select coalesce(nullif(u.nombre,''),u.email) from mayorista_private.usuarios u where u.user_id=new.chofer_user_id)));
 new.datos:=jsonb_set(new.datos,'{armadorNombre}',to_jsonb((select coalesce(nullif(u.nombre,''),u.email) from mayorista_private.usuarios u where u.user_id=new.armador_user_id)));
 return new;
end $$;
revoke all on function mayorista_private.validar_responsables() from public,anon,authenticated;
create trigger validar_responsables before insert on mayorista.cargas_operativas for each row execute function mayorista_private.validar_responsables();
alter table mayorista.cargas_operativas enable row level security;
alter table mayorista.cargas_operativas force row level security;
create policy carga_asignada_read on mayorista.cargas_operativas for select to authenticated using(
 mayorista.operador(empresa_id,array['gerencia','administracion']) or
 mayorista.operador(empresa_id,array['armador']) and armador_user_id=(select auth.uid()) or
 mayorista.operador(empresa_id,array['chofer']) and chofer_user_id=(select auth.uid())
);
create policy carga_asignada_insert on mayorista.cargas_operativas for insert to authenticated with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy carga_asignada_update on mayorista.cargas_operativas for update to authenticated using(
 mayorista.operador(empresa_id,array['gerencia','administracion']) or
 mayorista.operador(empresa_id,array['armador']) and armador_user_id=(select auth.uid()) or
 mayorista.operador(empresa_id,array['chofer']) and chofer_user_id=(select auth.uid())
) with check(
 mayorista.operador(empresa_id,array['gerencia','administracion']) or
 mayorista.operador(empresa_id,array['armador']) and armador_user_id=(select auth.uid()) or
 mayorista.operador(empresa_id,array['chofer']) and chofer_user_id=(select auth.uid())
);
grant select,insert on mayorista.cargas_operativas to authenticated;
grant update(version,datos) on mayorista.cargas_operativas to authenticated;
create table mayorista.codigos_operativos(empresa_id uuid not null,codigo text not null,producto_id uuid not null,unidades_base integer not null check(unidades_base>0),primary key(empresa_id,codigo),foreign key(empresa_id,producto_id) references mayorista.productos(empresa_id,producto_id));
alter table mayorista.codigos_operativos enable row level security;
alter table mayorista.codigos_operativos force row level security;
create policy codigos_operativos_read on mayorista.codigos_operativos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion','armador','chofer']));
create policy codigos_operativos_insert on mayorista.codigos_operativos for insert to authenticated with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
grant select,insert on mayorista.codigos_operativos to authenticated;
create table mayorista.operaciones_carga (
 empresa_id uuid not null,carga_id uuid not null,comando_id uuid not null,huella text not null check(huella ~ '^[0-9a-f]{64}$'),actor_id uuid not null,respuesta jsonb not null,
 primary key(empresa_id,comando_id),foreign key(empresa_id,carga_id) references mayorista.cargas_operativas(empresa_id,carga_id)
);
alter table mayorista.operaciones_carga enable row level security;
alter table mayorista.operaciones_carga force row level security;
create policy operacion_carga_read on mayorista.operaciones_carga for select to authenticated using(exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=operaciones_carga.empresa_id and c.carga_id=operaciones_carga.carga_id));
create policy operacion_carga_insert on mayorista.operaciones_carga for insert to authenticated with check(actor_id=(select auth.uid()) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=operaciones_carga.empresa_id and c.carga_id=operaciones_carga.carga_id));
grant select,insert on mayorista.operaciones_carga to authenticated;
-- Permisos administrativos nuevos sobre los datos propios existentes. Sin autoasignar membresías.
create policy clientes_admin_operativo on mayorista.clientes for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy vendedores_admin_operativo on mayorista.vendedores for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy pedidos_admin_operativo on mayorista.pedidos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy planificacion_admin_operativo on mayorista.administracion for all to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion'])) with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy comandos_admin_operativo_read on mayorista.comandos_administrativos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy comandos_admin_operativo_insert on mayorista.comandos_administrativos for insert to authenticated with check(actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy cargas_admin_operativo on mayorista.cargas_estado for all to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion'])) with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy asignacion_admin_operativo on mayorista.cargas_asignaciones for all to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion'])) with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy eventos_admin_operativo_read on mayorista.eventos_pedido for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy visitas_admin_operativo on mayorista.visitas for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy cuenta_admin_operativo_read on mayorista.cuenta_movimientos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy cuenta_admin_operativo_insert on mayorista.cuenta_movimientos for insert to authenticated with check(actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy inventario_admin_operativo on mayorista.inventario for all to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion'])) with check(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy movimiento_admin_operativo_read on mayorista.movimientos_inventario for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy movimiento_admin_operativo_insert on mayorista.movimientos_inventario for insert to authenticated with check(actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy eventos_admin_operativo_insert on mayorista.eventos_pedido for insert to authenticated with check(actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['gerencia','administracion']));
-- Se requiere empresa activa también en RLS de los datos que consultan vendedores.
drop policy clientes_asignados on mayorista.clientes;
create policy clientes_asignados on mayorista.clientes for select to authenticated using(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=clientes.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=clientes.vendedor_id));
drop policy productos_empresa on mayorista.productos;
create policy productos_empresa on mayorista.productos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion','vendedor','armador','chofer']));
drop policy precios_empresa on mayorista.precios;
create policy precios_empresa on mayorista.precios for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion','vendedor']));
drop policy pedidos_visibles on mayorista.pedidos;
create policy pedidos_visibles on mayorista.pedidos for select to authenticated using(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=pedidos.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=pedidos.vendedor_id));
drop policy pedidos_propios on mayorista.pedidos;
create policy pedidos_propios on mayorista.pedidos for insert to authenticated with check(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=pedidos.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=pedidos.vendedor_id) and exists(select 1 from mayorista.clientes c where c.empresa_id=pedidos.empresa_id and c.cliente_id=pedidos.cliente_id and c.vendedor_id=pedidos.vendedor_id and c.habilitado));
drop policy visitas_read on mayorista.visitas;
create policy visitas_read on mayorista.visitas for select to authenticated using(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=visitas.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=visitas.vendedor_id));
drop policy visitas_insert on mayorista.visitas;
create policy visitas_insert on mayorista.visitas for insert to authenticated with check(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=visitas.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=visitas.vendedor_id));
-- Armador reserva únicamente productos presentes en una carga que tiene asignada.
create policy inventario_armador_read on mayorista.inventario for select to authenticated using(mayorista.operador(empresa_id,array['armador']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=inventario.empresa_id and c.armador_user_id=(select auth.uid()) and jsonb_path_exists(c.datos,'$.pedidos.*.lineas[*] ? (@.productoId == $p)',jsonb_build_object('p',inventario.producto_id::text))));
create policy inventario_armador_insert on mayorista.inventario for insert to authenticated with check(mayorista.operador(empresa_id,array['armador']) and unidades=0 and reservadas=0 and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=inventario.empresa_id and c.armador_user_id=(select auth.uid()) and jsonb_path_exists(c.datos,'$.pedidos.*.lineas[*] ? (@.productoId == $p)',jsonb_build_object('p',inventario.producto_id::text))));
create policy inventario_armador_update on mayorista.inventario for update to authenticated using(mayorista.operador(empresa_id,array['armador']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=inventario.empresa_id and c.armador_user_id=(select auth.uid()) and jsonb_path_exists(c.datos,'$.pedidos.*.lineas[*] ? (@.productoId == $p)',jsonb_build_object('p',inventario.producto_id::text)))) with check(mayorista.operador(empresa_id,array['armador']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=inventario.empresa_id and c.armador_user_id=(select auth.uid()) and jsonb_path_exists(c.datos,'$.pedidos.*.lineas[*] ? (@.productoId == $p)',jsonb_build_object('p',inventario.producto_id::text))));
create policy movimiento_armador_read on mayorista.movimientos_inventario for select to authenticated using(mayorista.operador(empresa_id,array['armador']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=movimientos_inventario.empresa_id and c.carga_id::text=movimientos_inventario.origen and c.armador_user_id=(select auth.uid())));
create policy movimiento_armador_insert on mayorista.movimientos_inventario for insert to authenticated with check(tipo='reserva' and actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['armador']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=movimientos_inventario.empresa_id and c.carga_id::text=movimientos_inventario.origen and c.armador_user_id=(select auth.uid())));
create policy cuenta_chofer_insert on mayorista.cuenta_movimientos for insert to authenticated with check(tipo in ('entrega','devolucion') and actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['chofer']) and exists(select 1 from mayorista.cargas_operativas c where c.empresa_id=cuenta_movimientos.empresa_id and c.chofer_user_id=(select auth.uid()) and c.datos->'pedidos' ? cuenta_movimientos.pedido_id::text));
rollback;
