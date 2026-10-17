import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
/** PostgreSQL CI real. Nunca se invoca desde Railway ni usa QA persistente. */
export async function verifyLaunchAPI(pool,{make,origin,E,B,creds}){
 await pool.query(await readFile(new URL('../commercial/launch-schema-qa.sql',import.meta.url),'utf8'));
 let service=make();const timings={},serverTimings=[];
 const call=async(path,token,body)=>{const t=performance.now();const response=await service(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));const value=await response.json();if(response.headers.has('Server-Timing'))serverTimings.push({path:path.split('?')[0],value:response.headers.get('Server-Timing')});(timings[path.split('?')[0]]??=[]).push(performance.now()-t);return {status:response.status,body:value};};
 const login=async role=>(await call('/auth/login','',creds[role])).body.accessToken;
 const token=await login('gerencia'),seller=await login('vendedor'),admin=await login('administracion'),warehouse=await login('armador'),driver=await login('chofer');
 const c=body=>({id:randomUUID(),empresaId:E,...body});
 for(const roleToken of [seller,warehouse,driver])for(const path of ['/admin/launch','/admin/launch/customers','/admin/launch/imports?id='+randomUUID()])assert.equal((await call(path,roleToken)).status,403);
 assert.equal((await call('/admin/launch',token)).status,200);
 const command=c({version:0,input:{tipoNegocio:'mixto',nombre:'Distribuidora CI',deposito:'Central CI'}});
 assert.equal((await call('/admin/launch',token,command)).status,200);
 assert.equal((await call('/admin/launch',token,command)).status,200);
 assert.equal((await call('/admin/launch',admin,c({version:1,input:command.input}))).status,403);
 assert.equal((await call('/admin/launch',token,c({version:0,input:command.input}))).status,409);
 assert.equal((await call('/admin/launch',token,{...c({version:1,input:command.input}),empresaId:B})).status,403);
 async function importRows(tipo,matrix){
  const prepare=c({tipo,matrix}),initial=await call('/admin/launch/imports',token,prepare);assert.equal(initial.status,200,JSON.stringify(initial));
  const id=initial.body.id;assert.equal((await call('/admin/launch/imports',token,prepare)).body.id,id);
  let current=initial.body,requests=0;
  while(current.resumen.some(r=>r.estado==='pendiente'&&r.cantidad)){
   const apply=c({tipo:'aplicar',importacionId:id});const concurrent=requests===0?await Promise.all([call('/admin/launch/imports/process',admin,apply),call('/admin/launch/imports/process',admin,apply)]):null;if(concurrent)assert.deepEqual(concurrent[0],concurrent[1]);const first=concurrent?.[0]??await call('/admin/launch/imports/process',admin,apply);assert.equal(first.status,200,JSON.stringify(first));
   const retry=await call('/admin/launch/imports/process',admin,apply);assert.deepEqual(retry,first);current=first.body;if(++requests>410)throw Error('Importación no progresa');
  }
  return {id,current};
 }
 const subscription=c({version:0,input:{estado:'prueba',hasta:'2030-01-01T00:00:00Z'}});assert.equal((await call('/admin/launch/subscription',token,subscription)).status,200);assert.equal((await call('/admin/launch/subscription',token,subscription)).status,200);assert.equal((await call('/admin/launch/subscription',admin,c({version:1,input:{estado:'suspendido',hasta:'2030-01-01'}}))).status,403);
 let sv=1;for(const estado of ['activo','pago_pendiente','suspendido','reactivado']){const changed=await call('/admin/launch/subscription',token,c({version:sv,input:{estado,hasta:'2030-01-01T00:00:00Z'}}));assert.equal(changed.status,200,JSON.stringify(changed));sv++;assert.equal(changed.body.datos.aplicarSuspension,false);}
 assert.equal((await call('/admin/launch/subscription',token)).body.vigencia.estado,'reactivado');
 const clients=await importRows('clientes',[['codigo','nombre','documento','direccion'],...Array.from({length:1500},(_,i)=>['LAUNCH-C'+i,'Cliente lanzamiento '+String(i).padStart(4,'0'),'LAUNCH-D'+i,'Calle '+i])]);assert.equal(clients.current.resumen.find(r=>r.estado==='aplicada')?.cantidad,1500,JSON.stringify(clients.current));
 const products=await importRows('productos',[['codigo','ean','nombre','marca','precio'],...Array.from({length:5000},(_,i)=>['LAUNCH-P'+i,'LAUNCH-EAN'+i,'Producto lanzamiento '+i,'Marca CI','25.50'])]);assert.equal(products.current.resumen.find(r=>r.estado==='aplicada')?.cantidad,5000,JSON.stringify(products.current));
 // Archivo repetido con otro comando conserva importación e identidades existentes.
 const existing=await importRows('productos',[['codigo','nombre','precio'],['LAUNCH-P0','Nombre que no se debe pisar','999']]);assert.equal(existing.current.resumen[0].cantidad,1);
 assert.equal(Number((await pool.query("SELECT precio_venta FROM public.productos WHERE empresa_id=$1 AND codigo_interno='LAUNCH-P0'",[E])).rows[0].precio_venta),25.5);
 const stock=await importRows('stock',[['codigo','cantidad'],['LAUNCH-P0','100']]);assert.equal(stock.current.resumen[0].estado,'aplicada',JSON.stringify(stock.current));
 const duplicateStock=await importRows('stock',[['codigo','cantidad'],['LAUNCH-P0','101']]);assert.equal(duplicateStock.current.resumen[0].estado,'error');
 assert.equal(Number((await pool.query("SELECT stock_actual FROM public.productos WHERE empresa_id=$1 AND codigo_interno='LAUNCH-P0'",[E])).rows[0].stock_actual),100);
 const bad=await importRows('clientes',[['codigo','nombre','documento'],['ERROR-C','','ERROR-D']]);assert.equal(bad.current.resumen[0].estado,'error');
 const fix=await call('/admin/launch/imports/process',token,c({tipo:'corregir',importacionId:bad.id,numero:2,encabezados:['codigo','nombre','documento'],fila:['ERROR-C','Corregido CI','ERROR-D']}));assert.equal(fix.status,200);
 assert.equal((await call('/admin/launch/imports/process',token,c({tipo:'aplicar',importacionId:bad.id}))).body.resumen[0].estado,'aplicada');
 const page=await call('/admin/launch/customers?q=Cliente%20lanzamiento&limit=30&offset=30',token);assert.equal(page.status,200,JSON.stringify(page));assert.equal(page.body.total,1500);assert.equal(page.body.items.length,30);
 const next=await call('/admin/launch/customers?q=Cliente%20lanzamiento&limit=30&offset=60',token);assert.ok(!next.body.items.some(c=>page.body.items.some(p=>p.id===c.id)));
 const sellerId=(await pool.query('SELECT vendedor_id FROM mayorista.vendedores WHERE empresa_id=$1 LIMIT 1',[E])).rows[0].vendedor_id,routeId=(await pool.query('SELECT ruta_id FROM mayorista.rutas WHERE empresa_id=$1 LIMIT 1',[E])).rows[0].ruta_id;
 const assignment=c({version:(await call('/admin/state',token)).body.revision,input:{clientes:page.body.items.slice(0,3).map(c=>c.id),vendedorId:sellerId,rutaId:routeId,listaId:null}}),assigned=await call('/admin/launch/customers',token,assignment);assert.equal(assigned.status,200,JSON.stringify(assigned));assert.deepEqual(await call('/admin/launch/customers',token,assignment),assigned);
 service=make();const persisted=await call('/admin/launch',token);assert.equal(persisted.body.datos.nombre,'Distribuidora CI');assert.equal(persisted.body.version,1);
 assert.equal((await call('/admin/launch/imports?id='+products.id,token)).body.resumen.find(r=>r.estado==='aplicada').cantidad,5000);
 for(const tipo of ['ventas','facturacion','cobranzas','deuda','vendedores','objetivos','clientes','rutas','productos','entregas','devoluciones']){const r=await call('/admin/reports/export?tipo='+tipo,token);assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.body.rows.length<=100);assert.equal(r.body.revision.length,64);}
 const firstHistory=await call('/orders/history?limit=1',seller);assert.equal(firstHistory.status,200);assert.ok(firstHistory.body.items.length<=1);if(firstHistory.body.items[0]){const first=firstHistory.body.items[0],next=await call('/orders/history?limit=1&before='+encodeURIComponent(first.recibidoEn)+'&id='+first.pedidoId,seller);assert.equal(next.status,200);assert.ok(next.body.items.every(p=>p.pedidoId!==first.pedidoId));}
 for(let sample=0;sample<20;sample++)assert.equal((await call('/catalog',token)).status,200);
 const db=await pool.connect();try{await db.query('BEGIN');await db.query('SET LOCAL ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[(await pool.query('SELECT user_id FROM mayorista.miembros WHERE empresa_id=$1 AND rol=$2 LIMIT 1',[E,'vendedor'])).rows[0].user_id]);assert.equal((await db.query('SELECT * FROM mayorista.importaciones')).rows.length,0);assert.equal((await db.query('SELECT * FROM mayorista.puesta_marcha')).rows.length,0);}finally{await db.query('ROLLBACK');db.release();}
 const metrics=Object.fromEntries(Object.entries(timings).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{n:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.min(v.length-1,Math.floor(v.length*.95))]}];}));
 await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/launch-ci-metrics.json',import.meta.url),JSON.stringify({environment:'PostgreSQL CI real; no Railway ni Android físico',clients:1500,products:5000,serverTimings,metrics},null,2));
 console.log('PASS lanzamiento PostgreSQL real: 1500 clientes, 5000 productos, apertura, reintentos, corrección, persistencia, padrón paginado, asignación y RLS',JSON.stringify(metrics));
}
