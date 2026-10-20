-- SIGO: defensa de escritura para impedir nuevos costo_actual/costo_ultima_compra NULL.
-- No hace backfill ni modifica filas historicas. Solo normaliza escrituras futuras.

create or replace function public.sigo_productos_costos_no_nulos_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.costo_actual := coalesce(new.costo_actual, 0);
  new.costo_ultima_compra := coalesce(new.costo_ultima_compra, 0);
  return new;
end;
$$;

drop trigger if exists trg_sigo_productos_costos_no_nulos on public.productos;
create trigger trg_sigo_productos_costos_no_nulos
before insert or update of costo_actual, costo_ultima_compra
on public.productos
for each row
execute function public.sigo_productos_costos_no_nulos_guard();
