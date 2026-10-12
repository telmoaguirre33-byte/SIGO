import {createServer} from 'node:http';
import {readFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../demo/dist');
const profile=await mkdtemp('/tmp/sigo-mayorista-browser-');
const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw new Error('path');const content=await readFile(file);res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]??'text/plain');res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
let child, ws, seq=0;
const pending=new Map(), runtimeErrors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
  child=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=9223',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let pages;
  for(let i=0;i<100;i++){try{pages=await(await fetch('http://127.0.0.1:9223/json')).json();break;}catch{await delay(100);}}
  if(!pages)throw new Error('Chromium CDP no disponible');
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(m.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://127.0.0.1:4173/'});await ready();
}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function ready(){for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('[data-tab=clientes]')"))return;await delay(50);}throw new Error('La aplicación no inició');}
async function stop(){if(ws){ws.close();ws=null;}if(child && child.exitCode===null){await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}}
let passed=0;
async function test(name,expression){assert.equal(await evaluate(`(async()=>{${expression};return true})()`),true);passed++;console.log('PASS '+name);}
try{
  await start();
  await evaluate(`window.core=await import('./offline/pedidos-indexeddb.js');window.cat=await import('./offline/catalogo-indexeddb.js');window.aux=await import('./storage.mjs');window.sample=await import('./sample.mjs');window.check=(condition,message)=>{if(!condition)throw new Error(message)};window.scope=sample.identities[0];window.queue=new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId);window.catalog=sample.sampleCatalog(scope);`);
  await test('catálogo IndexedDB y aislamiento empresa/vendedor', `await cat.guardarCatalogo(catalog);check((await cat.leerCatalogo(scope.empresaId,scope.vendedorId)).clientes.length===4,'clientes');check(await cat.leerCatalogo('otra',scope.vendedorId)===null,'otra empresa');check(await cat.leerCatalogo(scope.empresaId,'otro')===null,'otro vendedor')`);
  await test('claves compuestas sin colisiones', `await cat.guardarCatalogo({...catalog,empresaId:'a::b',vendedorId:'c'});await cat.guardarCatalogo({...catalog,empresaId:'a',vendedorId:'b::c'});check((await cat.leerCatalogo('a::b','c')).empresaId==='a::b','colisión')`);
  await test('rechazo de cantidades fraccionarias e infinitas', `for(const cantidad of [0,-1,1.5,Infinity,NaN]){let rejected=false;try{await queue.crear('c1',[{productoId:'p1',cantidad,precioUnitario:2200}])}catch{rejected=true}check(rejected,'cantidad '+cantidad)}`);
  await test('guardar 100 pedidos y releer desde otra instancia', `window.ids=[];for(let i=0;i<100;i++){ids.push((await queue.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:2200}])).id)}check(new Set(ids).size===100,'UUID únicos');check((await new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId).listar()).length===100,'persistencia')`);
  await test('cola aislada por empresa y vendedor', `check((await new core.PedidosIndexedDB('otra',scope.vendedorId).listar()).length===0,'empresa');check((await new core.PedidosIndexedDB(scope.empresaId,'otro').listar()).length===0,'vendedor')`);
  await test('doble guardado con UUID estable produce un pedido', `window.stableId=crypto.randomUUID();const lines=[{productoId:'p2',cantidad:24,precioUnitario:1440}];await Promise.all([queue.crear('c2',lines,stableId),queue.crear('c2',lines,stableId)]);check((await queue.listar()).filter(p=>p.id===stableId).length===1,'duplicado');let rejected=false;try{await queue.crear('c1',lines,stableId)}catch{rejected=true}check(rejected,'colisión diferente')`);
  await test('borrador durable y conflicto entre pestañas', `let d=await aux.loadDraft(scope);window.draftId=d.id;window.draftSaved=await aux.saveDraft(scope,{...d,clienteId:'c1',lineas:[{productoId:'p1',cantidad:1,precioUnitario:2200}]});check((await aux.loadDraft(scope)).id===draftId,'UUID borrador');let rejected=false;try{await aux.saveDraft(scope,d)}catch{rejected=true}check(rejected,'conflicto revision')`);
  await test('visitas persistentes y aisladas', `await aux.registerVisit(scope,'c1','sin_pedido','Visita de prueba',null);check((await aux.listVisits(scope)).length===1,'visita');check((await aux.listVisits({empresaId:'otra',vendedorId:scope.vendedorId})).length===0,'empresa visitas')`);
  await test('acuse inválido mantiene errores recuperables', `let r=await queue.sincronizar(async p=>({id:p.id,confirmadoEn:'no-es-fecha'}));check(r.fallidos===101,'errores');check((await queue.listar()).every(p=>p.estado==='error'),'no confirmado')`);
  await test('fallo de red después de recibir conserva UUID y acuse idempotente', `window.firstReceipt=null;await queue.sincronizar(async p=>{const r=await aux.demoReceive(scope,p,catalog);if(!firstReceipt)firstReceipt=r;throw new Error('Red perdida después de recibir')});check((await queue.listar()).every(p=>p.estado==='error'),'conservación');const p=(await queue.listar()).find(p=>p.id===firstReceipt.id);const retry=await aux.demoReceive(scope,p,catalog);check(retry.confirmadoEn===firstReceipt.confirmadoEn,'acuse estable')`);
  await test('dos instancias concurrentes envían una sola vez por UUID', `let sent=0;const another=new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId);const send=async p=>{sent++;return aux.demoReceive(scope,p,catalog)};await Promise.all([queue.sincronizar(send),another.sincronizar(send)]);check(sent===101,'duplicación '+sent);check((await queue.listar()).every(p=>p.estado==='sincronizado'),'acuse');const r=await queue.sincronizar(send);check(r.enviados===0,'no repetir')`);
  await test('conflicto de precio conserva pedido para revisión', `window.conflict=await queue.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:1}]);const r=await queue.sincronizar(p=>aux.demoReceive(scope,p,catalog));check(r.fallidos===1,'precio');check((await queue.listar()).find(p=>p.id===conflict.id).estado==='error','conservado')`);
  await test('catálogo vencido y empresa incorrecta rechazan envío', `const p=(await queue.listar())[0];for(const c of [{...catalog,descargadoEn:'2000-01-01'}, {...catalog,empresaId:'otra'}]){let rejected=false;try{await aux.demoReceive(scope,p,c)}catch{rejected=true}check(rejected,'validación catálogo')}`);
  await test('transacción abortada no deja una visita parcial', `await new Promise((resolve,reject)=>{const r=indexedDB.open('sigo-mayorista-demo-aux-v1',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('visits','readwrite');tx.objectStore('visits').add({...scope,id:'abort-test',clienteId:'c1'});tx.onabort=()=>{db.close();resolve()};tx.oncomplete=()=>reject(new Error('no abortó'));tx.abort()}});check(!(await aux.listVisits(scope)).some(v=>v.id==='abort-test'),'escritura parcial')`);
  await test('desborde horizontal ausente en pantalla Android de 390 px', `check(document.documentElement.scrollWidth<=390,'overflow')`);
  await evaluate(`await navigator.serviceWorker.ready;await new Promise(r=>setTimeout(r,200));`);
  await call('Page.reload');await ready();
  await test('persistencia después de recargar la página', `const m=await import('./offline/pedidos-indexeddb.js');check=(c,m)=>{if(!c)throw new Error(m)};check((await new m.PedidosIndexedDB('demo-distribuidora-sur','demo-lucia').listar()).length===102,'pedidos')`);
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await call('Page.reload');await ready();
  await test('arranque sin red mediante Service Worker', `if(navigator.onLine)throw new Error('online');if(!document.body.textContent.includes('Sin internet'))throw new Error('sin indicador');const m=await import('./offline/pedidos-indexeddb.js');if((await new m.PedidosIndexedDB('demo-distribuidora-sur','demo-lucia').listar()).length!==102)throw new Error('datos offline')`);
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/workspace/SIGO/src/modules/mayorista/tests/android-preview.png',Buffer.from(shot.data,'base64'));
  await stop();await start();
  await test('persistencia después de cerrar y reabrir Chromium', `const m=await import('./offline/pedidos-indexeddb.js');const a=await import('./storage.mjs');const scope={empresaId:'demo-distribuidora-sur',vendedorId:'demo-lucia'};if((await new m.PedidosIndexedDB(scope.empresaId,scope.vendedorId).listar()).length!==102)throw new Error('pedidos');if((await a.loadDraft(scope)).lineas.length!==1)throw new Error('borrador');if((await a.listVisits(scope)).length!==1)throw new Error('visitas')`);
  assert.deepEqual(runtimeErrors,[],'errores JavaScript');
  console.log(`${passed} pruebas aprobadas en Chromium real. Sin API remota ni Supabase.`);
  await writeFile('/workspace/SIGO/src/modules/mayorista/tests/last-result.json',JSON.stringify({date:new Date().toISOString(),browser:'Chromium headless',passed,runtimeErrors},null,2));
}finally{await stop();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
