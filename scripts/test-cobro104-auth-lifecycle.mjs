// Real GoTrue auth + PostgREST + React POS. All HTTP and commercial rows are synthetic.
// No accessToken override, auth replacement, real credentials, printer or fiscal API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const { createClient } = require('@supabase/supabase-js');
const dom = new JSDOM('<html><body></body></html>', { url: 'https://auth-lifecycle.invalid' });
for (const k of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','CustomEvent','sessionStorage']) globalThis[k] = dom.window[k];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = window.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
window.open = window.print = () => { throw Error('EXTERNAL_ACTION_FORBIDDEN'); };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const E = '11111111-1111-4111-8111-111111111111';
const O = '33333333-3333-4333-8333-333333333333';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const baseline = process.env.COBRO104_BASELINE_DIR;
const results = [], rows = new Map(), authEvents = [];
let client, root, mode = 'ok', release, rpc = 0, refreshes = 0, unit = 'kg';
const prints = [], fiscal = [];
function session(userId = A) {
  const now = Math.floor(Date.now()/1000);
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  return { access_token: encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:userId,exp:now+3600,aud:'authenticated',role:'authenticated'})+'.synthetic-signature', refresh_token:'synthetic-refresh-'+userId, token_type:'bearer', expires_in:3600, expires_at:now+3600, user:{id:userId,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}} };
}
const response = data => new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
async function localFetch(input, init = {}) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://auth-lifecycle.invalid');
  if (url.pathname === '/auth/v1/token') { refreshes++; return response(session()); }
  if (url.pathname === '/auth/v1/user') return response(session().user);
  if (url.pathname === '/auth/v1/logout') return new Response(null, {status:204});
  if (url.pathname === '/rest/v1/rpc/confirmar_venta_sigo_v2') {
    init.signal?.throwIfAborted();
    rpc++;
    const p = JSON.parse(init.body), key = p.p_empresa_id+':'+p.p_idempotency_key;
    assert.equal(JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+p.p_empresa_id)).fase,'enviado');
    let row = rows.get(key);
    if (row) assert.equal(row.fingerprint,JSON.stringify(p));
    else { row = { id:'22222222-2222-4222-8222-'+String(rows.size+1).padStart(12,'0'), empresa_id:p.p_empresa_id, idempotency_key:p.p_idempotency_key, estado:'confirmada', numero:rows.size+1, medio_pago:p.p_medio_pago, cliente_id:p.p_cliente_id, total:20*p.p_items[0].cantidad, items:p.p_items.map(i=>({...i,precio_unitario:20,subtotal:20*i.cantidad})), fingerprint:JSON.stringify(p), created_at:new Date().toISOString() }; rows.set(key,row); }
    if (mode==='lost') { mode='ok'; throw Error('Synthetic response lost AFTER COMMIT'); }
    if (mode==='deferred') return new Promise(resolve => { release=()=>resolve(response(row.id)); });
    return response(row.id);
  }
  assert.ok(url.pathname.startsWith('/rest/v1/'), 'Unexpected endpoint '+url.pathname);
  const eq = n => url.searchParams.get(n)?.replace(/^eq\./,'');
  const selected = [...rows.values()].filter(r=>r.empresa_id===eq('empresa_id'));
  const table = url.pathname.split('/').at(-1);
  let data = [];
  if (table==='ventas_sigo') data=selected.filter(r=>(!eq('id')||r.id===eq('id'))&&(!eq('idempotency_key')||r.idempotency_key===eq('idempotency_key'))).map(({items,fingerprint,...r})=>r);
  else if (table==='venta_items_sigo') data=selected.filter(r=>r.id===eq('venta_id')).flatMap(r=>r.items);
  else if (table==='caja_movimientos_sigo') data=selected.map(r=>({venta_id:r.id,medio_pago:r.medio_pago,importe:r.total}));
  else assert.equal(table,'cliente_movimientos_sigo');
  if (new Headers(init.headers).get('Accept')?.includes('application/vnd.pgrst.object+json')) return response(data[0]??null);
  return response(data);
}
function product(e) { return { id:P, empresa_id:e,nombre:'Synthetic real auth product',codigo_interno:'AUTH',codigo_barras:'AUTH',precio_venta:20,stock_actual:1000,activo:true,unidad_medida:unit }; }
globalThis.__authQA = { product, client:()=>client, unit:()=>unit, print:(...args)=>prints.push(args) };
window.addEventListener('sigo:arca:venta', e=>fiscal.push(e.detail));
const mocks = {
  './supabase':'export const supabase=new Proxy({}, {get(_t,k){const c=globalThis.__authQA.client();const v=c[k];return typeof v==="function"?v.bind(c):v}});',
  './productos':'export const listarProductosSigo=async e=>[globalThis.__authQA.product(e)];export const listarUnidadesProductoSigo=async()=>({"'+P+'":globalThis.__authQA.unit()});export const guardarProductoSigo=async()=>{throw Error("Product writes forbidden")};',
  './clientes':'export const listarClientesSigo=async()=>[];',
  './ofertasProductos':'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;',
  './ticketVenta':'export const imprimirTicketVenta=async(...a)=>globalThis.__authQA.print(...a);',
  './BarcodeScanner':'import React from "react";export default function Scanner(p){return <button id="add" onClick={()=>p.onProduct(globalThis.__authQA.product(p.empresaId))}>Add</button>}',
  './adminPush':'export const cerrarSesionConPushRevocado=async()=>{};export const notificarAltaEmpresaAdmin=async()=>{};',
};
const out=process.cwd()+'/.test-build/cobro104-auth-lifecycle.mjs';
await build({stdin:{contents:'export {default as POS} from "./src/VentaRapidaOperativa";export {default as Gate} from "./src/SigoAuthGate";',resolveDir:process.cwd(),loader:'tsx'},outfile:out,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],define:{'import.meta.env.VITE_MERCADOPAGO_SUBSCRIPTION_URL':'""'},plugins:[{name:'local-http-only',setup(b){
  if(baseline)b.onLoad({filter:/\/(VentaRapidaOperativa|SigoAuthGate)\.tsx$/},async a=>({contents:await fs.readFile(baseline+'/src/'+a.path.split('/').at(-1),'utf8'),loader:'tsx',resolveDir:process.cwd()+'/src'}));
  b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'boundary'}:null);
  b.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'text'}));
}}]});
const {POS, Gate}=await import(pathToFileURL(out));
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30))});}
async function mount(e=E, gate=false){document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(React.StrictMode,null,gate?React.createElement(Gate,null,React.createElement(POS,{empresaId:e})):React.createElement(POS,{empresaId:e}))));await settle();}
async function unmount(){await act(async()=>root.unmount());}
async function start(){sessionStorage.clear();mode='ok';release=null;rpc=0;prints.length=0;fiscal.length=0;const values=new Map([['auth-qa',JSON.stringify(session())]]);client=createClient('https://auth-lifecycle.invalid','synthetic-publishable-placeholder',{auth:{storageKey:'auth-qa',storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},autoRefreshToken:false,detectSessionInUrl:false,persistSession:true},global:{fetch:localFetch}});await client.auth.getSession();client.auth.onAuthStateChange((event,s)=>authEvents.push({event,hasUser:Boolean(s?.user?.id)}));}
async function stop(){await unmount();await client.auth.stopAutoRefresh();client.auth.broadcastChannel?.close();client.realtime.disconnect();}
async function add(){await act(async()=>document.getElementById('add').click());if(unit!=='unidad'){await act(async()=>{const el=document.getElementById('sigo-cantidad-medida');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'750');el.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>document.querySelector('.sigo-pos form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}await settle();}
async function key(k){await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})));await settle();}
const attempt=(e=E)=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e));
const pending=()=>Boolean(document.querySelector('[data-recuperar-cobro]'));
function pass(name){results.push(name);console.log('PASS',name);}
// Controlled fault injection through the REAL GoTrue subscriber dispatcher, not a replaced auth client.
// This proves the defective transition; it does not claim the real service emitted a null refresh.
await start();await mount();await add();mode='deferred';await key('F9');assert.equal(typeof release,'function');const ack=release;
await act(async()=>client.auth._notifyAllSubscribers('TOKEN_REFRESHED',null));
await act(async()=>client.auth._notifyAllSubscribers('TOKEN_REFRESHED',session()));
await act(async()=>ack());await settle();assert.equal(attempt().estado,'confirmado');
assert.equal(pending(),Boolean(baseline),'ACK_CONFIRMED_UI_STALE_AFTER_TRANSIENT_AUTH');
if(baseline){pass('Pinned main reproduces confirmed durable ACK with stale pending UI after injected null event');await stop();}
else {
  pass('Both POS auth observers preserve same actor and adopt ACK after injected null event');
  mode='ok';for(let n=0;n<2;n++){await add();await key('F9');assert.equal(pending(),false);}
  assert.equal(rpc,3);pass('Second and third consecutive sales after transient auth');await stop();
  for(const company of [E,O])for(const u of ['kg','unidad']){
    unit=u;await start();await mount(company,true);const before=rows.size;
    for(const k of ['F9','F10','F11']){await add();await key(k);assert.equal(attempt(company).estado,'confirmado');assert.equal(pending(),false);const refreshed=await client.auth.refreshSession();assert.equal(refreshed.error,null);await settle();}
    assert.equal(rows.size,before+3);assert.equal(rpc,3);assert.equal(prints.length,1);assert.equal(fiscal.length,1);
    await key('F12');assert.equal(prints.length,2);assert.equal(rpc,3);assert.equal(fiscal.length,1);
    pass(company+' '+u+': async INITIAL_SESSION, three sales F9/F10/F11, real token refresh and F12 without another charge');await stop();
  }
  unit='kg';await start();await mount(E,true);await add();mode='deferred';await key('F10');const gateAck=release;
  await act(async()=>client.auth._notifyAllSubscribers('TOKEN_REFRESHED',null));await settle();assert.ok(document.querySelector('.sigo-pos'),'Transient null must not unmount the cashier');
  await act(async()=>gateAck());await settle();assert.equal(attempt().estado,'confirmado');assert.equal(pending(),false);assert.equal(prints.length,1);pass('Auth gate retains cart and cashier while transient null ACK settles');await stop();
  await start();await mount();await add();mode='lost';const before=rows.size;await key('F11');assert.equal(attempt().estado,'pendiente');const original=attempt();await unmount();await mount();assert.equal(rpc,1);await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(attempt().estado,'confirmado');assert.equal(rows.size,before+1);assert.equal(attempt().payload.idempotencyKey,original.payload.idempotencyKey);assert.equal(prints.length+fiscal.length,0);await add();await key('F9');assert.equal(pending(),false);pass('Lost post-commit response, reload, exact-key explicit recovery and next sale without duplicate/output');await stop();
  for(const change of ['user','signout']){
    await start();await mount();await add();mode='deferred';await key('F11');const late=release;
    if(change==='user')await act(async()=>client.auth._notifyAllSubscribers('SIGNED_IN',session(B)));
    else await act(async()=>client.auth.signOut({scope:'local'}));
    await act(async()=>late());await settle();assert.equal(attempt().estado,'confirmado');assert.equal(pending(),true);assert.equal(prints.length+fiscal.length,0);const sent=rpc;await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(rpc,sent);pass('Real auth '+change+' change blocks stale adoption and all print/fiscal output');await stop();
  }
  await start();await mount(E,true);await act(async()=>client.auth.signOut({scope:'local'}));await settle();assert.equal(Boolean(document.querySelector('.sigo-pos')),false);pass('Explicit real SDK sign-out unmounts cashier at auth gate');await stop();
}
assert.ok(authEvents.some(e=>e.event==='INITIAL_SESSION'&&e.hasUser));if(!baseline)assert.ok(refreshes>=12);
const artifact=process.env.COBRO104_AUTH_QA_DIR||'.test-build';await fs.mkdir(artifact,{recursive:true});await fs.writeFile(artifact+'/auth-lifecycle-summary.json',JSON.stringify({status:'PASS',baseline:baseline||null,syntheticOnly:true,realGoTrue:true,sdk:require('@supabase/supabase-js/package.json').version,refreshes,results,limitations:['Null-event case is deliberate fault injection; production emission is unproven.','Synthetic HTTP and in-memory ledger do not validate real database, physical devices, printing or fiscal issuance.']},null,2));
dom.window.close();console.log(JSON.stringify({status:'PASS',cases:results.length,refreshes}));
