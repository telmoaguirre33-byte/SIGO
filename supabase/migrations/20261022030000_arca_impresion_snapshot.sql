-- Prepared only. Requires separate approval before applying to any shared database.
-- Stores the fiscal print data used when authorizing a receipt; no stock, sale,
-- product, price, payment or fiscal-configuration changes.
begin;
alter table public.arca_comprobantes
  add column if not exists impresion_snapshot jsonb;
comment on column public.arca_comprobantes.impresion_snapshot is
  'SIGO versioned server-created receipt snapshot for faithful reprinting. Historical rows remain null and use read-only ARCA recovery.';
commit;
