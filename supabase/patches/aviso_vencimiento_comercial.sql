-- COMERCIAL. Expone únicamente un aviso de lectura, sin cambiar datos ni permisos existentes.
create schema sigo_aviso_privado;
revoke all on schema sigo_aviso_privado from public, anon;
grant usage on schema sigo_aviso_privado to authenticated;

create function sigo_aviso_privado.vencida(p_empresa_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $func$
  select exists (
    select 1
    from public.empresas e
    join public.empresa_usuarios eu on eu.empresa_id = e.id
    left join auth.users titular on titular.id = e.created_by
    left join lateral (
      select c.fecha_proximo_pago
      from public.sigo_clientes_comerciales c
      where c.empresa_id = e.id
      order by c.updated_at desc, c.user_id
      limit 1
    ) comercial on true
    where e.id = p_empresa_id
      and e.activa and eu.activo and eu.user_id = auth.uid()
      and case when comercial.fecha_proximo_pago is not null then
        comercial.fecha_proximo_pago <= (now() at time zone 'America/Argentina/Buenos_Aires')::date
      else
        coalesce(titular.created_at, e.created_at) >= timestamptz '2026-09-20 17:00:00+00'
        and now() >= coalesce(titular.created_at, e.created_at) + interval '720 hours'
      end
  )
$func$;

create function public.sigo_aviso_vencimiento(p_empresa_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $func$
  select sigo_aviso_privado.vencida(p_empresa_id)
$func$;

revoke all on function sigo_aviso_privado.vencida(uuid), public.sigo_aviso_vencimiento(uuid) from public, anon;
grant execute on function sigo_aviso_privado.vencida(uuid), public.sigo_aviso_vencimiento(uuid) to authenticated;
