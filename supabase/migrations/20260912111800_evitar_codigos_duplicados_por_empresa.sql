-- SIGO: impide crear nuevos códigos duplicados dentro de la misma empresa.
-- No borra, renombra ni modifica datos legacy. Si ya existen duplicados, permanecen
-- visibles para saneamiento controlado; solamente se bloquean nuevas colisiones.

create or replace function public.validar_codigo_producto_unico_sigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo_barras text := nullif(btrim(coalesce(new.codigo_barras, '')), '');
  v_codigo_interno text := nullif(btrim(coalesce(new.codigo_interno, '')), '');
begin
  if new.empresa_id is null then
    raise exception 'EMPRESA_REQUIRED';
  end if;

  -- Guardamos los códigos normalizados en bordes para que pistola/manual/cámara
  -- consulten exactamente la misma identidad comercial.
  new.codigo_barras := v_codigo_barras;
  new.codigo_interno := v_codigo_interno;

  if v_codigo_barras is not null and exists (
    select 1
    from public.productos p
    where p.empresa_id = new.empresa_id
      and p.id <> coalesce(new.id, gen_random_uuid())
      and nullif(btrim(coalesce(p.codigo_barras, '')), '') = v_codigo_barras
  ) then
    raise exception 'BARCODE_DUPLICATE_IN_COMPANY';
  end if;

  if v_codigo_interno is not null and exists (
    select 1
    from public.productos p
    where p.empresa_id = new.empresa_id
      and p.id <> coalesce(new.id, gen_random_uuid())
      and nullif(btrim(coalesce(p.codigo_interno, '')), '') = v_codigo_interno
  ) then
    raise exception 'INTERNAL_CODE_DUPLICATE_IN_COMPANY';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_codigo_producto_unico_sigo on public.productos;
create trigger trg_validar_codigo_producto_unico_sigo
before insert or update of empresa_id, codigo_barras, codigo_interno
on public.productos
for each row
execute function public.validar_codigo_producto_unico_sigo();

comment on function public.validar_codigo_producto_unico_sigo() is
  'SIGO: bloquea nuevas colisiones de código de barras/código interno por tenant sin modificar datos históricos.';
