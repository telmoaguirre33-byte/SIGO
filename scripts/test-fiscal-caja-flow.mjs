import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid' });
for (const k of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','CustomEvent','sessionStorage']) globalThis[k] = dom.window[k];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react'); const { act } = React; const { createRoot } = await import('react-dom/client');
const E = '11111111-1111-4111-8111-111111111111', V = '22222222-2222-4222-8222-222222222222';
const receipt = { punto_venta: 1, tipo_cbte: 11, numero_cbte: 42, cae: '12345678901234', cae_vencimiento: '2026-10-31', ventaNumero: 99, total: 10, fecha: '2026-10-21', ambiente: 'produccion', receptorDocTipo: 99, receptorDocumento: '0', emisorCuit: '30000000007', emisorRazonSocial: 'SINTÉTICO', items: [{ nombre: 'Queso prueba', cantidad: .5, precio_unitario: 20, subtotal: 10 }] };
const product = { id: 'p1', empresa_id: E, nombre: 'Producto sintético', codigo_barras: 'SYNTHETIC', codigo_interno: 'SYNTHETIC', precio_venta: 10, stock_actual: 50, activo: true, unidad_medida: 'unidad' };
let state;
function reset(extra = {}) { sessionStorage.clear(); state = { row: null, fiscalPosts: 0, fiscalGets: 0, prints: [], common: [], confirms: [], events: [], queryLog: [], fail: false, ...extra }; globalThis.__m = { product, query, print: (...a) => { state.prints.push(a); if(state.printFailure){state.printFailure=false;throw new Error('Impresión bloqueada por el navegador; el CAE está guardado.');} }, common: (...a) => { state.common.push(a); }, confirm: async a => { state.confirms.push(a); await new Promise(r => setTimeout(r, 15)); return { ventaId: V, verificacion: Promise.resolve({ totalVerificado: 10, integridad: 'ok' }) }; } }; }
function query(table) {
  const filters = {}; let range;
  const obj = new Proxy({}, { get(_t, k) {
    if (k === 'then') return (resolve, reject) => Promise.resolve().then(() => {
      state.queryLog.push({ table, filters: { ...filters }, range });
      let data;
      if (table === 'ventas_sigo') data = range ? [{ id: V, numero: 99, total: 10, created_at: '2026-10-21T12:00:00Z' }] : { id: V, numero: 99, total: 10, cliente_id: null };
      if (table === 'arca_config') data = { ambiente: 'produccion', activo: true, ultima_prueba_ok: true };
      if (table === 'arca_puntos_venta') data = [{ numero: 1, ambiente: 'produccion' }];
      if (table === 'arca_comprobantes') data = state.row;
      return { data, error: null };
    }).then(resolve, reject);
    return (...a) => { if (k === 'eq') filters[a[0]] = a[1]; if (k === 'range') range = a; return obj; };
  } }); return obj;
}
globalThis.fetch = async (_url, init = {}) => {
  if (String(_url).startsWith('/api/arca/impresion')) return new Response(JSON.stringify({ config: state.missingPrintConfig ? null : { domicilio:'Calle sintética123', condicion_iva:'RESPONSABLE MONOTRIBUTO', ingresos_brutos:'No contribuyente',inicio_actividades:'2020-01-01',excepcion_inicio:null }, puedeConfigurar: state.admin !== false, identidad: {cuit_emisor:'30000000007',razon_social:'SINTÉTICO'} }));
  if (init.method === 'POST') { state.fiscalPosts++; await new Promise(r => setTimeout(r, 15)); if (state.fail) return new Response(JSON.stringify({ error: 'ARCA_TIMEOUT' }), { status: 504 }); state.row = { cae: receipt.cae, punto_venta: 1, tipo_cbte: 11 }; return new Response(JSON.stringify({ comprobanteImprimible: receipt })); }
  state.fiscalGets++; return new Response(JSON.stringify({ comprobante: receipt }));
};
window.addEventListener('sigo:fiscal:caja', e => state.events.push(e.detail));
const mocks = {
  './supabase': 'export const supabase={from:(t)=>globalThis.__m.query(t),auth:{getSession:async()=>({data:{session:{access_token:"synthetic-token"}}})}};',
  './ticketFiscal': 'export const imprimirTicketFiscal=async(...a)=>globalThis.__m.print(...a);',
  './ticketVenta': 'export const imprimirTicketVenta=async(...a)=>globalThis.__m.common(...a);',
  './BarcodeScanner': 'import React from "react"; export default function Scanner(p){return React.createElement("button",{id:"synthetic-add",onClick:()=>p.onProduct(globalThis.__m.product)},"Add synthetic");}',
  './clientes': 'export const listarClientesSigo=async()=>[];',
  './productos': 'export const listarProductosSigo=async()=>[globalThis.__m.product];export const listarUnidadesProductoSigo=async()=>({[globalThis.__m.product.id]:globalThis.__m.product.unidad_medida});export const guardarProductoSigo=async()=>{};',
  './ofertasProductos': 'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;export const precioConOferta=(n)=>n;',
  './ventas': 'export class VentaRechazadaSinCambiosError extends Error {} export const confirmarVentaSigo=async(a)=>globalThis.__m.confirm(a); export const listarVentasRecientesSigo=async()=>[];',
};
await build({ stdin: { contents: 'export { default as Flow } from "./src/FiscalCajaFlow"; export { default as POS } from "./src/VentaRapidaOperativa"; export { emitirFiscalCaja, prepararFiscalCaja } from "./src/fiscalCaja";', resolveDir: process.cwd(), loader: 'tsx' }, outfile: '.test-build/fiscal-flow.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react','react-dom','react/jsx-runtime'], plugins: [{ name: 'synthetic-services', setup(b) { b.onResolve({ filter: /^\.\// }, a => mocks[a.path] ? { path: a.path, namespace: 'synthetic' } : null); b.onLoad({ filter: /.*/, namespace: 'synthetic' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() })); } }] });
const { Flow, POS, emitirFiscalCaja, prepararFiscalCaja } = await import(pathToFileURL(process.cwd() + '/.test-build/fiscal-flow.mjs'));
let root;
async function mount(Component, props, strict = false) { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); await act(async () => { const el = React.createElement(Component, props); root.render(strict ? React.createElement(React.StrictMode, {}, el) : el); await new Promise(r => setTimeout(r, 50)); }); await settle(); }
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 70)); }); }
async function unmount() { await act(async () => root.unmount()); }
const request = (accion = 'emitir', id = V) => ({ empresaId: E, ventaId: id, accion, requestId: crypto.randomUUID() });
async function click(id) { await act(async () => document.querySelector(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))); }
async function keys(...keys) { await act(async () => { for (const key of keys) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); await settle(); }
reset();
await mount(Flow, { solicitud: request(), alCerrar() {} }, true);
assert.equal(state.fiscalPosts, 1); assert.equal(state.prints.length, 1); assert.equal(state.fiscalGets, 0); assert.equal(state.prints[0][1], '58');
assert.ok(state.queryLog.filter(q => ['ventas_sigo','arca_comprobantes'].includes(q.table)).every(q => q.filters.empresa_id === E && (q.filters.id === V || q.filters.venta_id === V)));
await unmount(); console.log('PASS: StrictMode F11 emits once, uses exact sale+tenant, prints once in58mm without confirmation');
reset({ row: { cae: receipt.cae, punto_venta: 1, tipo_cbte: 11 } }); await mount(Flow, { solicitud: request('reimprimir'), alCerrar() {} });
assert.equal(state.fiscalPosts, 0); assert.equal(state.fiscalGets, 1); assert.equal(state.prints.length, 1); await unmount(); console.log('PASS: F12 existing fiscal reload reads original with zero CAE writes');
reset(); await mount(Flow, { solicitud: request('reimprimir'), alCerrar() {} }); assert.equal(state.fiscalPosts, 0); assert.equal(state.common.length, 1); assert.equal(state.prints.length, 0); await unmount(); console.log('PASS: F12 no fiscal record prints common receipt without claiming fiscal');
reset({ fail: true }); await mount(Flow, { solicitud: request(), alCerrar() {} }, true); assert.equal(state.fiscalPosts, 1); assert.equal(state.prints.length, 0); assert.match(document.body.textContent, /no respondió/); await settle(); assert.equal(state.fiscalPosts, 1); await unmount();
// Same tab reload retains only a pointer to the uncertain attempt, not authorization to repeat it.
await mount(Flow, { solicitud: request(), alCerrar() {} }, true); assert.equal(state.fiscalPosts, 1); assert.equal(state.prints.length, 0); assert.match(document.body.textContent, /intento fiscal anterior/); await unmount(); console.log('PASS: timeout and reload never automatically retry CAE or print');
reset(); await mount(Flow, { solicitud: request('historial', null), alCerrar() {} }, true); assert.equal(state.fiscalPosts, 0); assert.equal(state.prints.length, 0); assert.equal(state.common.length, 0); await unmount(); console.log('PASS: opening history does not emit or print');
reset(); const p = await prepararFiscalCaja(E, V); const [a,b] = await Promise.all([emitirFiscalCaja(E,p,1), emitirFiscalCaja(E,p,1)]); assert.equal(state.fiscalPosts,1); assert.deepEqual(a,b); console.log('PASS: simultaneous client calls share one emission request');
for (const key of ['F9','F10','F11']) { reset(); await mount(POS, { empresaId: E }); await click('#synthetic-add'); await keys(key,key,key); assert.equal(state.confirms.length,1,key+' must confirm once'); assert.equal(state.common.length,key==='F10'?1:0); assert.equal(state.events.length,key==='F11'?1:0); if(key==='F11'){assert.equal(state.events[0].ventaId,V);assert.equal(state.events[0].accion,'emitir');} await unmount(); }
console.log('PASS: triple F9/F10/F11 each confirms sale once; F9 no print/F10 common/F11 fiscal intent');
reset(); sessionStorage.setItem('sigo:ultima-venta:'+E,V); await mount(POS,{empresaId:E}); await keys('F12'); assert.equal(state.confirms.length,0); assert.equal(state.events[0].ventaId,V); assert.equal(state.events[0].accion,'reimprimir'); await unmount();
reset(); await mount(POS,{empresaId:E}); await keys('F12'); assert.equal(state.events[0].accion,'historial'); assert.equal(state.confirms.length,0); await unmount();
console.log('PASS: F12 reload restores last sale; empty session opens history without another sale');

for (const admin of [true,false]) { reset({missingPrintConfig:true,admin}); await mount(Flow,{solicitud:request(),alCerrar(){}},true); assert.equal(state.fiscalPosts,0);assert.equal(state.prints.length,0);assert.match(document.body.textContent,/Completar impresión fiscal/);if(!admin)assert.match(document.body.textContent,/Un administrador/);await unmount(); }
console.log('PASS: incomplete fiscal print configuration never emits; initial setup reserved for admin');

reset({printFailure:true});await mount(Flow,{solicitud:request(),alCerrar(){}},true);assert.equal(state.fiscalPosts,1);assert.equal(state.prints.length,1);assert.match(document.body.textContent,/Impresión bloqueada/);
await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Reimprimir fiscal 58 mm').click()); await settle();assert.equal(state.fiscalPosts,1);assert.equal(state.prints.length,2);await unmount();console.log('PASS: blocked print preserves receipt and explicit retry never asks for another CAE');

reset({fail:true});await mount(Flow,{solicitud:request(),alCerrar(){}},true);await unmount();await mount(Flow,{solicitud:request('reimprimir'),alCerrar(){}},true);assert.equal(state.fiscalPosts,1);assert.equal(state.common.length,0);assert.equal(state.prints.length,0);assert.match(document.body.textContent,/intento fiscal anterior/);await unmount();console.log('PASS: F12 does not substitute a common ticket while fiscal attempt is still unverified');
reset();await mount(POS,{empresaId:E});await click('#synthetic-add');await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',repeat:true,bubbles:true})));await settle();assert.equal(state.confirms.length,0);await unmount();console.log('PASS: held F11 repeat event never confirms a sale');
reset();let closeCount=0,notice='';window.addEventListener('sigo:fiscal:estado',e=>notice=e.detail.mensaje,{once:true});await mount(Flow,{solicitud:request(),alCerrar(){closeCount++;}},true);await act(async()=>state.prints[0][2]());assert.equal(closeCount,1);assert.equal(state.fiscalPosts,1);assert.match(notice,/Factura autorizada; F12/);assert.doesNotMatch(notice,/impreso/i);await unmount();console.log('PASS: afterprint/cancel returns to caja with authorized receipt, never claims physical printing');
