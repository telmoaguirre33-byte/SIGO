// Fully synthetic PostgreSQL fixture. Never reads credentials or contacts Supabase.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ids = Object.freeze({
  company: '10000000-0000-0000-0000-000000000001',
  otherCompany: '10000000-0000-0000-0000-000000000002',
  admin: '20000000-0000-0000-0000-000000000001',
  reader: '20000000-0000-0000-0000-000000000002',
  outsider: '20000000-0000-0000-0000-000000000003',
  client: '20000000-0000-0000-0000-000000000004',
  product: '30000000-0000-0000-0000-000000000002',
  available: '30000000-0000-0000-0000-000000000001',
  otherProduct: '30000000-0000-0000-0000-000000000003',
  inactive: '30000000-0000-0000-0000-000000000004',
  nonSellable: '30000000-0000-0000-0000-000000000005',
  supplier: '40000000-0000-0000-0000-000000000001',
  customer: '50000000-0000-0000-0000-000000000001',
});
export const root = new URL('../../', import.meta.url);
export const proposalUrl = new URL('docs/operacion-controlada/archivo-productos/02_PREPARADO_NO_APLICAR.sql', root);
const migration = (name) => readFile(new URL(`supabase/migrations/${name}`, root), 'utf8');

export async function createFixture({ db: suppliedDatabase } = {}) {
  // A supplied adapter must already be restricted to an empty, local synthetic DB.
  // The concurrency suite validates this before supplying query()/exec().
  let db = suppliedDatabase;
  if (!db) {
    const override = process.env.SIGO_PGLITE_NODE_MODULES;
    const module = override
      ? await import(pathToFileURL(resolve(override, '@electric-sql/pglite/dist/index.js')).href)
      : await import('@electric-sql/pglite');
    db = new module.PGlite(); // In-memory PostgreSQL/WASM. No external database endpoint.
  }
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table public.empresas(id uuid primary key);
    create table public.empresa_usuarios(empresa_id uuid,user_id uuid,rol text,activo boolean default true);
    create table public.test_permissions(user_id uuid,empresa_id uuid,permiso text);
    create function public.tiene_permiso_empresa(p_empresa_id uuid,p_permiso text)
      returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.test_permissions p where p.user_id=auth.uid()
        and p.empresa_id=p_empresa_id and p.permiso=p_permiso);
    $$;
    create function public.es_miembro_empresa(p_empresa_id uuid)
      returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.test_permissions p where p.user_id=auth.uid() and p.empresa_id=p_empresa_id);
    $$;
    create table public.productos(
      id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas,
      codigo_interno text,codigo_barras text,nombre text not null,descripcion text,categoria text,marca text,proveedor text,
      costo_actual numeric default 0,costo_ultima_compra numeric default 0,precio_venta numeric default 0,
      margen_ganancia numeric default 0,margen_porcentaje numeric default 0,
      stock_actual numeric default 0,stock_minimo numeric default 0,stock_maximo numeric default 1000,
      activo boolean not null default true,unidad_medida text default 'unidad',unidad_revision bigint default 0
    );
  `);
  // Load actual repository SQL, not JavaScript simulations of the affected functions.
  for (const name of [
    '20260911043000_ventas_caja_operativas.sql',
    '20260911062000_clientes_cuenta_corriente.sql',
    '20260911073000_compras_proveedores_operativos.sql',
    '20260912151800_productos_baja_logica_segura.sql',
    '20260912111800_evitar_codigos_duplicados_por_empresa.sql',
    '20260912235500_productos_alta_costos_cero.sql',
    '20260913205500_carrito_devoluciones_anulaciones.sql',
    '20260913162000_guard_movimientos_producto_operativo.sql',
    '20260910010900_portal_cliente_seguro.sql',
  ]) await db.exec(await migration(name));
  const operationalGuard = await migration('20260913203500_desactivar_servicios_no_vendibles.sql');
  await db.exec(operationalGuard.slice(operationalGuard.indexOf('create or replace function public.sigo_validar_producto_movimiento()')));
  // The alias migration ends in a production-specific data block. NEVER execute that block.
  const aliases = await migration('20260916164500_producto_codigos_alias_scanner.sql');
  await db.exec(aliases.slice(0, aliases.indexOf('-- Evidencia recibida')));
  await db.exec(`
    alter table public.ventas_sigo add column request_fingerprint text;
    alter table public.compras_sigo add column request_fingerprint text;
    create table public.ofertas_productos_sigo(
      id uuid primary key default gen_random_uuid(),empresa_id uuid,producto_id uuid,
      fecha_inicio date,fecha_fin date,descuento_porcentaje numeric
    );
  `);
  for (const name of [
    '20260922233000_compras_precio_automatico.sql',
    '20260925141000_editar_anular_compras.sql',
    '20261022024847_manual_medidas_atomicas.sql',
  ]) await db.exec(await migration(name));
  const proposalSql = await readFile(proposalUrl, 'utf8');
  await db.exec(proposalSql);
  const proposalSha256 = createHash('sha256').update(proposalSql).digest('hex');
  await db.exec(`
    insert into auth.users(id) values ('${ids.admin}'),('${ids.reader}'),('${ids.outsider}'),('${ids.client}');
    insert into public.empresas(id) values ('${ids.company}'),('${ids.otherCompany}');
    insert into public.test_permissions
      select '${ids.admin}'::uuid,'${ids.company}'::uuid,p from unnest(array[
        'products.write','products.read','stock.read','stock.write','costs.read','margins.read',
        'price_lists.read','sales.read','sales.write','purchases.write','purchases.read','clients.read','clients.write'
      ]) p;
    insert into public.test_permissions values
      ('${ids.reader}','${ids.company}','products.read'),
      ('${ids.outsider}','${ids.otherCompany}','products.write'),
      ('${ids.outsider}','${ids.otherCompany}','products.read');
    insert into public.productos(id,empresa_id,nombre,codigo_interno,codigo_barras,stock_actual,costo_actual,costo_ultima_compra,precio_venta,unidad_revision)
      values ('${ids.product}','${ids.company}','Sintético archivo','ARCH-1','9900000000001',100,7.25,7,12.50,4),
      ('${ids.available}','${ids.company}','Sintético disponible','OPEN-1','9900000000002',100,5,5,10,0),
      ('${ids.otherProduct}','${ids.otherCompany}','Otro tenant','OTHER','9900000000003',123,9,9,20,0),
      ('${ids.inactive}','${ids.company}','Legacy inactivo','LEG-1','9900000000004',0,8,8,10,0),
      ('${ids.nonSellable}','${ids.company}','Servicio no vendible','NO-1','9900000000005',2,1,1,2,0);
    update public.productos set activo=false where id='${ids.inactive}';
    update public.productos set categoria='NO_VENDIBLE' where id='${ids.nonSellable}';
    insert into public.producto_codigos_alias_sigo(empresa_id,producto_id,codigo)
      values('${ids.company}','${ids.product}','ALIAS-ARCH'),('${ids.otherCompany}','${ids.otherProduct}','ALIAS-ARCH');
    select set_config('request.jwt.claim.sub','${ids.admin}',false);
    insert into public.proveedores_sigo(id,empresa_id,razon_social) values('${ids.supplier}','${ids.company}','Proveedor sintético');
    insert into public.clientes_sigo(id,empresa_id,nombre) values('${ids.customer}','${ids.company}','Cliente sintético');
    insert into public.empresa_usuarios(empresa_id,user_id,rol) values('${ids.company}','${ids.client}','client');
    insert into public.portal_cliente_usuarios(empresa_id,cliente_id,user_id) values('${ids.company}','${ids.customer}','${ids.client}');
    insert into public.portal_stock_publicado(empresa_id,cliente_id,producto_id,stock_comercial,consumo_diario_estimado)
      values('${ids.company}','${ids.customer}','${ids.product}',100,2),('${ids.company}','${ids.customer}','${ids.available}',100,2);
    -- Intentionally permissive product DML models legacy table grants. The proposal must
    -- enforce archive permissions and auditing even if these grants already exist.
    grant select,insert,update,delete on public.productos to authenticated;
    grant select on public.ventas_sigo,public.venta_items_sigo,public.compras_sigo,public.compra_items_sigo,
      public.caja_movimientos_sigo,public.clientes_sigo,public.devoluciones_sigo,public.devolucion_items_sigo to authenticated;
  `);
  return { db, proposalSha256 };
}
