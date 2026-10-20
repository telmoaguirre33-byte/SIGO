-- SIGO: permisos efectivos en backend.
-- Complementa la RLS multiempresa: el frontend puede ocultar acciones, pero
-- las autorizaciones sensibles deben decidirse también dentro de Supabase.

create or replace function public.permiso_sigo_valido(p_permiso text)
returns boolean
language sql
immutable
as $$
  select p_permiso = any (array[
    'companies.manage',
    'users.manage',
    'products.read',
    'products.write',
    'stock.read',
    'stock.write',
    'sales.read',
    'sales.write',
    'purchases.read',
    'purchases.write',
    'clients.read',
    'clients.write',
    'suppliers.read',
    'suppliers.write',
    'reports.read',
    'costs.read',
    'margins.read',
    'price_lists.read',
    'arca.configure',
    'invoices.issue',
    'client_portal.read'
  ]::text[]);
$$;

create or replace function public.permisos_sigo_validos(p_permisos text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(public.permiso_sigo_valido(p)), true)
  from unnest(coalesce(p_permisos, '{}'::text[])) as p;
$$;

-- Los permisos extra solo aceptan claves conocidas. NOT VALID evita bloquear
-- la migración si existiera algún dato histórico inválido; sí protege altas y
-- modificaciones nuevas hasta poder validar todo el histórico.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empresa_usuarios_permisos_extra_validos'
      and conrelid = 'public.empresa_usuarios'::regclass
  ) then
    alter table public.empresa_usuarios
      add constraint empresa_usuarios_permisos_extra_validos
      check (public.permisos_sigo_validos(permisos_extra)) not valid;
  end if;
end $$;

-- Permisos base del rol dentro de UNA empresa. Los roles administrativo,
-- vendedor y depósito NO reciben costos, márgenes ni listas de precios.
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
      and (
        p_permiso = any(eu.permisos_extra)
        or case eu.rol
          when 'owner' then p_permiso = any(array[
            'users.manage',
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

revoke all on function public.permiso_sigo_valido(text) from public;
revoke all on function public.permisos_sigo_validos(text[]) from public;
revoke all on function public.tiene_permiso_empresa(uuid, text) from public;

grant execute on function public.permiso_sigo_valido(text) to authenticated;
grant execute on function public.permisos_sigo_validos(text[]) to authenticated;
grant execute on function public.tiene_permiso_empresa(uuid, text) to authenticated;

comment on function public.tiene_permiso_empresa(uuid, text) is
  'SIGO: autorización backend por empresa, rol y permisos extra. Usar desde RLS para tablas operativas.';
