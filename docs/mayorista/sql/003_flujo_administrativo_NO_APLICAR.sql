-- Propuesta solo para entorno aislado. No es una migración ni se aplica a producción.
begin;
create table mayorista.eventos_pedido (
  empresa_id uuid not null,pedido_id uuid not null,comando_id uuid not null,
  version integer not null check(version>0),comando jsonb not null,
  actor_id uuid not null,creado_en timestamptz not null default now(),
  primary key(empresa_id,pedido_id,comando_id),unique(empresa_id,pedido_id,version),
  foreign key(empresa_id,pedido_id) references mayorista.pedidos
);
alter table mayorista.eventos_pedido enable row level security;
alter table mayorista.eventos_pedido force row level security;
create policy eventos_admin on mayorista.eventos_pedido for select to authenticated using(
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=eventos_pedido.empresa_id)
);
create policy eventos_admin_insert on mayorista.eventos_pedido for insert to authenticated with check(
  actor_id=(select auth.uid()) and exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=eventos_pedido.empresa_id)
);
grant select,insert on mayorista.eventos_pedido to authenticated;
-- Sin UPDATE/DELETE: mantener historial inmutable y acuse original del pedido.
rollback;
