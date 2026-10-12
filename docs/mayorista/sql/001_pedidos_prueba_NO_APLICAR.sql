-- Diseño preliminar exclusivo para entorno de pruebas de Mayorista.
-- NO aplicar en Supabase de producción.
-- No modifica tablas de SIGO, Caja, Ventas, Compras ni Stock.
create schema if not exists mayorista;
create table if not exists mayorista.pedidos (
  empresa_id uuid not null,
  pedido_id uuid not null,
  vendedor_id uuid not null,
  cliente_id uuid not null,
  creado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  estado text not null default 'recibido' check (estado in ('recibido','requiere_revision','aprobado','rechazado')),
  payload jsonb not null,
  primary key (empresa_id, pedido_id),
  constraint mayorista_payload_objeto check (jsonb_typeof(payload) = 'object')
);
create index if not exists mayorista_pedidos_vendedor on mayorista.pedidos (empresa_id, vendedor_id, recibido_en desc);
alter table mayorista.pedidos enable row level security;
-- Sin políticas RLS deliberadamente: acceso denegado hasta definir autenticación,
-- pertenencia por empresa y roles. El servidor deberá verificar JWT y permisos,
-- validar catálogo/precios y usar una operación atómica idempotente.
revoke all on schema mayorista from public, anon, authenticated;
revoke all on all tables in schema mayorista from public, anon, authenticated;
