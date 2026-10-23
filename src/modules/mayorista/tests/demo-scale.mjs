import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {createIsolatedService} from '../backend/service.mjs';
import {createQaSigoLink} from '../security/qa-sigo-link.mjs';
import {prepareDemoCompany,DEMO_COMPANY} from '../backend/demo-company.mjs';
import {buildProductIndex,searchProducts} from '../vendedor/product-search.mjs';
import {verifySharedFiscal} from './shared-fiscal.mjs';
import {requestLimiter} from '../backend/server.mjs';
/** HTTP y PostgreSQL reales. Identidad SIGO externa sustituida explícitamente.
 * El pool recibido debe ser un namespace de CI, nunca una empresa comercial real. */
export async function verifyDemoScale(pool,{externalEmpresaId,password='qa-'+randomUUID()}){
 if(pool.options.host!=='127.0.0.1'||Number(pool.options.port)!==55471||pool.options.database!=='mayorista_qa')throw Error('Prueba con identidad sustituida limitada a PostgreSQL CI local');
 const E=DEMO_COMPANY,origin='https://backend.qa.invalid',preview='https://preview.qa.invalid';
 const evidence={date:new Date().toISOString(),target:'CI PostgreSQL local',externalIdentity:'stub',fiscalTransport:'simulated_wsfe',concurrency:8,samples:[],errors:[],productionActivation:false};
 const cpu=process.cpuUsage(),memoryBefore=process.memoryUsage(),start=performance.now();let server;
 try{
  const demo=await prepareDemoCompany(pool,{password,externalEmpresaId});
  assert.deepEqual(await prepareDemoCompany(pool,{password:'ignored-after-first-install',externalEmpresaId}),demo);
  const count=async table=>Number((await pool.query('SELECT count(*) AS n FROM '+table+' WHERE empresa_id=$1',[E])).rows[0].n);
  assert.equal(await count('public.productos'),5000);assert.equal(await count('public.clientes_sigo'),1500);assert.equal(await count('mayorista.vendedores'),8);
  const keys=generateKeyPairSync('ed25519'),sigoUser=randomUUID();
  const makeLink=()=>createQaSigoLink({pool,externalEmpresaId,qaEmpresaId:E,allowLocalAccounts:true,verifyRemote:async()=>({user:{id:sigoUser,email:'sigo-owner@qa.invalid'},company:{rol:'owner'}})});
  let link=makeLink();
  const limiter=requestLimiter();
  const make=()=>createIsolatedService({enabled:true,pool,...keys,issuer:'p0-scale-ci',origin,integrationOrigins:[preview],rateLimit:limiter,operational:true,inventoryRequired:true,accountsEnabled:true,databasePolicy:{assertPool:p=>assert.equal(p,pool)},sharedSourceEnabled:true,qaSigoLink:link});
  let service=make();
  server=createServer(async(req,res)=>{try{const response=await service(new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,{token,body,requestOrigin=origin,method=body?'POST':'GET',expected=200}={}){
   const before=performance.now(),r=await fetch(base+path,{method,headers:{Origin:requestOrigin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=r.status===204?null:await r.json();evidence.samples.push({path,method,status:r.status,ms:performance.now()-before});
   if(r.status!==expected)evidence.errors.push({path,status:r.status,expected,body:data});assert.equal(r.status,expected,path+' '+JSON.stringify(data));return data;
  }
  const tokens={};await Promise.all(demo.accounts.map(async a=>{const r=await call('/auth/login',{body:{empresaId:E,email:a.email,password}});tokens[a.userId]=r.accessToken;}));
  const owner=demo.accounts.find(a=>a.rol==='gerencia'),admin=demo.accounts.find(a=>a.rol==='administracion'),armador=demo.accounts.find(a=>a.rol==='armador'),drivers=demo.accounts.filter(a=>a.rol==='chofer'),sellers=demo.accounts.filter(a=>a.rol==='vendedor');
  const sigo=await call('/auth/sigo',{token:'explicit-external-stub',body:{empresaId:externalEmpresaId},requestOrigin:preview});
  for(const requestOrigin of [origin,preview]){const me=await call('/me',{token:sigo.accessToken,requestOrigin});assert.equal(me.empresaId,E);assert.equal((await call('/me',{token:tokens[armador.userId],requestOrigin})).empresaId,E);}
  await call('/me',{token:tokens[owner.userId],requestOrigin:'https://evil.qa.invalid',expected:403});
  await call('/catalog',{token:tokens[armador.userId],expected:403});
  await call('/me',{token:tokens[owner.userId],requestOrigin:preview,method:'OPTIONS',expected:204});
  const catalogs=await Promise.all(sellers.map(a=>call('/catalog',{token:tokens[a.userId]})));
  assert.equal(new Set(catalogs.flatMap(c=>c.clientes.map(x=>x.id))).size,1500);
  const orders=[];const searchTimes=[];
  for(const [i,catalog] of catalogs.entries()){
   assert.equal(catalog.productos.length,5000);assert.ok(catalog.clientes.every(c=>c.vendedorId===sellers[i].vendedorId));
   const customer=catalog.clientes.find(c=>Number(c.limiteCredito)>=100000),prices=catalog.precios.filter(p=>p.listaId===customer.listaId),index=buildProductIndex(catalog.productos,prices);
   for(let q=0;q<40;q++){const before=performance.now();assert.ok(searchProducts(index,'QA-P-00001').length);searchTimes.push(performance.now()-before);}
   const product=catalog.productos.find(p=>p.codigoInterno==='QA-P-00001'),price=prices.find(p=>p.productoId===product.id);
   for(let k=0;k<2;k++)orders.push({seller:sellers[i],customer,body:{pedidoId:randomUUID(),empresaId:E,vendedorId:sellers[i].vendedorId,clienteId:customer.id,creadoEn:new Date().toISOString(),comerciales:{condicionPago:'cuenta_corriente'},lineas:[{productoId:product.id,precioId:price.id,cantidad:1,precioUnitario:Number(price.precio)}]}});
  }
  const P=orders[0].body.lineas[0].productoId;
  const snapshot=async()=>({stock:Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),sales:await count('public.ventas_sigo'),collections:await count('public.caja_movimientos_sigo'),balances:(await pool.query('SELECT id,saldo_actual::text FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows});
  const before=await snapshot();
  // Ocho vendedores simultáneos, dos pedidos por vendedor. Reintento concurrente del mismo UUID.
  for(let round=0;round<2;round++)await Promise.all(sellers.map(async(s,i)=>{const order=orders[i*2+round],ack=await call('/orders',{token:tokens[s.userId],body:order.body});assert.deepEqual(await call('/orders',{token:tokens[s.userId],body:order.body}),ack);}));
  link=makeLink();service=make(); // reinicio de servicio: sesión local persistente, SIGO exige revalidación.
  await call('/me',{token:sigo.accessToken,expected:401});
  for(const s of sellers){const visible=await call('/orders',{token:tokens[s.userId]});assert.equal(visible.filter(o=>o.vendedorId===s.vendedorId).length,2);}
  assert.equal(await count('mayorista.pedidos'),16);
  await call('/orders',{token:tokens[sellers[0].userId],body:{...orders[0].body,clienteId:orders[2].body.clienteId},expected:409});
  let state=await call('/cargas',{token:tokens[owner.userId]});
  const legacy=async(tipo,input)=>{state=await call('/cargas/commands',{token:tokens[admin.userId],body:{id:randomUUID(),empresaId:E,version:state.revision,tipo,input}});};
  await legacy('codigo',{productoId:P,codigo:'P0-SCALE-UNIT',unidadesBase:1});
  const sales=[];
  for(let i=0;i<8;i++){
   const pair=orders.slice(i*2,i*2+2),loadId=randomUUID(),driver=drivers[i%3];
   for(const o of pair)await legacy('aprobar',{pedidoId:o.body.pedidoId});
   await legacy('crear',{id:loadId,camion:demo.vehicles[i%3].patente,ruta:pair[0].customer.rutaId,chofer:driver.email,responsable:armador.email,modo:'consolidada'});
   for(const o of pair)await legacy('asignar',{cargaId:loadId,pedidoId:o.body.pedidoId});
   await call('/operations/loads',{token:tokens[owner.userId],body:{cargaId:loadId,armadorUserId:armador.userId,choferUserId:driver.userId}});
   let version=0;
   const step=async(actor,tipo,input={},id=randomUUID())=>{const body={id,empresaId:E,version,tipo,input:{cargaId:loadId,...input}},r=await call('/operations/loads/commands',{token:tokens[actor.userId],body});version=r.version;return body;};
   await step(armador,'iniciar');await step(armador,'escanear',{codigo:'P0-SCALE-UNIT',cantidad:2,modo:'picking'});await step(armador,'verificar');await step(armador,'cargar',{nota:'Carga QA controlada'});await step(owner,'salir',{nota:'Salida QA autorizada'});
   for(const o of pair){
    const event=randomUUID(),delivered=await step(driver,'entregar',{pedidoId:o.body.pedidoId,lineas:[{productoId:P,entregado:1,devuelto:0}],nota:'Entrega ficticia QA'},event);
    const saleCommand={id:event,empresaId:E,tipo:'entrega',datos:{pedidoId:o.body.pedidoId,clienteId:o.body.clienteId,medioPago:'cuenta_corriente',lineas:[{productoId:P,cantidad:1,precioUnitario:o.body.lineas[0].precioUnitario}]}};
    const sale=await call('/shared/commerce',{token:tokens[admin.userId],body:saleCommand});assert.equal(sale.estado,'confirmado');assert.deepEqual(await call('/shared/commerce',{token:tokens[admin.userId],body:saleCommand}),sale);sales.push(sale);
    assert.deepEqual((await call('/operations/loads/commands',{token:tokens[driver.userId],body:delivered})).load.pedidos[o.body.pedidoId].entrega,(await call('/operations/loads',{token:tokens[driver.userId]})).cargas.find(c=>c.cargaId===loadId).load.pedidos[o.body.pedidoId].entrega);
    const cents=Math.round(o.body.lineas[0].precioUnitario*100),payment={id:randomUUID(),empresaId:E,datos:{clienteId:o.body.clienteId,pedidoId:o.body.pedidoId,centavos:cents,medio:'efectivo',comprobante:'RECIBO-P0-'+o.body.pedidoId}};
    const paid=await call('/shared/collections',{token:tokens[admin.userId],body:payment});assert.deepEqual(await call('/shared/collections',{token:tokens[admin.userId],body:payment}),paid);
    await step(driver,'rendir',{pedidoId:o.body.pedidoId,centavos:cents,nota:'Rendición QA'});await step(owner,'revisar_rendicion',{pedidoId:o.body.pedidoId,nota:'Rendición conciliada QA'});
   }
   await step(owner,'cerrar');
   state=await call('/cargas',{token:tokens[owner.userId]});
  }
  const after=await snapshot();assert.equal(after.stock,before.stock-16);assert.equal(after.sales,before.sales+16);assert.equal(after.collections,before.collections+16);assert.deepEqual(after.balances,before.balances);
  await verifySharedFiscal(pool,{ownerUserId:owner.userId,exercise:async()=>{}});
  const invoiceCount=await count('public.arca_comprobantes');assert.equal(invoiceCount,1);assert.deepEqual(await snapshot(),after);
  const report=await call('/admin/dashboard',{token:tokens[owner.userId]});assert.equal(report.empresaId,E);
  await call('/admin/reports',{token:tokens[owner.userId]});
  const connection=await pool.connect();try{assert.equal(Number((await connection.query('SELECT count(*) AS n FROM mayorista.pedidos WHERE empresa_id=$1',[E])).rows[0].n),16);}finally{connection.release();}
  evidence.reconciliation={orders:16,delivered:16,sales:16,collections:16,consolidatedLoads:8,simulatedInvoices:invoiceCount,stockBefore:before.stock,stockAfter:after.stock,balancesRestored:true,persistedAcrossConnections:true};
  searchTimes.sort((a,b)=>a-b);evidence.search={products:5000,queries:searchTimes.length,p95Ms:searchTimes[Math.floor(searchTimes.length*.95)]};
  return [{name:'P0: 8 vendedores, 1500 clientes, 5000 productos, HTTP/PG, cargas y conciliación real en CI',status:'pass'}];
 }catch(e){evidence.failure=e.message;throw e;}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  evidence.durationMs=performance.now()-start;evidence.nodeCpuMicroseconds=process.cpuUsage(cpu);evidence.nodeMemory={before:memoryBefore,after:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS};evidence.databaseResourceMetrics='not measured';
  const groups={};for(const s of evidence.samples){const key=s.method+' '+s.path;(groups[key]??=[]).push(s.ms);}evidence.responseTimes=Object.fromEntries(Object.entries(groups).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{n:v.length,p50Ms:v[Math.floor(v.length*.5)],p95Ms:v[Math.min(v.length-1,Math.floor(v.length*.95))],maxMs:v.at(-1)}];}));
  await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/p0-demo-scale.json',import.meta.url),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({event:'P0_SCALE_CI',...evidence,samples:undefined}));
 }
}
