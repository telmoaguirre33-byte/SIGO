-- SIGO: permisos granulares con denegación explícita por usuario y empresa.
-- Seguridad: una denegación siempre prevalece sobre el rol base y sobre permisos extra.
-- Migración aditiva/no destructiva: no cambia permisos efectivos existentes mientras
-- permisos_denegados permanezca vacío (valor por defecto).

alter table public.empresa_usuarios
  add column if not exists permisos_denegados text[] not null default '{}';

-- Solo se admiten claves de permiso conocidas también en las denegaciones.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empresa_usuarios_permisos_denegados_validos'
      and conrelid = 'public.empresa_usuarios'::regclass
  ) then
    alter table public.empresa_usuarios
      add constraint empresa_usuarios_permisos_denegados_validos
      check (public.permisos_sigo_validos(permisos_denegados)) not valid;
  end if;
end $$;

-- Evita configuraciones ambiguas en nuevas altas/modificaciones: un permiso no puede
-- estar simultáneamente otorgado y denegado. NOT VALID no bloquea datos históricos.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empresa_usuarios_permisos_sin_conflictos'
      and conrelid = 'public.empresa_usuarios'::regclass
  ) then
    alter table public.empresa_usuarios
      add constraint empresa_usuarios_permisos_sin_conflictos
      check (not (permisos_extra && permisos_denegados)) not valid;
  end if;
end $$;

create or replace function public.tiene_permiso_empresa(
  p_empresa_id uuid,
  p_permiso text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and public.permiso_sigo_valido(p_permiso)
      -- DENY gana siempre: permite quitar permisos del rol base de forma granular.
      and not (p_permiso = any(coalesce(eu.permisos_denegados, '{}'::text[])))
      and (
        p_permiso = any(coalesce(eu.permisos_extra, '{}'::text[]))
        or case eu.rol
          when 'owner' then p_permiso = any(array[
            'companies.manage','users.manage',
            'products.read','products.write',
            'stock.read','stock.write',
            'sales.read','sales.write',
            'purchases.read','purchases.write',
            'clients.read','clients.write',
            'suppliers.read','suppliers.write',
            'reports.read',
            'costs.read','margins.read','price_lists.read',
            'arca.configure','invoices.issue',
            'client_portal.read'
          ]::text[])
          -- "admin" representa al administrativo operativo. Por defecto NO ve
          -- costos, márgenes ni listas de precios; solo puede recibirlos mediante
          -- permisos_extra explícitos y siempre que no estén denegados.
          when 'admin' then p_permiso = any(array[
            'products.read','products.write',
            'stock.read','stock.write',
            'sales.read','sales.write',
            'purchases.read','purchases.write',
            'clients.read','clients.write',
            'suppliers.read','suppliers.write',
            'reports.read','invoices.issue'
          ]::text[])
          when 'seller' then p_permiso = any(array[
            'products.read','stock.read',
            'sales.read','sales.write',
            'clients.read','invoices.issue'
          ]::text[])
          when 'warehouse' then p_permiso = any(array[
            'products.read','stock.read','stock.write',
            'purchases.read','purchases.write'
          ]::text[])
          when 'client' then p_permiso = 'client_portal.read'
          else false
        end
      )
  );
$$;

revoke all on function public.tiene_permiso_empresa(uuid, text) from public;
grant execute on function public.tiene_permiso_empresa(uuid, text) to authenticated;

comment on column public.empresa_usuarios.permisos_denegados is
  'SIGO: permisos explícitamente revocados al usuario dentro de esta empresa. La denegación prevalece sobre rol y permisos_extra.';

comment on function public.tiene_permiso_empresa(uuid, text) is
  'SIGO: autorización backend granular por tenant. DENY explícito > permiso extra > rol base. Admin no recibe datos sensibles por defecto.';
