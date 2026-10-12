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
      if(req.url.startsWith('/offline/')||req.url.startsWith('/sync/')){const file=path.resolve(root,req.url.slice(1));if(!file.startsWith(root+path.sep))throw new Error();res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));return;}
      const response=await handler(new Request('https://127.0.0.1:4181'+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(503);res.end();}
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(4181,'127.0.0.1',r);});
  const results=[],devices=[];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function start(index){
    await mkdir(`${dir}/profile-${index}`,{recursive:true});
    const port=9224+index,child=spawn(process.env.CHROMIUM_PATH??'/usr/bin/google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--ignore-certificate-errors',`--remote-debugging-port=${port}`,`--user-data-dir=${dir}/profile-${index}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-4000);});
    let pages;for(let n=0;n<100;n++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();break;}catch{await delay(100);}}
    if(!pages){child.kill('SIGKILL');throw new Error('Chromium no inició: '+stderr);}
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
    let a=await start(0),b=await start(1);await init(a);await init(b);
    await check('Dos perfiles independientes guardan 100 pedidos cada uno en IndexedDB',async()=>{for(const d of [a,b])assert.equal(await d.evaluate(`(async()=>{for(let n=0;n<100;n++)await queue.crear(${JSON.stringify(clienteId)},[{productoId:${JSON.stringify(productoId)},cantidad:1,precioUnitario:10}]);return (await queue.listar()).length;})()`),100);});
    await check('Sin conexión, 100 pedidos quedan recuperables con UUID intacto',async()=>{await a.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});const r=await a.evaluate('(async()=>{window.savedIds=(await queue.listar()).map(p=>p.id);const r=await queue.sincronizar(p=>client.send(p));return {fallidos:r.fallidos,ids:(await queue.listar()).map(p=>p.id)};})()');assert.equal(r.fallidos,100);assert.equal(new Set(r.ids).size,100);});
    await check('Cerrar y reabrir el perfil recupera los 100 pedidos no enviados',async()=>{await a.stop();a=await start(0);await init(a);assert.equal(await a.evaluate('(async()=>{const ps=await queue.listar();return ps.length===100&&ps.every(p=>p.estado==="error");})()'),true);});
    await check('Dos perfiles sincronizan 200 pedidos contra API real sin perderlos',async()=>{const rs=await Promise.all([a.evaluate('queue.sincronizar(p=>client.send(p))'),b.evaluate('queue.sincronizar(p=>client.send(p))')]);for(const r of rs)assert.deepEqual(r,{enviados:100,fallidos:0});const ids=[];for(const d of [a,b])ids.push(...await d.evaluate('(async()=> (await queue.listar()).map(p=>p.id))()'));assert.equal(new Set(ids).size,200);});
    await check('Acuse perdido tras commit se recupera con el mismo UUID',async()=>{const r=await a.evaluate(`(async()=>{const p=await queue.crear(${JSON.stringify(clienteId)},[{productoId:${JSON.stringify(productoId)},cantidad:1,precioUnitario:10}]);const failed=await queue.sincronizar(async p=>{await client.send(p);throw new Error('Acuse perdido');});const recovered=await queue.sincronizar(p=>client.send(p));const stored=(await queue.listar()).find(x=>x.id===p.id);return {failed,recovered,same:stored.id===p.id,state:stored.estado};})()`);assert.equal(r.failed.fallidos,1);assert.equal(r.recovered.enviados,1);assert.ok(r.same);assert.equal(r.state,'sincronizado');});
    await check('GPS emulado entrega ubicación y precisión en Chromium',async()=>{await a.command('Browser.grantPermissions',{origin:'https://127.0.0.1:4181',permissions:['geolocation']});await a.command('Emulation.setGeolocationOverride',{latitude:-34.6037,longitude:-58.3816,accuracy:12});const gps=await a.evaluate('new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{timeout:5000}))');assert.deepEqual(gps,{lat:-34.6037,lng:-58.3816,accuracy:12});});
    await check('Logout borra token en memoria y no elimina pedidos persistidos',async()=>{assert.equal(await a.evaluate('(async()=>{await client.logout();let denied=false;try{await client.send((await queue.listar())[0]);}catch{denied=true;}return denied&&client.identity()===null&&(await queue.listar()).length===101;})()'),true);});
    return results;
  }finally{
    await Promise.allSettled(devices.map(d=>d.stop()));await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/native-browser-result.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),profiles:2,physicalDevices:false,gps:'emulated',results},null,2));
  }
}
