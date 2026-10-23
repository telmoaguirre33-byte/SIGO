-- Inventario separado, únicamente QA. No aplicar en SIGO existente.
begin;
create table mayorista.inventario (
 empresa_id uuid not null,producto_id uuid not null,unidades integer not null check(unidades between 0 and 1000000000),
 reservadas integer not null check(reservadas>=0 and reservadas<=unidades),primary key(empresa_id,producto_id),
 foreign key(empresa_id,producto_id) references mayorista.productos(empresa_id,producto_id)
);
create table mayorista.movimientos_inventario (
 empresa_id uuid not null,comando_id uuid not null,tipo text not null check(tipo in ('ingreso','reserva','salida','devolucion')),
 origen text not null,huella text not null check(huella ~ '^[a-f0-9]{64}$'),actor_id uuid not null,respuesta jsonb not null,
 creado_en timestamptz not null default now(),primary key(empresa_id,comando_id),unique(empresa_id,tipo,origen)
);
alter table mayorista.inventario enable row level security;
alter table mayorista.inventario force row level security;
alter table mayorista.movimientos_inventario enable row level security;
alter table mayorista.movimientos_inventario force row level security;
create policy inventario_admin on mayorista.inventario for all to authenticated using(exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=inventario.empresa_id)) with check(exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=inventario.empresa_id));
create policy movimiento_read on mayorista.movimientos_inventario for select to authenticated using(exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=movimientos_inventario.empresa_id));
create policy movimiento_insert on mayorista.movimientos_inventario for insert to authenticated with check(actor_id=(select auth.uid()) and exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=movimientos_inventario.empresa_id));
grant select,insert,update on mayorista.inventario to authenticated;
grant select,insert on mayorista.movimientos_inventario to authenticated;
rollback;
