import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
const { createRoot } = await import('react-dom/client');
const source = await readFile(new URL('../src/SigoApp.tsx', import.meta.url), 'utf8');
const component = source.slice(source.indexOf('function Productos('), source.indexOf('\nfunction Stock('));
const form = source.slice(source.indexOf('type ProductoForm'), source.indexOf('export default function SigoApp'));
// Componentes de producto, archivo, hook y diálogo reales. Sólo se sustituyen servicios y scanner.
const contents = `import React,{useState,useEffect,useMemo,useRef} from 'react';
import {avisoArchivo,configurarArchivoProducto,buscarProductoInventario} from './archivoProductos';
import {cantidadEscaladaMedida,formatoStockMedida,pasoCantidadMedida,UNIDADES_VENTA} from './ventaPorMedidas';
import {listarProductosSigo,listarRevisionesUnidadProductoSigo,guardarProductoSigo,ProductoGuardadoSinVerificarError} from './productos';
import {useCorreccionUnidadInicial} from './useCorreccionUnidadInicial';
import DialogoCorreccionUnidadInicial from './DialogoCorreccionUnidadInicial';
import ProductosArchivados from './ProductosArchivados';
import {supabase} from './supabase';
const listarModulosEmpresa=async()=>[];const BarcodeScanner=()=>null;const StockImportAssistant=()=>null;
${form}\n${component}\nexport default Productos;`;
const archivePath = new URL('../src/archivoProductos.ts', import.meta.url).pathname;
const plugins = [{ name: 'servicios-simulados', setup(b) {
  b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
  b.onResolve({ filter: /^\.\/productos$/ }, () => ({ path: 'products', namespace: 'services' }));
  b.onResolve({ filter: /^\.\/archivoProductos$/ }, () => ({ path: 'archive', namespace: 'services' }));
  b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'db', namespace: 'services' }));
  b.onLoad({ filter: /.*/, namespace: 'services' }, a => ({ contents: a.path === 'products'
    ? 'export const listarProductosSigo=(...a)=>globalThis.__archivoUi.list(...a);export const listarRevisionesUnidadProductoSigo=(...a)=>globalThis.__archivoUi.catalog(...a);export const guardarProductoSigo=(...a)=>globalThis.__archivoUi.save(...a);export class ProductoGuardadoSinVerificarError extends Error{};'
    : a.path === 'archive'
      ? `export {avisoArchivo,buscarProductoInventario} from ${JSON.stringify(archivePath)};export const configurarArchivoProducto=(...a)=>globalThis.__archivoUi.archive(...a);`
      : 'export const supabase={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getUser:async()=>({data:{user:{id:"u1"}},error:null})},rpc:(...a)=>globalThis.__archivoUi.rpc(...a)};', loader: 'js', resolveDir: new URL('../src', import.meta.url).pathname }));
} }];
async function compile(args) { const out = await build({ ...args, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins }); return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`); }
const { default: Productos } = await compile({ stdin: { contents, resolveDir: new URL('../src', import.meta.url).pathname, loader: 'tsx' } });
const { default: Panel } = await compile({ entryPoints: [new URL('../src/ProductosArchivados.tsx', import.meta.url).pathname] });
const { observarCambiosCatalogo, notificarCambioCatalogo } = await compile({ entryPoints: [archivePath] });
const props = (empresaId, onCorreccionAbierta) => ({ key: empresaId, empresaId, puedeEditar: true, puedeCorregirUnidad: true, onCorreccionAbierta });
const botones = host => [...host.querySelectorAll('button')];
const boton = (host, text) => botones(host).find(b => b.textContent === text);
async function click(button) { assert.ok(button, 'Debe existir el botón'); await act(async () => button.click()); }
async function fixture({ archive = async () => {}, confirm = true, rpc } = {}) {
  window.sessionStorage.clear();
  const calls = [], blocks = [];
  let items = [
    { id: 'p1', empresa_id: 'e1', nombre: 'Pulpa', stock_actual: 100, stock_minimo: 0, stock_maximo: null, unidad_medida: 'unidad', unidad_revision: '0', precio_venta: 13000, costo_actual: 11000, costo_ultima_compra: 11000, archivado_comercial: false },
    { id: 'archivado1', empresa_id: 'e1', nombre: 'Pulpa archivada', stock_actual: 25, unidad_medida: 'kg', unidad_revision: '3', precio_venta: 13000, archivado_comercial: true },
  ];
  const update = (id, patch) => { items = items.map(p => p.id === id ? { ...p, ...patch } : p); };
  globalThis.__archivoUi = {
    list: async (empresa, opts) => { calls.push(['list', empresa, opts]); return items.filter(p => p.empresa_id === empresa && (opts?.inventario || !p.archivado_comercial)); },
    catalog: async empresa => Object.fromEntries(items.filter(p => p.empresa_id === empresa).map(p => [p.id, { unidad_medida: p.unidad_medida, unidad_revision: p.unidad_revision }])),
    archive: async (...args) => { calls.push(['archive', ...args]); await archive(...args); update(args[1], { archivado_comercial: args[2] }); },
    save: async input => { calls.push(['save', input]); const current = items.find(p => p.id === input.productoId); if (current && input.unidadRevision !== current.unidad_revision) throw Error('La unidad cambió: cerrá el editor y volvé a abrirlo.'); },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]); if (rpc) return rpc(name, args);
      const p = items.find(p => p.id === args.p_producto_id);
      const values = Object.fromEntries(['stock_actual', 'stock_minimo', 'stock_maximo', 'precio_venta', 'costo_actual', 'costo_ultima_compra'].map(k => [k, p[k]]));
      if (name.startsWith('previsualizar')) return { error: null, data: { empresaId: p.empresa_id, productoId: p.id, nombre: p.nombre, unidad: p.unidad_medida, unidadDestino: args.p_unidad_destino, revision: p.unidad_revision, elegible: true, snapshot: `${p.unidad_revision}:${args.p_unidad_destino}`, valores: values } };
      const revision = String(BigInt(p.unidad_revision) + 1n); update(p.id, { unidad_medida: args.p_unidad_destino, unidad_revision: revision });
      return { error: null, data: { empresaId: p.empresa_id, productoId: p.id, requestId: args.p_request_id, snapshot: args.p_snapshot, unidad: args.p_unidad_destino, revision, valores: values } };
    },
  };
  window.confirm = text => { calls.push(['confirm', text]); return confirm; };
  const onBlocked = value => blocks.push(value);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(Productos, props('e1', onBlocked))));
  return { calls, blocks, host, root, update, props: empresa => props(empresa, onBlocked), button: () => boton(host, 'Dar de baja comercial'), close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('Stock100: permite confirmar archivo sin vaciar, retira catálogo tras verificar', async () => {
  const f = await fixture(); try { await click(f.button()); assert.match(f.calls.find(c => c[0] === 'confirm')[1], /stock.*se conservan/); assert.deepEqual(f.calls.find(c => c[0] === 'archive'), ['archive', 'e1', 'p1', true]); assert.equal(f.button(), undefined); assert.match(f.host.querySelector('[role=status]').textContent, /baja comercial verificada/); } finally { await f.close(); }
});
test('Cancelar archivo: no llama servidor y mantiene producto', async () => {
  const f = await fixture({ confirm: false }); try { await click(f.button()); assert.ok(f.button()); assert.equal(f.calls.some(c => c[0] === 'archive'), false); } finally { await f.close(); }
});
test('Resultado incierto: mantiene fila y error, no éxito', async () => {
  const f = await fixture({ archive: async () => { throw Error('Resultado no verificado'); } }); try { await click(f.button()); assert.ok(f.button()); assert.match(f.host.querySelector('[role=alert]').textContent, /no verificado/); assert.equal(f.host.querySelector('[role=status]'), null); } finally { await f.close(); }
});
test('Doble click pendiente: sólo una solicitud', async () => {
  let resolve; const f = await fixture({ archive: () => new Promise(r => resolve = r) }); try { const b = f.button(); await click(b); await click(b); assert.equal(f.calls.filter(c => c[0] === 'archive').length, 1); await act(async () => resolve()); } finally { await f.close(); }
});
test('Cambio empresa no muestra baja vieja en nueva empresa', async () => {
  let resolve; const f = await fixture({ archive: () => new Promise(r => resolve = r) }); try {
    await click(f.button()); globalThis.__archivoUi.list = async () => [{ id: 'p2', empresa_id: 'e2', nombre: 'Otra empresa', stock_actual: 1, unidad_medida: 'kg' }];
    await act(async () => f.root.render(React.createElement(Productos, f.props('e2')))); await act(async () => resolve()); assert.match(f.host.textContent, /Otra empresa/); assert.doesNotMatch(f.host.textContent, /baja comercial verificada/);
  } finally { await f.close(); }
});
test('Cambios catálogo: notificación local y otra pestaña filtran empresa y limpian listeners', () => {
  let n = 0; const stop = observarCambiosCatalogo('e1', () => n++); notificarCambioCatalogo('e2'); assert.equal(n, 0); notificarCambioCatalogo('e1'); assert.equal(n, 1);
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'sigo:catalogo-cambio', newValue: JSON.stringify({ empresaId: 'e1' }) })); assert.equal(n, 2); window.dispatchEvent(new window.Event('focus')); assert.equal(n, 3); stop(); notificarCambioCatalogo('e1'); assert.equal(n, 3);
});
test('Vista Archivados real: stock100 visible y reactivación conserva identidad y reporta busy', async () => {
  const calls = [], busy = []; globalThis.__archivoUi = { list: async (...a) => { calls.push(['list', ...a]); return [{ id: 'p1', empresa_id: 'e1', nombre: 'Pulpa archivada', archivado_comercial: true, stock_actual: 100, unidad_medida: 'kg' }]; }, archive: async (...a) => calls.push(['archive', ...a]) };
  window.confirm = () => true; const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let updated = 0;
  try { await act(async () => root.render(React.createElement(Panel, { empresaId: 'e1', puedeEditar: true, onUpdated: () => updated++, onBusy: value => busy.push(value) }))); assert.match(host.textContent, /100 kg/); await click(boton(host, 'Reactivar')); assert.deepEqual(calls.find(c => c[0] === 'archive'), ['archive', 'e1', 'p1', false]); assert.match(host.querySelector('[role=status]').textContent, /reactivación verificada/); assert.equal(updated, 1); assert.deepEqual(busy, [true, false]); assert.equal(host.querySelector('li'), null); } finally { await act(async () => root.unmount()); host.remove(); }
});
test('Corrección real abierta bloquea archivar y reactivar, y libera ambas acciones al cerrar', async () => {
  const f = await fixture(); try {
    await click(boton(f.host, 'Ver archivados')); assert.ok(boton(f.host, 'Reactivar'));
    await click(boton(f.host, 'Corregir unidad de carga inicial')); assert.ok(f.host.querySelector('dialog'));
    assert.equal(f.button().disabled, true); assert.equal(boton(f.host, 'Reactivar'), undefined); assert.equal(boton(f.host, 'Ocultar archivados').disabled, true); assert.equal(f.blocks.at(-1), true);
    await click(f.button()); assert.equal(f.calls.some(c => c[0] === 'archive'), false); assert.equal(f.calls.some(c => c[0] === 'rpc'), false);
    await click(boton(f.host, 'Cerrar')); assert.equal(f.host.querySelector('dialog'), null); assert.equal(f.button().disabled, false); assert.ok(boton(f.host, 'Reactivar')); assert.equal(f.blocks.at(-1), false);
  } finally { await f.close(); }
});
test('Baja en progreso bloquea nueva corrección y reactivación sin emitir RPC', async () => {
  let resolve; const f = await fixture({ archive: () => new Promise(r => resolve = r) }); try {
    await click(boton(f.host, 'Ver archivados')); await click(f.button());
    const correction = boton(f.host, 'Corregir unidad de carga inicial'); assert.equal(correction.disabled, true); assert.equal(boton(f.host, 'Reactivar'), undefined); assert.equal(f.blocks.at(-1), true);
    await click(correction); assert.equal(f.host.querySelector('dialog'), null); assert.equal(f.calls.some(c => c[0] === 'rpc'), false);
    await act(async () => resolve()); assert.equal(f.blocks.at(-1), false);
  } finally { await f.close(); }
});
test('Reactivación real en progreso bloquea corrección, archivo y navegación del host', async () => {
  let resolve; const f = await fixture({ archive: () => new Promise(r => resolve = r) }); try {
    await click(boton(f.host, 'Ver archivados')); await click(boton(f.host, 'Reactivar'));
    assert.equal(f.button().disabled, true); assert.equal(boton(f.host, 'Corregir unidad de carga inicial').disabled, true); assert.equal(boton(f.host, 'Ocultar archivados').disabled, true); assert.equal(f.blocks.at(-1), true);
    await click(f.button()); await click(boton(f.host, 'Corregir unidad de carga inicial')); assert.equal(f.calls.filter(c => c[0] === 'archive').length, 1); assert.equal(f.host.querySelector('dialog'), null);
    await act(async () => resolve()); assert.equal(f.blocks.at(-1), false); assert.match(f.host.textContent, /reactivación verificada/);
  } finally { await f.close(); }
});
test('Editor combinado mantiene revisión capturada aunque actualizar catálogo cambie unidad', async () => {
  const f = await fixture(); try {
    await click(boton(f.host, 'Editar')); assert.equal(f.button().disabled, true);
    f.update('p1', { unidad_medida: 'kg', unidad_revision: '9' }); await click(boton(f.host, 'Actualizar'));
    assert.equal(f.host.querySelector('#producto-unidad-medida').value, 'unidad');
    await act(async () => f.host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(f.calls.find(c => c[0] === 'save')[1].unidadRevision, '0'); assert.equal(f.calls.find(c => c[0] === 'save')[1].unidadMedida, 'unidad'); assert.match(f.host.querySelector('[role=alert]').textContent, /unidad cambió/);
    await click(boton(f.host, 'Cancelar')); await click(boton(f.host, 'Editar'));
    await act(async () => f.host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(f.calls.filter(c => c[0] === 'save')[1][1].unidadRevision, '9'); assert.equal(f.calls.filter(c => c[0] === 'save')[1][1].unidadMedida, 'kg');
  } finally { await f.close(); }
});
test('Circuito integrado: corregir unidad, archivar con stock y reactivar preserva identidad y seis valores', async () => {
  const f = await fixture(); try {
    const before = (await globalThis.__archivoUi.list('e1', { inventario: true })).find(p => p.id === 'p1');
    await click(boton(f.host, 'Corregir unidad de carga inicial'));
    await act(async () => { const select = f.host.querySelector('dialog select'); select.value = 'kg'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await click(boton(f.host, 'Verificar valores e historial'));
    await click(f.host.querySelector('dialog input[type=checkbox]'));
    await click(boton(f.host, 'Corregir solamente la unidad a kg'));
    assert.match(f.host.querySelector('dialog [role=status]').textContent, /Unidad corregida de unidad a kg/);
    assert.equal(f.blocks.at(-1), true); await click(boton(f.host, 'Listo')); assert.equal(f.blocks.at(-1), false);
    assert.equal(f.calls.filter(c => c[0] === 'rpc').length, 2); assert.equal(f.calls.filter(c => c[0] === 'rpc')[1][2].p_unidad_destino, 'kg');
    await click(f.button()); assert.equal(f.button(), undefined);
    await click(boton(f.host, 'Ver archivados'));
    const archivedRow = [...f.host.querySelectorAll('li')].find(li => li.querySelector('strong')?.textContent === 'Pulpa');
    assert.ok(archivedRow); assert.match(archivedRow.textContent, /100 kg/); await click(archivedRow.querySelector('button'));
    assert.ok(f.button());
    const after = (await globalThis.__archivoUi.list('e1', { inventario: true })).find(p => p.id === 'p1');
    assert.equal(after.id, before.id); assert.equal(after.unidad_medida, 'kg'); assert.equal(after.unidad_revision, '1'); assert.equal(after.archivado_comercial, false);
    for (const field of ['stock_actual', 'stock_minimo', 'stock_maximo', 'precio_venta', 'costo_actual', 'costo_ultima_compra']) assert.equal(after[field], before[field]);
    assert.deepEqual(f.calls.filter(c => c[0] === 'archive'), [['archive', 'e1', 'p1', true], ['archive', 'e1', 'p1', false]]);
  } finally { await f.close(); }
});
