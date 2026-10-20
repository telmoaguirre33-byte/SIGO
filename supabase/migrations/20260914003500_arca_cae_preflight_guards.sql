-- SIGO: endurecimiento previo a CAE para WSFEv1.
-- Aditivo y no destructivo: agrega identidad fiscal del receptor y vincula
-- comprobantes ARCA con la venta que los origina. No emite CAE ni altera stock.

alter table public.clientes_sigo
  add column if not exists arca_doc_tipo integer,
  add column if not exists condicion_iva_receptor_id integer;

comment on column public.clientes_sigo.arca_doc_tipo is
  'Tipo de documento WSFEv1 del receptor (por ejemplo 80 CUIT, 96 DNI, 99 consumidor final). Debe validarse contra FEParamGetTiposDoc antes de emitir.';
comment on column public.clientes_sigo.condicion_iva_receptor_id is
  'Condicion frente al IVA del receptor requerida por WSFEv1/RG 5616. Debe validarse contra FEParamGetCondicionIvaReceptor antes de emitir.';

alter table public.clientes_sigo
  drop constraint if exists clientes_sigo_arca_doc_tipo_rango,
  add constraint clientes_sigo_arca_doc_tipo_rango
    check (arca_doc_tipo is null or arca_doc_tipo between 1 and 999),
  drop constraint if exists clientes_sigo_condicion_iva_receptor_rango,
  add constraint clientes_sigo_condicion_iva_receptor_rango
    check (condicion_iva_receptor_id is null or condicion_iva_receptor_id between 1 and 99);

alter table public.arca_comprobantes
  add column if not exists venta_id uuid references public.ventas_sigo(id) on delete restrict;

create unique index if not exists arca_comprobantes_empresa_venta_uidx
  on public.arca_comprobantes(empresa_id, venta_id)
  where venta_id is not null;

create unique index if not exists arca_comprobantes_empresa_request_uidx
  on public.arca_comprobantes(empresa_id, request_id)
  where request_id is not null and btrim(request_id) <> '';

alter table public.arca_comprobantes
  drop constraint if exists arca_comprobantes_cae_formato,
  add constraint arca_comprobantes_cae_formato
    check (cae is null or cae ~ '^[0-9]{14}$');

-- Guard adicional: una fila fiscal asociada a una venta siempre debe pertenecer
-- al mismo tenant. Esto evita enlazar accidentalmente ventas de otra empresa.
create or replace function public.validar_arca_comprobante_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_empresa_venta uuid;
begin
  if new.venta_id is null then
    return new;
  end if;

  select empresa_id into v_empresa_venta
  from public.ventas_sigo
  where id = new.venta_id;

  if v_empresa_venta is null then
    raise exception 'ARCA_SALE_NOT_FOUND';
  end if;
  if v_empresa_venta <> new.empresa_id then
    raise exception 'ARCA_SALE_TENANT_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists arca_comprobantes_tenant_guard on public.arca_comprobantes;
create trigger arca_comprobantes_tenant_guard
before insert or update of empresa_id, venta_id on public.arca_comprobantes
for each row execute function public.validar_arca_comprobante_tenant();

comment on function public.validar_arca_comprobante_tenant() is
  'SIGO: evita asociar un comprobante fiscal ARCA a una venta de otro tenant.';
