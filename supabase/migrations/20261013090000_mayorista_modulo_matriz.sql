-- SIGO Matriz: Mayorista / Distribuidora como módulo opcional por empresa.
-- Registro apagado por defecto; esta migración no activa el módulo ni integra sus datos.
insert into public.sigo_modulos_catalogo
  (clave, nombre, descripcion, categoria, disponible, obligatorio, orden)
values
  ('mayorista_distribuidora', 'Mayorista / Distribuidora',
   'Gestión independiente de ventas mayoristas y distribución.',
   'Comercial / Distribución', true, false, 130)
on conflict (clave) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  disponible = excluded.disponible,
  obligatorio = false,
  orden = excluded.orden,
  updated_at = now();

-- Opt-in: empresas ya existentes quedan explícitamente apagadas; las nuevas
-- se muestran apagadas cuando todavía no tienen una fila de configuración.
insert into public.sigo_empresa_modulos (empresa_id, modulo_clave, habilitado)
select e.id, 'mayorista_distribuidora', false
from public.empresas e
on conflict (empresa_id, modulo_clave) do nothing;

-- Lectura separada para no cambiar el contrato del RPC existente de Matriz.
create or replace function public.matriz_listar_mayorista_modulos_sigo()
returns table (empresa_id uuid, mayorista_habilitado boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED'; end if;
  return query
    select e.id, coalesce(em.habilitado, false)
    from public.empresas e
    left join public.sigo_empresa_modulos em
      on em.empresa_id = e.id
     and em.modulo_clave = 'mayorista_distribuidora'
    order by e.id;
end;
$$;

revoke all on function public.matriz_listar_mayorista_modulos_sigo() from public;
grant execute on function public.matriz_listar_mayorista_modulos_sigo() to authenticated;

comment on function public.matriz_listar_mayorista_modulos_sigo()
is 'SIGO Matriz: lista el estado opcional de Mayorista por empresa; solo Superadmin.';
