-- SIGO: listado seguro de empresas operativas del usuario autenticado.
-- Un superadmin NO recibe acceso operativo por esta RPC: solo aparecen empresas donde
-- además posee una membresía activa en empresa_usuarios.

create or replace function public.mis_empresas_sigo()
returns table (
  empresa_id uuid,
  nombre text,
  razon_social text,
  rol text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id as empresa_id,
    e.nombre,
    e.razon_social,
    eu.rol
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  where eu.user_id = auth.uid()
    and eu.activo = true
    and e.activa = true
  order by e.nombre asc;
$$;

revoke all on function public.mis_empresas_sigo() from public;
grant execute on function public.mis_empresas_sigo() to authenticated;

comment on function public.mis_empresas_sigo() is
  'SIGO: devuelve únicamente tenants operativos donde el usuario autenticado tiene membresía activa. Ser superadmin por sí solo no agrega acceso operativo.';