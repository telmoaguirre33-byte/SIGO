-- SIGO: datos fiscales mínimos de producto para preparar WSFEv1 sin adivinar IVA.
-- No asigna alícuotas por defecto: los 1.400 productos existentes quedan intactos
-- y deben clasificarse fiscalmente antes de una emisión real.

alter table public.productos
  add column if not exists iva_alicuota_id integer,
  add column if not exists iva_tasa numeric(6,3),
  add column if not exists precio_incluye_iva boolean;

alter table public.productos
  drop constraint if exists productos_iva_alicuota_id_rango,
  add constraint productos_iva_alicuota_id_rango
    check (iva_alicuota_id is null or iva_alicuota_id between 1 and 99),
  drop constraint if exists productos_iva_tasa_rango,
  add constraint productos_iva_tasa_rango
    check (iva_tasa is null or (iva_tasa >= 0 and iva_tasa <= 100));

comment on column public.productos.iva_alicuota_id is
  'Identificador de alícuota IVA para WSFEv1. Debe validarse contra FEParamGetTiposIva; SIGO no lo presume.';
comment on column public.productos.iva_tasa is
  'Tasa IVA asociada al producto para cálculo fiscal. No se completa automáticamente para evitar emitir importes fiscales incorrectos.';
comment on column public.productos.precio_incluye_iva is
  'Indica si precio_venta incluye IVA. Debe definirse antes de preparar FECAESolicitar.';
