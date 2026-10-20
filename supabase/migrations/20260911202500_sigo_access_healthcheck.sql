-- SIGO: healthcheck seguro del acceso multiempresa.
-- No expone datos de otras empresas ni información sensible.

create or replace function public.sigo_access_healthcheck()
returns table (
  authenticated boolean,
  user_id uuid,
  active_memberships integer,
  owner_memberships integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null as authenticated,
    auth.uid() as user_id,
    count(*) filter (where eu.activo = true)::integer as active_memberships,
    count(*) filter (where eu.activo = true and eu.rol = 'owner')::integer as owner_memberships
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  where eu.user_id = auth.uid()
    and e.activa = true;
$$;

revoke all on function public.sigo_access_healthcheck() from public;
grant execute on function public.sigo_access_healthcheck() to authenticated;

comment on function public.sigo_access_healthcheck() is
  'SIGO: verifica sesión y cantidad de membresías activas del usuario autenticado sin exponer datos de otros tenants.';
