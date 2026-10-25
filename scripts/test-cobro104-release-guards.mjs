// Real React/POS, ventas.ts and Supabase SDK. HTTP, credentials, printer and fiscal outputs are synthetic.
// Restores pre-dispatch actor-change coverage removed from the old preflight-dependent fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const { createClient } = require('@supabase/supabase-js');
const dom = new JSDOM('<html><body></body></html>', { url: 'https://sigo-release.invalid' });
for (const key of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','CustomEvent','sessionStorage']) globalThis[key] = dom.window[key];
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
const results = [];
let state, sdk, boundary, root, mounted = false, authSubscription;
let authRun = 0;
function session(userId = A, expired = false) {
  const now = Math.floor(Date.now() / 1000), exp = now + (expired ? -60 : 3600);
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:userId,exp,aud:'authenticated',role:'authenticated'})+'.'+enc('synthetic-signature'), refresh_token:'synthetic-'+userId, token_type:'bearer', expires_in:3600, expires_at:exp, user:{id:userId,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}} };
}
const response = data => new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
function product(e, i = 0) { return { id:i ? `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12,'0')}` : P,empresa_id:e,nombre:'Producto QA '+i,codigo_interno:'QA'+i,codigo_barras:'QA'+i,precio_venta:20,stock_actual:1000,activo:true,unidad_medida:'unidad' }; }
function catalog(e) { return Array.from({length:5001}, (_,i) => product(e,i)); }
async function localFetch(input, init = {}) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://sigo-release.invalid', 'No commercial hosts allowed');
  if (init.signal?.aborted) { state.abortedFetch++; init.signal.throwIfAborted(); }
  if (url.pathname === '/auth/v1/token') { state.refreshes++; await new Promise(r=>setTimeout(r,40)); return response(session()); }
  if (url.pathname === '/auth/v1/user') {
    const bearer = new Headers(init.headers).get('Authorization').replace(/^Bearer /i,'');
    const userId = JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub;
    return response(session(userId).user);
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null,{status:204});
  if (url.pathname === '/rest/v1/rpc/confirmar_venta_sigo_v2') {
    const p = JSON.parse(init.body), key = p.p_empresa_id+':'+p.p_idempotency_key;
    const saved = JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+p.p_empresa_id));
    assert.equal(saved.fase,'enviado'); assert.equal(saved.payload.idempotencyKey,p.p_idempotency_key);
    state.calls.push(structuredClone(p));
    let row = state.rows.get(key);
    if (row) assert.equal(row.fingerprint,JSON.stringify(p),'Recovery must preserve exact payload');
    else { row = {id:'22222222-2222-4222-8222-'+String(state.rows.size+1).padStart(12,'0'),empresa_id:p.p_empresa_id,idempotency_key:p.p_idempotency_key,fingerprint:JSON.stringify(p),estado:'confirmada',numero:state.rows.size+1,medio_pago:p.p_medio_pago,cliente_id:p.p_cliente_id,total:p.p_items.reduce((s,i)=>s+20*i.cantidad,0),items:p.p_items.map(i=>({...i,precio_unitario:20,subtotal:20*i.cantidad})),created_at:new Date().toISOString()}; state.rows.set(key,row); }
    if (state.loseResponse) { state.loseResponse=false; throw Error('Synthetic lost ACK AFTER COMMIT'); }
    return response(row.id);
  }
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  const eq = name => url.searchParams.get(name)?.replace(/^eq\./,'');
  const selected = [...state.rows.values()].filter(r=>r.empresa_id===eq('empresa_id'));
  const table = url.pathname.split('/').at(-1);
  let data = [];
  if (table==='ventas_sigo') data=selected.filter(r=>(!eq('id')||r.id===eq('id'))&&(!eq('idempotency_key')||r.idempotency_key===eq('idempotency_key'))).map(({items,fingerprint,...r})=>r);
  else if (table==='venta_items_sigo') data=selected.filter(r=>r.id===eq('venta_id')).flatMap(r=>r.items);
  else if (table==='caja_movimientos_sigo') data=selected.map(r=>({venta_id:r.id,medio_pago:r.medio_pago,importe:r.total}));
  else assert.equal(table,'cliente_movimientos_sigo');
  const single = new Headers(init.headers).get('Accept')?.includes('application/vnd.pgrst.object+json');
  if (table==='ventas_sigo' && eq('id') && state.holdNextReadback) {
    state.holdNextReadback=false;
    return new Promise(resolve=>{state.releaseReadback=()=>resolve(response(single ? {...data[0],total:999} : data.map(r=>({...r,total:999}))));});
  }
  return response(single ? data[0]??null : data);
}
globalThis.__releaseQA = {
  boundary:()=>boundary, product,
  readProducts:e=>{state.catalogCalls++;if(state.catalogSlow)return new Promise(resolve=>state.catalogReleases.push(()=>resolve(catalog(e))));return Promise.resolve(catalog(e));},
  units:e=>Object.fromEntries(catalog(e).map(p=>[p.id,'unidad'])),
  print:(...args)=>state.prints.push(args),
};
window.addEventListener('sigo:arca:venta',event=>state.fiscal.push(event.detail));
const mocks = {
  './supabase':'export const supabase=new Proxy({}, {get(_t,k){const c=globalThis.__releaseQA.boundary();const v=c[k];return typeof v==="function"?v.bind(c):v}});',
  './productos':'export const listarProductosSigo=e=>globalThis.__releaseQA.readProducts(e);export const listarUnidadesProductoSigo=async e=>globalThis.__releaseQA.units(e);export const guardarProductoSigo=async()=>{throw Error("FORBIDDEN")};',
  './clientes':'export const listarClientesSigo=async()=>[];',
  './ofertasProductos':'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;',
  './ticketVenta':'export const imprimirTicketVenta=async(...a)=>globalThis.__releaseQA.print(...a);',
  './BarcodeScanner':'import React from "react";export default function Scanner(p){return <button id="add-release" onClick={()=>p.onProduct(globalThis.__releaseQA.product(p.empresaId))}>Add</button>}',
  './adminPush':'export const cerrarSesionConPushRevocado=async()=>{};export const notificarAltaEmpresaAdmin=async()=>{};',
};
const out = process.cwd()+'/.test-build/cobro104-release-guards.mjs';
await build({stdin:{contents:'export {default as POS} from "./src/VentaRapidaOperativa";export {default as Gate} from "./src/SigoAuthGate";',resolveDir:process.cwd(),loader:'tsx'},outfile:out,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],define:{'import.meta.env':JSON.stringify({VITE_MERCADOPAGO_SUBSCRIPTION_URL:''})},plugins:[{name:'no-live-services',setup(b){b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'boundary'}:null);b.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'text'}));}}]});
const { POS, Gate } = await import(pathToFileURL(out));
async function settle() { await act(async()=>{await new Promise(r=>setTimeout(r,30));}); }
async function waitFor(check, message) { const until=Date.now()+4000;while(!check()&&Date.now()<until)await settle();assert.ok(check(),message); }
async function mount(e=E, gate=false) { document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(React.StrictMode,null,gate?React.createElement(Gate,null,React.createElement(POS,{empresaId:e})):React.createElement(POS,{empresaId:e}))));mounted=true;await waitFor(()=>document.getElementById('add-release'),'Cashier must mount');await settle(); }
async function unmount() { if(mounted){await act(async()=>root.unmount());mounted=false;} }
async function add() { await act(async()=>document.getElementById('add-release').click());await settle(); }
async function key(...keys) { await act(async()=>{for(const key of keys)window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));});await settle(); }
const attempt=(e=E)=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e));
const pending=()=>Boolean(document.querySelector('[data-recuperar-cobro]'));
function emit(event,userId) { for(const cb of state.listeners)cb(event,userId?{user:{id:userId}}:null); }
async function start({expired=false,controlledToken=false}={}) {
  sessionStorage.clear();
  state={rows:new Map(),calls:[],prints:[],fiscal:[],events:[],refreshes:0,abortedFetch:0,catalogCalls:0,catalogSlow:false,catalogReleases:[],listeners:new Set(),controlledToken};
  if(controlledToken){
    sdk=createClient('https://sigo-release.invalid','synthetic-placeholder',{accessToken:async()=>state.holdNextToken?(state.holdNextToken=false,new Promise(resolve=>{state.releaseToken=resolve;})):null,global:{fetch:localFetch}});
    boundary = {
      from: sdk.from.bind(sdk),
      rpc: (...args) => { state.holdNextToken = true; return sdk.rpc(...args); },
      auth: {
        onAuthStateChange(cb) {
          state.listeners.add(cb);
          cb('INITIAL_SESSION', { user: { id: A } });
          return { data: { subscription: { unsubscribe() { state.listeners.delete(cb); } } } };
        },
      },
    };
  }else{
    const storageKey = 'release-auth-'+(++authRun);
    const values=new Map([[storageKey,JSON.stringify(session(A,expired))]]);
    sdk=createClient('https://sigo-release.invalid','synthetic-placeholder',{auth:{storageKey,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},autoRefreshToken:true,detectSessionInUrl:false,persistSession:true},global:{fetch:localFetch}});
    boundary=sdk;
    authSubscription=sdk.auth.onAuthStateChange((event,s)=>state.events.push({event,user:s?.user?.id??null})).data.subscription;
  }
}
async function stop() { await unmount();for(const release of state.catalogReleases)release();await settle();if(!state.controlledToken){authSubscription?.unsubscribe();await sdk.auth.stopAutoRefresh();sdk.auth.broadcastChannel?.close();}sdk.realtime.disconnect();assert.equal(state.listeners.size,0); }
function pass(name) { results.push(name);console.log('PASS:',name); }

// No injected auth event: expired storage is refreshed by the actual GoTrue SDK.
for(const company of [E,O]) {
  await start({expired:true});await mount(company);
  await waitFor(()=>state.events.some(e=>e.event==='TOKEN_REFRESHED'&&e.user===A),'Natural token renewal must happen');
  await settle();assert.ok(state.refreshes>=1);
  state.catalogSlow=true;const catalogReads=state.catalogCalls;
  for(const shortcut of ['F9','F10','F11']) {
    await add();await key(shortcut,shortcut);
    await waitFor(()=>attempt(company)?.estado==='confirmado'&&!pending(),'Sequential payment must confirm without full-catalog read');
    const note=document.querySelector('[data-cobro-diagnostico]');
    if(note){assert.equal(note.getAttribute('role'),'status');assert.doesNotMatch(note.textContent,/hasta revisar|pendiente|stock verificado/i);}
  }
  assert.equal(state.calls.length,3);assert.equal(state.rows.size,3);assert.equal(new Set(state.calls.map(p=>p.p_idempotency_key)).size,3);
  assert.equal(state.catalogCalls,catalogReads,'5001-product catalogue must NOT be reread on each charge');
  assert.equal(state.prints.length,1);assert.equal(state.fiscal.length,1);
  await key('F12');assert.equal(state.calls.length,3);assert.equal(state.prints.length,2);
  pass(company+': natural first renewal, 5001 products, slow catalogue and F9/F10/F11/F12');await stop();
}

await start();await mount(E,true);state.catalogSlow=true;await add();state.loseResponse=true;await key('F11');
assert.equal(attempt().estado,'pendiente');const saved=attempt();assert.equal(state.rows.size,1);
await act(async()=>sdk.auth.signOut({scope:'local'}));await waitFor(()=>!document.querySelector('.sigo-pos'),'Sign-out must remove cashier');
await act(async()=>{const result=await sdk.auth.setSession(session());assert.equal(result.error,null);});
await waitFor(()=>document.querySelector('[data-recuperar-cobro]'),'Re-entry must preserve pending attempt');
assert.equal(state.calls.length,1,'Re-entry must not send a new payment automatically');
await act(async()=>document.querySelector('[data-recuperar-cobro]').click());
await waitFor(()=>attempt().estado==='confirmado'&&!pending(),'Same-key explicit recovery must work');
assert.equal(state.rows.size,1);assert.equal(attempt().payload.idempotencyKey,saved.payload.idempotencyKey);
assert.deepEqual(state.calls[1],state.calls[0]);assert.equal(state.prints.length+state.fiscal.length,0);
// New mount needs its initial catalogue to settle before a NEW sale, independently of recovery.
state.catalogSlow=false;for(const release of state.catalogReleases.splice(0))release();await settle();
await add();await key('F9');assert.equal(attempt().estado,'confirmado');assert.equal(state.rows.size,2);
pass('Lost post-commit response, real SDK sign-out/re-entry, same-key recovery and following sale');await stop();

await start();await mount();state.holdNextReadback=true;await add();await key('F9');
assert.equal(attempt().estado,'confirmado');assert.equal(typeof state.releaseReadback,'function');
await add();await key('F9');const second=attempt();const currentNote=document.querySelector('[data-cobro-diagnostico]')?.textContent??'';
await act(async()=>state.releaseReadback());await settle();
assert.equal(attempt().ventaId,second.ventaId);assert.equal(state.rows.size,2);assert.equal(pending(),false);
assert.equal(document.querySelector('[data-cobro-diagnostico]')?.textContent??'',currentNote,'A stale diagnostic must not overwrite the next sale');
pass('Late prior-sale diagnostic cannot overwrite a newer confirmed sale');await stop();

// This fixture arms the SDK token barrier at RPC construction, NOT at an optional catalogue read.
for(const unmounted of [false,true])for(const change of ['actor','signout']) {
  await start({controlledToken:true});await mount();await add();await key('F9');
  assert.equal(typeof state.releaseToken,'function');assert.equal(state.calls.length,0);const saved=attempt();
  if(unmounted)await unmount();
  await act(async()=>emit(change==='actor'?'SIGNED_IN':'SIGNED_OUT',change==='actor'?B:null));
  await act(async()=>state.releaseToken('synthetic-token'));await settle();
  assert.equal(state.calls.length,0,'Changed actor must prevent RPC dispatch');assert.equal(state.rows.size,0);
  assert.equal(state.abortedFetch,1);assert.equal(attempt().estado,'pendiente');assert.equal(attempt().payload.idempotencyKey,saved.payload.idempotencyKey);
  assert.equal(state.prints.length+state.fiscal.length,0);
  if(!unmounted)assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);
  pass('Pre-dispatch '+change+' '+(unmounted?'after unmount':'while mounted')+': zero charges after late SDK token');await stop();
}
await start({controlledToken:true});await mount();await add();await key('F9');
await act(async()=>emit('TOKEN_REFRESHED',null));await act(async()=>emit('TOKEN_REFRESHED',A));
await act(async()=>state.releaseToken('synthetic-token'));await waitFor(()=>attempt()?.estado==='confirmado','Same actor may finish');
assert.equal(state.calls.length,1);assert.equal(state.rows.size,1);assert.equal(pending(),false);
pass('Pre-dispatch same-actor renewal remains allowed');await stop();

const artifact=process.env.COBRO104_RELEASE_QA_DIR||'.test-build';await fs.mkdir(artifact,{recursive:true});
await fs.writeFile(artifact+'/release-guards-summary.json',JSON.stringify({status:'PASS',results,syntheticOnly:true,catalogSize:5001,realSdk:true,limitations:['HTTP sessions and rows are synthetic; no commercial accounts or production database accessed.','Controlled-token cases use a test token barrier and synthetic auth dispatcher; natural-expiry cases use GoTrue without injected events.','No physical Android/PWA, printer or ARCA/CAE verification.']},null,2));
dom.window.close();console.log(JSON.stringify({status:'PASS',cases:results.length}));
