import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {interactiveQa} from './interactive-qa.mjs';
import {demoId} from './demo-company.mjs';
import {buildProductIndex,searchProducts} from '../vendedor/product-search.mjs';
import {verifySharedFiscal} from '../tests/shared-fiscal.mjs';

const RUN='p0-live-70c2783-v1';
/** Ejecutor de aceptación, opt-in. No siembra ni arranca un servidor de prueba.
 * HTTP contra el dominio Railway publicado, login nativo real, mismo namespace QA.
 * Solo la etapa fiscal usa el emisor existente con transporte externo simulado.
 * No contiene ni registra contraseñas, tokens o conexiones. No se ejecuta al importar. */
export async function acceptLiveDemo(env){
 if(env.MAYORISTA_LIVE_ACCEPTANCE!=='true')throw Error('Aceptación live requiere opt-in explícito');
 const origin=env.MAYORISTA_PUBLIC_ORIGIN;
 if(origin!=='https://mayorista-api-qa-qa.up.railway.app')throw Error('Dominio fuera de QA aprobado');
 if(!env.MAYORISTA_BOOTSTRAP_PASSWORD)throw Error('Credencial QA no configurada');
 const qa=await interactiveQa(env);if(!qa)throw Error('QA interactivo obligatorio');
 const {pool}=qa,E=qa.qaEmpresaId,id=k=>demoId(RUN,k),samples=[],started=performance.now();let lock,report;
 try{
  lock=await pool.connect();await lock.query("SELECT pg_advisory_lock(hashtext('p0-live-demo-acceptance'))");
  const demo=(await pool.query('SELECT datos FROM mayorista_private.qa_demo_manifest WHERE version=1 AND empresa_id=$1',[E])).rows[0]?.datos;
  if(!demo||demo.namespace!==qa.namespace||demo.accounts.length!==14||demo.vehicles.length!==3)throw Error('Manifest demo existente no conciliado');
  await pool.query(`CREATE TABLE IF NOT EXISTS mayorista_private.qa_live_journal(run_id text not null,step text not null,request jsonb not null,response jsonb,primary key(run_id,step));
   CREATE TABLE IF NOT EXISTS mayorista_private.qa_live_reports(run_id text primary key,report jsonb not null);
   ALTER TABLE mayorista_private.qa_live_journal ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista_private.qa_live_reports ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON mayorista_private.qa_live_journal,mayorista_private.qa_live_reports FROM public,anon,authenticated;`);
  const prior=(await pool.query('SELECT report FROM mayorista_private.qa_live_reports WHERE run_id=$1',[RUN])).rows[0]?.report;
  if(prior?.status==='pass')return {...prior,reused:true};
  const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM public.productos WHERE empresa_id=$1) AS products,
   (SELECT count(*)::int FROM public.clientes_sigo WHERE empresa_id=$1) AS customers,
   (SELECT count(*)::int FROM mayorista.vendedores WHERE empresa_id=$1 AND activo) AS sellers`,[E])).rows[0];
  assert.deepEqual(counts,{products:5000,customers:1500,sellers:8});
  async function call(path,{token,body,expected=200}={}){
   const time=performance.now();let response;
   try{response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});}
   catch{samples.push({path,status:0,ms:performance.now()-time});throw Error('Transporte QA no disponible en '+path);}
   const data=await response.json();samples.push({path,method:body?'POST':'GET',status:response.status,expected,ms:performance.now()-time});
   assert.equal(response.status,expected,path+' HTTP '+response.status);return data;
  }
  async function journal(step,path,token,body){
   await pool.query('INSERT INTO mayorista_private.qa_live_journal(run_id,step,request) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[RUN,step,{path,body}]);
   const saved=(await pool.query('SELECT request,response FROM mayorista_private.qa_live_journal WHERE run_id=$1 AND step=$2',[RUN,step])).rows[0];
   assert.equal(saved.request.path,path);
   if(saved.response!==null)return saved.response;
   const result=await call(path,{token,body:saved.request.body});
   await pool.query('UPDATE mayorista_private.qa_live_journal SET response=$3 WHERE run_id=$1 AND step=$2',[RUN,step,result]);return result;
  }
  const tokens={};
  // Nunca persiste credenciales ni respuestas de autenticación en el journal.
  for(const a of demo.accounts){const login=await call('/auth/login',{body:{empresaId:E,email:a.email,password:env.MAYORISTA_BOOTSTRAP_PASSWORD}});tokens[a.userId]=login.accessToken;const me=await call('/me',{token:login.accessToken});assert.equal(me.empresaId,E);assert.equal(me.rol,a.rol);}
  const owner=demo.accounts.find(a=>a.rol==='gerencia'),admin=demo.accounts.find(a=>a.rol==='administracion'),worker=demo.accounts.find(a=>a.rol==='armador'),drivers=demo.accounts.filter(a=>a.rol==='chofer'),sellers=demo.accounts.filter(a=>a.rol==='vendedor'),token=a=>tokens[a.userId];
  for(const a of [sellers[0],worker,drivers[0]])await call('/admin/state',{token:token(a),expected:403});
  for(const a of [worker,drivers[0]])await call('/catalog',{token:token(a),expected:403});
  const catalogs=await Promise.all(sellers.map(s=>call('/catalog',{token:token(s)})));
  assert.equal(new Set(catalogs.flatMap(c=>c.clientes.map(x=>x.id))).size,1500);
  const orders=[],searchTimes=[];
  for(const [i,c] of catalogs.entries()){
   assert.equal(c.productos.length,5000);assert.ok(c.clientes.every(x=>x.vendedorId===sellers[i].vendedorId));
   const customer=c.clientes.find(x=>Number(x.limiteCredito)>=100000),prices=c.precios.filter(x=>x.listaId===customer.listaId),index=buildProductIndex(c.productos,prices);
   for(let k=0;k<40;k++){const t=performance.now();assert.ok(searchProducts(index,'QA-P-00001').length);searchTimes.push(performance.now()-t);}
   const product=c.productos.find(x=>x.codigoInterno==='QA-P-00001'),substitute=c.productos.find(x=>x.codigoInterno==='QA-P-00002'),price=prices.find(x=>x.productoId===product.id),subPrice=prices.find(x=>x.productoId===substitute.id);
   for(let k=0;k<2;k++)orders.push({actor:sellers[i],customer,substitute:substitute.id,subPrice,body:{pedidoId:id('order-'+i+'-'+k),empresaId:E,vendedorId:sellers[i].vendedorId,clienteId:customer.id,creadoEn:'2026-10-16T00:00:00.000Z',comerciales:{condicionPago:'cuenta_corriente'},lineas:[{productoId:product.id,precioId:price.id,cantidad:2,precioUnitario:Number(price.precio)}]}});
  }
  const P=orders[0].body.lineas[0].productoId,Q=orders[0].substitute;
  const snapshot=async()=>({stocks:(await pool.query('SELECT id,stock_actual::text FROM public.productos WHERE empresa_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[E,[P,Q]])).rows,balances:(await pool.query('SELECT id,saldo_actual::text FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows,counts:(await pool.query(`SELECT
   (SELECT count(*)::int FROM mayorista.pedidos WHERE empresa_id=$1) AS orders,
   (SELECT count(*)::int FROM public.ventas_sigo WHERE empresa_id=$1) AS sales,
   (SELECT count(*)::int FROM public.caja_movimientos_sigo WHERE empresa_id=$1) AS cash`,[E])).rows[0]});
  let before=(await pool.query('SELECT response FROM mayorista_private.qa_live_journal WHERE run_id=$1 AND step=$2',[RUN,'baseline'])).rows[0]?.response;
  if(!before){before=await snapshot();await pool.query('INSERT INTO mayorista_private.qa_live_journal VALUES($1,$2,$3,$4)',[RUN,'baseline',{},before]);}
  for(let round=0;round<2;round++)await Promise.all(sellers.map(async(s,i)=>{const o=orders[i*2+round],ack=await journal('order-'+i+'-'+round,'/orders',token(s),o.body);assert.deepEqual(await call('/orders',{token:token(s),body:o.body}),ack);}));
  await call('/orders',{token:token(sellers[0]),body:{...orders[0].body,empresaId:'30000000-0000-4000-8000-000000000002'},expected:403});
  for(const s of sellers){const visible=await call('/orders',{token:token(s)});assert.ok(visible.every(o=>o.vendedorId===s.vendedorId));assert.ok(orders.filter(o=>o.actor.userId===s.userId).every(o=>visible.some(v=>v.pedidoId===o.body.pedidoId)));}
  let root=await call('/cargas',{token:token(owner)});
  const legacy=async(key,tipo,input)=>{root=await journal(key,'/cargas/commands',token(admin),{id:id(key),empresaId:E,version:root.revision,tipo,input});};
  await legacy('barcode-p','codigo',{productoId:P,codigo:'LIVE-P0-P',unidadesBase:1});await legacy('barcode-q','codigo',{productoId:Q,codigo:'LIVE-P0-Q',unidadesBase:1});
  const expectedStock=new Map([[P,0],[Q,0]]),loadIds=[];let delivered=0,sales=0,payments=0;
  for(let i=0;i<8;i++){
   const pair=orders.slice(i*2,i*2+2),loadId=id('load-'+i),driver=drivers[i%3];loadIds.push(loadId);
   for(let k=0;k<2;k++)await legacy('approve-'+i+'-'+k,'aprobar',{pedidoId:pair[k].body.pedidoId});
   await legacy('create-'+i,'crear',{id:loadId,camion:demo.vehicles[i%3].patente,ruta:pair[0].customer.rutaId,chofer:driver.email,responsable:worker.email,modo:'consolidada'});
   for(let k=0;k<2;k++)await legacy('assign-'+i+'-'+k,'asignar',{cargaId:loadId,pedidoId:pair[k].body.pedidoId});
   await journal('publish-'+i,'/operations/loads',token(owner),{cargaId:loadId,armadorUserId:worker.userId,choferUserId:driver.userId});
   let version=0,load;
   const step=async(key,a,tipo,input={})=>{const r=await journal(key,'/operations/loads/commands',token(a),{id:id(key),empresaId:E,version,tipo,input:{cargaId:loadId,...input}});version=r.version;load=r.load;return r;};
   await step('start-'+i,worker,'iniciar');
   if(i===2){
    const input={cargaId:loadId,pedidoId:pair[0].body.pedidoId,productoId:P,faltante:2,sustitutoId:Q,precioId:pair[0].subPrice.id,cantidad:2,nota:'Sustitución sintética autorizada P0'};
    await call('/operations/loads/commands',{token:token(worker),body:{id:id('forbidden-substitution'),empresaId:E,version,tipo:'sustituir',input},expected:403});
    await step('substitute-'+i,owner,'sustituir',input);
   }
   await step('pick-'+i,worker,'escanear',{codigo:'LIVE-P0-P',cantidad:i===2?2:i===1?3:4,modo:'picking'});
   if(i===2)await step('pick-q-'+i,worker,'escanear',{codigo:'LIVE-P0-Q',cantidad:2,modo:'picking'});
   if(i===1)await step('shortage-'+i,owner,'autorizar_faltante',{pedidoId:pair[1].body.pedidoId,productoId:P,destino:'cancelado',nota:'Faltante sintético autorizado P0'});
   await step('verify-'+i,worker,'verificar');await step('load-'+i,worker,'cargar',{nota:'Carga controlada P0'});await step('depart-'+i,owner,'salir',{nota:'Salida autorizada P0'});
   for(let k=0;k<2;k++){
    const o=pair[k],lines=load.pedidos[o.body.pedidoId].lineas.map(l=>({productoId:l.productoId,entregado:l.preparado-(i===0&&k===0?1:0),devuelto:i===0&&k===0?1:0}));
    await step('deliver-'+i+'-'+k,driver,'entregar',{pedidoId:o.body.pedidoId,lineas:lines,nota:'Entrega sintética P0'});delivered++;
    const commercial=lines.filter(l=>l.entregado>0).map(l=>({productoId:l.productoId,cantidad:l.entregado,precioUnitario:load.pedidos[o.body.pedidoId].lineas.find(x=>x.productoId===l.productoId).precioUnitario}));
    for(const l of commercial)expectedStock.set(l.productoId,expectedStock.get(l.productoId)+l.cantidad);
    const saleBody={id:id('deliver-'+i+'-'+k),empresaId:E,tipo:'entrega',datos:{pedidoId:o.body.pedidoId,clienteId:o.body.clienteId,medioPago:'cuenta_corriente',lineas:commercial}};
    const sale=await journal('sale-'+i+'-'+k,'/shared/commerce',token(admin),saleBody);assert.equal(sale.estado,'confirmado');assert.deepEqual(await call('/shared/commerce',{token:token(admin),body:saleBody}),sale);sales++;
    const cents=commercial.reduce((s,l)=>s+Math.round(l.cantidad*l.precioUnitario*100),0),payment={id:id('payment-'+i+'-'+k),empresaId:E,datos:{clienteId:o.body.clienteId,pedidoId:o.body.pedidoId,centavos:cents,medio:'efectivo',comprobante:'LIVE-P0-'+i+'-'+k}};
    const paid=await journal('payment-'+i+'-'+k,'/shared/collections',token(admin),payment);assert.deepEqual(await call('/shared/collections',{token:token(admin),body:payment}),paid);payments++;
    await step('settle-'+i+'-'+k,driver,'rendir',{pedidoId:o.body.pedidoId,centavos:cents,nota:'Rendición P0'});await step('review-'+i+'-'+k,owner,'revisar_rendicion',{pedidoId:o.body.pedidoId,nota:'Rendición conciliada P0'});
   }
   if(i===0)await step('receive-'+i,worker,'recibir_devoluciones',{lineas:[{productoId:P,cantidad:1,vendible:1,averiada:0}],nota:'Recepción física de unidad no entregada P0'});
   await step('close-'+i,owner,'cerrar');root=await call('/cargas',{token:token(owner)});
  }
  const after=await snapshot();assert.equal(after.counts.orders-before.counts.orders,16);assert.equal(after.counts.sales-before.counts.sales,16);assert.equal(after.counts.cash-before.counts.cash,16);assert.deepEqual(after.balances,before.balances);
  for(const s of before.stocks)assert.equal(Number(after.stocks.find(x=>x.id===s.id).stock_actual),Number(s.stock_actual)-expectedStock.get(s.id));
  for(const a of [owner,admin,worker,...drivers]){
   const view=await call('/operations/loads',{token:token(a)});
   if(a.rol==='gerencia'||a.rol==='administracion')assert.ok(loadIds.every(l=>view.cargas.some(c=>c.cargaId===l)));
   else if(a.rol==='armador')assert.ok(view.cargas.every(c=>c.load.responsable===a.userId&&Object.values(c.load.pedidos).every(p=>p.lineas.every(l=>l.precioUnitario===undefined))));
   else assert.ok(view.cargas.every(c=>c.load.chofer===a.userId));
  }
  const revoked=sellers[7],wasActive=(await pool.query('SELECT activo FROM mayorista_private.qa_local_accounts WHERE user_id=$1 AND empresa_id=$2',[revoked.userId,E])).rows[0].activo;
  try{await pool.query('UPDATE mayorista_private.qa_local_accounts SET activo=false WHERE user_id=$1 AND empresa_id=$2',[revoked.userId,E]);await call('/me',{token:token(revoked),expected:401});}finally{await pool.query('UPDATE mayorista_private.qa_local_accounts SET activo=$3 WHERE user_id=$1 AND empresa_id=$2',[revoked.userId,E,wasActive]);}
  // Una factura simulada en el mismo namespace. No llama a ARCA ni a Auth reales.
  const fiscalRow=(await pool.query('SELECT response FROM mayorista_private.qa_live_journal WHERE run_id=$1 AND step=$2',[RUN,'fiscal'])).rows[0];
  if(!fiscalRow){await pool.query('INSERT INTO mayorista_private.qa_live_journal VALUES($1,$2,$3,NULL)',[RUN,'fiscal',{transport:'simulated_wsfe'}]);await verifySharedFiscal(pool,{ownerUserId:owner.userId,exercise:async()=>{}});await pool.query('UPDATE mayorista_private.qa_live_journal SET response=$3 WHERE run_id=$1 AND step=$2',[RUN,'fiscal',{status:'pass'}]);}
  else if(fiscalRow.response?.status!=='pass')throw Error('Factura previa sin acuse final: requiere conciliación, no se repite emisión');
  assert.deepEqual(await snapshot(),after);
  await call('/admin/dashboard',{token:token(owner)});await call('/admin/reports',{token:token(owner)});
  const connection=await pool.connect();try{assert.equal(Number((await connection.query('SELECT count(*) AS n FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])',[E,orders.map(o=>o.body.pedidoId)])).rows[0].n),16);}finally{connection.release();}
  searchTimes.sort((a,b)=>a-b);
  report={status:'pass',run:RUN,revision:env.RAILWAY_GIT_COMMIT_SHA,namespace:qa.namespace,empresaId:E,counts,concurrency:8,orders:16,delivered,sales,payments,loads:8,partialDelivery:true,authorizedShortage:true,authorizedSubstitution:true,stockDelta:Object.fromEntries(expectedStock),balancesRestored:true,simulatedFiscal:true,roles:5,revocation:true,interfaces:'pending',productionActivation:false,before,after,search:{scope:'índice cliente ejecutado en contenedor de aceptación, no teléfono',n:searchTimes.length,p50:searchTimes[Math.floor(searchTimes.length*.5)],p95:searchTimes[Math.floor(searchTimes.length*.95)]},ackLoss:'replay HTTP real; desconexión física no inducida'};
  return report;
 }catch(e){report={status:'failed',run:RUN,revision:env.RAILWAY_GIT_COMMIT_SHA,error:e.message,productionActivation:false};throw e;}
 finally{
  if(report){const grouped={};for(const x of samples)(grouped[x.method+' '+x.path]??=[]).push(x.ms);report.metrics=Object.fromEntries(Object.entries(grouped).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{n:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.min(v.length-1,Math.floor(v.length*.95))],max:v.at(-1)}];}));report.samples=samples;report.durationMs=performance.now()-started;report.processResources={cpu:process.cpuUsage(),memory:process.memoryUsage()};
   await pool.query('INSERT INTO mayorista_private.qa_live_reports VALUES($1,$2) ON CONFLICT(run_id) DO UPDATE SET report=excluded.report',[RUN,report]).catch(()=>{});
   console.log(JSON.stringify({event:'MAYORISTA_LIVE_ACCEPTANCE',...report,samples:undefined,before:undefined,after:undefined}));
  }
  if(lock){await lock.query("SELECT pg_advisory_unlock(hashtext('p0-live-demo-acceptance'))").catch(()=>{});lock.release();}await pool.end();
 }
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])acceptLiveDemo(process.env).catch(()=>{process.exitCode=1;});
