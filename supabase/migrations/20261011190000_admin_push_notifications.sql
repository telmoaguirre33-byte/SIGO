-- Notificaciones privadas para el superadministrador de SIGO.
-- No añade políticas de escritura para usuarios autenticados ni toca tablas operativas.

create table if not exists public.sigo_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  sent_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  last_error text
);

create table if not exists public.sigo_admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.sigo_admin_notifications enable row level security;
alter table public.sigo_admin_push_subscriptions enable row level security;

drop policy if exists sigo_admin_notifications_select on public.sigo_admin_notifications;
create policy sigo_admin_notifications_select on public.sigo_admin_notifications
for select to authenticated using (public.es_superadmin_sigo());

drop policy if exists sigo_admin_notifications_update on public.sigo_admin_notifications;
create policy sigo_admin_notifications_update on public.sigo_admin_notifications
for update to authenticated using (public.es_superadmin_sigo())
with check (public.es_superadmin_sigo());

-- Las suscripciones nunca se leen ni escriben directamente desde el navegador.
-- Las administra la API de Vercel con service role tras verificar el JWT y superadmin.
revoke all on public.sigo_admin_push_subscriptions from anon, authenticated;
revoke all on public.sigo_admin_notifications from anon, authenticated;
grant select, update on public.sigo_admin_notifications to authenticated;
grant all on public.sigo_admin_notifications, public.sigo_admin_push_subscriptions to service_role;

create or replace function public.sigo_notificar_nueva_empresa_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sigo_admin_notifications(event_key, title, body)
  values (
    'cliente-nuevo:' || new.id::text,
    'SIGO Gestión',
    'Se registró un cliente nuevo.'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists sigo_notificar_nueva_empresa_admin on public.empresas;
create trigger sigo_notificar_nueva_empresa_admin
after insert on public.empresas
for each row execute function public.sigo_notificar_nueva_empresa_admin();

create or replace function public.sigo_generar_avisos_vencimiento_admin()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertados integer := 0;
begin
  with owners as (
    select e.id, (e.created_at at time zone 'America/Argentina/Cordoba')::date + 30 as vence
    from public.empresas e
    where e.activa = true
      and exists (
        select 1 from public.empresa_usuarios eu
        where eu.empresa_id = e.id and eu.rol = 'owner' and eu.activo = true
      )
  ), avisos as (
    select id, (vence - current_date) as dias
    from owners
    where vence - (now() at time zone 'America/Argentina/Cordoba')::date in (10, 5, 3, 1, 0)
  )
  insert into public.sigo_admin_notifications(event_key, title, body)
  select 'vencimiento-prueba:' || id::text || ':' || dias::text,
         'SIGO Gestión',
         case when dias = 0 then 'Hoy vence el período de prueba de una cuenta.'
              else 'Una cuenta vence en ' || dias::text || ' días.' end
  from avisos
  on conflict (event_key) do nothing;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$$;

create or replace function public.sigo_claim_admin_notification(p_event_key text)
returns table (id uuid, event_key text, title text, body text, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.sigo_admin_notifications n
     set claimed_at = now(), claim_token = gen_random_uuid(), last_error = null
   where n.event_key = p_event_key
     and n.sent_at is null
     and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes')
  returning n.id, n.event_key, n.title, n.body, n.claim_token;
end;
$$;

create or replace function public.sigo_claim_pending_admin_notifications(p_limit integer default 50)
returns table (id uuid, event_key text, title text, body text, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with pendientes as (
    select n.id
    from public.sigo_admin_notifications n
    where n.sent_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes')
    order by n.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.sigo_admin_notifications n
     set claimed_at = now(), claim_token = gen_random_uuid(), last_error = null
    from pendientes p
   where n.id = p.id
  returning n.id, n.event_key, n.title, n.body, n.claim_token;
end;
$$;

create or replace function public.sigo_finish_admin_notification(p_id uuid, p_claim_token uuid, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer;
begin
  update public.sigo_admin_notifications n
     set sent_at = case when p_error is null then now() else null end,
         claimed_at = null,
         claim_token = null,
         last_error = case when p_error is null then null else left(p_error, 200) end
   where n.id = p_id and n.claim_token = p_claim_token and n.sent_at is null;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

revoke all on function public.sigo_notificar_nueva_empresa_admin() from public, anon, authenticated;
revoke all on function public.sigo_generar_avisos_vencimiento_admin() from public, anon, authenticated;
revoke all on function public.sigo_claim_admin_notification(text) from public, anon, authenticated;
revoke all on function public.sigo_claim_pending_admin_notifications(integer) from public, anon, authenticated;
revoke all on function public.sigo_finish_admin_notification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sigo_generar_avisos_vencimiento_admin() to service_role;
grant execute on function public.sigo_claim_admin_notification(text) to service_role;
grant execute on function public.sigo_claim_pending_admin_notifications(integer) to service_role;
grant execute on function public.sigo_finish_admin_notification(uuid, uuid, text) to service_role;

comment on table public.sigo_admin_notifications is
  'SIGO: historial privado y deduplicado de avisos para superadministración.';
comment on table public.sigo_admin_push_subscriptions is
  'SIGO: endpoints Web Push del superadministrador; acceso exclusivamente server-side.';
