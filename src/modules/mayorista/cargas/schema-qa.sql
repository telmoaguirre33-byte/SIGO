-- Propuesta aislada. No es una migración Supabase ni se ejecuta en producción.
begin;
create table mayorista.cargas_estado (
 empresa_id uuid primary key,revision integer not null check(revision>0),datos jsonb not null,
 check(jsonb_typeof(datos)='object' and datos->>'empresaId'=empresa_id::text)
);
create table mayorista.cargas_asignaciones (
 empresa_id uuid not null,pedido_id uuid not null,carga_id uuid not null,
 primary key(empresa_id,pedido_id),
 foreign key(empresa_id,pedido_id) references mayorista.pedidos
);
alter table mayorista.cargas_estado enable row level security;
alter table mayorista.cargas_estado force row level security;
alter table mayorista.cargas_asignaciones enable row level security;
alter table mayorista.cargas_asignaciones force row level security;
create policy cargas_admin on mayorista.cargas_estado for all to authenticated using(
 exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cargas_estado.empresa_id)
) with check(
 exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cargas_estado.empresa_id)
);
create policy asignaciones_admin on mayorista.cargas_asignaciones for all to authenticated using(
 exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cargas_asignaciones.empresa_id)
) with check(
 exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cargas_asignaciones.empresa_id)
);
grant select,insert,update on mayorista.cargas_estado to authenticated;
grant select,insert,delete on mayorista.cargas_asignaciones to authenticated;
rollback;
