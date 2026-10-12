import {verifyCargasApi} from './cargas-api.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {verifyNativeBrowsers} from './native-browser.mjs';
import pg from '../backend/node_modules/pg/lib/index.js';
import {createIsolatedService} from '../backend/service.mjs';
import {passwordRecord} from '../security/isolated-auth.mjs';

const pool=new pg.Pool({host:'127.0.0.1',port:55471,database:'mayorista_qa',user:'postgres',password:'mayorista_ci_only',max:30});
const origin='https://127.0.0.1:4181',E='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',U='10000000-0000-4000-8000-000000001001',V='10000000-0000-4000-8000-000000000011',C='10000000-0000-4000-8000-000000000101',P='10000000-0000-4000-8000-000000000301';
const results=[];let server;
async function check(name,fn){await fn();results.push({name,status:'pass'});console.log('PASS:',name);}
const keys=generateKeyPairSync('ed25519');
const handler=createIsolatedService({enabled:true,pool,...keys,origin,issuer:'sigo-mayorista-ci',rateLimit:async()=>true,inventoryRequired:true,accountsEnabled:true});
async function listen(){
  server=createServer(async(req,res)=>{try{const request=new Request('http://127.0.0.1:4180'+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:req,duplex:'half'})});const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(503);res.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4180,'127.0.0.1',resolve);});
}
const call=async(path,{token,body,method=body?'POST':'GET'}={})=>{const r=await fetch('http://127.0.0.1:4180'+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
const order=()=>({empresaId:E,vendedorId:V,clienteId:C,pedidoId:randomUUID(),creadoEn:new Date().toISOString(),lineas:[{productoId:P,cantidad:2,precioUnitario:10}]});
try{
  const proposal=(await readFile(new URL('../../../../docs/mayorista/sql/002_seguridad_preparada_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;.*$/m,'');
  // El job RLS previo hace rollback. Crear únicamente en DB fija localhost mayorista_qa.
  await pool.query(`BEGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;${proposal}${(await readFile(new URL('../../../../docs/mayorista/sql/003_flujo_administrativo_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${(await readFile(new URL('../../../../docs/mayorista/sql/004_administracion_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${(await readFile(new URL('../cargas/schema-qa.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${(await readFile(new URL('../commercial/visits-schema-qa.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${(await readFile(new URL('../commercial/inventory-schema-qa.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${(await readFile(new URL('../commercial/accounts-schema-qa.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^rollback;$/m,'')}${await readFile(new URL('./native-auth-schema.sql',import.meta.url),'utf8')}COMMIT;`);
  await pool.query('INSERT INTO mayorista.vendedores VALUES($1,$2,$3,true)',[E,V,'Vendedor QA']);
  await pool.query('INSERT INTO mayorista.miembros VALUES($1,$2,$3,$4,true)',[E,U,V,'vendedor']);
  await pool.query('INSERT INTO mayorista.clientes(empresa_id,cliente_id,vendedor_id,nombre) VALUES($1,$2,$3,$4)',[E,C,V,'Cliente QA']);
  await pool.query('INSERT INTO mayorista.productos VALUES($1,$2,$3,true)',[E,P,'Producto QA']);
  await pool.query('INSERT INTO mayorista.precios VALUES($1,$2,$3,1,10)',[E,randomUUID(),P]);
  const password='contraseña-efímera-'+randomUUID(),record=await passwordRecord(password);
  await pool.query('INSERT INTO mayorista_private.usuarios(user_id,email,salt,password_hash) VALUES($1,$2,$3,$4)',[U,'vendedor@qa.invalid',record.salt,record.hash]);
  await listen();let token,token2;
  await check('Contraseña real verificada y token Ed25519 firmado',async()=>{const r=await call('/auth/login',{body:{email:'vendedor@qa.invalid',password,empresaId:E}});assert.equal(r.status,200);token=r.body.accessToken;assert.equal((await call('/me',{token})).body.userId,U);});
  await check('Contraseña incorrecta, UUID inválido y otra empresa rechazados',async()=>{assert.equal((await call('/auth/login',{body:{email:'vendedor@qa.invalid',password:'incorrecta',empresaId:E}})).status,401);assert.equal((await call('/auth/login',{body:{email:'vendedor@qa.invalid',password,empresaId:'invalid'}})).status,401);assert.equal((await call('/auth/login',{body:{email:'vendedor@qa.invalid',password,empresaId:B}})).status,403);});
  await check('Firma alterada y acceso sin sesión rechazados',async()=>{const parts=token.split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.empresaId=B;parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');assert.equal((await call('/me',{token:parts.join('.')})).status,401);assert.equal((await call('/orders')).status,401);});
  const first=order();let receipt;
  await check('20 envíos HTTP concurrentes, una fila y un acuse estable',async()=>{const rs=await Promise.all(Array.from({length:20},()=>call('/orders',{token,body:first})));for(const r of rs)assert.equal(r.status,200);receipt=rs[0].body;for(const r of rs)assert.deepEqual(r.body,receipt);assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.pedidos')).rows[0].count),1);});
  await check('UUID con contenido diferente produce conflicto sin sobrescribir',async()=>{assert.equal((await call('/orders',{token,body:{...first,lineas:[{...first.lineas[0],cantidad:3}]}})).status,409);});
  await check('Pedido de otra empresa o cliente no asignado no se guarda',async()=>{assert.equal((await call('/orders',{token,body:{...order(),empresaId:B}})).status,403);assert.equal((await call('/orders',{token,body:{...order(),clienteId:randomUUID()}})).status,409);});
  await check('Segunda sesión independiente ve el mismo pedido sin duplicarlo',async()=>{token2=(await call('/auth/login',{body:{email:'vendedor@qa.invalid',password,empresaId:E}})).body.accessToken;assert.deepEqual((await call('/orders',{token:token2,body:first})).body,receipt);assert.equal((await call('/orders',{token:token2})).body.length,1);});
  await check('Caída y reapertura del servidor conserva UUID y acuse en PostgreSQL',async()=>{await new Promise(resolve=>server.close(resolve));await assert.rejects(()=>call('/orders',{token,body:first}));await listen();assert.deepEqual((await call('/orders',{token,body:first})).body,receipt);});
  await check('Precio cambiado rechaza nuevo pedido y permite recuperar acuse previo',async()=>{await pool.query('UPDATE mayorista.precios SET precio=12');assert.equal((await call('/orders',{token,body:order()})).status,409);assert.deepEqual((await call('/orders',{token,body:first})).body,receipt);});
  await check('Logout revoca una sesión y conserva la segunda',async()=>{assert.equal((await call('/auth/logout',{token,method:'POST'})).status,200);assert.equal((await call('/me',{token})).status,401);assert.equal((await call('/me',{token:token2})).status,200);});
  await check('Catálogo real restringido por empresa y vendedor',async()=>{const r=await call('/catalog',{token:token2});assert.equal(r.status,200);assert.equal(r.body.clientes.length,1);assert.equal(r.body.productos[0].id,P);});
  await pool.query('UPDATE mayorista.precios SET precio=10');
  const visit={id:randomUUID(),empresaId:E,vendedorId:V,clienteId:C,resultado:'sin_pedido',nota:'Visita QA',registradaEn:new Date().toISOString(),gps:{latitud:-34.6,longitud:-58.38,precision:12}};
  await check('20 visitas HTTP concurrentes guardan una visita y un acuse estable',async()=>{const rs=await Promise.all(Array.from({length:20},()=>call('/visits',{token:token2,body:visit})));assert.ok(rs.every(r=>r.status===200));assert.ok(rs.every(r=>JSON.stringify(r.body)===JSON.stringify(rs[0].body)));assert.equal((await call('/visits',{token:token2})).body.length,1);});
  await check('Visita recupera acuse y rechaza UUID alterado, empresa falsa y GPS inválido',async()=>{assert.equal((await call('/visits',{token:token2,body:visit})).status,200);assert.equal((await call('/visits',{token:token2,body:{...visit,nota:'UUID alterado'}})).status,409);assert.equal((await call('/visits',{token:token2,body:{...visit,id:randomUUID(),empresaId:B}})).status,403);assert.equal((await call('/visits',{token:token2,body:{...visit,id:randomUUID(),gps:{latitud:91,longitud:0,precision:1}}})).status,422);});
  await check('RLS de visitas prohíbe UPDATE/DELETE y oculta otra empresa',async()=>{const c=await pool.connect();try{for(const sql of ['UPDATE mayorista.visitas SET huella=huella','DELETE FROM mayorista.visitas']){await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[U]);await assert.rejects(()=>c.query(sql),e=>e.code==='42501');await c.query('ROLLBACK');}await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[U]);assert.equal((await c.query('SELECT * FROM mayorista.visitas WHERE empresa_id=$1',[B])).rows.length,0);}finally{await c.query('ROLLBACK');c.release();}});
  results.push(...await verifyNativeBrowsers({handler,password,empresaId:E,vendedorId:V,clienteId:C,productoId:P}));
  assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.pedidos')).rows[0].count),204);
  await check('Vendedor no puede administrar pedidos',async()=>{assert.equal((await call('/admin/fulfillment',{token:token2,body:{empresaId:E,pedidoId:first.pedidoId}})).status,403);});
  await check('RLS rechaza escritura administrativa directa de un vendedor',async()=>{
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[U,JSON.stringify({sub:U,is_anonymous:false})]);await assert.rejects(()=>c.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,1,$2::jsonb)',[E,JSON.stringify({empresaId:E})]),e=>e.code==='42501');}finally{await c.query('ROLLBACK');c.release();}
  });
  await check('Vendedor no obtiene acceso al inventario independiente',async()=>{assert.equal((await call('/inventory',{token:token2})).status,403);assert.equal((await call('/accounts',{token:token2})).status,403);assert.equal((await call('/inventory/commands',{token:token2,body:{id:randomUUID(),empresaId:E,tipo:'ingreso',input:{productoId:P,cantidad:1,comprobante:'NO-ADMIN'}}})).status,403);});
  await pool.query("UPDATE mayorista.miembros SET rol='administrador' WHERE user_id=$1",[U]);
  await check('Vendedores, rutas, clientes y objetivos guardados bajo sesión administrativa',async()=>{
    const route=randomUUID();let version=0,last;
    for(const [operacion,input] of [['vendedor',{id:V,nombre:'Vendedor QA',zona:'Centro'}],['ruta',{id:route,nombre:'Ruta QA',zona:'Centro'}],['cliente',{id:C,nombre:'Cliente QA',direccion:'Calle QA',vendedorId:V,rutaId:route}],['objetivo',{vendedorId:V,importe:1000,visitas:3}]]){
      last={id:randomUUID(),empresaId:E,version,operacion,input};const r=await call('/admin/commands',{token:token2,body:last});assert.equal(r.status,200);assert.equal(r.body.revision,++version);
    }
    const retry=await call('/admin/commands',{token:token2,body:last});assert.equal(retry.body.revision,4);
    const state=await call('/admin/state',{token:token2});assert.equal(state.status,200);assert.equal(state.body.clientes[0].vendedorId,V);assert.equal(state.body.objetivos[0].importe,1000);
    assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.comandos_administrativos')).rows[0].count),4);
  });
  await check('Administración concurrente y empresa falsa rechazadas sin borrar planificación',async()=>{
    const base={id:randomUUID(),empresaId:E,version:4,operacion:'vendedor',input:{id:V,nombre:'Actualización QA',zona:'Centro'}};
    const rs=await Promise.all([call('/admin/commands',{token:token2,body:base}),call('/admin/commands',{token:token2,body:{...base,id:randomUUID(),input:{...base.input,nombre:'Otra edición QA'}}})]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call('/admin/commands',{token:token2,body:{...base,id:randomUUID(),empresaId:B}})).status,403);
    assert.equal((await call('/admin/commands',{token:token2,body:{...base,id:randomUUID(),version:5,input:{...base.input,empresaId:B}}})).status,422);
    assert.equal((await call('/admin/state',{token:token2})).body.clientes.length,1);
  });
  await check('RLS oculta configuración administrativa de otra empresa',async()=>{
    await pool.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,1,$2::jsonb)',[B,JSON.stringify({empresaId:B})]);const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[U,JSON.stringify({sub:U,is_anonymous:false})]);assert.equal((await c.query('SELECT empresa_id FROM mayorista.administracion WHERE empresa_id=$1',[B])).rows.length,0);}finally{await c.query('ROLLBACK');c.release();}
  });
  await check('Administración autenticada prepara, despacha y entrega sin alterar acuse',async()=>{
    let version=0;
    for(const estado of ['preparacion','despachado','entregado']){
      const command={id:randomUUID(),empresaId:E,pedidoId:first.pedidoId,version,tipo:'estado',estado,nota:'Comprobante QA'};
      const r=await call('/admin/fulfillment',{token:token2,body:command});assert.equal(r.status,200);assert.equal(r.body.estado,estado);version++;
      const retry=await call('/admin/fulfillment',{token:token2,body:command});assert.equal(retry.body.version,version);
    }
    assert.deepEqual((await call('/orders',{token:token2,body:first})).body,receipt);
  });
  await check('Administración rechaza versión obsoleta y otra empresa',async()=>{assert.equal((await call('/admin/fulfillment',{token:token2,body:{id:randomUUID(),empresaId:E,pedidoId:first.pedidoId,version:0,tipo:'cobranza',centavos:100,nota:'QA recibo'}})).status,409);assert.equal((await call('/admin/fulfillment',{token:token2,body:{empresaId:B,pedidoId:first.pedidoId}})).status,403);});
  await check('Devoluciones y cobranzas aisladas conservan saldo auditado',async()=>{
    const base={empresaId:E,pedidoId:first.pedidoId,nota:'QA comprobante'};
    assert.equal((await call('/admin/fulfillment',{token:token2,body:{...base,id:randomUUID(),version:3,tipo:'devolucion',linea:0,cantidad:1}})).status,200);
    const r=await call('/admin/fulfillment',{token:token2,body:{...base,id:randomUUID(),version:4,tipo:'cobranza',centavos:1000}});assert.equal(r.status,200);assert.equal(r.body.version,5);assert.equal(r.body.eventos.length,5);
    assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.eventos_pedido')).rows[0].count),5);
  });
  await check('Dos administradores concurrentes no sobrescriben la versión',async()=>{
    const commands=Array.from({length:2},()=>({id:randomUUID(),empresaId:E,pedidoId:first.pedidoId,version:5,tipo:'devolucion',linea:0,cantidad:1,nota:'Devolución concurrente QA'}));
    const rs=await Promise.all(commands.map(body=>call('/admin/fulfillment',{token:token2,body})));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.eventos_pedido')).rows[0].count),6);
  });
  results.push(...await verifyCargasApi({call,token:token2,empresaId:E,otraEmpresa:B,productoId:P,pool,makeOrder:order,restart:async()=>{await new Promise(resolve=>server.close(resolve));await listen();}}));
  await check('Revocación de membresía impide acceso con token firmado vigente',async()=>{await pool.query('UPDATE mayorista.miembros SET activo=false WHERE user_id=$1',[U]);assert.equal((await call('/orders',{token:token2})).status,403);});
  console.log(`API PostgreSQL real: ${results.length} controles aprobados. Sesiones independientes, no teléfonos físicos.`);
}catch(e){results.push({status:'failure',error:e.message});throw e;}finally{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));await pool.end();
  await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/native-api-result.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),target:'127.0.0.1:55471/mayorista_qa',results},null,2));
}
