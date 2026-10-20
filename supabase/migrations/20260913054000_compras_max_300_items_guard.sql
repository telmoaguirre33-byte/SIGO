-- SIGO: alinea la base con el limite operativo de 300 renglones por compra/factura.
-- No modifica compras historicas; solo impide agregar el renglon 301 en escrituras futuras.

create or replace function public.sigo_compra_items_max_300_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_items integer;
begin
  select count(*)
    into v_items
    from public.compra_items_sigo ci
   where ci.compra_id = new.compra_id;

  if v_items >= 300 then
    raise exception 'TOO_MANY_ITEMS';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sigo_compra_items_max_300 on public.compra_items_sigo;
create trigger trg_sigo_compra_items_max_300
before insert on public.compra_items_sigo
for each row
execute function public.sigo_compra_items_max_300_guard();
