import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Dos perfiles Chromium independientes contra la API y PostgreSQL reales.
 * Certificado temporal localhost, GPS emulado; no demuestra teléfonos físicos. */
export async function verifyNativeBrowsers({handler,password,empresaId,vendedorId,clienteId,productoId}){
  const dir=await mkdtemp('/tmp/mayorista-native-');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../demo/dist');
  const cert=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});assert.equal(cert.status,0,'TLS temporal');
  const server=createServer({key:await readFile(path.join(dir,'key.pem')),cert:await readFile(path.join(dir,'cert.pem'))},async(req,res)=>{
    try{
      if(req.url==='/qa.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Mayorista QA aislada</title><p>Prueba automática</p>');return;}
      if(req.url==='/secure-qa.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><main id="secure-app"></main><script type="module">import {mountSecureSeller} from "./vendedor/secure.mjs";mountSecureSeller(document.querySelector("#secure-app"),{enabled:true,baseUrl:location.origin+"/"});</script></html>');return;}
      if(req.url==='/seller-qa.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><main id="qa-app"></main><script type="module">import {mountConnectedSeller} from "./vendedor/connected.mjs";mountConnectedSeller(document.querySelector("#qa-app"),{enabled:true,qa:true,baseUrl:location.origin+"/"});</script></html>');return;}
      if(req.url.startsWith('/vendedor/')||req.url.startsWith('/offline/')||req.url.startsWith('/sync/')||req.url.startsWith('/security/')){const file=path.resolve(root,req.url.slice(1));if(!file.startsWith(root+path.sep))throw new Error();res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));return;}
      const response=await handler(new Request('https://127.0.0.1:4181'+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(503);res.end();}
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(4181,'127.0.0.1',r);});
  const results=[],devices=[];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function start(index){
    const profile=`${dir}/profile-${index}`;
    await mkdir(profile,{recursive:true});await rm(path.join(profile,'DevToolsActivePort'),{force:true});
    const child=spawn(process.env.CHROMIUM_PATH??'/usr/bin/google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--ignore-certificate-errors','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','pipe','pipe']});
    let diagnostics='',spawnError;for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{diagnostics=(diagnostics+data.toString()).slice(-4000);});child.once('error',e=>{spawnError=e;});
    let pages;
    for(let n=0;n<450;n++){
      if(spawnError||child.exitCode!==null)break;
      try{const port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(!Number.isInteger(port)||port<1||port>65535)throw new Error();const response=await fetch(`http://127.0.0.1:${port}/json`);const candidate=await response.json();if(candidate.some(p=>p.type==='page')){pages=candidate;break;}}catch{}await delay(100);
    }
    if(!pages){child.kill('SIGKILL');throw new Error(`Chromium no inició (exit=${child.exitCode}, error=${spawnError?.message??'ninguno'}): ${diagnostics}`);}
    const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map();
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};
    const command=(method,params={})=>new Promise((resolve,reject)=>{const next=++id,t=setTimeout(()=>{pending.delete(next);reject(new Error('CDP timeout '+method));},30000);pending.set(next,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:next,method,params}));});
    const evaluate=async source=>{const r=await command('Runtime.evaluate',{expression:source,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
    await command('Runtime.enable');await command('Page.enable');await command('Network.enable');await command('Page.navigate',{url:'https://127.0.0.1:4181/qa.html'});
    let ready=false;for(let n=0;n<100;n++){if(await evaluate("location.pathname==='/qa.html'&&document.readyState==='complete'")){ready=true;break;}await delay(50);}assert.ok(ready);
    const device={command,evaluate,stop:async()=>{await command('Browser.close').catch(()=>{});ws.close();if(child.exitCode===null)await new Promise(r=>{const t=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(t);r();});});}};
    devices[index]=device;return device;
  }
  async function init(d){await d.evaluate(`(async()=>{const q=await import('./offline/pedidos-indexeddb.js');const c=await import('./sync/http-client.mjs');window.queue=new q.PedidosIndexedDB(${JSON.stringify(empresaId)},${JSON.stringify(vendedorId)});window.client=c.createMayoristaClient({enabled:true,baseUrl:'https://127.0.0.1:4181/'});await client.login(${JSON.stringify({email:'vendedor@qa.invalid',password,empresaId})});})()`);}
  async function check(name,fn){await fn();results.push({name,status:'pass'});console.log('PASS:',name);}
  try{
    let preserved;
    let a=await start(0),b=await start(1);await init(a);await init(b);
    await check('Dos perfiles independientes guardan 100 pedidos cada uno en IndexedDB',async()=>{for(const d of [a,b])assert.equal(await d.evaluate(`(async()=>{for(let n=0;n<100;n++)await queue.crear(${JSON.stringify(clienteId)},[{productoId:${JSON.stringify(productoId)},cantidad:1,precioUnitario:10}]);return (await queue.listar()).length;})()`),100);});
    await check('Sin conexión, 100 pedidos quedan recuperables con UUID intacto',async()=>{await a.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});const r=await a.evaluate('(async()=>{window.savedIds=(await queue.listar()).map(p=>p.id);const r=await queue.sincronizar(p=>client.send(p));const records=await queue.listar();return {fallidos:r.fallidos,records,same:JSON.stringify(savedIds)===JSON.stringify(records.map(p=>p.id))};})()');assert.equal(r.fallidos,100);assert.equal(new Set(r.records.map(p=>p.id)).size,100);assert.ok(r.same);preserved=r.records;});
    await check('Cerrar y reabrir el perfil recupera los 100 pedidos no enviados',async()=>{await a.stop();a=await start(0);await init(a);const restored=await a.evaluate('queue.listar()');assert.deepEqual(restored,preserved);});
    await check('Dos perfiles sincronizan 200 pedidos contra API real sin perderlos',async()=>{const rs=await Promise.all([a.evaluate('queue.sincronizar(p=>client.send(p))'),b.evaluate('queue.sincronizar(p=>client.send(p))')]);for(const r of rs)assert.deepEqual(r,{enviados:100,fallidos:0});const ids=[];for(const d of [a,b])ids.push(...await d.evaluate('(async()=> (await queue.listar()).map(p=>p.id))()'));assert.equal(new Set(ids).size,200);const remote=await a.evaluate('client.orders()');const byId=new Map(remote.map(p=>[p.pedidoId,p]));for(const d of [a,b])for(const local of await d.evaluate('queue.listar()')){const received=byId.get(local.id);assert.ok(received,'UUID no recibido');assert.equal(received.empresaId,local.empresaId);assert.equal(received.vendedorId,local.vendedorId);assert.equal(received.clienteId,local.clienteId);assert.deepEqual(received.lineas,local.lineas);}});
    await check('Acuse perdido tras commit se recupera con el mismo UUID',async()=>{const r=await a.evaluate(`(async()=>{const p=await queue.crear(${JSON.stringify(clienteId)},[{productoId:${JSON.stringify(productoId)},cantidad:1,precioUnitario:10}]);const failed=await queue.sincronizar(async p=>{await client.send(p);throw new Error('Acuse perdido');});const recovered=await queue.sincronizar(p=>client.send(p));const stored=(await queue.listar()).find(x=>x.id===p.id);return {failed,recovered,same:stored.id===p.id,state:stored.estado};})()`);assert.equal(r.failed.fallidos,1);assert.equal(r.recovered.enviados,1);assert.ok(r.same);assert.equal(r.state,'sincronizado');});
    await check('GPS emulado entrega ubicación y precisión en Chromium',async()=>{await a.command('Browser.grantPermissions',{origin:'https://127.0.0.1:4181',permissions:['geolocation']});await a.command('Emulation.setGeolocationOverride',{latitude:-34.6037,longitude:-58.3816,accuracy:12});const gps=await a.evaluate('new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{timeout:5000}))');assert.deepEqual(gps,{lat:-34.6037,lng:-58.3816,accuracy:12});});
    await check('GPS denegado devuelve error recuperable de permisos',async()=>{await a.command('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin:'https://127.0.0.1:4181'});assert.equal(await a.evaluate('new Promise(resolve=>navigator.geolocation.getCurrentPosition(()=>resolve(0),e=>resolve(e.code),{timeout:3000}))'),1);});
    await check('GPS sin posición disponible informa el error',async()=>{await a.command('Browser.setPermission',{permission:{name:'geolocation'},setting:'granted',origin:'https://127.0.0.1:4181'});await a.command('Emulation.setGeolocationOverride',{});assert.equal(await a.evaluate('new Promise(resolve=>navigator.geolocation.getCurrentPosition(()=>resolve(0),e=>resolve(e.code),{timeout:3000}))'),2);});
    await check('Logout borra token en memoria y no elimina pedidos persistidos',async()=>{assert.equal(await a.evaluate('(async()=>{await client.logout();let denied=false;try{await client.send((await queue.listar())[0]);}catch{denied=true;}return denied&&client.identity()===null&&(await queue.listar()).length===101;})()'),true);});
    await a.command('Page.navigate',{url:'https://127.0.0.1:4181/seller-qa.html'});
    for(let n=0;n<100;n++){if(await a.evaluate("!!document.querySelector('#login')"))break;await delay(50);}
    await check('Pantalla Vendedor QA autentica y descarga catálogo real por empresa',async()=>{
      assert.equal(await a.evaluate(`(async()=>{const f=document.querySelector('#login');f.elements.empresaId.value=${JSON.stringify(empresaId)};f.elements.email.value='vendedor@qa.invalid';f.elements.password.value=${JSON.stringify(password)};f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('#order'))return document.body.textContent.includes('Catálogo descargado y persistido.');}return false;})()`),true);
    });
    await a.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await check('Pantalla conectada guarda offline y conserva el mismo UUID al sincronizar',async()=>{
      const before=await a.evaluate("document.querySelectorAll('[data-order-id]').length");
      assert.equal(await a.evaluate(`(async()=>{document.querySelector('#order').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll('[data-order-id]').length===${before}+1)return document.body.textContent.includes('Pedido guardado:');}return false;})()`),true);
      const id=await a.evaluate("[...document.querySelectorAll('[data-order-id]')].find(e=>e.textContent.includes('pendiente')).dataset.orderId");
      await a.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      assert.equal(await a.evaluate(`(async()=>{document.querySelector('#sync').click();for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));const e=document.querySelector('[data-order-id="${id}"]');if(e&&e.textContent.includes('sincronizado'))return true;}return false;})()`),true);
      const remote=await b.evaluate('client.orders()');assert.ok(remote.some(p=>p.pedidoId===id));
    });
    await a.command('Page.navigate',{url:'https://127.0.0.1:4181/secure-qa.html'});
    for(let n=0;n<100;n++){if(await a.evaluate("!!document.querySelector('#login')"))break;await delay(50);}
    const localPassword='clave-cifrada-real-20261012';
    await check('App segura autentica y cifra catálogo de API real',async()=>{
      assert.equal(await a.evaluate(`(async()=>{const f=document.querySelector('#login');f.elements.empresaId.value=${JSON.stringify(empresaId)};f.elements.email.value='vendedor@qa.invalid';f.elements.password.value=${JSON.stringify(password)};f.elements.localPassword.value=${JSON.stringify(localPassword)};f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<200;n++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('#line'))return document.body.textContent.includes('Catálogo cifrado actualizado.');}return false;})()`),true);
    });
    await a.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    let encryptedOrderId;
    await check('App segura crea borrador y pedido cifrados offline con UUID estable',async()=>{
      assert.equal(await a.evaluate(`(async()=>{document.querySelector('#line').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(document.body.textContent.includes('Borrador cifrado conservado.'))break;}document.querySelector('#save').click();for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('[data-order-id]'))return document.body.textContent.includes('Pedido guardado:');}return false;})()`),true);
      encryptedOrderId=await a.evaluate("document.querySelector('[data-order-id]').dataset.orderId");
      await a.command('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin:'https://127.0.0.1:4181'});
      assert.equal(await a.evaluate(`(async()=>{document.querySelector('#visit').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(document.body.textContent.includes('Visita conservada con resultado GPS.'))return document.body.textContent.includes('1 visitas conservadas');}return false;})()`),true);
      await a.stop();a=await start(0);await a.command('Page.navigate',{url:'https://127.0.0.1:4181/secure-qa.html'});for(let n=0;n<100;n++){if(await a.evaluate("!!document.querySelector('#unlock')"))break;await delay(50);}
      await a.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      assert.equal(await a.evaluate(`(async()=>{const f=document.querySelector('#unlock');f.elements.empresaId.value=${JSON.stringify(empresaId)};f.elements.vendedorId.value=${JSON.stringify(vendedorId)};f.elements.localPassword.value=${JSON.stringify(localPassword)};f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<200;n++){await new Promise(r=>setTimeout(r,50));const e=document.querySelector('[data-order-id]');if(e)return e.dataset.orderId===${JSON.stringify(encryptedOrderId)}&&document.body.textContent.includes('Acceso offline')&&document.body.textContent.includes('1 visitas conservadas');}return false;})()`),true);
      assert.equal(await a.evaluate(`(async()=>{document.querySelector('#sync').click();await new Promise(r=>setTimeout(r,100));return document.body.textContent.includes('Iniciá sesión online para sincronizar');})()`),true);
    });
    await a.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await check('Renovación online envía pedido cifrado una vez a PostgreSQL real',async()=>{
      await a.evaluate("document.querySelector('#logout').click()");for(let n=0;n<100;n++){if(await a.evaluate("!!document.querySelector('#login')"))break;await delay(50);}
      assert.equal(await a.evaluate(`(async()=>{const f=document.querySelector('#login');f.elements.empresaId.value=${JSON.stringify(empresaId)};f.elements.email.value='vendedor@qa.invalid';f.elements.password.value=${JSON.stringify(password)};f.elements.localPassword.value=${JSON.stringify(localPassword)};f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<200;n++){await new Promise(r=>setTimeout(r,50));if(document.querySelector('#sync'))break;}document.querySelector('#sync').click();for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));const e=document.querySelector('[data-order-id]');if(e?.textContent.includes('sincronizado'))return e.dataset.orderId===${JSON.stringify(encryptedOrderId)};}return false;})()`),true);
      const remote=await b.evaluate('client.orders()');assert.equal(remote.filter(p=>p.pedidoId===encryptedOrderId).length,1);for(let n=0;n<100;n++){if(await a.evaluate("document.body.textContent.includes('1 visitas conservadas · 1 sincronizadas.')"))break;await delay(50);}assert.equal(await a.evaluate("document.body.textContent.includes('1 visitas conservadas · 1 sincronizadas.')"),true);assert.equal((await b.evaluate('client.visits()')).length,2);
    });
    return results;
  }finally{
    await Promise.allSettled(devices.map(d=>d.stop()));await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/native-browser-result.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),profiles:2,physicalDevices:false,gps:'emulated',results},null,2));
  }
}
