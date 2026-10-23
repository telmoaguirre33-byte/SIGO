import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
const product={id:'p',empresa_id:'e',nombre:'Queso',precio_venta:100,stock_actual:10,activo:true,codigo_interno:'p'};
let unit='kg',calls=[],printed=0,failRecovery=true;
const real=new Set(['./ventaPorMedidas','./intentoCobro','./contencionMedidas']);
const stubs={
 './BarcodeScanner':`import React from 'react'; export default function Scanner(p){globalThis.__scan=p;return React.createElement('div',null,'scan')}`,
 './EditorCantidadMedida':`import React from 'react';export default function Editor(p){return React.createElement('button',{'data-add':'',onClick:()=>p.onConfirmar(.75)},'add')}`,
 './ticketVenta':`export const imprimirTicketVenta=(...a)=>globalThis.__print(...a);`,
 './barcode':`export const isLegacyDuplicateProduct=()=>false; export const normalizeBarcode=x=>x;`,
 './clientes':`export const listarClientesSigo=async()=>[];`,
 './productos':`export const listarProductosSigo=async()=>[globalThis.__product];export const listarUnidadesProductoSigo=async()=>({p:globalThis.__unit});export const guardarProductoSigo=async()=>{throw Error('Unexpected product write')};`,
 './ofertasProductos':`export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;`,
 './ventas':`export class VentaRechazadaSinCambiosError extends Error{};export const listarVentasRecientesSigo=async()=>[];export const confirmarVentaSigo=p=>globalThis.__sale(p);`,
};
const plugins=[{name:'fixtures',setup(b){
 b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^\.\//},a=>stubs[a.path]&&!real.has(a.path)?{path:a.path,namespace:'stub'}:undefined);
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
}}];
async function bundled(path){const r=await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const {default:Caja}=await bundled('../src/VentaRapidaOperativa.tsx');
const store=await bundled('../src/intentoCobro.ts');
const guard=await bundled('../src/contencionMedidas.ts');
const flush=()=>new Promise(r=>setTimeout(r,10));
test('contención: todas las medidas y desconocidas bloqueadas; unidad normal habilitada',()=>{
 for(const unidad of ['kg','g','m','l','ml','cm','m2','m3','docena','caja',null,undefined]) assert.equal(guard.bloqueaNuevaVentaMedida(true,[{unidad}]),true);
 assert.equal(guard.bloqueaNuevaVentaMedida(true,[{unidad:'unidad'}]),false);
 assert.equal(guard.bloqueaNuevaVentaMedida(false,[{unidad:'kg'}]),false);
});
test('DOM: sin autocobro, bloquea F9/F10/F11 nuevos por kg, conserva recuperación exacta y unidad',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});
 globalThis.__product=product;globalThis.__unit=unit;globalThis.__print=()=>{printed++;return Promise.resolve()};
 globalThis.__sale=async p=>{calls.push(JSON.parse(JSON.stringify(p)));if(failRecovery){failRecovery=false;throw Error('synthetic uncertain response')}return {ventaId:'v',verificacion:Promise.resolve({integridad:'ok',totalVerificado:75})}};
 let fiscal=0;window.addEventListener('sigo:arca:venta',()=>fiscal++);
 const {createRoot}=await import('react-dom/client');let root=createRoot(document.getElementById('root'));
 try{
 await act(async()=>{root.render(React.createElement(Caja,{empresaId:'e'}));await flush()});
 assert.equal(calls.length,0);assert.ok(document.querySelector('[data-contencion-medidas]'));
 await act(async()=>globalThis.__scan.onProduct(product));
 await act(async()=>document.querySelector('[data-add]').click());
 assert.equal(document.querySelector('.cobrar').disabled,true);
 for(const key of ['F9','F10','F11']) await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
 assert.equal(calls.length,0);assert.equal(sessionStorage.length,0);
 await act(async()=>root.unmount());
 const payload={empresaId:'e',medioPago:'efectivo',clienteId:null,descuentoPct:0,idempotencyKey:'original-key',items:[{productoId:'p',cantidad:.75,unidadMedida:'kg'}]};
 const pending=store.crearIntentoCobro(payload,75);store.guardarIntentoCobro(pending);
 const saved=sessionStorage.getItem(store.claveIntentoCobro('e'));
 root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(Caja,{empresaId:'e'}));await flush()});
 assert.equal(calls.length,0);assert.equal(sessionStorage.getItem(store.claveIntentoCobro('e')),saved);
 await act(async()=>{document.querySelector('[data-recuperar-cobro]').click();await flush()});
 assert.deepEqual(calls,[payload]);assert.equal(store.leerIntentoCobro('e').estado,'pendiente');assert.deepEqual(store.leerIntentoCobro('e').payload,payload);
 await act(async()=>await flush());assert.equal(calls.length,1);
 await act(async()=>{document.querySelector('[data-recuperar-cobro]').click();await flush()});
 assert.deepEqual(calls,[payload,payload]);assert.equal(printed,0);assert.equal(fiscal,0);
 assert.equal(store.leerIntentoCobro('e').estado,'confirmado');assert.deepEqual(store.leerIntentoCobro('e').payload,payload);
 await act(async()=>root.unmount());globalThis.__unit='unidad';
 root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(Caja,{empresaId:'e'}));await flush()});
 await act(async()=>globalThis.__scan.onProduct(product));assert.equal(document.querySelector('.cobrar').disabled,false);
 await act(async()=>{document.querySelector('.cobrar').click();await flush()});
 assert.equal(calls.length,3);assert.equal(calls[2].items[0].unidadMedida,'unidad');assert.equal(calls[2].items[0].cantidad,1);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
