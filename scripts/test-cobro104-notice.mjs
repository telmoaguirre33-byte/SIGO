// Real POS + ventas.ts + React; services and commercial rows are in memory.
// Tests both the pinned production defect and the fixed candidate. No real payment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
const dom = new JSDOM('<html><body></body></html>', { url: 'https://notice-qa.invalid' });
for (const key of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','CustomEvent','sessionStorage']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = window.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
window.open = window.print = () => { throw Error('EXTERNAL_ACTION_FORBIDDEN'); };
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const E = '11111111-1111-4111-8111-111111111111';
const P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V = '22222222-2222-4222-8222-222222222222';
const baseline = process.env.COBRO104_NOTICE_BASELINE;
const results = [];
let state, root;
const product = e => ({id:P,empresa_id:e,nombre:'Aviso QA',codigo_interno:'QA',codigo_barras:'QA',precio_venta:20,stock_actual:100,activo:true,unidad_medida:'unidad'});
function reset(mode) { sessionStorage.clear();state={mode,rows:new Map(),calls:[],prints:[],fiscal:[],signals:[],release:null}; }
function query(table) {
  const filters={};let single=false;
  const q=new Proxy({}, {get(_target,name) {
    if(name==='then')return (resolve,reject)=>Promise.resolve().then(()=>{
      const rows=[...state.rows.values()].filter(r=>r.empresa_id===filters.empresa_id);
      let data=[];
      if(table==='ventas_sigo')data=rows.filter(r=>(!filters.id||r.id===filters.id)&&(!filters.idempotency_key||r.idempotency_key===filters.idempotency_key));
      else if(table==='venta_items_sigo')data=rows.filter(r=>r.id===filters.venta_id).flatMap(r=>r.items);
      else if(table==='caja_movimientos_sigo')data=rows.map(r=>({venta_id:r.id,importe:r.total,medio_pago:r.medio_pago}));
      else assert.equal(table,'cliente_movimientos_sigo');
      return {data:single?data[0]??null:data,error:null};
    }).then(resolve,reject);
    return (...args)=>{if(name==='eq')filters[args[0]]=args[1];if(name==='single'||name==='maybeSingle')single=true;return q;};
  }});
  return q;
}
async function rpc(name,payload) {
  assert.equal(name,'confirmar_venta_sigo_v2');state.calls.push(structuredClone(payload));
  const stored=JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+payload.p_empresa_id));
  assert.equal(stored.estado,'pendiente');assert.equal(stored.fase,'enviado');
  assert.equal(stored.payload.idempotencyKey,payload.p_idempotency_key);
  const key=payload.p_empresa_id+':'+payload.p_idempotency_key;
  let row=state.rows.get(key);
  if(row)assert.equal(row.fingerprint,JSON.stringify(payload),'Retry must preserve the entire original request');
  else {
    const items=payload.p_items.map(i=>({...i,precio_unitario:20,subtotal:i.cantidad*20}));
    row={id:state.rows.size?`22222222-2222-4222-8222-${String(state.rows.size+1).padStart(12,'0')}`:V,empresa_id:payload.p_empresa_id,idempotency_key:payload.p_idempotency_key,estado:'confirmada',numero:state.rows.size+1,items,total:items.reduce((sum,i)=>sum+i.subtotal,0),medio_pago:payload.p_medio_pago,cliente_id:payload.p_cliente_id,fingerprint:JSON.stringify(payload),created_at:'2026-10-25T00:00:00Z'};
    state.rows.set(key,row);
  }
  if(state.mode==='wait')await new Promise(resolve=>{state.release=resolve;});
  if(state.mode==='lost'){state.mode='ok';throw Error('Synthetic response lost after commit');}
  return {data:row.id,error:null};
}
globalThis.__noticeQA={product,query,rpc,print:(...a)=>state.prints.push(a),signal:s=>state.signals.push(s)};
window.addEventListener('sigo:arca:venta',e=>state.fiscal.push(e.detail));
const mocks={
  './supabase':'export const supabase={auth:{onAuthStateChange(cb){cb("INITIAL_SESSION",{user:{id:"qa-actor"}});return {data:{subscription:{unsubscribe(){}}}}}},from:t=>globalThis.__noticeQA.query(t),rpc:(...a)=>{const q={abortSignal(s){globalThis.__noticeQA.signal(s);return q},then(r,j){return Promise.resolve().then(()=>globalThis.__noticeQA.rpc(...a)).then(r,j)}};return q}};',
  './productos':`export const listarProductosSigo=async e=>[globalThis.__noticeQA.product(e)];export const listarUnidadesProductoSigo=async()=>({"${P}":"unidad"});export const guardarProductoSigo=async()=>{throw Error("NO_PRODUCT_WRITES")};`,
  './clientes':'export const listarClientesSigo=async()=>[];',
  './ofertasProductos':'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;',
  './ticketVenta':'export const imprimirTicketVenta=async(...a)=>globalThis.__noticeQA.print(...a);',
  './BarcodeScanner':'import React from "react";export default function Scanner(p){return <button id="notice-add" onClick={()=>p.onProduct(globalThis.__noticeQA.product(p.empresaId))}>Agregar</button>}',
};
const out=process.cwd()+'/.test-build/cobro104-notice.mjs';
await build({stdin:{contents:'export {default as POS} from "./src/VentaRapidaOperativa";',resolveDir:process.cwd(),loader:'tsx'},outfile:out,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],plugins:[{name:'isolated-boundaries',setup(b){
  if(baseline)b.onLoad({filter:/\/VentaRapidaOperativa\.tsx$/},async()=>({contents:await fs.readFile(baseline,'utf8'),loader:'tsx',resolveDir:process.cwd()+'/src'}));
  b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'qa'}:null);
  b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
}}]});
const {POS}=await import(pathToFileURL(out));
async function settle(ms=30){await act(async()=>{await new Promise(r=>setTimeout(r,ms));});}
async function mount(){document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(POS,{empresaId:E}))));await settle();}
async function unmount(){await act(async()=>root.unmount());}
async function click(selector){await act(async()=>document.querySelector(selector).click());await settle();}
async function key(value){await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})));await settle();}
const attempt=()=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+E));
function pass(name){results.push(name);console.log('PASS:',name);}

reset('wait');await mount();await click('#notice-add');await key('F9');
assert.equal(typeof state.release,'function');assert.equal(state.calls.length,1);
const progress=document.querySelector('[data-cobro-pendiente]');
assert.ok(progress);assert.match(progress.textContent,/Procesando el cobro/);
assert.equal(progress.getAttribute('role'),baseline?'alert':'status');
assert.equal(progress.classList.contains('form-error'),Boolean(baseline));
assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,true);
assert.equal(attempt().estado,'pendiente','Never declare confirmation before a valid ACK');
for(const shortcut of ['F9','F10','F11','F12'])await key(shortcut);
assert.equal(state.calls.length,1);assert.equal(state.rows.size,1);assert.equal(state.prints.length+state.fiscal.length,0);
pass(baseline?'Pinned production reproduces an error alert during a normal in-flight payment':'Normal in-flight payment is a status, not an error; repeat actions stay blocked');
await act(async()=>state.release());await settle();
assert.equal(attempt().estado,'confirmado');assert.equal(document.querySelector('[data-cobro-pendiente]'),null);
assert.equal(document.querySelector('.sigo-pos-success-inline')?.textContent,'Venta confirmada');
await settle(2500);
assert.equal(Boolean(document.querySelector('.sigo-pos-success-inline')),!baseline,'Confirmation must remain readable until the next deliberate operation');
assert.equal(state.rows.size,1);assert.equal(state.calls.length,1);
pass(baseline?'Pinned production erases success after 2.2 seconds':'Confirmed result remains visible instead of disappearing before it can be read');
if(!baseline){state.mode='ok';await click('#notice-add');assert.equal(document.querySelector('.sigo-pos-success-inline'),null);await key('F9');assert.equal(state.rows.size,2);assert.equal(attempt().estado,'confirmado');pass('Next sale clears previous notice and confirms with a distinct original key');}
await unmount();

reset('lost');await mount();await click('#notice-add');await key('F10');
const original=attempt(), persisted=sessionStorage.getItem('sigo:intento-cobro:'+E);
const uncertain=document.querySelector('[data-cobro-pendiente]');
assert.equal(uncertain.getAttribute('role'),'alert');assert.ok(uncertain.classList.contains('form-error'));
assert.match(uncertain.textContent,/Hay un cobro pendiente de verificar/);
assert.equal(attempt().estado,'pendiente');assert.equal(state.rows.size,1);
await settle(2500);
assert.ok(document.querySelector('[data-cobro-pendiente]'));
assert.equal(sessionStorage.getItem('sigo:intento-cobro:'+E),persisted);
for(const shortcut of ['F1','F9','F10','F11','F12'])await key(shortcut);
assert.equal(state.calls.length,1);assert.equal(state.prints.length+state.fiscal.length,0);
await click('[data-recuperar-cobro]');assert.equal(attempt().estado,'confirmado');assert.equal(state.rows.size,1);
assert.equal(attempt().payload.idempotencyKey,original.payload.idempotencyKey);assert.deepEqual(state.calls[1],state.calls[0]);
assert.equal(state.prints.length+state.fiscal.length,0);assert.equal(document.querySelector('[data-cobro-pendiente]'),null);
pass('True uncertain result remains an alert, blocks repeat charges and recovers the exact key without duplicating');await unmount();

const dir=process.env.COBRO104_NOTICE_QA_DIR||'.test-build';await fs.mkdir(dir,{recursive:true});
await fs.writeFile(dir+'/notice-summary.json',JSON.stringify({status:'PASS',baseline:baseline||null,syntheticOnly:true,results,limitations:['In-memory services and JSDOM, not commercial sessions or physical devices.','The reproduced presentation defect does not establish that every user-reported failure is visual.']},null,2));
dom.window.close();
