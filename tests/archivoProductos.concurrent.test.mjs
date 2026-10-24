// PostgreSQL 17 multi-session tests. Requires a fresh LOCAL disposable database.
// Never connects to Supabase, never reads real rows, and never drops a database/schema.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import { createFixture, ids } from './fixtures/archivoProductos.fixture.mjs';

const configuredUrl = process.env.SIGO_ARCHIVO_TEST_DATABASE_URL;

function localTestConfig(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Se requiere una URL PostgreSQL local sintética válida.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.pathname !== '/sigo_archivo_test'
      || url.search || url.hash || !url.username) {
    throw new Error('SIGO_ARCHIVO_TEST_DATABASE_URL sólo admite localhost/127.0.0.1 y la base sigo_archivo_test, sin parámetros ni fragmentos.');
  }
  return {
    host: url.hostname, port: Number(url.port || 5432), database: 'sigo_archivo_test',
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 10_000, statement_timeout: 15_000,
    query_timeout: 17_000, application_name: 'sigo_archivo_test',
  };
}

// This validation runs without importing pg or opening any connection.
test('la URL de pruebas rechaza destinos externos, otras bases y overrides por query', () => {
  for (const raw of [
    'postgresql://test:fake@example.invalid/sigo_archivo_test',
    'postgresql://test:fake@localhost/production',
    'postgresql://test:fake@localhost/sigo_archivo_test?host=example.invalid',
    'postgresql://test:fake@127.0.0.1/sigo_archivo_test#override',
    'https://test:fake@localhost/sigo_archivo_test',
    'postgresql://test:fake@localhost/sigo_archivo_test%2Fother',
  ]) assert.throws(() => localTestConfig(raw), /sólo admite|válida/);
  assert.equal(localTestConfig('postgresql://test:fake@127.0.0.1:5432/sigo_archivo_test').database, 'sigo_archivo_test');
});

test('PostgreSQL17: archivo comercial y ventas concurrentes', {
  skip: !configuredUrl ? 'SIGO_ARCHIVO_TEST_DATABASE_URL ausente: no se ejecutó concurrencia real; PGlite no la sustituye.' : false,
  timeout: 90_000,
}, async t => {
  const config = localTestConfig(configuredUrl); // Must run BEFORE import/connect.
  const { Client } = await import('pg');
  const clients = [];
  async function connect(name) {
    const client = new Client({ ...config, application_name: `sigo_archivo_test_${name}` });
    clients.push(client);
    await client.connect();
    client.testPid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
    return client;
  }
  t.after(async () => {
    // Only our own test connections are closed. No database/schema deletion.
    await Promise.allSettled(clients.map(client => client.end()));
  });
  const observer = await connect('observer');
  const environment = (await observer.query(`select current_database() as db,
    current_setting('server_version_num')::int as version,
    (select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%') as objects,
    (select count(*)::int from pg_catalog.pg_roles where rolname in ('anon','authenticated')) as fixture_roles`)).rows[0];
  assert.equal(environment.db, 'sigo_archivo_test');
  assert.ok(environment.version >= 170000 && environment.version < 180000, 'Se requiere PostgreSQL 17 para esta puerta de validación.');
  assert.equal(environment.objects, 0, 'La base sintética no está vacía: se rechaza reutilizar o borrar sus datos.');
  assert.equal(environment.fixture_roles, 0, 'El cluster no es nuevo: roles de aplicación preexistentes impiden inicializar la fixture.');
  const adapter = { query: (sql, params) => observer.query(sql, params), exec: sql => observer.query(sql) };
  const { proposalSha256 } = await createFixture({ db: adapter });
  const first = await connect('first');
  const second = await connect('second');
  t.diagnostic(`SQL ensayado SHA-256: ${proposalSha256}; PostgreSQL ${environment.version}; tres sesiones independientes.`);

  async function begin(client, actor = ids.admin) {
    await client.query('reset role');
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    await client.query('set local role authenticated');
  }
  async function rollbackBoth() {
    // In these scenarios first is always the blocker. Releasing it lets second finish.
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
  }
  async function scenario(name, body) {
    await t.test(name, { timeout: 20_000 }, async st => {
      try { await body(st); }
      finally { await rollbackBoth(); }
    });
  }
  function observed(promise) {
    const state = { settled: false };
    state.result = promise.then(value => {
      state.settled = true; return { ok: true, value };
    }, error => {
      state.settled = true; return { ok: false, error };
    });
    return state;
  }
  async function waitForRowLock(blocker, waiter, pending) {
    const deadline = performance.now() + 8_000;
    while (performance.now() < deadline) {
      const { rows } = await observer.query(`select state,wait_event_type,wait_event,
        pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity where pid=$1`, [waiter.testPid]);
      const row = rows[0];
      if (row?.wait_event_type === 'Lock' && row.blockers.includes(blocker.testPid)) return row;
      if (pending.settled) {
        const result = await pending.result;
        assert.fail(`La operación no esperó el lock de producto: ${result.ok ? 'terminó antes de la barrera' : result.error.message}`);
      }
      // Yield only; timing never decides correctness. The observed lock is the barrier.
      await nextTurn();
    }
    assert.fail('No se observó el bloqueo PostgreSQL esperado antes del timeout de seguridad.');
  }
  const archive = (client, id, company = ids.company) => client.query(
    'select public.configurar_archivo_producto_sigo($1,$2,true) as estado', [company, id]);
  const sale = (client, id, key) => client.query(
    "select public.confirmar_venta_sigo_v2($1,$2::jsonb,'efectivo',$3,null,0) as id",
    [ids.company, JSON.stringify([{ producto_id: id, cantidad: 4, unidad_medida: 'unidad' }]), key]);
  const product = async id => (await observer.query('select trim_scale(stock_actual)::text as stock_actual,archivado_comercial from public.productos where id=$1', [id])).rows[0];
  const audits = async id => (await observer.query('select archivado,trim_scale(stock_preservado)::text as stock_preservado,usuario_id,empresa_id from public.productos_archivo_auditoria_sigo where producto_id=$1 order by id', [id])).rows;
  async function addProduct(suffix) {
    const id = `60000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
    await observer.query(`insert into public.productos(id,empresa_id,nombre,codigo_interno,stock_actual,costo_actual,costo_ultima_compra,precio_venta)
      values($1,$2,$3,$4,100,7.25,7,12.5)`, [id, ids.company, `Concurrencia sintética ${suffix}`, `CONC-${suffix}`]);
    return id;
  }
  async function saleCounts(key) {
    return (await observer.query(`select
      (select count(*)::int from public.ventas_sigo where idempotency_key=$1) ventas,
      (select count(*)::int from public.venta_items_sigo i join public.ventas_sigo v on v.id=i.venta_id where v.idempotency_key=$1) items,
      (select count(*)::int from public.caja_movimientos_sigo c join public.ventas_sigo v on v.id=c.venta_id where v.idempotency_key=$1) caja`, [key])).rows[0];
  }
  async function rejectedWithinTransaction(client, sql, args, pattern) {
    await client.query('savepoint expected_error');
    try { await assert.rejects(client.query(sql, args), pattern); }
    finally { await client.query('rollback to savepoint expected_error; release savepoint expected_error'); }
  }

  await scenario('archivo primero: venta espera, luego falla sin cabecera, detalle, caja ni stock parcial', async st => {
    const id = await addProduct(1); const key = 'concurrent-archive-first';
    await begin(first); await archive(first, id);
    await begin(second); const pending = observed(sale(second, id, key));
    const lock = await waitForRowLock(first, second, pending);
    st.diagnostic(`Venta bloqueada por sesión de archivo: ${lock.wait_event_type}/${lock.wait_event}.`);
    assert.deepEqual(await product(id), { stock_actual: '100', archivado_comercial: false }, 'estado no comprometido sigue invisible a otra sesión');
    await first.query('commit');
    const result = await pending.result;
    assert.equal(result.ok, false);
    assert.match(result.error.message, /PRODUCT_ARCHIVED/);
    await second.query('rollback');
    assert.deepEqual(await product(id), { stock_actual: '100', archivado_comercial: true });
    assert.deepEqual(await saleCounts(key), { ventas: 0, items: 0, caja: 0 });
    assert.equal((await audits(id))[0].stock_preservado, '100');
  });

  await scenario('venta primero: archivo espera y conserva el stock remanente comprometido', async () => {
    const id = await addProduct(2); const key = 'concurrent-sale-first';
    await begin(first); const saleResult = await sale(first, id, key);
    await begin(second); const pending = observed(archive(second, id));
    await waitForRowLock(first, second, pending);
    assert.deepEqual(await saleCounts(key), { ventas: 0, items: 0, caja: 0 }, 'venta aún no comprometida');
    await first.query('commit');
    const result = await pending.result;
    assert.equal(result.ok, true, result.error?.message);
    await second.query('commit');
    assert.ok(saleResult.rows[0].id);
    assert.deepEqual(await product(id), { stock_actual: '96', archivado_comercial: true });
    assert.deepEqual(await saleCounts(key), { ventas: 1, items: 1, caja: 1 });
    assert.equal((await audits(id))[0].stock_preservado, '96');
  });

  await scenario('rollback del archivo: venta en espera continúa y no queda auditoría fantasma', async () => {
    const id = await addProduct(3); const key = 'concurrent-archive-rollback';
    await begin(first); await archive(first, id);
    await begin(second); const pending = observed(sale(second, id, key));
    await waitForRowLock(first, second, pending);
    await first.query('rollback');
    const result = await pending.result;
    assert.equal(result.ok, true, result.error?.message);
    await second.query('commit');
    assert.deepEqual(await product(id), { stock_actual: '96', archivado_comercial: false });
    assert.deepEqual(await saleCounts(key), { ventas: 1, items: 1, caja: 1 });
    assert.equal((await audits(id)).length, 0);
  });

  await scenario('rollback de venta: archivo en espera conserva 100 y no queda movimiento comercial', async () => {
    const id = await addProduct(4); const key = 'concurrent-sale-rollback';
    await begin(first); await sale(first, id, key);
    await begin(second); const pending = observed(archive(second, id));
    await waitForRowLock(first, second, pending);
    await first.query('rollback');
    const result = await pending.result;
    assert.equal(result.ok, true, result.error?.message);
    await second.query('commit');
    assert.deepEqual(await product(id), { stock_actual: '100', archivado_comercial: true });
    assert.deepEqual(await saleCounts(key), { ventas: 0, items: 0, caja: 0 });
    assert.equal((await audits(id))[0].stock_preservado, '100');
  });

  await scenario('dos empresas: locks independientes y escrituras cruzadas rechazadas sin residuos', async () => {
    const id = await addProduct(5);
    await begin(first); await archive(first, id);
    await begin(second, ids.outsider);
    await archive(second, ids.otherProduct, ids.otherCompany);
    // Completion while first still holds its lock proves no cross-company lock dependency.
    await rejectedWithinTransaction(second, 'select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.company,id], /FORBIDDEN/);
    await rejectedWithinTransaction(second, 'select public.configurar_archivo_producto_sigo($1,$2,true)', [ids.otherCompany,id], /PRODUCT_NOT_FOUND_IN_TENANT/);
    await first.query('rollback'); await second.query('commit');
    assert.deepEqual(await product(id), { stock_actual: '100', archivado_comercial: false });
    assert.equal((await audits(id)).length, 0);
    assert.deepEqual(await product(ids.otherProduct), { stock_actual: '123', archivado_comercial: true });
    assert.deepEqual(await audits(ids.otherProduct), [{ archivado: true, stock_preservado: '123', usuario_id: ids.outsider, empresa_id: ids.otherCompany }]);
  });
});
