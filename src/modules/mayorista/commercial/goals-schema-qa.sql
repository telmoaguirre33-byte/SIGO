-- Ampliación aditiva de QA; no toca tablas compartidas de SIGO.
begin;
create table mayorista.metas (
 empresa_id uuid not null, meta_id uuid not null, vendedor_id uuid,
 metrica text not null check(metrica in ('vendido','facturado','pedidos','visitados','compradores','nuevos','recuperados','cobrado','deuda_recuperada','unidades')),
 periodo text not null check(periodo in ('diario','semanal','mensual','personalizado')),
 desde date not null, hasta date not null, objetivo bigint not null check(objetivo>0 and objetivo<=9007199254740991),
 activa boolean not null default true, version integer not null default 1 check(version>0),
 actualizado_por uuid not null, actualizado_en timestamptz not null default now(),
 primary key(empresa_id,meta_id), foreign key(empresa_id,vendedor_id) references mayorista.vendedores(empresa_id,vendedor_id),
 check(hasta>=desde and hasta-desde<366)
);
create index metas_empresa_periodo on mayorista.metas(empresa_id,desde,hasta);
alter table mayorista.metas enable row level security;
alter table mayorista.metas force row level security;
create policy metas_admin on mayorista.metas for all to authenticated
 using(mayorista.operador(empresa_id,array['gerencia','administracion']))
 with check(mayorista.operador(empresa_id,array['gerencia','administracion']) and actualizado_por=(select auth.uid()));
create policy metas_propias on mayorista.metas for select to authenticated
 using(mayorista.operador(empresa_id,array['vendedor']) and exists(select 1 from mayorista.miembros m where m.empresa_id=metas.empresa_id and m.user_id=(select auth.uid()) and m.vendedor_id=metas.vendedor_id));
grant select,insert,update on mayorista.metas to authenticated;
rollback;
