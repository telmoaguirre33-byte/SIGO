import assert from 'node:assert/strict';
import test from 'node:test';
import { crearCorreccionUnidadInicial, validarPreview, CONFIRMACION } from '../src/correccionUnidadInicial.ts';
import { crearAdaptadorCorreccionUnidadInicial, DECLARACION_SERVIDOR } from '../src/adaptadorCorreccionUnidadInicial.ts';
import { crearPersistenciaCorreccionUnidadInicial } from '../src/persistenciaCorreccionUnidadInicial.ts';
const scope = { empresaId: 'empresa', productoId: 'producto' };
const p = { ...scope, nombre: 'Nombre', elegible: true, unidad: 'unidad', unidadDestino: 'kg', revision: '0', snapshot: 's'.repeat(64), valores: { stock_actual: 10, stock_minimo: 0, stock_maximo: null, precio_venta: 10, costo_actual: 5, costo_ultima_compra: 5 } };
const attempt = { requestId: '12345678-1234-4123-8123-123456789012', preview: p, destino: 'kg', confirmacion: CONFIRMACION };
const receipt = { ...scope, requestId: attempt.requestId, snapshot: p.snapshot, unidad: 'kg', revision: '1', valores: p.valores };
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k) }; };
const persistence = (storage, overrides={}) => crearPersistenciaCorreccionUnidadInicial(storage, { usuarioId: 'u', ...scope, ...overrides });
const controller = (store, commit) => { const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, preview: async () => p, uuid: () => attempt.requestId, persistencia: store, commit }); c.seleccionarDestino('kg'); return c; };
test('adapter usa RPC/nombres/argumentos exactos y verifica recibo completo', async () => {
  const calls = []; const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async (name,args) => { calls.push([name,args]); return { data: name.startsWith('previsualizar') ? p : receipt, error: null }; } });
  assert.deepEqual(await a.preview(scope, 'kg'), p); assert.equal((await a.commit(attempt)).estado, 'aplicado');
  assert.deepEqual(calls[0], ['previsualizar_correccion_unidad_inicial_sigo', { p_empresa_id: 'empresa', p_producto_id: 'producto', p_unidad_destino: 'kg' }]);
  assert.deepEqual(calls[1], ['corregir_unidad_inicial_sigo', { p_empresa_id: 'empresa', p_producto_id: 'producto', p_request_id: attempt.requestId, p_snapshot: p.snapshot, p_declaracion: DECLARACION_SERVIDOR, p_unidad_destino: 'kg' }]);
});
test('adapter rechaza recibo con valores alterados, omitidos o representación distinta', async () => {
  for (const values of [{}, { ...p.valores, stock_actual: 11 }, { ...p.valores, precio_venta: '10' }]) {
    const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: { ...receipt, valores: values }, error: null }) });
    await assert.rejects(a.commit(attempt));
  }
});
test('sólo errores PostgreSQL negocio conocidos son rechazo; desconocidos/red son inciertos', async () => {
  for (const [error, rejected] of [[{ code: 'P0001', message: 'PRODUCT_CHANGED_RELOAD' }, true], [{ code: '503', message: 'PRODUCT_CHANGED_RELOAD' }, false], [{ code: 'P0001', message: 'otro' }, false]]) {
    const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: null, error }) });
    if (rejected) assert.equal((await a.commit(attempt)).estado, 'rechazado'); else await assert.rejects(a.commit(attempt));
  }
});
test('NULL sólo permitido en máximo', () => {
  validarPreview(p, scope, 'kg');
  for (const field of Object.keys(p.valores).filter(k => k !== 'stock_maximo')) assert.throws(() => validarPreview({ ...p, valores: { ...p.valores, [field]: null } }, scope, 'kg'));
});
test('persiste antes del RPC y recarga recupera mismo UUID/payload sin mutación automática', async () => {
  const storage = memory(); const store = persistence(storage); let first; let second; let calls = 0;
  const c = controller(store, async a => { calls++; first=a; assert.deepEqual(store.leer().intento, a); throw Error('timeout'); });
  await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(c.getState().fase, 'uncertain');
  const reloaded = controller(persistence(storage), async a => { calls++; second=a; return { estado: 'aplicado', ...receipt }; });
  assert.equal(reloaded.getState().fase, 'uncertain'); assert.equal(calls, 1);
  await reloaded.cargar(); await reloaded.guardar(); assert.equal(calls, 1);
  await reloaded.reintentar(); assert.deepEqual(second, first); assert.equal(reloaded.getState().fase, 'success'); assert.equal(store.leer(), null);
});
test('fallo almacenamiento bloquea envío; registro corrupto bloquea sin borrar', async () => {
  let calls = 0; const storage = memory(); const store = persistence(storage);
  storage.setItem = () => { throw Error('Quota'); };
  const c = controller(store, async () => { calls++; return { estado: 'aplicado', ...receipt }; });
  await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(calls, 0); assert.equal(c.getState().fase, 'error');
  const corrupted = memory(); const ps = persistence(corrupted); corrupted.setItem(ps.key, '{');
  const blocked = controller(ps, async () => { calls++; }); assert.equal(blocked.getState().fase, 'invalidated');
  assert.equal(corrupted.getItem(ps.key), '{'); await blocked.cargar(); assert.equal(calls, 0);
});
test('expiración conserva registro; separación por usuario/tenant/producto', () => {
  const storage = memory(); let now = 100;
  const store = crearPersistenciaCorreccionUnidadInicial(storage, { usuarioId: 'u', ...scope }, () => now, 10);
  store.guardar(attempt); const raw = storage.getItem(store.key); now=111;
  assert.equal(store.leer().expirado, true); store.guardar(attempt); assert.equal(storage.getItem(store.key), raw);
  for (const patch of [{ usuarioId: 'otro' }, { empresaId: 'otra' }, { productoId: 'otro' }]) assert.equal(persistence(storage, patch).leer(), null);
});
test('no sobrescribe otro intento ni borra incertidumbre ante rechazo del retry', async () => {
  const store = persistence(memory()); store.guardar(attempt);
  assert.throws(() => store.guardar({ ...attempt, requestId: 'otro' }));
  const c = controller(store, async () => ({ estado: 'rechazado', mensaje: 'Sin permiso' }));
  await c.reintentar(); assert.equal(c.getState().fase, 'uncertain'); assert.deepEqual(store.leer().intento, attempt);
});
for (const code of ['55P03', '40P01']) {
  test(`PostgreSQL ${code} rechaza sin cambio el primer envío y conserva prudencia si era retry incierto`, async () => {
    const adapter = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: null, error: { code, message: 'database concurrency conflict' } }) });
    const expected = 'El producto está siendo usado en otra operación. Volvé a verificar antes de corregirlo.';
    assert.deepEqual(await adapter.commit(attempt), { estado: 'rechazado', mensaje: expected });
    const store = persistence(memory());
    const fresh = controller(store, adapter.commit);
    await fresh.cargar(); fresh.confirmar(true); await fresh.guardar();
    assert.equal(fresh.getState().fase, 'error'); assert.equal(fresh.getState().mensaje, expected);
    assert.equal(store.leer(), null);
    store.guardar(attempt);
    const retry = controller(store, adapter.commit);
    await retry.reintentar();
    assert.equal(retry.getState().fase, 'uncertain');
    assert.deepEqual(store.leer().intento, attempt);
  });
}

