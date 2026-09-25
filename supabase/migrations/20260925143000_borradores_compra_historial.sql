-- Comprobantes incompletos: historial durable sin alterar productos ni stock.
create table if not exists public.compra_borradores_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  documento jsonb not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','descartado','confirmado')),
  compra_id uuid references public.compras_sigo(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compra_borrador_size_check check (octet_length(documento::text)<1000000)
);
create index if not exists compra_borradores_empresa_fecha_idx on public.compra_borradores_sigo(empresa_id,created_at desc);
alter table public.compra_borradores_sigo enable row level security;
grant select,insert,update on public.compra_borradores_sigo to authenticated;
revoke all on public.compra_borradores_sigo from anon;
create policy "Leer borradores de compras de la empresa" on public.compra_borradores_sigo for select to authenticated
using (coalesce(public.tiene_permiso_empresa(empresa_id,'purchases.read'),false));
create policy "Crear borradores de compras de la empresa" on public.compra_borradores_sigo for insert to authenticated
with check (created_by=auth.uid() and coalesce(public.tiene_permiso_empresa(empresa_id,'purchases.write'),false));
create policy "Actualizar borradores de compras de la empresa" on public.compra_borradores_sigo for update to authenticated
using (coalesce(public.tiene_permiso_empresa(empresa_id,'purchases.write'),false))
with check (coalesce(public.tiene_permiso_empresa(empresa_id,'purchases.write'),false) and
  ((estado in ('pendiente','descartado') and compra_id is null) or
    (estado='confirmado' and exists(select 1 from public.compras_sigo c where c.id=compra_id and c.empresa_id=empresa_id and c.estado='confirmada'))));
