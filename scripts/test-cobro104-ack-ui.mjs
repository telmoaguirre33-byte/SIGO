// Independent HTTP-ACK integration: actual Supabase SDK thenable/parser, ventas.ts, POS and sessionStorage.
// All HTTP is synthetic; no network, credentials, fiscal listeners or physical devices.
// Run after npm run build. Optional COBRO104_REAL_DEADLINE=1 runs an additional real 25-second wait.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const baseline=process.env.COBRO104_BASELINE_DIR;
const require=createRequire(root+'/package.json');
const {JSDOM}=require('jsdom');const {build}=require('esbuild');const {createClient}=require('@supabase/supabase-js');
const dom=new JSDOM('<html><body></body></html>',{url:'https://audit.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','KeyboardEvent','CustomEvent','sessionStorage'])globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.fetch=window.fetch=async()=>{throw Error('NETWORK FORBIDDEN')};
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const E='11111111-1111-4111-8111-111111111111',O='33333333-3333-4333-8333-333333333333',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rows=new Map();let state,reactRoot,activeCompany;
const authListeners=new Set();let actor='synthetic-user-A';let initialAuthEnabled=true;
function emitAuth(event,userId){actor=userId;for(const listener of authListeners)listener(event,userId?{user:{id:userId}}:null);}
function products(e){return [{id:P,empresa_id:e,nombre:'Synthetic ACK product',codigo_interno:'ACK',codigo_barras:'ACK',precio_venta:20,stock_actual:100-[...rows.values()].filter(r=>r.empresa_id===e).reduce((sum,r)=>sum+r.items[0].cantidad,0),activo:true,unidad_medida:'kg'}]}
function reset(mode='scalar'){actor='synthetic-user-A';initialAuthEnabled=true;state={mode,requests:[],rpc:0,prints:[],fiscal:[],release:null};sessionStorage.clear();globalThis.__audit={products,print:(...a)=>state.prints.push(a)};}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function syntheticFetch(input,init){
 if(state.mode==='rpc-auth-hang'&&init.signal?.aborted){state.abortedFetch=(state.abortedFetch||0)+1;init.signal.throwIfAborted();}
 const url=new URL(String(input));assert.equal(url.origin,'https://audit.invalid');const table=url.pathname.split('/').at(-1);state.requests.push({method:init.method,path:url.pathname});
 if(url.pathname.includes('/rpc/')){
  assert.equal(table,'confirmar_venta_sigo_v2');state.rpc++;const p=JSON.parse(init.body);const key=p.p_empresa_id+':'+p.p_idempotency_key;
  assert.equal(JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+p.p_empresa_id)).fase,'enviado');
  let row=rows.get(key);if(row)assert.equal(row.fingerprint,JSON.stringify(p));
  else{row={id:'22222222-2222-4222-8222-'+String(rows.size+1).padStart(12,'0'),empresa_id:p.p_empresa_id,idempotency_key:p.p_idempotency_key,fingerprint:JSON.stringify(p),numero:rows.size+1,medio_pago:p.p_medio_pago,cliente_id:p.p_cliente_id,created_at:'2026-10-24T00:00:00Z',items:p.p_items.map(i=>({...i,precio_unitario:20,subtotal:i.cantidad*20}))};row.total=row.items.reduce((s,i)=>s+i.subtotal,0);rows.set(key,row);}
  if(state.mode==='deferred')return new Promise(resolve=>{state.release=()=>resolve(response(row.id))});
  if(state.mode==='deferred-abortable')return new Promise((resolve,reject)=>{state.release=()=>resolve(response(row.id));init.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic fetch aborted after commit','AbortError')),{once:true});});
  if(state.mode==='empty')return new Response('',{status:200});
  if(state.mode==='truncated')return new Response('"'+row.id,{status:200});
  if(state.mode==='object')return response({venta_id:row.id});
  if(state.mode==='invalid-uuid')return response('not-a-uuid');
  if(state.mode==='uuid-newline')return response(row.id+'\n');
  if(state.mode==='uuid-space')return response(row.id+' ');
  if(state.mode==='array')return response([row.id]);
  return response(row.id);
 }
 const eq=name=>url.searchParams.get(name)?.replace(/^eq\./,'');
 if(state.mode==='rpc-auth-hang'&&url.searchParams.has('idempotency_key'))state.holdNextToken=true;
 const selected=[...rows.values()].filter(r=>r.empresa_id===eq('empresa_id'));
 let data=[];
 if(table==='ventas_sigo')data=selected.filter(r=>(!eq('id')||r.id===eq('id'))&&(!eq('idempotency_key')||r.idempotency_key===eq('idempotency_key'))).map(({items,fingerprint,...r})=>r);
 else if(table==='venta_items_sigo')data=selected.filter(r=>r.id===eq('venta_id')).flatMap(r=>r.items);
 else if(table==='caja_movimientos_sigo')data=selected.map(r=>({venta_id:r.id,medio_pago:r.medio_pago,importe:r.total}));
 else if(table!=='cliente_movimientos_sigo')throw Error('Unexpected HTTP '+url);
 if(new Headers(init.headers).get('Accept')?.includes('application/vnd.pgrst.object+json'))return data.length===1?response(data[0]):response({code:'PGRST116',message:'Synthetic no rows'},406);
 return response(data);
}
const client=createClient('https://audit.invalid','synthetic-placeholder',{accessToken:async()=>{if(state?.holdNextToken){state.holdNextToken=false;return new Promise(resolve=>{state.releaseToken=resolve})}return null},global:{fetch:syntheticFetch}});
// Only the auth-event dispatcher is synthetic: RPC/query builders and HTTP parsing remain the real SDK.
globalThis.__realClient={from:client.from.bind(client),rpc:client.rpc.bind(client),auth:{onAuthStateChange(callback){authListeners.add(callback);if(initialAuthEnabled)callback('INITIAL_SESSION',actor?{user:{id:actor}}:null);return {data:{subscription:{unsubscribe(){authListeners.delete(callback)}}}}}}};
for(const n of ['sigo:arca:venta','sigo:fiscal:caja'])window.addEventListener(n,e=>state.fiscal.push(e.detail));
const mocks={
 './supabase':'export const supabase=globalThis.__realClient;',
 './productos':'export const listarProductosSigo=async(e)=>globalThis.__audit.products(e);export const listarUnidadesProductoSigo=async()=>({"'+P+'":"kg"});export const guardarProductoSigo=async()=>{throw Error("Forbidden")};',
 './clientes':'export const listarClientesSigo=async()=>[];',
 './ofertasProductos':'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;',
 './ticketVenta':'export const imprimirTicketVenta=async(...a)=>globalThis.__audit.print(...a);',
 './BarcodeScanner':'import React from "react";export default function Scanner(p){return React.createElement("button",{id:"add",onClick:()=>p.onProduct(globalThis.__audit.products(p.empresaId)[0])},"Add");}',
};
const out=root+'/.test-build/cobro104-ack-ui.mjs';
await build({stdin:{contents:'export {default as POS} from "./src/VentaRapidaOperativa";export {huellaPayloadCobro} from "./src/intentoCobro";',resolveDir:root,loader:'tsx'},outfile:out,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],plugins:[{name:'service-boundaries-real-sdk',setup(b){if(baseline)b.onLoad({filter:/\/(VentaRapidaOperativa\.tsx|ventas\.ts|intentoCobro\.ts)$/},async a=>({contents:await fs.readFile(baseline+'/src/'+a.path.split('/').at(-1),'utf8'),loader:a.path.endsWith('.tsx')?'tsx':'ts',resolveDir:root+'/src'}));b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'boundary'}:null);b.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:mocks[a.path],resolveDir:root}));}}]});
const {POS,huellaPayloadCobro}=await import(pathToFileURL(out));
async function settle(){await act(async()=>{await new Promise(r=>setTimeout(r,20))});}
async function mount(e){activeCompany=e;document.body.innerHTML='<div id="root"></div>';reactRoot=createRoot(document.getElementById('root'));await act(async()=>reactRoot.render(React.createElement(React.StrictMode,null,React.createElement(POS,{empresaId:e}))));await settle();}
async function unmount(){await act(async()=>reactRoot.unmount());}
async function key(k){await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})));await settle();}
async function add(){await act(async()=>document.getElementById('add').click());await act(async()=>{const el=document.getElementById('sigo-cantidad-medida');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'750');el.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await settle();}
function attempt(e=activeCompany){return JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e));}
const results=[];const saveResult=results.push.bind(results);results.push=(r)=>{console.log('PASS:',r.case);return saveResult(r)};
for(const e of [E,O])for(const device of ['isolated-session-A','isolated-session-B']){
 reset();await mount(e);await add();await key('F9');assert.equal(state.rpc,1);assert.equal(attempt().estado,'confirmado');assert.match(attempt().ventaId,/^[0-9a-f-]{36}$/);assert.equal(Boolean(document.querySelector('[data-recuperar-cobro]')),false);assert.equal(document.querySelector('.sigo-pos-payments button').disabled,false);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'HTTP200 JSON scalar UUID -> SDK -> real ventas -> POS -> confirmed storage',company:e,device,pass:true});
}
for(const mode of ['empty','truncated']){
 reset(mode);await mount(E);await add();const before=rows.size;await key('F9');assert.equal(rows.size,before+1);assert.equal(attempt().estado,'pendiente');assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);const saved=attempt();const message=document.body.textContent;await unmount();
 // Separate session/device receives the same saved recovery reference, never a new key.
 reset('scalar');sessionStorage.setItem('sigo:intento-cobro:'+E,JSON.stringify(saved));await mount(E);await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(rows.size,before+1);assert.equal(attempt().estado,'confirmado');assert.equal(attempt().payload.idempotencyKey,saved.payload.idempotencyKey);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'HTTP200 '+mode+' ACK commits but preserves pending; another session exact-key replay reconciles',pass:true,errorText:message.match(/La venta no devolvió comprobante[^.]*|22222222-[^ ]*/)?.[0]});
}
reset('deferred');await mount(E);await add();await key('F10');assert.ok(state.release);await act(async()=>reactRoot.render(React.createElement(POS,{empresaId:O})));await settle();state.release();await settle();assert.equal(attempt(E).estado,'confirmado');assert.equal(attempt(O),null);assert.equal(state.prints.length+state.fiscal.length,0);assert.equal(document.querySelector('.sigo-pos-payments button').disabled,false);await unmount();results.push({case:'real SDK scalar response after company switch persists only original company, no print',pass:true});
reset();await mount(E);await add();const proto=Object.getPrototypeOf(sessionStorage),original=proto.setItem;proto.setItem=function(k,v){if(k.startsWith('sigo:intento-cobro:')&&JSON.parse(v).estado==='confirmado')throw Error('Synthetic post-ACK quota failure');return original.call(this,k,v)};
await key('F9');assert.equal(state.rpc,1);assert.equal(attempt(E).estado,'pendiente');assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);proto.setItem=original;await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(attempt(E).estado,'confirmado');await unmount();results.push({case:'valid UUID ACK but storage failure preserves pending and releases busy; same-key replay resolves',pass:true});
// Regression: previously this exact valid ACK left the remounted UI stale and demanded reload.
reset('deferred');await mount(E);await add();await key('F11');
const orphanRelease=state.release;const originalKey=attempt(E).payload.idempotencyKey;
await unmount();await mount(E);
assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);
await act(async()=>orphanRelease());await settle();
assert.equal(attempt(E).estado,'confirmado');assert.equal(attempt(E).payload.idempotencyKey,originalKey);assert.equal(attempt(O),null);
assert.equal(state.prints.length+state.fiscal.length,0);
const rpcBeforeStaleRecovery=state.rpc;
await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();
assert.equal(state.rpc,rpcBeforeStaleRecovery,'Adopting a verified saved ACK must not send any RPC');
assert.equal(Boolean(document.querySelector('[data-recuperar-cobro]')),false,'Matching confirmed ACK must clear stale pending UI without reload');
assert.equal(document.querySelector('.sigo-pos-action.reprint').disabled,false);
assert.equal(state.prints.length+state.fiscal.length,0,'Adoption must not resume fiscal/print permissions');
await unmount();results.push({case:'StrictMode remount before late ACK: same company/key/fingerprint/valid UUID adopted immediately without RPC, reload, print or fiscal',pass:true});

for(const mismatch of ['key','fingerprint','company','uuid','uuid-newline']){
 reset('empty');await mount(E);await add();await key('F9');const original=attempt(E);const stored={...structuredClone(original),estado:'confirmado',ventaId:'99999999-9999-4999-8999-999999999999'};
 if(mismatch==='key')stored.payload.idempotencyKey+='-different';
 if(mismatch==='fingerprint')stored.payload.items[0].cantidad=.5;
 if(mismatch==='company')stored.payload.empresaId=O;
 if(mismatch==='uuid')stored.ventaId='not-a-uuid';
 if(mismatch==='uuid-newline')stored.ventaId+='\n';
 stored.huella=huellaPayloadCobro(stored.payload);
 sessionStorage.setItem('sigo:intento-cobro:'+E,JSON.stringify(stored));
 const beforeRPC=state.rpc;
 await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();
 assert.equal(state.rpc,beforeRPC,'Mismatch must not dispatch a recovery RPC');
 assert.ok(document.querySelector('[data-recuperar-cobro]'),'Mismatched saved ACK must not clear pending UI');
 assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false,'Mismatch must not leave busy state stuck');
 assert.equal(document.querySelector('.sigo-pos-action.reprint').disabled,true);
 assert.equal(state.prints.length+state.fiscal.length,0);
 await unmount();results.push({case:'Confirmed storage with mismatched '+mismatch+' is not adopted or sent to RPC',pass:true});
}
reset('deferred');await mount(E);await add();await key('F10');const afterUnmountRelease=state.release;await unmount();await act(async()=>afterUnmountRelease());await settle();assert.equal(attempt(E).estado,'confirmado');await mount(E);assert.equal(Boolean(document.querySelector('[data-recuperar-cobro]')),false);assert.equal(document.querySelector('.sigo-pos-action.reprint').disabled,false);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'StrictMode: late scalar ACK settles while unmounted, next mount sees confirmed UUID, no busy or print',pass:true});
for(const event of ['SIGNED_OUT','different-user','round-trip-user','unknown-initial']){
 reset('empty');await mount(E);await add();await key('F9');const original=attempt(E);
 if(event==='unknown-initial'){await unmount();initialAuthEnabled=false;await mount(E);}
 const confirmed={...structuredClone(original),estado:'confirmado',ventaId:'99999999-9999-4999-8999-999999999999'};
 sessionStorage.setItem('sigo:intento-cobro:'+E,JSON.stringify(confirmed));
 if(event==='SIGNED_OUT')emitAuth('SIGNED_OUT',null);
 if(event==='different-user')emitAuth('SIGNED_IN','synthetic-user-B');
 if(event==='round-trip-user'){emitAuth('SIGNED_IN','synthetic-user-B');emitAuth('SIGNED_IN','synthetic-user-A');}
 const beforeRPC=state.rpc;await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();
 assert.equal(state.rpc,beforeRPC);assert.ok(document.querySelector('[data-recuperar-cobro]'),'Auth-invalid context must not adopt confirmed ACK');
 assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);assert.equal(state.prints.length+state.fiscal.length,0);
 await unmount();results.push({case:'Auth '+event+' blocks stale ACK adoption without RPC, output or stuck busy',pass:true});
}
reset('deferred');await mount(E);await add();await key('F11');const authLateRelease=state.release;emitAuth('SIGNED_IN','synthetic-user-B');const readsBeforeAuthLate=state.requests.filter(r=>r.method==='GET').length;await act(async()=>authLateRelease());await settle();assert.equal(attempt(E).estado,'confirmado');assert.equal(state.requests.filter(r=>r.method==='GET').length,readsBeforeAuthLate,'Changed auth must suppress post-ACK reconciliation and refresh reads');assert.ok(document.querySelector('[data-recuperar-cobro]'));assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'Actor change during RPC persists original UUID but suppresses UI adoption, reconciliation, print and fiscal output',pass:true});
reset('empty');await mount(E);await add();await key('F9');const sameActor=attempt(E);sessionStorage.setItem('sigo:intento-cobro:'+E,JSON.stringify({...sameActor,estado:'confirmado',ventaId:'99999999-9999-4999-8999-999999999999'}));emitAuth('TOKEN_REFRESHED','synthetic-user-A');const beforeRefreshRPC=state.rpc;await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(state.rpc,beforeRefreshRPC);assert.equal(Boolean(document.querySelector('[data-recuperar-cobro]')),false);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'Same actor token refresh permits matching confirmed ACK adoption without RPC',pass:true});
for(const mode of ['object','invalid-uuid','array','uuid-newline','uuid-space']){
 reset(mode);await mount(E);await add();const before=rows.size;await key('F9');
 assert.equal(rows.size,before+1);assert.equal(state.rpc,1);
 assert.equal(attempt().estado,'pendiente','A non-scalar or invalid UUID ACK must never mark the sale confirmed');
 assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);
 assert.equal(state.prints.length+state.fiscal.length,0);
 state.mode='scalar';await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();
 assert.equal(attempt().estado,'confirmado');assert.equal(rows.size,before+1);
 await unmount();results.push({case:'HTTP200 '+mode+' ACK fails closed; same-key scalar replay reconciles without duplicate',pass:true});
}
for(const unmounted of [false,true]){
 reset('rpc-auth-hang');await mount(E);await add();await key('F9');assert.equal(typeof state.releaseToken,'function','The actual SDK token lookup must be pending before RPC fetch');const beforeRows=rows.size;const pendingBeforeActor=attempt(E);
 if(unmounted)await unmount();
 emitAuth('SIGNED_IN','synthetic-user-B');state.releaseToken('synthetic-token-not-real');await settle();
 assert.equal(state.rpc,0,'Changed actor must prevent dispatch, not just hide its result');assert.equal(rows.size,beforeRows);assert.equal(state.abortedFetch,1);assert.equal(attempt(E).estado,'pendiente');assert.equal(attempt(E).payload.idempotencyKey,pendingBeforeActor.payload.idempotencyKey);assert.equal(state.prints.length+state.fiscal.length,0);
 if(!unmounted){assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);await unmount();}
 results.push({case:'Real SDK token waiting '+(unmounted?'after unmount':'while mounted')+': actor change aborts before RPC fetch; late token cannot charge',pass:true});
}
for(const change of ['actor','company']){
 reset('deferred-abortable');await mount(E);await add();await key('F11');assert.equal(state.rpc,1);const committedCount=rows.size;const saved=attempt(E);
 if(change==='actor')emitAuth('SIGNED_IN','synthetic-user-B');else {await act(async()=>reactRoot.render(React.createElement(React.StrictMode,null,React.createElement(POS,{empresaId:O}))));}
 await settle();assert.equal(rows.size,committedCount);assert.equal(attempt(E).estado,'pendiente','Abort after dispatch cannot prove rollback or fabricate an ACK');assert.equal(attempt(E).payload.idempotencyKey,saved.payload.idempotencyKey);assert.equal(state.prints.length+state.fiscal.length,0);
 await unmount();actor='synthetic-user-A';state.mode='scalar';await mount(E);await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();assert.equal(attempt(E).estado,'confirmado');assert.equal(rows.size,committedCount);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:change+' change after commit: abort-aware transport drops ACK, retains uncertainty, same-key retry reconciles',pass:true});
}
if(process.env.COBRO104_REAL_DEADLINE==='1'){
reset('deferred');await mount(E);await add();const timeoutStart=Date.now();await key('F11');assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,true);const timeoutOriginal=attempt(E);const timeoutRows=rows.size;const lateRelease=state.release;await act(async()=>{await new Promise(r=>setTimeout(r,26000))});await settle();const elapsed=Date.now()-timeoutStart;assert.equal(document.querySelector('[data-recuperar-cobro]').disabled,false);assert.equal(attempt(E).estado,'pendiente');assert.equal(state.prints.length+state.fiscal.length,0);state.mode='scalar';await act(async()=>document.querySelector('[data-recuperar-cobro]').click());await settle();const resolved=attempt(E);assert.equal(resolved.estado,'confirmado');assert.equal(resolved.payload.idempotencyKey,timeoutOriginal.payload.idempotencyKey);assert.equal(rows.size,timeoutRows);lateRelease();await settle();assert.deepEqual(attempt(E),resolved);assert.equal(state.prints.length+state.fiscal.length,0);await unmount();results.push({case:'REAL 25-second clock RPC timeout releases POS busy without interaction; same-key scalar replay and late response inert',pass:true,elapsedMs:elapsed});
}
await settle();assert.equal(authListeners.size,0,'All StrictMode and operation auth observers must unsubscribe after final settlement and unmount');
const summary={authSubscriptionsRemaining:authListeners.size,status:'PASS',sourceRoot:baseline||root,syntheticOnly:true,network:'All SDK fetch replaced by synthetic HTTP responses. No real services.',sdk:require('@supabase/supabase-js/package.json').version,results};summary.testEnvironment='JSDOM with real React POS and Supabase SDK; isolated sessions are not physical devices or browser viewport emulation.';const evidenceDir=process.env.COBRO104_ACK_QA_DIR||root+'/.test-build';await fs.mkdir(evidenceDir,{recursive:true});await fs.writeFile(evidenceDir+'/cobro104-ack-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));dom.window.close();
