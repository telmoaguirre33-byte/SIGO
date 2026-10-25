-- Propuesta exclusiva QA, no aplicar en una base existente de SIGO.
begin;
create table mayorista.visitas (
 empresa_id uuid not null,visita_id uuid not null,vendedor_id uuid not null,cliente_id uuid not null,
 datos jsonb not null,huella text not null check(huella ~ '^[a-f0-9]{64}$'),recibida_en timestamptz not null default now(),
 primary key(empresa_id,visita_id),
 foreign key(empresa_id,cliente_id,vendedor_id) references mayorista.clientes(empresa_id,cliente_id,vendedor_id),
 check(jsonb_typeof(datos)='object' and datos->>'empresaId'=empresa_id::text and datos->>'vendedorId'=vendedor_id::text and datos->>'id'=visita_id::text and datos->>'clienteId'=cliente_id::text)
);
alter table mayorista.visitas enable row level security;
alter table mayorista.visitas force row level security;
create policy visitas_read on mayorista.visitas for select to authenticated using(exists(
 select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.empresa_id=visitas.empresa_id and (m.rol='administrador' or m.vendedor_id=visitas.vendedor_id)
));
create policy visitas_insert on mayorista.visitas for insert to authenticated with check(exists(
 select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.empresa_id=visitas.empresa_id and m.vendedor_id=visitas.vendedor_id
));
grant select,insert on mayorista.visitas to authenticated;
-- Inmutables: sin permisos UPDATE o DELETE.
rollback;
