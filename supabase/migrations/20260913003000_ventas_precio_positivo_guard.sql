-- SIGO: evita ventas accidentales a precio cero.
-- No modifica historicos ni productos existentes. Solo valida nuevos items de venta
-- y cualquier cambio futuro sobre precio_unitario.

create or replace function public.validar_precio_venta_item_sigo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.precio_unitario is null or new.precio_unitario <= 0 then
    raise exception 'PRODUCT_PRICE_REQUIRED';
  end if;
  if new.subtotal is null or new.subtotal <= 0 then
    raise exception 'SALE_SUBTOTAL_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_venta_item_precio_positivo on public.venta_items_sigo;
create trigger trg_venta_item_precio_positivo
before insert or update of precio_unitario, subtotal on public.venta_items_sigo
for each row execute function public.validar_precio_venta_item_sigo();

comment on function public.validar_precio_venta_item_sigo() is
  'SIGO: defensa final contra ventas con precio unitario o subtotal igual/menor a cero.';
