import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

// The real POS and ventas.ts run against a strictly in-memory Supabase transaction.
// No user records, remote connections, ARCA, printers, browser processes or credentials.
const dom = new JSDOM('<html><body></body></html>', { url: 'https://cobro-synthetic.invalid' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'CustomEvent', 'sessionStorage']) globalThis[k] = dom.window[k];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = window.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST'); };
window.print = window.open = () => { throw new Error('EXTERNAL_ACTION_FORBIDDEN_IN_SYNTHETIC_TEST'); };
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const E = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const V = '22222222-2222-4222-8222-222222222222';
const product = empresa => ({ id: 'p-synthetic', empresa_id: empresa, nombre: 'Producto sintético', codigo_interno: 'SYNTHETIC', codigo_barras: 'SYNTHETIC', precio_venta: 20, stock_actual: 50, activo: true, unidad_medida: state?.unit ?? 'kg' });
let state;
const stateKey = (empresa, key) => `${empresa}:${key}`;
function reset(extra = {}) {
  sessionStorage.clear();
  state = { calls: [], committed: new Map(), commits: 0, prints: [], fiscal: [], reject: null, loseResponse: true, verificationFail: false, beforeResponse: null, ...extra };
  globalThis.__cobro = {
    products: empresa => [{ ...product(empresa), stock_actual: 50 - [...state.committed.values()].filter(r => r.empresa_id === empresa).reduce((s, r) => s + r.items[0].cantidad, 0) }],
    readProducts: async (empresa, signal) => { if (signal) state.signals?.push(signal); if (signal && state.stockWait) await state.stockWait; return structuredClone(globalThis.__cobro.products(empresa)); },
    query,
    rpc,
    signal: s => state.signals?.push(s),
    print: (...a) => state.prints.push(a),
  };
}
function query(table) {
  const filters = {}; let single = false;
  const q = new Proxy({}, { get(_t, name) {
    if (name === 'then') return (resolve, reject) => Promise.resolve().then(async () => {
      if (filters.idempotency_key && state.preflightWait) await state.preflightWait;
      if (single && state.readbackWait) await state.readbackWait;
      if (state.verificationFail && (single || table !== 'ventas_sigo')) throw new Error('Synthetic reconciliation read failed');
      const rows = [...state.committed.values()].filter(r => r.empresa_id === filters.empresa_id);
      let data = [];
      if (table === 'ventas_sigo') data = rows.filter(r => (!filters.id || r.id === filters.id) && (!filters.idempotency_key || r.idempotency_key === filters.idempotency_key));
      else if (table === 'venta_items_sigo') data = rows.filter(r => r.id === filters.venta_id).flatMap(r => r.items);
      else if (table === 'caja_movimientos_sigo') data = rows.map(r => ({ venta_id: r.id, medio_pago: r.medio_pago, importe: r.total }));
      else if (table !== 'cliente_movimientos_sigo') throw new Error(`Unexpected mocked table: ${table}`);
      if (state.hidePreflight && filters.idempotency_key) data = [];
      return { data: single ? data[0] ?? null : data, error: null };
    }).then(resolve, reject);
    return (...a) => { if (name === 'abortSignal') state.signals?.push(a[0]); if (name === 'eq') filters[a[0]] = a[1]; if (name === 'single' || name === 'maybeSingle') single = true; return q; };
  } });
  return q;
}
async function rpc(name, payload) {
  assert.equal(name, 'confirmar_venta_sigo_v2');
  state.calls.push(structuredClone(payload));
  const persisted = JSON.parse(sessionStorage.getItem('sigo:intento-cobro:' + payload.p_empresa_id));
  assert.equal(persisted.estado, 'pendiente', 'protection must be durable before the RPC');
  assert.equal(persisted.payload.idempotencyKey, payload.p_idempotency_key);
  if (state.reject) return { data: null, error: state.reject };
  const key = stateKey(payload.p_empresa_id, payload.p_idempotency_key);
  const fingerprint = JSON.stringify(payload);
  let row = state.committed.get(key);
  if (row && row.fingerprint !== fingerprint) return { data: null, error: { code: 'P0001', message: 'IDEMPOTENCY_CONFLICT' } };
  if (!row) {
    const items = payload.p_items.map(i => ({ ...i, precio_unitario: 20, subtotal: i.cantidad * 20 }));
    row = { id: state.commits ? `44444444-4444-4444-8444-${String(state.commits).padStart(12, '0')}` : V, empresa_id: payload.p_empresa_id, idempotency_key: payload.p_idempotency_key, fingerprint, items, numero: ++state.commits, total: items.reduce((s, i) => s + i.subtotal, 0), medio_pago: payload.p_medio_pago, cliente_id: payload.p_cliente_id, created_at: '2026-10-22T00:00:00Z' };
    state.committed.set(key, row);
  }
  if (state.beforeResponse) await state.beforeResponse;
  if (state.loseResponse) { state.loseResponse = false; throw new Error('Synthetic connection lost AFTER COMMIT'); }
  return { data: row.id, error: null };
}
for (const eventName of ['sigo:arca:venta', 'sigo:fiscal:caja']) window.addEventListener(eventName, event => state.fiscal.push({ eventName, detail: event.detail }));
const mocks = {
  './supabase': 'export const supabase={from:(t)=>globalThis.__cobro.query(t),rpc:(...a)=>{const q={abortSignal:(s)=>{globalThis.__cobro.signal?.(s);return q},then:(r,j)=>Promise.resolve().then(()=>globalThis.__cobro.rpc(...a)).then(r,j)};return q}};',
  './ticketVenta': 'export const imprimirTicketVenta=async(...a)=>globalThis.__cobro.print(...a);',
  './BarcodeScanner': 'import React from "react";export default function Scanner(p){return React.createElement("button",{id:"synthetic-add",onClick:()=>p.onProduct(globalThis.__cobro.products(p.empresaId)[0])},"Add synthetic");}',
  './clientes': 'export const listarClientesSigo=async()=>[];',
  './productos': 'export const listarProductosSigo=async(e,s)=>globalThis.__cobro.readProducts(e,s);export const listarUnidadesProductoSigo=async(e)=>Object.fromEntries(globalThis.__cobro.products(e).map(p=>[p.id,p.unidad_medida]));export const guardarProductoSigo=async()=>{throw new Error("Product write forbidden")};',
  './ofertasProductos': 'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;',
};
await build({ stdin: { contents: 'export { default as POS } from "./src/VentaRapidaOperativa";export * from "./src/intentoCobro";', resolveDir: process.cwd(), loader: 'tsx' }, outfile: '.test-build/cobro-recuperacion-flow.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'], plugins: [{ name: 'synthetic-services', setup(b) { b.onResolve({ filter: /^\.\// }, a => mocks[a.path] ? { path: a.path, namespace: 'synthetic' } : null); b.onLoad({ filter: /.*/, namespace: 'synthetic' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() })); } }] });
const { POS, crearIntentoCobro, guardarIntentoCobro, leerIntentoCobro, registrarCobroConfirmado, huellaPayloadCobro } = await import(pathToFileURL(process.cwd() + '/.test-build/cobro-recuperacion-flow.mjs'));
let root;
async function mount(empresa = E) { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); await act(async () => root.render(React.createElement(React.StrictMode, {}, React.createElement(POS, { empresaId: empresa })))); await settle(); }
async function rerender(empresa) { await act(async () => root.render(React.createElement(React.StrictMode, {}, React.createElement(POS, { empresaId: empresa })))); await settle(); }
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 25)); }); }
async function unmount() { await act(async () => root.unmount()); }
async function click(selector, count = 1) { await act(async () => { for (let i = 0; i < count; i++) document.querySelector(selector).click(); }); await settle(); }
async function keys(...values) { await act(async () => { for (const key of values) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); await settle(); }
async function addWeight(q = '750') {
  await click('#synthetic-add');
  const input = document.getElementById('sigo-cantidad-medida');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, q); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

for (const shortcut of ['F9', 'F10', 'F11']) {
  reset(); await mount(); await addWeight(); await keys(shortcut, shortcut);
  assert.equal(state.commits, 1); assert.equal(state.calls.length, 1);
  const original = structuredClone(state.calls[0]);
  assert.equal(original.p_items[0].cantidad, .75); assert.equal(original.p_items[0].unidad_medida, 'kg');
  assert.equal(leerIntentoCobro(E).estado, 'pendiente');
  assert.ok(document.querySelector('[data-recuperar-cobro]'));
  await keys('F1', 'F6', 'F9', 'F10', 'F11', 'F12');
  assert.equal(state.calls.length, 1); assert.equal(state.fiscal.length, 0); assert.equal(state.prints.length, 0);
  assert.equal(document.querySelector('.sigo-pos-payments button').disabled, true);
  assert.equal(document.querySelector('.sigo-pos-qty button').disabled, true);
  await unmount(); await mount();
  assert.equal(state.calls.length, 1, 'reload does not retry');
  assert.equal(document.querySelector('#synthetic-add'), null, 'new cart cannot replace uncertain attempt');
  await click('[data-recuperar-cobro]', 3);
  assert.equal(state.calls.length, 2, 'double recovery shares one in-flight request');
  assert.deepEqual(state.calls[1], original, 'same key and exact payload after reload');
  assert.equal(state.commits, 1); assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  assert.equal(leerIntentoCobro(E).estado, 'confirmado'); assert.equal(leerIntentoCobro(E).ventaId, V);
  await keys('F12'); assert.deepEqual(state.prints, [[E, V, '80', true]]); assert.equal(state.fiscal.length, 0);
  await keys('F11'); assert.deepEqual(state.fiscal, [{ eventName: 'sigo:arca:venta', detail: { empresaId: E, ventaId: V } }]); assert.equal(state.prints.length, 1);
  assert.equal(state.calls.length, 2);
  await addWeight('500'); await keys('F9');
  assert.equal(state.commits, 2); assert.notEqual(state.calls[2].p_idempotency_key, original.p_idempotency_key);
  assert.equal(state.calls[2].p_items[0].cantidad, .5);
  await unmount();
  console.log(`PASS: ${shortcut} lost response + reload + explicit recovery commits once, preserves kg and never resumes fiscal/print`);
}

reset(); await mount(); await addWeight(); await keys('F9'); const pendingE = sessionStorage.getItem('sigo:intento-cobro:' + E); await unmount();
await mount(OTHER); assert.equal(document.querySelector('[data-recuperar-cobro]'), null); await addWeight('250'); await keys('F9'); assert.equal(state.commits, 2); assert.equal(state.calls[1].p_empresa_id, OTHER); assert.equal(sessionStorage.getItem('sigo:intento-cobro:' + E), pendingE); await unmount();
await mount(E); await click('[data-recuperar-cobro]'); assert.equal(state.commits, 2); assert.equal(state.calls[2].p_empresa_id, E); assert.equal(state.calls[2].p_idempotency_key, state.calls[0].p_idempotency_key); await unmount();
console.log('PASS: separate companies never recover or overwrite each other’s attempt');

reset({ reject: { code: 'P0001', message: 'INSUFFICIENT_STOCK' } }); await mount(); await addWeight(); await keys('F9'); assert.equal(state.commits, 0); assert.equal(leerIntentoCobro(E).estado, 'rechazado'); assert.equal(document.querySelector('[data-recuperar-cobro]'), null); assert.equal(document.querySelector('.sigo-pos-qty button').disabled, false); const rejectedKey = state.calls[0].p_idempotency_key; state.reject = null; state.loseResponse = false; await keys('F9'); assert.equal(state.commits, 1); assert.notEqual(state.calls[1].p_idempotency_key, rejectedKey); await unmount();
console.log('PASS: known rollback on first attempt allows cart correction and a fresh key');

reset(); await mount(); await addWeight(); await keys('F9'); state.reject = { code: 'P0001', message: 'SALES_WRITE_FORBIDDEN' }; await click('[data-recuperar-cobro]'); assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'pendiente'); assert.ok(document.querySelector('[data-recuperar-cobro]')); state.reject = null; await click('[data-recuperar-cobro]'); assert.equal(state.commits, 1); await unmount();
console.log('PASS: rollback during recovery never erases a prior uncertain commit');

reset({ loseResponse: false, verificationFail: true }); await mount(); await addWeight(); await keys('F9'); assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'confirmado'); assert.equal(document.querySelector('[data-recuperar-cobro]'), null); await unmount(); sessionStorage.removeItem('sigo:ultima-venta:' + E); await mount(); await keys('F12'); assert.equal(state.calls.length, 1); assert.deepEqual(state.prints, [[E, V, '80', true]]); assert.equal(state.fiscal.length, 0); await unmount();
console.log('PASS: confirmed UUID survives reconciliation failures and missing optional last-ticket pointer');

reset(); let release; state.beforeResponse = new Promise(r => { release = r; }); state.loseResponse = false;
await mount(); await addWeight(); await keys('F9'); await rerender(OTHER); release(); await settle(); assert.equal(leerIntentoCobro(E).estado, 'confirmado'); assert.equal(leerIntentoCobro(OTHER), null); assert.equal(document.querySelector('.sigo-pos-payments button').disabled, false); await rerender(E); await keys('F12'); assert.deepEqual(state.prints, [[E, V, '80', true]]); assert.equal(state.fiscal.length, 0); assert.equal(state.commits, 1); await unmount();
console.log('PASS: in-flight company switch persists original result without leaving another company busy');

reset(); const payload = { empresaId: E, medioPago: 'efectivo', clienteId: null, descuentoPct: 0, idempotencyKey: 'synthetic-immutable-key', items: [{ productoId: 'p-synthetic', cantidad: .75, unidadMedida: 'kg' }] };
const attempt = crearIntentoCobro(payload, 15); guardarIntentoCobro(attempt); payload.items[0].cantidad = 1; assert.equal(attempt.payload.items[0].cantidad, .75);
const changed = crearIntentoCobro({ ...attempt.payload, items: [{ ...attempt.payload.items[0], cantidad: 1 }] }, 20); assert.throws(() => guardarIntentoCobro(changed), /no se puede reutilizar/); assert.equal(leerIntentoCobro(E).payload.items[0].cantidad, .75);
sessionStorage.setItem('sigo:intento-cobro:' + E, JSON.stringify({ ...attempt, payload: { ...attempt.payload, medioPago: 'debito' } })); await mount(); await keys('F9', 'F11'); assert.equal(state.calls.length, 0); assert.match(document.body.textContent, /No se pudo leer el intento/); assert.equal(document.querySelector('#synthetic-add'), null); await unmount();
console.log('PASS: immutable snapshot rejects changed payload and malformed persisted data fails closed');

reset(); await mount(); await addWeight(); const storageProto = Object.getPrototypeOf(sessionStorage); const originalSet = storageProto.setItem; storageProto.setItem = function (key, value) { if (key.startsWith('sigo:intento-cobro:')) throw new Error('Synthetic quota failure'); return originalSet.call(this, key, value); };
await keys('F9'); assert.equal(state.calls.length, 0); assert.equal(state.commits, 0); assert.match(document.body.textContent, /No se envió un cobro nuevo/); storageProto.setItem = originalSet; await keys('F9'); assert.equal(state.calls.length, 1); assert.equal(state.commits, 1); await unmount();
console.log('PASS: session storage failure prevents a new charge from being sent');


reset(); await mount(); await addWeight(); await keys('F9'); await unmount();
const altered = leerIntentoCobro(E); altered.payload.items[0].cantidad = 1; altered.totalEsperado = 20; altered.huella = huellaPayloadCobro(altered.payload);
sessionStorage.setItem('sigo:intento-cobro:' + E, JSON.stringify(altered));
await mount(); await click('[data-recuperar-cobro]'); assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'pendiente'); assert.match(document.body.textContent, /datos distintos/); assert.equal(document.querySelector('#synthetic-add'), null); await unmount();
console.log('PASS: authoritative server fingerprint rejects altered same-key recovery without releasing the uncertain attempt');

reset({ loseResponse: false }); await mount(); await addWeight();
const proto = Object.getPrototypeOf(sessionStorage); const set = proto.setItem;
proto.setItem = function (key, value) { if (key.startsWith('sigo:intento-cobro:') && JSON.parse(value).estado === 'confirmado') throw new Error('Synthetic post-commit storage failure'); return set.call(this, key, value); };
await keys('F9'); assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'pendiente'); assert.ok(document.querySelector('[data-recuperar-cobro]')); await keys('F1', 'F9'); assert.equal(state.calls.length, 1);
proto.setItem = set; await click('[data-recuperar-cobro]'); assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'confirmado'); await unmount();
assert.throws(() => guardarIntentoCobro(crearIntentoCobro({ ...leerIntentoCobro(E).payload, items: [{ ...leerIntentoCobro(E).payload.items[0], cantidad: 1 }] }, 20)), /no se puede reutilizar/);
console.log('PASS: failure saving a confirmed result remains safely recoverable; resolved keys cannot be reused for a changed cart');


for (const shortcut of ['F10', 'F11']) {
  reset({ loseResponse: false }); let complete; state.beforeResponse = new Promise(r => { complete = r; });
  await mount(); await addWeight(); await keys(shortcut); assert.equal(state.commits, 1); await unmount(); complete(); await settle();
  assert.equal(leerIntentoCobro(E).estado, 'confirmado'); assert.equal(leerIntentoCobro(E).ventaId, V);
  assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  await mount(); assert.equal(state.calls.length, 1); assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  await keys('F12'); assert.deepEqual(state.prints, [[E, V, '80', true]]); assert.equal(state.fiscal.length, 0); await unmount();
  console.log(`PASS: late ${shortcut} result after navigation persists UUID but never emits/prints from an unmounted POS`);
}

// Control only operation deadlines; React/JSDOM timers and normal settling remain real.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const deadlines = new Map();
let deadlineId = 1000000;
globalThis.setTimeout = (fn, ms, ...args) => {
  if (ms === 12000 || ms === 25000) { const id = ++deadlineId; deadlines.set(id, { fn, ms }); return id; }
  return realSetTimeout(fn, ms, ...args);
};
globalThis.clearTimeout = id => { if (!deadlines.delete(id)) realClearTimeout(id); };
async function expire(ms) {
  const entry = [...deadlines].find(([, timer]) => timer.ms === ms);
  assert.ok(entry, `An active ${ms}ms deadline must exist`);
  deadlines.delete(entry[0]);
  await act(async () => entry[1].fn());
  await settle();
}
for (const field of ['preflightWait', 'stockWait']) {
  reset({ loseResponse: false, signals: [] });
  let release;
  await mount(); await addWeight();
  state[field] = new Promise(r => { release = r; });
  await keys('F9', 'F9');
  const original = leerIntentoCobro(E);
  assert.equal(original.fase, 'preparacion'); assert.equal(state.calls.length, 0);
  await expire(12000);
  assert.ok(state.signals.some(s => s.aborted), 'preflight request signal aborted');
  assert.equal(leerIntentoCobro(E).estado, 'pendiente');
  assert.match(document.body.textContent, /La preparación del cobro no pudo completarse/);
  assert.equal(document.querySelector('[data-recuperar-cobro]').disabled, false);
  release(); await settle();
  assert.equal(state.calls.length, 0, 'late preflight cannot start an invisible RPC');
  assert.equal(leerIntentoCobro(E).fase, 'preparacion');
  state[field] = null;
  await unmount(); await mount(); await click('[data-recuperar-cobro]', 3);
  assert.equal(state.calls.length, 1); assert.equal(state.commits, 1);
  assert.equal(state.calls[0].p_idempotency_key, original.payload.idempotencyKey);
  assert.equal(state.calls[0].p_items[0].cantidad, .75);
  assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  await unmount();
  console.log(`PASS: ${field} deadline aborts and releases UI; late completion cannot charge; reload recovers same key/snapshot`);
}
for (const shortcut of ['F9', 'F10', 'F11']) {
  reset({ loseResponse: false, signals: [] }); let release;
  state.beforeResponse = new Promise(r => { release = r; });
  await mount(); await addWeight(); await keys(shortcut, shortcut);
  assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).fase, 'enviado');
  const original = structuredClone(state.calls[0]);
  await expire(25000);
  assert.ok(state.signals.some(s => s.aborted), 'RPC signal aborted');
  assert.equal(leerIntentoCobro(E).estado, 'pendiente');
  assert.match(document.body.textContent, /resultado del cobro no está verificado/i);
  assert.throws(() => guardarIntentoCobro({ ...leerIntentoCobro(E), fase: 'preparacion' }), /resultado previo/);
  await keys('F9', 'F10', 'F11', 'F12'); assert.equal(state.calls.length, 1);
  release(); await settle();
  assert.equal(leerIntentoCobro(E).estado, 'pendiente', 'late UUID cannot mutate timed-out state');
  assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  state.beforeResponse = null;
  // Empty readback and a rollback of the retry do not disprove the prior commit.
  state.hidePreflight = true;
  state.reject = { code: 'P0001', message: 'INSUFFICIENT_STOCK' };
  await click('[data-recuperar-cobro]');
  assert.equal(leerIntentoCobro(E).estado, 'pendiente');
  state.reject = null;
  await click('[data-recuperar-cobro]', 2);
  assert.equal(state.commits, 1); assert.deepEqual(state.calls.at(-1), original);
  assert.equal(leerIntentoCobro(E).estado, 'confirmado');
  assert.equal(state.prints.length, 0); assert.equal(state.fiscal.length, 0);
  await unmount();
  console.log(`PASS: ${shortcut} post-commit deadline keeps uncertainty; late response inert; rollback cannot clear prior attempt; same-key recovery commits once`);
}
// A previous client version may have sent a record still labelled preparacion.
reset(); await mount(); await addWeight(); await keys('F9'); await unmount();
const mixedVersion = leerIntentoCobro(E);
mixedVersion.fase = 'preparacion';
sessionStorage.setItem('sigo:intento-cobro:' + E, JSON.stringify(mixedVersion));
let releaseMixed;
state.preflightWait = new Promise(r => { releaseMixed = r; });
await mount(); await click('[data-recuperar-cobro]'); await expire(12000);
assert.match(document.body.textContent, /resultado del cobro no está verificado/i);
assert.doesNotMatch(document.body.textContent, /No se llegó a enviar/);
assert.equal(leerIntentoCobro(E).estado, 'pendiente');
assert.equal(state.commits, 1);
releaseMixed(); await settle(); state.preflightWait = null;
await click('[data-recuperar-cobro]');
assert.equal(state.commits, 1); assert.equal(leerIntentoCobro(E).estado, 'confirmado');
await unmount();
console.log('PASS: mixed-version preparacion record never asserts that an older uncertain attempt was not sent');

reset({ loseResponse: false, signals: [] }); let releaseReadback;
state.readbackWait = new Promise(r => { releaseReadback = r; });
await mount(); await addWeight(); await keys('F9');
assert.equal(leerIntentoCobro(E).estado, 'confirmado');
await expire(12000); assert.match(document.body.textContent, /conciliación automática no pudo verificarse/);
releaseReadback(); await settle(); assert.equal(leerIntentoCobro(E).estado, 'confirmado');
await unmount();
console.log('PASS: confirmed UUID is durable while readback hangs; reconciliation deadline does not undo the charge');
for (const unit of ['l', 'm', 'unidad']) {
  reset({ unit }); await mount();
  if (unit === 'unidad') await click('#synthetic-add'); else await addWeight('0.75');
  await keys('F9');
  assert.equal(leerIntentoCobro(E).estado, 'pendiente');
  const original = structuredClone(state.calls[0]);
  await click('[data-recuperar-cobro]', 2);
  assert.deepEqual(state.calls[1], original);
  assert.equal(original.p_items[0].unidad_medida, unit);
  assert.equal(original.p_items[0].cantidad, unit === 'unidad' ? 1 : .75);
  assert.equal(state.commits, 1); assert.equal(state.prints.length + state.fiscal.length, 0);
  await unmount();
  console.log(`PASS: ${unit} exact base units and original key survive lost response and explicit recovery`);
}
globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
assert.equal(deadlines.size, 0, 'all deadline timers cleaned up');

dom.window.close();
console.log('All synthetic recovery checks passed. Browser/physical-printer QA is intentionally not claimed.');
