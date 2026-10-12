import {createServer} from 'node:http';
import {readFile, mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../demo/dist');
const profile=await mkdtemp('/tmp/sigo-mayorista-browser-');
const artifacts=path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts');
await mkdir(artifacts,{recursive:true});
const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw new Error('path');const content=await readFile(file);res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]??'text/plain');res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{server.close();reject(new Error('BLOCKED: servidor local no pudo abrirse en 5 segundos; revisar permisos del entorno'));},5000);
  server.once('error',e=>{clearTimeout(timer);reject(e);});
  server.listen(4173,'127.0.0.1',()=>{clearTimeout(timer);resolve();});
}).catch(async e=>{await rm(profile,{recursive:true,force:true});throw e;});
let child, ws, seq=0;
const pending=new Map(), runtimeErrors=[];
let browserStderr='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
  child=spawn(process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=9223',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>{browserStderr=(browserStderr+data.toString()).slice(-20000);});
  let pages;
  for(let i=0;i<100;i++){try{pages=await(await fetch('http://127.0.0.1:9223/json')).json();break;}catch{await delay(100);}}
  if(!pages)throw new Error('Chromium CDP no disponible');
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onclose=()=>{for(const p of pending.values())p.reject(new Error('Conexión Chromium cerrada'));pending.clear();};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(m.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://127.0.0.1:4173/'});await ready();
}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
// Segunda pestaña real del mismo perfil, para verificar Web Locks entre documentos.
async function otherTab(){
  const {targetId}=await call('Target.createTarget',{url:'http://127.0.0.1:4173/'});
  const pages=await(await fetch('http://127.0.0.1:9223/json')).json();
  const socket=new WebSocket(pages.find(p=>p.id===targetId).webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Segunda pestaña no abrió')),5000);socket.onopen=()=>{clearTimeout(timer);resolve()};socket.onerror=()=>{clearTimeout(timer);reject(new Error('CDP segunda pestaña'))};});
  let id=0;const requests=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id && requests.has(m.id)){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};
  const command=(method,params={})=>new Promise((resolve,reject)=>{const rid=++id;const timer=setTimeout(()=>{requests.delete(rid);reject(new Error('Timeout segunda pestaña'));},30000);requests.set(rid,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id:rid,method,params}));});
  const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  for(let i=0;i<100;i++){if(await evaluate("document.readyState==='complete' && location.protocol==='http:'"))break;await delay(50);}
  return {evaluate,close:async()=>{for(const p of requests.values())p.reject(new Error('Pestaña cerrada durante envío'));requests.clear();socket.close();await call('Target.closeTarget',{targetId});}};
}
async function ready(){for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('[data-tab=clientes]')"))return;await delay(50);}throw new Error('La aplicación no inició');}
async function stop(){
  if(ws?.readyState===1)await call('Browser.close').catch(()=>{});
  if(ws){ws.close();ws=null;}
  if(child && child.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
}
let passed=0;
async function test(name,expression){assert.equal(await evaluate(`(async()=>{${expression};return true})()`),true);passed++;console.log('PASS '+name);}
try{
  await start();
  await evaluate(`(async()=>{window.core=await import('./offline/pedidos-indexeddb.js');window.cat=await import('./offline/catalogo-indexeddb.js');window.aux=await import('./storage.mjs');window.sample=await import('./sample.mjs');window.check=(condition,message)=>{if(!condition)throw new Error(message)};window.scope=sample.identities[0];window.queue=new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId);window.catalog=sample.sampleCatalog(scope);})()`);
  await test('catálogo IndexedDB y aislamiento empresa/vendedor', `await cat.guardarCatalogo(catalog);check((await cat.leerCatalogo(scope.empresaId,scope.vendedorId)).clientes.length===4,'clientes');check(await cat.leerCatalogo('otra',scope.vendedorId)===null,'otra empresa');check(await cat.leerCatalogo(scope.empresaId,'otro')===null,'otro vendedor')`);
  await test('claves compuestas sin colisiones', `await cat.guardarCatalogo({...catalog,empresaId:'a::b',vendedorId:'c'});await cat.guardarCatalogo({...catalog,empresaId:'a',vendedorId:'b::c'});check((await cat.leerCatalogo('a::b','c')).empresaId==='a::b','colisión')`);
  await test('rechazo de cantidades fraccionarias e infinitas', `for(const cantidad of [0,-1,1.5,Infinity,NaN]){let rejected=false;try{await queue.crear('c1',[{productoId:'p1',cantidad,precioUnitario:2200}])}catch{rejected=true}check(rejected,'cantidad '+cantidad)}`);
  await test('guardar 100 pedidos y releer desde otra instancia', `window.ids=[];for(let i=0;i<100;i++){ids.push((await queue.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:2200}])).id)}check(new Set(ids).size===100,'UUID únicos');check((await new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId).listar()).length===100,'persistencia')`);
  await test('cola aislada por empresa y vendedor', `check((await new core.PedidosIndexedDB('otra',scope.vendedorId).listar()).length===0,'empresa');check((await new core.PedidosIndexedDB(scope.empresaId,'otro').listar()).length===0,'vendedor')`);
  await test('doble guardado con UUID estable produce un pedido', `window.stableId=crypto.randomUUID();const lines=[{productoId:'p2',cantidad:24,precioUnitario:1440}];await Promise.all([queue.crear('c2',lines,stableId),queue.crear('c2',lines,stableId)]);check((await queue.listar()).filter(p=>p.id===stableId).length===1,'duplicado');let rejected=false;try{await queue.crear('c1',lines,stableId)}catch{rejected=true}check(rejected,'colisión diferente')`);
  await test('reintento con propiedades en otro orden conserva UUID', `const stored=(await queue.listar()).find(p=>p.id===stableId);const reordered=stored.lineas.map(l=>({precioUnitario:l.precioUnitario,cantidad:l.cantidad,productoId:l.productoId}));const retry=await queue.crear(stored.clienteId,reordered,stableId);check(retry.id===stableId,'UUID');check((await queue.listar()).length===101,'duplicado')`);
  await test('borrador durable y conflicto entre pestañas', `let d=await aux.loadDraft(scope);window.draftId=d.id;window.draftSaved=await aux.saveDraft(scope,{...d,clienteId:'c1',lineas:[{productoId:'p1',cantidad:1,precioUnitario:2200}]});check((await aux.loadDraft(scope)).id===draftId,'UUID borrador');let rejected=false;try{await aux.saveDraft(scope,d)}catch{rejected=true}check(rejected,'conflicto revision')`);
  await test('visitas persistentes y aisladas', `await aux.registerVisit(scope,'c1','sin_pedido','Visita de prueba',null);check((await aux.listVisits(scope)).length===1,'visita');check((await aux.listVisits({empresaId:'otra',vendedorId:scope.vendedorId})).length===0,'empresa visitas')`);
  await test('acuse inválido mantiene errores recuperables', `let r=await queue.sincronizar(async p=>({id:p.id,confirmadoEn:'no-es-fecha'}));check(r.fallidos===101,'errores');check((await queue.listar()).every(p=>p.estado==='error'),'no confirmado')`);
  await test('fallo de red después de recibir conserva UUID y acuse idempotente', `window.firstReceipt=null;await queue.sincronizar(async p=>{const r=await aux.demoReceive(scope,p,catalog);if(!firstReceipt)firstReceipt=r;throw new Error('Red perdida después de recibir')});check((await queue.listar()).every(p=>p.estado==='error'),'conservación');const p=(await queue.listar()).find(p=>p.id===firstReceipt.id);const retry=await aux.demoReceive(scope,p,catalog);check(retry.confirmadoEn===firstReceipt.confirmadoEn,'acuse estable')`);
  const second=await otherTab();
  try{
    await evaluate('window.sentCount=0');
    await second.evaluate(`(async()=>{window.sentCount=0;window.core=await import('./offline/pedidos-indexeddb.js');window.aux=await import('./storage.mjs');window.sample=await import('./sample.mjs');window.scope=sample.identities[0];window.catalog=sample.sampleCatalog(scope);window.queue=new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId);})()`);
    await Promise.all([
      evaluate(`queue.sincronizar(async p=>{sentCount++;return aux.demoReceive(scope,p,catalog)})`),
      second.evaluate(`queue.sincronizar(async p=>{sentCount++;return aux.demoReceive(scope,p,catalog)})`)
    ]);
    assert.equal((await evaluate('sentCount'))+(await second.evaluate('sentCount')),101,'envíos entre pestañas reales');
    await test('dos pestañas reales sincronizan sin duplicar UUID', `check((await queue.listar()).every(p=>p.estado==='sincronizado'),'acuse');const r=await queue.sincronizar(p=>aux.demoReceive(scope,p,catalog));check(r.enviados===0,'no repetir')`);
  }finally{await second.close();}
  // Cierre real de una pestaña mientras una recepción queda sin resolver.
  const interrupted=await otherTab();
  const crashScope={empresaId:'cierre-'+crypto.randomUUID(),vendedorId:'vendedor-cierre'};
  let sending;
  try{
    await interrupted.evaluate(`(async()=>{window.scope=${JSON.stringify(crashScope)};const m=await import('./offline/pedidos-indexeddb.js');window.q=new m.PedidosIndexedDB(scope.empresaId,scope.vendedorId);window.saved=await q.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:2200}]);window.started=false;})()`);
    const preservedId=await interrupted.evaluate('saved.id');
    sending=interrupted.evaluate(`q.sincronizar(async()=>{window.started=true;await new Promise(()=>{});})`).catch(()=>null);
    let started=false;for(let i=0;i<100;i++){if(await interrupted.evaluate('started')){started=true;break;}await delay(50);}
    assert.equal(started,true,'envío no inició');
    await interrupted.close();
    await sending;
    await test('cierre de pestaña durante envío conserva pedido y permite reintento', `const scope=${JSON.stringify(crashScope)};const q=new core.PedidosIndexedDB(scope.empresaId,scope.vendedorId);const before=await q.listar();check(before.length===1 && before[0].id===${JSON.stringify(preservedId)} && before[0].estado==='sincronizando','persistencia del envío interrumpido');let sends=0;const result=await q.sincronizar(async p=>{sends++;return {id:p.id,empresaId:p.empresaId,vendedorId:p.vendedorId,confirmadoEn:new Date().toISOString()}});check(result.enviados===1 && sends===1,'recuperación');check((await q.listar())[0].id===${JSON.stringify(preservedId)},'UUID preservado')`);
  }catch(e){await interrupted.close().catch(()=>{});throw e;}
  await test('conflicto de precio conserva pedido para revisión', `window.conflict=await queue.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:1}]);const r=await queue.sincronizar(p=>aux.demoReceive(scope,p,catalog));check(r.fallidos===1,'precio');check((await queue.listar()).find(p=>p.id===conflict.id).estado==='error','conservado')`);
  await test('catálogo vencido y empresa incorrecta rechazan envío', `const p=(await queue.listar())[0];for(const c of [{...catalog,descargadoEn:'2000-01-01'}, {...catalog,empresaId:'otra'}]){let rejected=false;try{await aux.demoReceive(scope,p,c)}catch{rejected=true}check(rejected,'validación catálogo')}`);
  await test('transacción abortada no deja una visita parcial', `await new Promise((resolve,reject)=>{const r=indexedDB.open('sigo-mayorista-demo-aux-v1',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('visits','readwrite');tx.objectStore('visits').add({...scope,id:'abort-test',clienteId:'c1'});tx.onabort=()=>{db.close();resolve()};tx.oncomplete=()=>reject(new Error('no abortó'));tx.abort()}});check(!(await aux.listVisits(scope)).some(v=>v.id==='abort-test'),'escritura parcial')`);
  await test('desborde horizontal ausente en pantalla Android de 390 px', `check(document.documentElement.scrollWidth<=390,'overflow')`);
  await evaluate(`(async()=>{await navigator.serviceWorker.ready;await new Promise(r=>setTimeout(r,200));})()`);
  await call('Page.reload');await ready();
  await test('persistencia después de recargar la página', `const m=await import('./offline/pedidos-indexeddb.js');check=(c,m)=>{if(!c)throw new Error(m)};check((await new m.PedidosIndexedDB('demo-distribuidora-sur','demo-lucia').listar()).length===102,'pedidos')`);
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await call('Page.reload');await ready();
  await test('arranque sin red mediante Service Worker', `if(navigator.onLine)throw new Error('online');if(!document.body.textContent.includes('Sin internet'))throw new Error('sin indicador');const m=await import('./offline/pedidos-indexeddb.js');if((await new m.PedidosIndexedDB('demo-distribuidora-sur','demo-lucia').listar()).length!==102)throw new Error('datos offline')`);
  await test('guardar sin conexión y error de envío conserva UUID', `const m=await import('./offline/pedidos-indexeddb.js');window.offlineScope={empresaId:'offline-'+crypto.randomUUID(),vendedorId:'vendedor-offline'};const q=new m.PedidosIndexedDB(offlineScope.empresaId,offlineScope.vendedorId);const p=await q.crear('c1',[{productoId:'p1',cantidad:1,precioUnitario:2200}]);window.offlineId=p.id;const r=await q.sincronizar(async()=>{if(!navigator.onLine)throw new Error('Sin internet');throw new Error('La simulación no está offline')});if(r.fallidos!==1 || (await q.listar())[0].id!==offlineId)throw new Error('pedido perdido sin conexión')`);
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await test('retorno de conexión recupera el pedido con el mismo UUID', `if(!navigator.onLine)throw new Error('no recuperó red');const m=await import('./offline/pedidos-indexeddb.js');const q=new m.PedidosIndexedDB(offlineScope.empresaId,offlineScope.vendedorId);const r=await q.sincronizar(async p=>({id:p.id,empresaId:p.empresaId,vendedorId:p.vendedorId,confirmadoEn:new Date().toISOString()}));const saved=(await q.listar())[0];if(r.enviados!==1 || saved.id!==offlineId || saved.estado!=='sincronizado')throw new Error('reintento incorrecto')`);

  const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'android-preview.png'),Buffer.from(shot.data,'base64'));
  await stop();await start();
  await test('persistencia después de cerrar y reabrir Chromium', `const m=await import('./offline/pedidos-indexeddb.js');const a=await import('./storage.mjs');const scope={empresaId:'demo-distribuidora-sur',vendedorId:'demo-lucia'};if((await new m.PedidosIndexedDB(scope.empresaId,scope.vendedorId).listar()).length!==102)throw new Error('pedidos');if((await a.loadDraft(scope)).lineas.length!==1)throw new Error('borrador');if((await a.listVisits(scope)).length!==1)throw new Error('visitas')`);
  await test('App Vendedor recupera borrador y guarda pedido desde la interfaz', `const m=await import('./offline/pedidos-indexeddb.js');const q=new m.PedidosIndexedDB('demo-distribuidora-sur','demo-lucia');const before=await q.listar();document.querySelector('[data-action=go-pedido]').click();if(document.querySelector('#customer').value!=='c1')throw new Error('borrador UI no recuperado');document.querySelector('[data-action=save]').click();let saved=false;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(document.body.textContent.includes('Pedido guardado en este celular.')){saved=true;break;}}if(!saved)throw new Error('UI no confirmó guardado');const after=await q.listar();if(after.length!==before.length+1 || new Set(after.map(p=>p.id)).size!==after.length)throw new Error('pedido UI perdido o duplicado')`);
  const uiShot=await call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'vendedor-pedido-ui.png'),Buffer.from(uiShot.data,'base64'));
  assert.deepEqual(runtimeErrors,[],'errores JavaScript');
  console.log(`${passed} pruebas aprobadas en Chromium real. Sin API remota ni Supabase.`);
  await writeFile(path.join(artifacts,'last-result.json'),JSON.stringify({date:new Date().toISOString(),browser:'Chromium headless',passed,runtimeErrors},null,2));
}catch(error){
  await writeFile(path.join(artifacts,'last-result.json'),JSON.stringify({date:new Date().toISOString(),browser:'Chromium headless',status:'failure',passed,error:error.stack,browserStderr,runtimeErrors},null,2));
  throw error;
}finally{
  await stop();await new Promise(r=>server.close(r));
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(e=>console.error('No se pudo limpiar perfil temporal:',e.message));
}
