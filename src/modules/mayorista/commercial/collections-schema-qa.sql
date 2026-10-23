-- Cobranzas y reembolsos propios. No opera Caja ni cuentas corrientes de SIGO.
begin;
create table mayorista.cobros_directos(empresa_id uuid not null,comando_id uuid not null,cliente_id uuid not null,tipo text not null check(tipo in ('cobro','reembolso')),centavos bigint not null check(centavos>0 and centavos<=9007199254740991),comprobante text not null,huella text not null,actor_id uuid not null,respuesta jsonb not null,creado_en timestamptz not null default now(),primary key(empresa_id,comando_id),unique(empresa_id,tipo,comprobante),foreign key(empresa_id,cliente_id) references mayorista.clientes(empresa_id,cliente_id));
alter table mayorista.cobros_directos enable row level security;alter table mayorista.cobros_directos force row level security;
create policy cobros_directos_read on mayorista.cobros_directos for select to authenticated using(mayorista.operador(empresa_id,array['gerencia','administracion']));
create policy cobros_directos_insert on mayorista.cobros_directos for insert to authenticated with check(actor_id=(select auth.uid()) and mayorista.operador(empresa_id,array['gerencia','administracion']));
grant select,insert on mayorista.cobros_directos to authenticated;
rollback;
