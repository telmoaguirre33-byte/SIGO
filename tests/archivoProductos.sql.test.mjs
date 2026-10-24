// Real PostgreSQL execution in an ephemeral PGlite database; no real rows or services.
import assert from 'node:assert/strict';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import { createFixture, ids } from './fixtures/archivoProductos.fixture.mjs';

let db, proposalSha256;
before(async () => { ({ db, proposalSha256 } = await createFixture()); });
after(async () => { if (db) await db.close(); });
beforeEach(async () => { await db.exec('begin'); await actor(ids.admin); });
afterEach(async () => { await db.exec('rollback'); });
async function actor(user, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
  await db.exec(`set role ${role}`);
}
async function owner(sql, params = []) {
  await db.exec('reset role');
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('set role authenticated'); }
}
async function expectedError(sql, params, pattern) {
  await db.exec('savepoint expected_error');
  try { await assert.rejects(db.query(sql, params), pattern); }
  finally { await db.exec('rollback to savepoint expected_error; release savepoint expected_error'); }
}
const archive = (product = ids.product, value = true, company = ids.company) => db.query(
  'select public.configurar_archivo_producto_sigo($1,$2,$3) as estado', [company, product, value]);
async function product(id = ids.product) { return (await owner('select to_jsonb(p) as p from public.productos p where id=$1', [id]))[0].p; }
async function audits() { return owner('select producto_id,usuario_id,archivado,stock_preservado::text,unidad_preservada from public.productos_archivo_auditoria_sigo order by id'); }
async function counts() {
  return (await owner(`select (select count(*)::int from public.ventas_sigo) ventas,
    (select count(*)::int from public.venta_items_sigo) venta_items,
    (select count(*)::int from public.compras_sigo) compras,
    (select count(*)::int from public.compra_items_sigo) compra_items,
    (select count(*)::int from public.caja_movimientos_sigo) caja,
    (select count(*)::int from public.devoluciones_sigo) devoluciones`))[0];
}
const sale = (items, key = 'venta-sintetica') => db.query(
  "select public.confirmar_venta_sigo_v2($1,$2::jsonb,'efectivo',$3,null,0) as id", [ids.company, JSON.stringify(items), key]);
const saleItem = (id, quantity = 2) => ({ producto_id: id, cantidad: quantity, unidad_medida: 'unidad' });
const purchaseSql = "select public.confirmar_compra_sigo($1,$2,$3::jsonb,'2026-10-24','Factura',$4,$5) as id";
const purchaseArgs = (items, key) => [ids.company, ids.supplier, JSON.stringify(items), key, key];

test('archivar con 100 conserva exactamente todos los demás campos e históricos y audita una vez', async () => {
  const before = await product();
  const history = await counts();
  const { rows: [result] } = await archive();
  assert.equal(result.estado.archivado_comercial, true);
  assert.equal(result.estado.activo, true);
  assert.deepEqual(await product(), { ...before, archivado_comercial: true });
  assert.deepEqual(await counts(), history);
  assert.deepEqual(await audits(), [{ producto_id: ids.product, usuario_id: ids.admin, archivado: true, stock_preservado: '100', unidad_preservada: 'unidad' }]);
  await archive();
  assert.equal((await audits()).length, 1, 'retry idempotente no duplica auditoría');
});

test('reactivar sólo revierte estado comercial y conserva stock, código, unidad y costos', async () => {
  const before = await product();
  await archive(); await archive(ids.product, false); await archive(ids.product, false);
  assert.deepEqual(await product(), before);
  assert.deepEqual((await audits()).map(a => a.archivado), [true, false]);
  assert.equal((await db.query('select id from public.listar_productos_sigo($1)', [ids.company])).rows.some(p => p.id === ids.product), true);
  await sale([saleItem(ids.product)], 'venta-reactivada');
  assert.equal(Number((await product()).stock_actual), 98);
});

test('tenant, permisos, ausencia de sesión y legacy inactivo fallan sin cambiar nada', async () => {
  await expectedError('select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.company, ids.otherProduct], /PRODUCT_NOT_FOUND_IN_TENANT/);
  await expectedError('select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.otherCompany, ids.otherProduct], /FORBIDDEN/);
  await expectedError('select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.company, ids.inactive], /PRODUCT_LEGACY_INACTIVE_REVIEW/);
  await actor(ids.outsider);
  await expectedError('update public.productos set archivado_comercial=true where id=$1', [ids.product], /FORBIDDEN/);
  await actor(ids.reader);
  await expectedError('select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.company, ids.product], /FORBIDDEN/);
  await expectedError('update public.productos set archivado_comercial=true where id=$1', [ids.product], /FORBIDDEN/);
  await actor(null);
  await expectedError('select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.company, ids.product], /AUTH_REQUIRED/);
  await actor(ids.admin);
  assert.equal((await product()).archivado_comercial, false);
  assert.equal((await audits()).length, 0);
});

test('UPDATE directo autorizado queda auditado; no se puede mezclar archivo con stock/tenant/nombre', async () => {
  const before = await product();
  for (const clause of ['stock_actual=0', "nombre='Cambio oculto'", `empresa_id='${ids.otherCompany}'`]) {
    await expectedError(`update public.productos set archivado_comercial=true,${clause} where id=$1`, [ids.product], /ARCHIVE_ONLY_STATE_CHANGE/);
  }
  assert.deepEqual(await product(), before);
  await db.query('update public.productos set archivado_comercial=true where id=$1', [ids.product]);
  assert.equal((await audits()).length, 1);
  assert.equal((await audits())[0].usuario_id, ids.admin);
  await expectedError('insert into public.productos(empresa_id,nombre,archivado_comercial) values($1,$2,true)', [ids.company, 'No permitido'], /ARCHIVE_CREATE_AS_ACTIVE_FIRST/);
  await expectedError('delete from public.productos where id=$1', [ids.product], /foreign key constraint/);
});

test('auditoría no puede leerse, borrarse ni falsificarse por authenticated', async () => {
  await archive();
  await expectedError('select * from public.productos_archivo_auditoria_sigo', [], /permission denied/);
  await expectedError('delete from public.productos_archivo_auditoria_sigo', [], /permission denied/);
  await expectedError('insert into public.productos_archivo_auditoria_sigo(empresa_id,producto_id,usuario_id,archivado) values($1,$2,$3,false)', [ids.company, ids.product, ids.admin], /permission denied/);
  assert.equal((await audits()).length, 1);
});

test('venta mixta con artículo archivado revierte cabecera, detalle, caja y descuentos de stock anteriores', async () => {
  await archive();
  const beforeCounts = await counts(); const beforeAvailable = await product(ids.available);
  await expectedError("select public.confirmar_venta_sigo_v2($1,$2::jsonb,'efectivo',$3,null,0)",
    [ids.company, JSON.stringify([saleItem(ids.available), saleItem(ids.product)]), 'venta-bloqueada'], /PRODUCT_ARCHIVED/);
  assert.deepEqual(await counts(), beforeCounts);
  assert.deepEqual(await product(ids.available), beforeAvailable);
  assert.equal(Number((await product()).stock_actual), 100);
});

test('compra mixta archivada revierte cabecera, detalles, stock, costo y precio', async () => {
  await archive();
  const beforeCounts = await counts(); const beforeAvailable = await product(ids.available);
  await expectedError(purchaseSql, purchaseArgs([
    { producto_id: ids.available, cantidad: 3, costo_unitario: 22 },
    { producto_id: ids.product, cantidad: 3, costo_unitario: 22 },
  ], 'compra-bloqueada'), /PRODUCT_ARCHIVED/);
  assert.deepEqual(await counts(), beforeCounts);
  assert.deepEqual(await product(ids.available), beforeAvailable);
  assert.equal(Number((await product()).stock_actual), 100);
});

test('devolución parcial y anulación total históricas restituyen stock sin desarchivar ni abrir ventas', async () => {
  const { rows: [{ id: saleId }] } = await sale([saleItem(ids.product, 4)]);
  const item = (await owner('select id from public.venta_items_sigo where venta_id=$1', [saleId]))[0];
  assert.equal(Number((await product()).stock_actual), 96);
  await archive();
  const args = [ids.company, saleId, JSON.stringify([{ venta_item_id: item.id, cantidad: 1 }]), 'Devolución sintética', 'return-partial'];
  const partial = await db.query('select public.registrar_devolucion_sigo($1,$2,$3::jsonb,$4,$5,false) as id', args);
  assert.equal(Number((await product()).stock_actual), 97);
  assert.equal((await product()).archivado_comercial, true);
  assert.equal((await db.query('select public.registrar_devolucion_sigo($1,$2,$3::jsonb,$4,$5,false) as id', args)).rows[0].id, partial.rows[0].id);
  assert.equal(Number((await product()).stock_actual), 97, 'retry no suma stock de nuevo');
  await db.query('select public.anular_venta_sigo($1,$2,$3,$4)', [ids.company, saleId, 'Anulación sintética', 'return-rest']);
  assert.equal(Number((await product()).stock_actual), 100);
  assert.equal((await product()).archivado_comercial, true);
  const history = (await owner(`select v.estado,(select count(*)::int from public.venta_items_sigo where venta_id=v.id) items,
    (select sum(importe)::text from public.caja_movimientos_sigo where venta_id=v.id and tipo='egreso') egreso
    from public.ventas_sigo v where v.id=$1`, [saleId]))[0];
  assert.deepEqual(history, { estado: 'anulada', items: 1, egreso: '50.00' });
  await expectedError("select public.confirmar_venta_sigo_v2($1,$2::jsonb,'efectivo',$3,null,0)", [ids.company, JSON.stringify([saleItem(ids.product)]), 'post-return-block'], /PRODUCT_ARCHIVED/);
});

test('anular compra histórica archivada conserva comprobante y archivo y devuelve stock anterior', async () => {
  await db.query(purchaseSql, purchaseArgs([{ producto_id: ids.product, cantidad: 3, costo_unitario: 6 }], 'compra-previa'));
  const { rows: [{ id: purchaseId }] } = await db.query(purchaseSql, purchaseArgs([{ producto_id: ids.product, cantidad: 5, costo_unitario: 8 }], 'compra-anular'));
  assert.equal(Number((await product()).stock_actual), 108);
  await archive();
  await db.query("select public.cambiar_compra_sigo($1,$2,'anular')", [ids.company, purchaseId]);
  assert.equal(Number((await product()).stock_actual), 103);
  assert.equal(Number((await product()).costo_actual), 6);
  assert.equal(Number((await product()).costo_ultima_compra), 6);
  assert.equal((await product()).archivado_comercial, true);
  assert.deepEqual((await owner('select estado,(select count(*)::int from public.compra_items_sigo where compra_id=c.id) items from public.compras_sigo c where id=$1', [purchaseId]))[0], { estado: 'anulada', items: 1 });
});

test('inventario mantiene archivados, legacy y no vendibles; catálogo y lookup operativo no ofrecen archivados', async () => {
  await archive();
  const inventory = (await db.query('select * from public.listar_inventario_productos_sigo($1)', [ids.company])).rows;
  assert.equal(inventory.length, 4);
  const archived = inventory.find(p => p.id === ids.product);
  assert.equal(archived.archivado_comercial, true);
  assert.equal(Number(archived.stock_actual), 100);
  assert.equal(Number(archived.unidad_revision), 4);
  const catalog = (await db.query('select id from public.listar_productos_sigo($1)', [ids.company])).rows;
  assert.deepEqual(catalog.map(p => p.id), [ids.available]);
  assert.equal((await db.query('select id from public.buscar_producto_codigo_sigo($1,$2)', [ids.company, 'ALIAS-ARCH'])).rows.length, 0);
  for (const code of ['ARCH-1', '9900000000001', 'ALIAS-ARCH']) {
    const result = (await db.query('select * from public.buscar_producto_inventario_sigo($1,$2)', [ids.company, code])).rows;
    assert.equal(result.length, 1);
    assert.equal(result[0].buscar_producto_inventario_sigo.id, ids.product);
  }
  await expectedError('select * from public.listar_inventario_productos_sigo($1)', [ids.otherCompany], /FORBIDDEN/);
});

test('inventario y alias enmascaran datos según permisos sin convertir restringido en cero', async () => {
  await archive(); await actor(ids.reader);
  const result = (await db.query('select * from public.buscar_producto_inventario_sigo($1,$2)', [ids.company, 'ALIAS-ARCH'])).rows[0].buscar_producto_inventario_sigo;
  for (const key of ['stock_actual','stock_minimo','stock_maximo','costo_actual','costo_ultima_compra','precio_venta','margen_ganancia','margen_porcentaje']) assert.equal(result[key], null, key);
  assert.equal(result.archivado_comercial, true);
  assert.equal(result.id, ids.product);
});

test('portal cliente excluye archivo y conserva validación del vínculo y tenant', async () => {
  await archive(); await actor(ids.client);
  const result = (await db.query('select producto_id from public.portal_cliente_catalogo_sigo($1)', [ids.company])).rows;
  assert.deepEqual(result.map(p => p.producto_id), [ids.available]);
  await expectedError('select * from public.portal_cliente_catalogo_sigo($1)', [ids.otherCompany], /PORTAL_FORBIDDEN/);
  await actor(ids.admin);
  await expectedError('select * from public.portal_cliente_catalogo_sigo($1)', [ids.company], /PORTAL_FORBIDDEN/);
});

test('archivo no hace desaparecer unidades ni valorización a costo del inventario físico', async () => {
  const totals = async () => (await db.query('select sum(stock_actual)::text stock,sum(stock_actual*costo_actual)::text costo from public.listar_inventario_productos_sigo($1)', [ids.company])).rows[0];
  const before = await totals();
  await archive();
  assert.deepEqual(await totals(), before);
  assert.deepEqual(before, { stock: '202', costo: '1227.00' });
});

test('guardas de detalle bloquean INSERT directo y cambio de producto sin depender de las RPC', async () => {
  const { rows: [{ id: saleId }] } = await sale([saleItem(ids.available)], 'venta-detalle');
  const { rows: [{ id: purchaseId }] } = await db.query(purchaseSql, purchaseArgs([{ producto_id: ids.available, cantidad: 2, costo_unitario: 5 }], 'compra-detalle'));
  await archive();
  await db.exec('reset role'); // Simulates another privileged RPC; production direct DML is separately constrained by RLS.
  await expectedError('insert into public.venta_items_sigo(venta_id,empresa_id,producto_id,cantidad,precio_unitario,subtotal) values($1,$2,$3,1,1,1)', [saleId,ids.company,ids.product], /PRODUCT_ARCHIVED/);
  await expectedError('insert into public.compra_items_sigo(compra_id,empresa_id,producto_id,cantidad,costo_unitario,subtotal) values($1,$2,$3,1,1,1)', [purchaseId,ids.company,ids.product], /PRODUCT_ARCHIVED/);
  await expectedError('update public.venta_items_sigo set producto_id=$1 where venta_id=$2', [ids.product,saleId], /PRODUCT_ARCHIVED/);
  await expectedError('update public.compra_items_sigo set producto_id=$1 where compra_id=$2', [ids.product,purchaseId], /PRODUCT_ARCHIVED/);
  await db.exec('set role authenticated');
  assert.equal(Number((await product()).stock_actual), 100);
});

test('los locks se verifican en funciones instaladas; concurrencia real queda fuera de PGlite', async t => {
  const functions = await owner("select proname,pg_get_functiondef(oid) as sql from pg_proc where proname in ('configurar_archivo_producto_sigo','sigo_validar_producto_no_archivado')");
  assert.equal(functions.length, 2);
  for (const f of functions) assert.match(f.sql, /for update/i, f.proname);
  const triggers = await owner("select tgname from pg_trigger where not tgisinternal and tgname in ('sigo_venta_no_archivada','sigo_compra_no_archivada')");
  assert.equal(triggers.length, 2);
  t.diagnostic(`SQL ensayado SHA-256: ${proposalSha256}`);
  t.diagnostic('PGlite ejecuta PostgreSQL real, pero estas pruebas usan una única conexión: no acreditan carreras entre sesiones ni permisos/RLS de producción.');
});
