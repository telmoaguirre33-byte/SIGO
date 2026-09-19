-- SIGO: sesiones efímeras para vincular celular como lector remoto.
create table if not exists public.sigo_lector_celular_sesiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  creado_por uuid not null references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  codigo text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  ultimo_scan_at timestamptz
);
alter table public.sigo_lector_celular_sesiones enable row level security;
create policy lector_sesion_propietario_select on public.sigo_lector_celular_sesiones
for select to authenticated using (creado_por=auth.uid() and expires_at>now());
create policy lector_sesion_propietario_insert on public.sigo_lector_celular_sesiones
for insert to authenticated with check (
  creado_por=auth.uid()
  and exists(select 1 from public.empresa_usuarios eu where eu.empresa_id=empresa_id and eu.user_id=auth.uid() and eu.activo=true)
  and exists(select 1 from public.sigo_empresa_modulos em where em.empresa_id=empresa_id and em.modulo_clave='lector_celular_remoto' and em.habilitado=true)
);
create policy lector_sesion_propietario_update on public.sigo_lector_celular_sesiones
for update to authenticated using (creado_por=auth.uid()) with check (creado_por=auth.uid());
create index if not exists sigo_lector_celular_sesiones_empresa_idx on public.sigo_lector_celular_sesiones(empresa_id,activo,expires_at);
