import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CAMPOS, PRECISION_UNIDAD, UNIDADES, CONFIRMACION, crearCorreccionUnidadInicial, validarPreview, validarValoresEnDestino } from '../src/correccionUnidadInicial.ts';
import { crearPersistenciaCorreccionUnidadInicial } from '../src/persistenciaCorreccionUnidadInicial.ts';
import { crearAdaptadorCorreccionUnidadInicial, DECLARACION_SERVIDOR } from '../src/adaptadorCorreccionUnidadInicial.ts';
import { prepararCorreccionUnidadInicial } from '../src/prepararCorreccionUnidadInicial.ts';
const scope = { empresaId: 'e', productoId: 'p' };
const uuid = '12345678-1234-4123-8123-123456789012';
const valores = { stock_actual: '12.000', stock_minimo: '0.000', stock_maximo: null, precio_venta: '25.00', costo_actual: '20.0000', costo_ultima_compra: '19.1234' };
const preview = (origen = 'kg', destino = 'unidad', revision = '0') => ({ ...scope, nombre: 'Producto', unidad: origen, unidadDestino: destino, revision, elegible: true, snapshot: `${revision}:${origen}:${destino}`, valores: { ...valores } });
const receipt = attempt => ({ estado: 'aplicado', ...scope, requestId: attempt.requestId, snapshot: attempt.preview.snapshot, unidad: attempt.destino, revision: String(BigInt(attempt.preview.revision) + 1n), valores: attempt.preview.valores });
const memory = () => { const m = new Map(); return { getItem: key => m.get(key) ?? null, setItem: (key, val) => m.set(key, val), removeItem: key => m.delete(key) }; };
const store = (storage, now) => crearPersistenciaCorreccionUnidadInicial(storage, { ...scope, usuarioId: 'u' }, now);
const intento = (p = preview()) => ({ requestId: uuid, preview: p, destino: p.unidadDestino, confirmacion: CONFIRMACION });

test('las 16 unidades y sus precisiones coinciden con el catálogo de ventas', async () => {
  const { UNIDADES_VENTA } = await import('../src/ventaPorMedidas.ts');
  const precision = Object.fromEntries(Object.entries(UNIDADES_VENTA).map(([u, info]) => [u, info.decimales]));
  assert.deepEqual(PRECISION_UNIDAD, precision);
});
test('los 240 pares origen→destino preservan seis valores, sin factor ni conversión', async () => {
  let count = 0;
  for (const origen of UNIDADES) for (const destino of UNIDADES) {
    if (origen === destino) continue;
    const p = preview(origen, destino, '9007199254740993');
    const calls = [];
    const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, preview: async (s, d) => { assert.equal(d, destino); return p; }, uuid: () => uuid, commit: async a => { calls.push(a); return receipt(a); } });
    c.seleccionarDestino(destino); await c.cargar(); c.confirmar(true); await c.guardar();
    assert.equal(c.getState().fase, 'success', `${origen}→${destino}`);
    assert.deepEqual(calls[0].preview.valores, valores); assert.equal(calls[0].destino, destino); count++;
  }
  assert.equal(count, 240);
});
test('no consulta preview antes de elegir destino ni acepta mismo origen/destino', async () => {
  let calls = 0;
  const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, preview: async () => { calls++; return preview(); }, commit: async () => { throw Error('prohibido'); } });
  await c.cargar(); assert.equal(calls, 0); assert.match(c.getState().mensaje, /Elegí primero/);
  for (const unidad of UNIDADES) assert.throws(() => validarPreview(preview(unidad, unidad), scope, unidad));
});
test('kg→unidad con 1.250 muestra error de entero, no convierte ni fuerza 1:1', async () => {
  let sent = 0;
  const p = { ...preview(), valores: { ...valores, stock_actual: '1.250' } };
  const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, preview: async () => p, commit: async () => { sent++; } });
  c.seleccionarDestino('unidad'); await c.cargar(); c.confirmar(true); await c.guardar();
  assert.equal(c.getState().fase, 'error'); assert.match(c.getState().mensaje, /Stock actual \(1\.250\).*cantidades enteras/);
  assert.match(c.getState().mensaje, /no convierte, redondea ni fuerza.*1:1/); assert.equal(sent, 0); assert.equal(p.valores.stock_actual, '1.250');
});
test('precisión destino se exige en los tres stocks, sin rechazar ceros finales', () => {
  for (const unidad of UNIDADES) for (const campo of CAMPOS.filter(c => c.startsWith('stock_'))) {
    const precision = PRECISION_UNIDAD[unidad];
    validarValoresEnDestino({ ...valores, [campo]: precision === 0 ? '2.0000' : '2.' + '1'.repeat(precision) + '000' }, unidad);
    assert.throws(() => validarValoresEnDestino({ ...valores, [campo]: '2.' + '0'.repeat(precision) + '1' }, unidad));
  }
  assert.throws(() => validarValoresEnDestino({ ...valores, precio_venta: '1.001' }, 'kg'));
  assert.throws(() => validarValoresEnDestino({ ...valores, costo_actual: '1.00001' }, 'kg'));
});
test('destino cambiado invalida preview y confirmación, ignora respuesta anterior', async () => {
  let finish; const sent = [];
  const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, uuid: () => uuid,
    preview: async (s, d) => d === 'unidad' ? new Promise(resolve => { finish = resolve; }) : preview('kg', d), commit: async a => { sent.push(a); return receipt(a); } });
  c.seleccionarDestino('unidad'); const old = c.cargar();
  c.seleccionarDestino('g'); await c.cargar(); finish(preview()); await old;
  assert.equal(c.getState().preview.unidadDestino, 'g'); c.confirmar(true);
  c.seleccionarDestino('cm'); assert.equal(c.getState().confirmado, false); assert.equal(c.getState().preview, undefined);
  await c.guardar(); assert.equal(sent.length, 0); await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(sent[0].destino, 'cm');
});
test('rechaza revisión ausente, numérica, negativa o no canónica; recibo requiere +1 exacto', async () => {
  for (const revision of [undefined, null, 0, -1, '-1', '01', '1.0', '1e3', '']) assert.throws(() => validarPreview({ ...preview(), revision }, scope, 'unidad'));
  for (const revision of ['0', '2', '01', 1, undefined, '9007199254740993']) {
    const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: { ...receipt(intento()), revision }, error: null }) });
    await assert.rejects(a.commit(intento()));
  }
  const p = preview('kg', 'unidad', '9007199254740993');
  const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: receipt(intento(p)), error: null }) });
  assert.equal((await a.commit(intento(p))).revision, '9007199254740994');
});
test('journal v2 almacena origen, destino y revisión; v1 huérfano bloquea sin borrar', async () => {
  const storage = memory(); const persistence = store(storage);
  persistence.guardar(intento()); assert.equal(JSON.parse(storage.getItem(persistence.key)).schema, 2);
  assert.equal(persistence.leer().intento.preview.revision, '0');
  for (const legacy of ['{', JSON.stringify({ schema: 1, intento: { destino: 'kg' } })]) {
    storage.setItem(persistence.legacyKey, legacy);
    assert.equal(persistence.tienePendiente(), true); assert.throws(() => persistence.leer()); assert.throws(() => persistence.guardar(intento())); assert.throws(() => persistence.resolver());
    let rpc = 0;
    const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, persistencia: persistence, preview: async () => { rpc++; return preview(); }, commit: async a => { rpc++; return receipt(a); } });
    assert.equal(c.getState().fase, 'invalidated'); c.seleccionarDestino('g'); await c.cargar(); await c.guardar(); await c.reintentar();
    assert.equal(rpc, 0); assert.equal(storage.getItem(persistence.legacyKey), legacy); assert.notEqual(storage.getItem(persistence.key), null);
  }
});
test('rechaza journals v2 con destino/revisión/payload inválidos sin borrarlos', () => {
  for (const patch of [{ destino: 'g' }, { preview: { ...preview(), revision: 0 } }, { preview: { ...preview(), unidad: 'unidad' } }, { confirmacion: 'otra' }]) {
    const storage = memory(), persistence = store(storage); persistence.guardar(intento());
    const record = JSON.parse(storage.getItem(persistence.key)); record.intento = { ...record.intento, ...patch };
    const raw = JSON.stringify(record); storage.setItem(persistence.key, raw); assert.throws(() => persistence.leer()); assert.equal(storage.getItem(persistence.key), raw);
  }
});
test('correcciones sucesivas tras éxito usan snapshot/revisión/request nuevos sin historial', async () => {
  const storage = memory(); let unidad = 'unidad'; let revision = '0'; let id = 0; const sent = [];
  for (const destino of ['kg', 'unidad', 'g', 'l']) {
    const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, persistencia: store(storage), uuid: () => `12345678-1234-4123-8123-${String(++id).padStart(12, '0')}`,
      preview: async (s, d) => preview(unidad, d, revision), commit: async a => { sent.push(a); const r = receipt(a); unidad = r.unidad; revision = r.revision; return r; } });
    c.seleccionarDestino(destino); await c.cargar(); c.confirmar(true); await c.guardar(); assert.equal(c.getState().fase, 'success'); assert.equal(store(storage).leer(), null);
  }
  assert.equal(new Set(sent.map(a => a.requestId)).size, 4); assert.deepEqual(sent.map(a => a.preview.revision), ['0', '1', '2', '3']); assert.equal(revision, '4');
});
test('declaración destino es literal; historia y precisión vuelven error claro sin commit', async () => {
  assert.equal(DECLARACION_SERVIDOR, 'CONFIRMO_CARGA_INICIAL_SIN_MOVIMIENTOS_Y_VALORES_YA_EN_UNIDAD_DESTINO');
  for (const code of ['UNIT_CHANGE_REQUIRES_HISTORY_REVIEW', 'UNIT_INVALID', 'UNIT_UNCHANGED', 'PRODUCT_VALUE_NOT_REPRESENTABLE']) {
    const a = crearAdaptadorCorreccionUnidadInicial({ rpc: async () => ({ data: null, error: { code: 'P0001', message: code } }) });
    await assert.rejects(a.preview(scope, 'unidad'), error => error.name === 'Error' && error.message !== code);
    assert.equal((await a.commit(intento())).estado, 'rechazado');
  }
});
test('cambio de usuario invalida contexto sin enviar ni borrar intento', async () => {
  const storage = memory(); store(storage).guardar(intento()); let usuarioId = 'u'; let calls = 0;
  const c = prepararCorreccionUnidadInicial({ cliente: { rpc: async () => { calls++; throw Error('no debe enviar'); } }, sessionStorage: storage, usuarioId: 'u', alcance: scope, contextoActual: () => ({ ...scope, usuarioId }) });
  usuarioId = 'otro'; await c.reintentar(); assert.equal(c.getState().fase, 'invalidated'); assert.equal(calls, 0); assert.notEqual(store(storage).leer(), null);
});
test('SigoApp captura revisión al abrir y conserva recuperación desde cualquier unidad', async () => {
  const source = await readFile(new URL('../src/SigoApp.tsx', import.meta.url), 'utf8');
  assert.match(source, /listarRevisionesUnidadProductoSigo\(empresaId\)/);
  assert.match(source, /setUnidadRevisionEdicion\(revisionesProducto\[producto.id\] \?\? null\)/);
  assert.match(source, /unidadRevision: editing \? unidadRevisionEdicion : null/);
  assert.match(source, /Object.hasOwn\(UNIDADES_VENTA, unidadesProducto\[p.id\] \?\? ""\) \|\| correccion.pendiente\(p.id\)/);
  assert.match(source, /Corregir unidad de carga inicial/);
  const guardar = source.slice(source.indexOf('  async function guardar(event:'), source.indexOf('  async function eliminar(producto:'));
  assert.doesNotMatch(guardar, /revisionesProducto\[|listarRevisionesUnidadProductoSigo/);
});
