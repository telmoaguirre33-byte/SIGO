-- Cuenta corriente Mayorista independiente. Solo QA, sin facturación ni caja.
begin;
create table mayorista.cuenta_movimientos (
 empresa_id uuid not null,comando_id uuid not null,pedido_id uuid not null,cliente_id uuid not null,
 tipo text not null check(tipo in ('entrega','devolucion','cobranza')),centavos bigint not null check(centavos<>0 and abs(centavos)<=9007199254740991),
 actor_id uuid not null,creado_en timestamptz not null default now(),primary key(empresa_id,comando_id,pedido_id,tipo),
 foreign key(empresa_id,pedido_id) references mayorista.pedidos(empresa_id,pedido_id),
 foreign key(empresa_id,cliente_id) references mayorista.clientes(empresa_id,cliente_id),
 check((tipo='entrega' and centavos>0) or (tipo in ('devolucion','cobranza') and centavos<0))
);
create unique index cuenta_cobro_unico on mayorista.cuenta_movimientos(empresa_id,pedido_id) where tipo='cobranza';
alter table mayorista.cuenta_movimientos enable row level security;
alter table mayorista.cuenta_movimientos force row level security;
create policy cuenta_read on mayorista.cuenta_movimientos for select to authenticated using(exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cuenta_movimientos.empresa_id));
create policy cuenta_insert on mayorista.cuenta_movimientos for insert to authenticated with check(actor_id=(select auth.uid()) and exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.rol='administrador' and m.empresa_id=cuenta_movimientos.empresa_id));
grant select,insert on mayorista.cuenta_movimientos to authenticated;
rollback;
