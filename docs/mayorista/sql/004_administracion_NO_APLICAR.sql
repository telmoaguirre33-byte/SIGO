-- Persistencia administrativa nueva, exclusivamente en ambiente aislado aprobado.
begin;
create table mayorista.administracion (
  empresa_id uuid primary key,revision integer not null check(revision>0),datos jsonb not null,
  check(jsonb_typeof(datos)='object' and datos->>'empresaId'=empresa_id::text)
);
create table mayorista.comandos_administrativos (
  empresa_id uuid not null,comando_id uuid not null,huella text not null,
  actor_id uuid not null,respuesta jsonb not null,creado_en timestamptz not null default now(),
  primary key(empresa_id,comando_id),check(huella ~ '^[a-f0-9]{64}$')
);
alter table mayorista.administracion enable row level security;
alter table mayorista.administracion force row level security;
alter table mayorista.comandos_administrativos enable row level security;
alter table mayorista.comandos_administrativos force row level security;
create policy administracion_empresa on mayorista.administracion for all to authenticated using(
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=administracion.empresa_id)
) with check(
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=administracion.empresa_id)
);
create policy comandos_admin_read on mayorista.comandos_administrativos for select to authenticated using(
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=comandos_administrativos.empresa_id)
);
create policy comandos_admin_insert on mayorista.comandos_administrativos for insert to authenticated with check(
  actor_id=(select auth.uid()) and exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=comandos_administrativos.empresa_id)
);
grant select,insert,update on mayorista.administracion to authenticated;
grant select,insert on mayorista.comandos_administrativos to authenticated;
-- Ningún permiso sobre credenciales/membresías. Configurar vendedores no crea usuarios.
-- Las asignaciones aquí son planificación; publicar a catálogo es otro flujo controlado.
rollback;
