import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {createIsolatedService} from '../backend/service.mjs';
import {passwordRecord} from '../security/isolated-auth.mjs';
import {assertSharedFixture} from './shared-fixture-policy.mjs';
export async function verifySharedBackend(pool){
 await assertSharedFixture(pool);
 const E='30000000-0000-4000-8000-000000000001',B='30000000-0000-4000-8000-000000000002',U='30000000-0000-4000-8000-000000000011',V=randomUUID(),R=randomUUID();
 const C=(await pool.query('SELECT id FROM public.clientes_sigo WHERE empresa_id=$1',[E])).rows[0].id,P=(await pool.query('SELECT id FROM public.productos WHERE empresa_id=$1',[E])).rows[0].id;
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/007_lectura_compartida_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 // SOLO el fixture QA usa la identidad nativa: ninguna función Auth de Supabase real se modifica.
 await pool.query('DROP TABLE auth.sessions; CREATE VIEW auth.sessions AS SELECT session_id AS id,user_id FROM mayorista_private.sesiones WHERE NOT revocada AND vence_en>now(); REVOKE ALL ON auth.sessions FROM public,anon,authenticated');
 await pool.query('INSERT INTO mayorista.empresas VALUES($1,$2,true),($3,$4,true)',[E,'Empresa compartida QA',B,'Empresa minorista QA']);
 await pool.query('INSERT INTO mayorista.vendedores VALUES($1,$2,$3,true)',[E,V,'Vendedor fuente compartida']);
 await pool.query('INSERT INTO mayorista.rutas VALUES($1,$2,$3,$4)',[E,R,'Ruta compartida','Centro']);
 await pool.query('INSERT INTO mayorista.clientes(empresa_id,cliente_id,vendedor_id,nombre,ruta_id) VALUES($1,$2,$3,$4,$5)',[E,C,V,'Nombre QA que NO debe usarse',R]);
 const creds={},actors={},password=randomBytes(24).toString('hex'),hash=await passwordRecord(password);
 for(const [i,role] of ['gerencia','administracion','vendedor','armador','chofer'].entries()){
  const id=i===0?U:randomUUID(),email=role+'@shared.qa.invalid';creds[role]={email,password,empresaId:E};actors[role]=id;
  await pool.query('INSERT INTO auth.users VALUES($1) ON CONFLICT DO NOTHING',[id]);
  if(i)await pool.query('INSERT INTO public.empresa_usuarios VALUES($1,$2,true,$3)',[E,id,role==='administracion'?'admin':role]);
  await pool.query('INSERT INTO mayorista_private.usuarios(user_id,email,salt,password_hash,nombre) VALUES($1,$2,$3,$4,$5)',[id,email,hash.salt,hash.hash,role]);
  await pool.query('INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,$3,$4)',[E,id,role==='vendedor'?V:null,role]);
 }
 // Una empresa QA sin binding compartido permanece en su circuito aprobado.
 await pool.query("INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,null,'gerencia')",[B,U]);
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const policy={assertPool:p=>{assert.equal(p,pool);}};
 const make=()=>createIsolatedService({enabled:true,pool,privateKey,publicKey,issuer:'shared-qa-acceptance',origin:'https://shared.qa.invalid',rateLimit:async()=>true,operational:true,inventoryRequired:true,accountsEnabled:true,databasePolicy:policy,sharedSourceEnabled:true});
 let service=make();
 const call=async(path,{token,body}={})=>{const res=await service(new Request('https://shared.qa.invalid'+path,{method:body?'POST':'GET',headers:{Origin:'https://shared.qa.invalid',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:res.status,body:await res.json()};};
 const tokens={};for(const role of Object.keys(creds)){const result=await call('/auth/login',{body:creds[role]});assert.equal(result.status,200);tokens[role]=result.body.accessToken;assert.equal((await call('/me',{token:tokens[role]})).body.fuenteComercial,'sigo');}
 const seller=tokens.vendedor,owner=tokens.gerencia;
 const catalog=(await call('/catalog',{token:seller}));assert.equal(catalog.status,200);assert.equal(catalog.body.clientes[0].nombre,'Cliente SIGO compartido');assert.equal(catalog.body.productos[0].nombre,'Producto SIGO compartido');assert.equal(Number(catalog.body.precios[0].precio),10);
 const pedido={pedidoId:randomUUID(),empresaId:E,vendedorId:V,clienteId:C,creadoEn:new Date().toISOString(),lineas:[{productoId:P,cantidad:1,precioUnitario:10}]};
 const receipt=await call('/orders',{token:seller,body:pedido});assert.equal(receipt.status,200);
 service=make();assert.deepEqual(await call('/orders',{token:seller,body:pedido}),receipt);
 assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.pedidos WHERE empresa_id=$1',[E])).rows[0].count),1);
 for(const role of ['vendedor','armador','chofer'])assert.equal((await call('/shared/commerce',{token:tokens[role]})).status,403);
 assert.equal((await call('/shared/commerce',{token:tokens.administracion})).status,200);
 assert.equal((await call('/catalog',{token:tokens.armador})).status,403);assert.equal((await call('/catalog',{token:tokens.chofer})).status,403);
 for(const path of ['/inventory/commands','/accounts/commands','/admin/catalog/commands'])assert.equal((await call(path,{token:owner,body:{id:randomUUID(),empresaId:E}})).status,409);
 assert.equal((await call('/shared/commerce',{token:owner,body:{id:randomUUID(),empresaId:B,tipo:'entrega'}})).status,403);
 const eventId=randomUUID(),loadId=randomUUID(),command={id:eventId,empresaId:E,tipo:'entrega',datos:{pedidoId:pedido.pedidoId,clienteId:C,medioPago:'cuenta_corriente',lineas:pedido.lineas}};
 assert.equal((await call('/shared/commerce',{token:owner,body:command})).status,409);
 let legacyVersion=0;
 for(const [tipo,input] of [['aprobar',{pedidoId:pedido.pedidoId}],['codigo',{productoId:P,codigo:'QA-UNIT-001',unidadesBase:1}],['crear',{id:loadId,camion:'QA-001',ruta:R,chofer:'Chofer QA',responsable:'Armador QA',modo:'individual'}],['asignar',{cargaId:loadId,pedidoId:pedido.pedidoId}]]){
  const r=await call('/cargas/commands',{token:owner,body:{id:randomUUID(),empresaId:E,version:legacyVersion++,tipo,input}});assert.equal(r.status,200,JSON.stringify(r));
 }
 assert.equal((await call('/operations/loads',{token:owner,body:{cargaId:loadId,armadorUserId:actors.armador,choferUserId:actors.chofer}})).status,200);
 let loadVersion=0;
 for(const [role,tipo,input] of [['armador','iniciar',{}],['armador','escanear',{codigo:'QA-UNIT-001',cantidad:1,modo:'picking'}],['armador','verificar',{}],['gerencia','salir',{nota:'Salida QA'}],['chofer','entregar',{pedidoId:pedido.pedidoId,lineas:[{productoId:P,entregado:1,devuelto:0}],nota:'Comprobante de entrega QA'}]]){
  const r=await call('/operations/loads/commands',{token:tokens[role],body:{id:tipo==='entregar'?eventId:randomUUID(),empresaId:E,version:loadVersion++,tipo,input:{cargaId:loadId,...input}}});assert.equal(r.status,200,JSON.stringify(r));
 }
 assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),7);
 const salesBefore=Number((await pool.query('SELECT count(*) FROM public.ventas_sigo WHERE empresa_id=$1',[E])).rows[0].count);
 let sale=await call('/shared/commerce',{token:owner,body:command});assert.equal(sale.status,200);assert.equal(sale.body.estado,'requiere_autorizacion');
 const credit={id:command.id,empresaId:E,tipo:'credito',aprobar:true,motivo:'Crédito por pedido en backend QA'};
 assert.equal((await call('/shared/commerce',{token:tokens.administracion,body:credit})).status,403);
 assert.equal((await call('/shared/commerce',{token:owner,body:credit})).body.estado,'aprobado');
 sale=await call('/shared/commerce',{token:owner,body:command});assert.equal(sale.body.estado,'confirmado');assert.deepEqual(await call('/shared/commerce',{token:owner,body:command}),sale);
 assert.equal(Number((await pool.query('SELECT count(*) FROM public.ventas_sigo WHERE empresa_id=$1',[E])).rows[0].count),salesBefore+1);
 assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),6);
 assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.movimientos_inventario WHERE empresa_id=$1',[E])).rows[0].count),0);
 const minorista=await call('/auth/login',{body:{...creds.gerencia,empresaId:B}});assert.equal((await call('/me',{token:minorista.body.accessToken})).body.fuenteComercial,undefined);
 await call('/auth/logout',{token:owner,body:{}});assert.equal((await call('/shared/commerce',{token:owner})).status,401);
 console.log('PASS fuente compartida backend: catálogo SIGO, cinco roles, UUID recuperable, escritores QA bloqueados, crédito y aislamiento');
 return [{name:'Backend conectado a fuente SIGO por empresa; cinco roles y escritores QA bloqueados',status:'pass'}];
}
