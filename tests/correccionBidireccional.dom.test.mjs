import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.env.SIGO_TEST_DEPS || import.meta.url);
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');
const React = require('react'); const { act } = React;
let Host;
async function loadHost() {
  if (Host) return Host;
  const result = await build({ stdin: { contents: `import React from 'react'; import { useCorreccionUnidadInicial } from './useCorreccionUnidadInicial'; import Dialog from './DialogoCorreccionUnidadInicial'; import { esUnidadSoportada } from './correccionUnidadInicial'; export default function Host({ config, unit }) { const c = useCorreccionUnidadInicial(config); return <>{(esUnidadSoportada(unit) || c.pendiente('p')) && <button disabled={Boolean(c.controller)} onClick={() => c.abrir('p')}>{c.pendiente('p') ? 'Recuperar corrección pendiente' : 'Corregir unidad de carga inicial'}</button>}{c.error && <p role='alert'>{c.error}</p>}{c.controller && <Dialog controller={c.controller} onClose={c.cerrar}/>}</>; }`, resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'tsx' }, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', write: false });
  const code = result.outputFiles[0].text.replace(/from "(react(?:\/[a-z-]+)?)"/g, (_, specifier) => `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`);
  Host = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return Host;
}
async function mounted(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/' });
  const prev = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  // Cargar ReactDOM después del DOM evita activar su fallback IE para inputs.
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try { await run({ root, dom, Host: await loadHost() }); }
  finally { await act(async () => root.unmount()); dom.window.close(); globalThis.window = prev.window; globalThis.document = prev.document; globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act; }
}
const valores = { stock_actual: '12.000', stock_minimo: '0.000', stock_maximo: null, precio_venta: '50.00', costo_actual: '40.0000', costo_ultima_compra: '39.1234' };
const preview = (destino = 'kg', origen = 'unidad', revision = '0') => ({ empresaId: 'e', productoId: 'p', nombre: 'Producto', unidad: origen, unidadDestino: destino, revision, elegible: true, snapshot: `${origen}:${destino}:${revision}`, valores });
const receipt = (args, revision = '1') => ({ empresaId: 'e', productoId: 'p', requestId: args.p_request_id, snapshot: args.p_snapshot, unidad: args.p_unidad_destino, revision, valores });
const buttons = () => [...document.querySelectorAll('button')];
const click = async text => act(async () => { const btn = buttons().find(b => b.textContent.includes(text)); assert.ok(btn, `botón ${text}`); btn.click(); });
const select = async (dom, value) => act(async () => { const el = document.querySelector('select'); el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
const confirm = async () => act(async () => document.querySelector('input[type=checkbox]').click());
const config = (dom, rpc, rest = {}) => ({ empresaId: 'e', usuarioId: 'u', permitido: true, storage: () => dom.window.sessionStorage, onUpdated: () => {}, onBlocked: () => {}, cliente: { rpc }, ...rest });

test('DOM elige destino antes de preview, muestra seis valores sin editar y admite repetir ida/vuelta', async () => mounted(async ({ root, dom, Host }) => {
  const calls = [], blocks = []; let refresh = 0, unidad = 'unidad', revision = '0';
  const cfg = config(dom, async (name, args) => {
    calls.push([name, args]);
    if (name.startsWith('previsualizar')) return { data: preview(args.p_unidad_destino, unidad, revision), error: null };
    unidad = args.p_unidad_destino; revision = String(BigInt(revision) + 1n);
    return { data: receipt(args, revision), error: null };
  }, { onUpdated: () => refresh++, onBlocked: b => blocks.push(b) });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'unidad' })));
  for (const destination of ['kg', 'unidad']) {
    await click('Corregir unidad de carga inicial');
    assert.equal(document.querySelector('select').value, ''); assert.equal(document.querySelectorAll('dd').length, 0);
    assert.equal(buttons().find(b => b.textContent.includes('Verificar valores')).disabled, true);
    assert.equal(calls.length, refresh * 2);
    await select(dom, destination); assert.equal(calls.length, refresh * 2);
    await click('Verificar valores'); assert.equal(document.querySelectorAll('dd').length, 6);
    assert.equal(document.querySelectorAll('input').length, 1); assert.equal(document.querySelector('input').type, 'checkbox');
    assert.match(document.querySelector('label:last-of-type').textContent, new RegExp(`por ${destination}`));
    assert.equal(buttons().find(b => b.textContent.includes('Corregir solamente')).disabled, true);
    await confirm(); await click('Corregir solamente');
    assert.equal(dom.window.sessionStorage.length, 0); assert.match(document.querySelector('[role=status]').textContent, /No se modificó ninguno de los seis valores/);
    await click('Listo'); assert.equal(document.querySelector('dialog'), null);
  }
  assert.equal(refresh, 2); assert.deepEqual(blocks, [true, false, true, false]);
  assert.notEqual(calls[1][1].p_request_id, calls[3][1].p_request_id);
  assert.notEqual(calls[1][1].p_snapshot, calls[3][1].p_snapshot);
}));
test('DOM kg→unidad fraccionario informa bloqueo entero sin confirmación ni commit', async () => mounted(async ({ root, dom, Host }) => {
  const calls = [];
  const cfg = config(dom, async (name, args) => { calls.push([name, args]); return { data: { ...preview('unidad', 'kg'), valores: { ...valores, stock_actual: '1.250' } }, error: null }; });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'kg' })));
  await click('Corregir unidad'); await select(dom, 'unidad'); await click('Verificar valores');
  assert.match(document.querySelector('[role=alert]').textContent, /1\.250.*cantidades enteras/);
  assert.equal(document.querySelector('input'), null); assert.equal(calls.length, 1);
  assert.equal(buttons().some(b => b.textContent.includes('Corregir solamente')), false);
}));
test('DOM cambio destino descarta confirmación y no convierte; cierre/cancel sin enviar', async () => mounted(async ({ root, dom, Host }) => {
  let calls = 0;
  const cfg = config(dom, async (name, args) => { calls++; return { data: preview(args.p_unidad_destino), error: null }; });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'unidad' })));
  await click('Corregir unidad'); await select(dom, 'kg'); await click('Verificar valores'); await confirm();
  await select(dom, 'g'); assert.equal(document.querySelector('input'), null); assert.equal(document.querySelectorAll('dd').length, 0); assert.equal(calls, 1);
  await click('Verificar valores'); assert.equal(document.querySelector('input').checked, false); assert.equal(calls, 2);
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog'), null); assert.equal(calls, 2);
  await click('Corregir unidad'); assert.equal(document.querySelector('select').value, ''); assert.equal(calls, 2);
}));
test('DOM timeout bloquea cierre y destino; remount recupera journal v2 sin RPC automático', async () => mounted(async ({ root, dom, Host }) => {
  const calls = []; let fail = true;
  const cfg = config(dom, async (name, args) => {
    calls.push([name, args]); if (name.startsWith('previsualizar')) return { data: preview(args.p_unidad_destino), error: null };
    if (fail) throw Error('timeout'); return { data: receipt(args), error: null };
  });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'unidad', key: 'before' })));
  await click('Corregir unidad'); await select(dom, 'kg'); await click('Verificar valores'); await confirm(); await click('Corregir solamente');
  assert.equal(calls.length, 2); assert.equal(document.querySelector('select').disabled, true);
  assert.equal(buttons().find(b => b.textContent === 'Cerrar').disabled, true);
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.notEqual(document.querySelector('dialog'), null);
  const unload = new dom.window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'kg', key: 'after' })));
  await click('Recuperar corrección pendiente'); assert.equal(calls.length, 2); fail = false;
  await click('Recuperar resultado'); assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[2]);
  assert.equal(dom.window.sessionStorage.length, 0);
}));
test('DOM v1 huérfano aparece aun con unidad desconocida, bloquea sin borrar ni enviar', async () => mounted(async ({ root, dom, Host }) => {
  let calls = 0; const key = 'sigo:correccion-unidad-inicial:v1:u:e:p'; dom.window.sessionStorage.setItem(key, '{');
  const cfg = config(dom, async () => { calls++; throw Error('prohibido'); });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: null })));
  await click('Recuperar corrección pendiente'); assert.match(document.querySelector('[role=alert]').textContent, /versión anterior/);
  assert.equal(document.querySelector('select').disabled, true); assert.equal(calls, 0); assert.equal(dom.window.sessionStorage.getItem(key), '{');
  await click('Cerrar'); await click('Recuperar corrección pendiente'); assert.equal(calls, 0);
}));
test('DOM permiso revocado invalida antes de commit y RPC ausente da error claro', async () => mounted(async ({ root, dom, Host }) => {
  let calls = 0;
  const cfg = config(dom, async (name, args) => { calls++; return { data: preview(args.p_unidad_destino), error: null }; });
  await act(async () => root.render(React.createElement(Host, { config: cfg, unit: 'unidad' })));
  await click('Corregir unidad'); await select(dom, 'kg'); await click('Verificar valores');
  await act(async () => root.render(React.createElement(Host, { config: { ...cfg, permitido: false }, unit: 'unidad' })));
  assert.equal(document.querySelector('input'), null); assert.equal(calls, 1); assert.match(document.querySelector('[role=alert]').textContent, /Cambió la empresa/);
  await act(async () => root.render(React.createElement(Host, { key: 'missing', unit: 'kg', config: config(dom, async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } })) })));
  await click('Corregir unidad'); await select(dom, 'unidad'); await click('Verificar valores');
  assert.match(document.querySelector('[role=alert]').textContent, /todavía no está disponible/); assert.equal(document.querySelector('input'), null);
}));
test('DOM editor real de SigoApp conserva revisión capturada aunque catálogo cambie antes de guardar', async () => mounted(async ({ root, dom }) => {
  // Se monta el componente Productos real; sólo servicios/red y scanner se sustituyen.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/SigoApp.tsx', import.meta.url), 'utf8');
  const setup = source.slice(source.indexOf('type ProductoForm ='), source.indexOf('export default function SigoApp'));
  const start = source.indexOf('function Productos('); const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start > 0 && end > start);
  let unidad = 'kg', revision = '7'; const sent = [];
  const product = () => ({ id: 'p', empresa_id: 'e', nombre: 'Producto', precio_venta: 50, stock_actual: 12, stock_minimo: 0, stock_maximo: null, unidad_medida: unidad });
  globalThis.__sigoProductoTest = {
    supabase: { auth: { onAuthStateChange: () => ({ data: { listener: null, subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) }, rpc: async () => { throw Error('RPC corrección no autorizado en esta prueba'); } },
    listarProductosSigo: async () => [product()], listarRevisionesUnidadProductoSigo: async () => ({ p: { unidad_medida: unidad, unidad_revision: revision } }),
    guardarProductoSigo: async input => { sent.push(input); if (input.unidadRevision !== revision) throw Error('La unidad cambió: cerrá el editor y volvé a abrirlo.'); }, listarModulosEmpresa: async () => [], eliminarProductoSigo: async () => { throw Error('fuera de alcance'); },
  };
  const code = `import React, { useEffect, useMemo, useRef, useState } from 'react'; import { useCorreccionUnidadInicial } from './useCorreccionUnidadInicial'; import DialogoCorreccionUnidadInicial from './DialogoCorreccionUnidadInicial'; import { PRECISION_UNIDAD } from './correccionUnidadInicial'; const { supabase, listarProductosSigo, listarRevisionesUnidadProductoSigo, guardarProductoSigo, listarModulosEmpresa, eliminarProductoSigo } = globalThis.__sigoProductoTest; const UNIDADES_VENTA=Object.fromEntries(Object.entries(PRECISION_UNIDAD).map(([u,p])=>[u,{nombre:u,decimales:p}])); const cantidadEscaladaMedida = v => v; const pasoCantidadMedida = () => 1; const formatoStockMedida = String; const BarcodeScanner = () => null; class ProductoGuardadoSinVerificarError extends Error {} ${setup} ${source.slice(start, end)} export default Productos;`;
  const built = await build({ stdin: { contents: code, resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'tsx' }, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', write: false });
  const compiled = built.outputFiles[0].text.replace(/from "(react(?:\/[a-z-]+)?)"/g, (_, specifier) => `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`);
  const { default: Productos } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  try {
    await act(async () => root.render(React.createElement(Productos, { empresaId: 'e', puedeEditar: true, puedeCorregirUnidad: true, onCorreccionAbierta: () => {} })));
    await click('Editar'); assert.equal(document.querySelector('#producto-unidad-medida').value, 'kg');
    unidad = 'unidad'; revision = '9'; await click('Actualizar');
    assert.equal(document.querySelector('#producto-unidad-medida').value, 'kg');
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(sent.length, 1); assert.equal(sent[0].unidadRevision, '7'); assert.equal(sent[0].unidadMedida, 'kg');
    assert.match(document.querySelector('[role=alert]').textContent, /unidad cambió/);
    await click('Cancelar'); await click('Editar');
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(sent[1].unidadRevision, '9'); assert.equal(sent[1].unidadMedida, 'unidad');
  } finally { delete globalThis.__sigoProductoTest; }
}));
