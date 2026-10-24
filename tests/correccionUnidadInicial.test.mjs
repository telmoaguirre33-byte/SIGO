import assert from 'node:assert/strict';
import test from 'node:test';
import { crearCorreccionUnidadInicial, validarPreview, CONFIRMACION } from '../src/correccionUnidadInicial.ts';
const alcance = { empresaId: 'empresa-a', productoId: 'producto-a' };
const uuid = '12345678-1234-4123-8123-123456789012';
const preview = () => ({ ...alcance, nombre: 'Producto', unidad: 'unidad', unidadDestino: 'kg', revision: '0', elegible: true, snapshot: '{"exacto":true}', valores: { stock_actual: '12.000', stock_minimo: 2, stock_maximo: null, precio_venta: '2500.00', costo_actual: 1900, costo_ultima_compra: 1900 } });
const receipt = p => ({ estado: 'aplicado', ...alcance, unidad: 'kg', requestId: p.requestId, snapshot: p.preview.snapshot, revision: String(BigInt(p.preview.revision) + 1n), valores: p.preview.valores });
function fixture(overrides = {}) {
  const calls = [];
  const c = crearCorreccionUnidadInicial(alcance, { alcanceActual: () => alcance, preview: async () => preview(), uuid: () => uuid, commit: async p => { calls.push(p); return receipt(p); }, ...overrides });
  c.seleccionarDestino('kg');
  return { c, calls };
}
test('requiere preview y confirmación específica; conserva exactamente los seis números', async () => {
  const { c, calls } = fixture();
  await c.guardar(); assert.equal(calls.length, 0);
  await c.cargar(); await c.guardar(); assert.equal(calls.length, 0);
  c.confirmar(true); await c.guardar();
  assert.equal(calls.length, 1); assert.equal(calls[0].confirmacion, CONFIRMACION);
  assert.deepEqual(calls[0].preview.valores, preview().valores);
  assert.equal(c.getState().fase, 'success');
});
test('doble clic es single-flight y retry incierto usa el mismo objeto, UUID y snapshot', async () => {
  let reject; const calls = [];
  const { c } = fixture({ commit: p => { calls.push(p); return calls.length === 1 ? new Promise((_, r) => { reject = r; }) : Promise.resolve(receipt(p)); } });
  await c.cargar(); c.confirmar(true);
  const pending = c.guardar(); await c.guardar(); assert.equal(calls.length, 1);
  reject(new Error('timeout')); await pending;
  assert.equal(c.getState().fase, 'uncertain');
  await c.cargar(); await c.guardar(); assert.equal(calls.length, 1);
  await c.reintentar(); assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
  assert.equal(c.getState().fase, 'success');
});
test('preview se copia/congela para que una mutación externa no cambie payload', async () => {
  const p = preview(); const { c, calls } = fixture({ preview: async () => p });
  await c.cargar(); p.valores.stock_actual = '999'; p.snapshot = 'otro';
  c.confirmar(true); await c.guardar();
  assert.equal(calls[0].preview.valores.stock_actual, '12.000'); assert.equal(calls[0].preview.snapshot, preview().snapshot);
  assert.ok(Object.isFrozen(calls[0])); assert.ok(Object.isFrozen(calls[0].preview.valores));
});
test('cambio tenant bloquea antes de commit', async () => {
  let actual = alcance; const { c, calls } = fixture({ alcanceActual: () => actual });
  await c.cargar(); c.confirmar(true); actual = { ...alcance, empresaId: 'otra' }; await c.guardar();
  assert.equal(calls.length, 0); assert.equal(c.getState().fase, 'invalidated');
});
test('cambio tenant durante respuesta no muestra éxito del tenant anterior', async () => {
  let actual = alcance; let resolve; let sent;
  const { c } = fixture({ alcanceActual: () => actual, commit: p => { sent = p; return new Promise(r => { resolve = r; }); } });
  await c.cargar(); c.confirmar(true); const pending = c.guardar(); actual = { ...alcance, empresaId: 'otra' };
  resolve(receipt(sent)); await pending; assert.equal(c.getState().fase, 'invalidated');
  assert.equal(c.getIntentoPendiente(), sent);
});
test('respuestas cruzadas o recibos inválidos nunca son éxito', async () => {
  for (const patch of [{ empresaId: 'otra' }, { productoId: 'otro' }, { requestId: 'otro' }, { snapshot: 'otro' }, { unidad: 'unidad' }]) {
    const { c } = fixture({ commit: async p => ({ ...receipt(p), ...patch }) });
    await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(c.getState().fase, 'uncertain');
  }
});
test('rechazo confirmado exige preview nuevo y nueva confirmación', async () => {
  const { c } = fixture({ commit: async () => ({ estado: 'rechazado', mensaje: 'Ahora hay movimientos.' }) });
  await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(c.getState().fase, 'error');
  assert.equal(c.getIntentoPendiente(), undefined); await c.cargar(); assert.equal(c.getState().confirmado, false);
});
test('fallo de preview no permite mutación ni conserva confirmación', async () => {
  const { c, calls } = fixture({ preview: async () => { throw Error('RPC ausente'); } });
  await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(c.getState().fase, 'error'); assert.equal(calls.length, 0);
});
test('validación falla cerrada ante unidad, elegibilidad, tenant, números inválidos u omitidos', () => {
  for (const patch of [{ unidad: 'kg' }, { elegible: false }, { empresaId: 'otra' }, { snapshot: '' }, { valores: {} }, { valores: { ...preview().valores, stock_actual: NaN } }, { valores: { ...preview().valores, stock_actual: '' } }]) {
    assert.throws(() => validarPreview({ ...preview(), ...patch }, alcance, 'kg'));
  }
});
test('preview tardío de otra empresa se ignora', async () => {
  let resolve; let actual = alcance;
  const { c } = fixture({ alcanceActual: () => actual, preview: () => new Promise(r => { resolve = r; }) });
  const pending = c.cargar(); actual = { ...alcance, empresaId: 'otra' }; resolve(preview()); await pending;
  assert.equal(c.getState().fase, 'invalidated'); assert.equal(c.getState().preview, undefined);
});

