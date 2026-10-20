-- PROPUESTA EXCLUSIVA PARA UN AMBIENTE DE PRUEBA NUEVO. NO APLICAR EN PRODUCCIÓN.
-- No forma parte de migraciones ni se ejecuta desde build/CLI.
-- Requiere funciones auth.uid()/auth.jwt() del ambiente de pruebas.
begin;
create schema mayorista;
revoke all on schema mayorista from public, anon;
grant usage on schema mayorista to authenticated;

create table mayorista.vendedores (
  empresa_id uuid not null, vendedor_id uuid not null, nombre text not null,
  activo boolean not null default true,
  primary key (empresa_id,vendedor_id)
);
create table mayorista.miembros (
  empresa_id uuid not null, user_id uuid not null, vendedor_id uuid not null,
  rol text not null check (rol in ('vendedor','administrador')), activo boolean not null default true,
  primary key (empresa_id,user_id),
  foreign key (empresa_id,vendedor_id) references mayorista.vendedores
);
create table mayorista.clientes (
  empresa_id uuid not null, cliente_id uuid not null, vendedor_id uuid not null,
  nombre text not null, ruta_id uuid, habilitado boolean not null default true,
  primary key (empresa_id,cliente_id),
  unique (empresa_id,cliente_id,vendedor_id),
  foreign key (empresa_id,vendedor_id) references mayorista.vendedores
);
create table mayorista.productos (
  empresa_id uuid not null, producto_id uuid not null, nombre text not null, activo boolean not null default true,
  primary key (empresa_id,producto_id)
);
create table mayorista.precios (
  empresa_id uuid not null, precio_id uuid not null, producto_id uuid not null,
  unidades_base integer not null check(unidades_base > 0),
  precio numeric(18,4) not null check(precio >= 0),
  primary key (empresa_id,precio_id),
  foreign key (empresa_id,producto_id) references mayorista.productos
);
create table mayorista.pedidos (
  empresa_id uuid not null, pedido_id uuid not null, vendedor_id uuid not null, cliente_id uuid not null,
  creado_en timestamptz not null, recibido_en timestamptz not null default now(),
  lineas jsonb not null check(jsonb_typeof(lineas)='array' and jsonb_array_length(lineas) between 1 and 200),
  huella text not null check(huella ~ '^[a-f0-9]{64}$'),
  estado text not null default 'recibido' check(estado='recibido'),
  primary key (empresa_id,pedido_id),
  foreign key (empresa_id,cliente_id,vendedor_id) references mayorista.clientes(empresa_id,cliente_id,vendedor_id)
);
create index miembros_usuario_empresa on mayorista.miembros(user_id,empresa_id) where activo;
create index clientes_asignados on mayorista.clientes(empresa_id,vendedor_id);
create index pedidos_vendedor_fecha on mayorista.pedidos(empresa_id,vendedor_id,creado_en);
create index precios_producto on mayorista.precios(empresa_id,producto_id);

alter table mayorista.miembros enable row level security;
alter table mayorista.miembros force row level security;
-- Autoconsulta: evita recursión de las políticas que verifican membresía.
create policy membresia_propia on mayorista.miembros for select to authenticated
using(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
grant select on mayorista.miembros to authenticated;
-- Sin INSERT/UPDATE/DELETE de membresías para authenticated: no autoasignar empresa o rol.

alter table mayorista.vendedores enable row level security;
alter table mayorista.vendedores force row level security;
create policy vendedores_visibles on mayorista.vendedores for select to authenticated using (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo
    and m.empresa_id=vendedores.empresa_id and (m.rol='administrador' or m.vendedor_id=vendedores.vendedor_id))
);
alter table mayorista.clientes enable row level security;
alter table mayorista.clientes force row level security;
create policy clientes_asignados on mayorista.clientes for select to authenticated using (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo
    and m.empresa_id=clientes.empresa_id and (m.rol='administrador' or m.vendedor_id=clientes.vendedor_id))
);
alter table mayorista.productos enable row level security;
alter table mayorista.productos force row level security;
create policy productos_empresa on mayorista.productos for select to authenticated using (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.empresa_id=productos.empresa_id)
);
alter table mayorista.precios enable row level security;
alter table mayorista.precios force row level security;
create policy precios_empresa on mayorista.precios for select to authenticated using (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo and m.empresa_id=precios.empresa_id)
);
alter table mayorista.pedidos enable row level security;
alter table mayorista.pedidos force row level security;
create policy pedidos_visibles on mayorista.pedidos for select to authenticated using (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo
    and m.empresa_id=pedidos.empresa_id and (m.rol='administrador' or m.vendedor_id=pedidos.vendedor_id))
);
create policy pedidos_propios on mayorista.pedidos for insert to authenticated with check (
  exists(select 1 from mayorista.miembros m where m.user_id=(select auth.uid()) and m.activo
    and m.empresa_id=pedidos.empresa_id and m.vendedor_id=pedidos.vendedor_id)
  and exists(select 1 from mayorista.clientes c where c.empresa_id=pedidos.empresa_id
    and c.cliente_id=pedidos.cliente_id and c.vendedor_id=pedidos.vendedor_id and c.habilitado)
);
grant select on mayorista.vendedores,mayorista.clientes,mayorista.productos,mayorista.precios,mayorista.pedidos to authenticated;
grant insert on mayorista.pedidos to authenticated;
-- Sin UPDATE/DELETE de pedidos recibidos: inmutabilidad de UUID+contenido+acuse.
-- Precios/productos de las líneas JSON: validación obligatoria del adaptador de recepción.
-- No se habilita el esquema en Data API; el backend debe validar y usar RLS.
-- Alta y mantenimiento administrativos requieren un flujo separado revisado.
rollback; -- Plantilla no activa: reemplazar solo en el ambiente de prueba aprobado.
