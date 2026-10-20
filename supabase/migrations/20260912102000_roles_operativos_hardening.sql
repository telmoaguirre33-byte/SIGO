-- SIGO: contrato de roles operativo alineado entre frontend y backend.
-- 1) Owner conserva administración integral de empresa.
-- 2) Admin puede administrar usuarios operativos de su empresa.
-- 3) Depósito queda limitado a productos/stock para no exponer Compras/costos.
-- La denegación explícita sigue prevaleciendo sobre rol y permisos extra.

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
          when 'admin' then p_permiso = any(array[
            'users.manage',
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
            'products.read','stock.read','stock.write'
          ]::text[])
          when 'client' then p_permiso = 'client_portal.read'
          else false
        end
      )
  );
$$;

revoke all on function public.tiene_permiso_empresa(uuid, text) from public;
grant execute on function public.tiene_permiso_empresa(uuid, text) to authenticated;

comment on function public.tiene_permiso_empresa(uuid, text) is
  'SIGO: autorización granular por tenant. Owner administra empresa; admin administra usuarios operativos; depósito sólo productos/stock; DENY explícito siempre prevalece.';
