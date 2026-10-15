import assert from 'node:assert/strict';
import {verifyQaSigoLink} from './qa-sigo-link.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {createIsolatedService} from '../backend/service.mjs';
import {createIsolatedAuth,passwordRecord} from '../security/isolated-auth.mjs';
import {assertSharedFixture} from './shared-fixture-policy.mjs';
export async function prepareSharedBackendFixture(pool,{origin='https://shared.qa.invalid'}={}){
 await assertSharedFixture(pool);
 const E='30000000-0000-4000-8000-000000000001',B='30000000-0000-4000-8000-000000000002',U='30000000-0000-4000-8000-000000000011',V=randomUUID(),R=randomUUID();
 const C=(await pool.query('SELECT id FROM public.clientes_sigo WHERE empresa_id=$1',[E])).rows[0].id,P=(await pool.query('SELECT id FROM public.productos WHERE empresa_id=$1',[E])).rows[0].id;
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/007_lectura_compartida_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 await pool.query('UPDATE public.productos SET marca=$1,codigo_interno=$2,codigo_barras=$3 WHERE id=$4',['Marca SIGO','SIGO-001','7790012345678',P]);
 await pool.query(await readFile(new URL('../../../../supabase/migrations/20260913205500_carrito_devoluciones_anulaciones.sql',import.meta.url),'utf8'));
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/008_operacion_comercial_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/009_precios_compartidos_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/010_nota_credito_compartida_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 await pool.query((await readFile(new URL('../../../../docs/mayorista/sql/011_destino_predeterminado_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,''));
 // Sesiones Supabase y Mayorista permanecen separadas; ambas se validan sin reemplazar Auth SIGO.
 assert.equal((await pool.query("SELECT relkind FROM pg_class WHERE oid='auth.sessions'::regclass")).rows[0].relkind,'r');
 await pool.query('INSERT INTO mayorista.empresas VALUES($1,$2,true),($3,$4,true)',[E,'Empresa compartida QA',B,'Empresa minorista QA']);
 await pool.query('INSERT INTO mayorista.vendedores VALUES($1,$2,$3,true)',[E,V,'Vendedor fuente compartida']);
 await pool.query('INSERT INTO mayorista.rutas VALUES($1,$2,$3,$4)',[E,R,'Ruta compartida','Centro']);
 await pool.query('INSERT INTO mayorista.clientes(empresa_id,cliente_id,vendedor_id,nombre,ruta_id) VALUES($1,$2,$3,$4,$5)',[E,C,V,'Nombre QA que NO debe usarse',R]);
 const creds={},actors={},password=randomBytes(24).toString('hex'),hash=await passwordRecord(password);
 for(const [i,role] of ['gerencia','administracion','vendedor','armador','chofer'].entries()){
  const id=i===0?U:randomUUID(),email=role+'@shared.qa.invalid';creds[role]={email,password,empresaId:E};actors[role]=id;
  await pool.query('INSERT INTO auth.users VALUES($1) ON CONFLICT DO NOTHING',[id]);
  if(i)await pool.query('INSERT INTO public.empresa_usuarios VALUES($1,$2,true,$3)',[E,id,role==='administracion'?'admin':role==='vendedor'?'seller':'warehouse']);
  await pool.query('INSERT INTO mayorista_private.usuarios(user_id,email,salt,password_hash,nombre) VALUES($1,$2,$3,$4,$5)',[id,email,hash.salt,hash.hash,role]);
  await pool.query('INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,$3,$4)',[E,id,role==='vendedor'?V:null,role]);
 }
 // Una empresa QA sin binding compartido permanece en su circuito aprobado.
 await pool.query("INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,null,'gerencia')",[B,U]);
 await pool.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,1,$2)',[E,{empresaId:E,revision:1,vendedores:[{id:V,nombre:'Vendedor fuente compartida',zona:'Centro',activo:true}],rutas:[{id:R,nombre:'Ruta compartida',zona:'Centro'}],clientes:[{id:C,nombre:'Cliente SIGO compartido',direccion:'Sin dirección registrada',vendedorId:V,rutaId:R}],objetivos:[]}]);
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const policy={assertPool:p=>{assert.equal(p,pool);}};
 const make=(options={})=>createIsolatedService({enabled:true,pool,privateKey,publicKey,issuer:'shared-qa-acceptance',origin,rateLimit:async()=>true,operational:true,inventoryRequired:true,accountsEnabled:true,databasePolicy:policy,sharedSourceEnabled:true,...options});
 const rootAuth=createIsolatedAuth({enabled:true,pool,privateKey,publicKey,issuer:'shared-qa-acceptance',databasePolicy:policy,operational:true});
 return {E,B,U,V,R,C,P,creds,actors,make,origin,verifyRootToken:rootAuth.verify};
}
export async function verifySharedBackend(pool){
 const {E,B,U,V,R,C,P,creds,actors,make,origin,verifyRootToken}=await prepareSharedBackendFixture(pool);
 let service=make();
 const call=async(path,{token,body}={})=>{const res=await service(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:res.status,body:await res.json()};};
 const tokens={};for(const role of Object.keys(creds)){const result=await call('/auth/login',{body:creds[role]});assert.equal(result.status,200);tokens[role]=result.body.accessToken;assert.equal((await call('/me',{token:tokens[role]})).body.fuenteComercial,'sigo');}
 const newCustomer=randomUUID();await pool.query('INSERT INTO public.clientes_sigo(id,empresa_id,nombre,limite_credito,created_by) VALUES($1,$2,$3,0,$4)',[newCustomer,E,'Cliente existente sin asignar',U]);
 const customerCommand={id:randomUUID(),empresaId:E,version:1,operacion:'cliente',input:{id:newCustomer,vendedorId:V,rutaId:R,nombre:'No sobrescribir ficha',direccion:'No sobrescribir dirección',habilitado:true}};
 assert.equal((await call('/admin/commands',{token:tokens.gerencia,body:{...customerCommand,input:{...customerCommand.input,id:randomUUID()}}})).status,422);
 // La operación inválida anterior no consume UUID ni revisión.
 assert.equal((await call('/admin/commands',{token:tokens.gerencia,body:customerCommand})).status,200);
 assert.equal((await pool.query('SELECT nombre FROM public.clientes_sigo WHERE id=$1',[newCustomer])).rows[0].nombre,'Cliente existente sin asignar');
 assert.equal((await pool.query('SELECT nombre FROM mayorista.clientes WHERE cliente_id=$1',[newCustomer])).rows[0].nombre,'Cliente existente sin asignar');
 const seller=tokens.vendedor,owner=tokens.gerencia;
 const catalog=(await call('/catalog',{token:seller}));assert.equal(catalog.status,200);assert.equal(catalog.body.clientes.find(c=>c.id===C).nombre,'Cliente SIGO compartido');assert.equal(catalog.body.productos[0].nombre,'Producto SIGO compartido');assert.equal(Number(catalog.body.precios[0].precio),10);assert.equal(catalog.body.productos[0].ean,'7790012345678');assert.equal(catalog.body.productos[0].marca,'Marca SIGO');
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
 const dashboard=await call('/admin/dashboard',{token:owner});assert.equal(dashboard.status,200);assert.equal(dashboard.body.resumen.vendido,4000);assert.equal(dashboard.body.resumen.facturado,null);assert.equal(dashboard.body.resumen.cobrado,1000);assert.equal(dashboard.body.resumen.deudaPendiente,3000);
 const ownGoal={id:randomUUID(),empresaId:E,version:0,input:{id:randomUUID(),vendedorId:V,metrica:'vendido',periodo:'diario',desde:new Date().toISOString().slice(0,10),hasta:new Date().toISOString().slice(0,10),objetivo:2000,activa:true}};
 assert.equal((await call('/admin/goals/commands',{token:owner,body:ownGoal})).status,200);const own=await call('/goals',{token:seller});assert.equal(own.status,200);assert.equal(own.body.objetivos[0].real,1000);
 await pool.query('UPDATE public.sigo_empresa_modulos SET habilitado=false WHERE empresa_id=$1',[E]);
 assert.equal((await call('/shared/commerce',{token:owner})).status,403);
 assert.equal((await call('/inventory/commands',{token:owner,body:{id:randomUUID(),empresaId:E,tipo:'ingreso',input:{productoId:P,cantidad:1,comprobante:'NO-FALLBACK-QA'}}})).status,403);
 await pool.query('UPDATE public.sigo_empresa_modulos SET habilitado=true WHERE empresa_id=$1',[E]);
 const minorista=await call('/auth/login',{body:{...creds.gerencia,empresaId:B}});assert.equal((await call('/me',{token:minorista.body.accessToken})).body.fuenteComercial,undefined);
 // Nuevas extensiones: ficha, delegación explícita y devolución canónica no vendible.
 const ficha=await call('/shared/customers/'+C,{token:seller});assert.equal(ficha.status,200);assert.equal(ficha.body.compras.length,3);assert.ok(ficha.body.productosHabituales.length);assert.equal(ficha.body.deudaVencida,null);
 assert.equal((await call('/shared/customers/'+C,{token:tokens.armador})).status,403);
 const delegated={id:randomUUID(),empresaId:E,datos:{clienteId:newCustomer,centavos:100,medio:'efectivo',comprobante:'Cobro vendedor autorizado QA'}};
 assert.equal((await call('/shared/collections',{token:seller,body:delegated})).status,403);
 assert.equal((await call('/shared/collectors',{token:tokens.administracion,body:{empresaId:E,usuario:actors.vendedor,activo:true,limiteCentavos:1000}})).status,403);
 await pool.query('UPDATE public.clientes_sigo SET saldo_actual=2 WHERE id=$1',[newCustomer]);await pool.query("INSERT INTO public.cliente_movimientos_sigo(empresa_id,cliente_id,tipo,importe,concepto,created_by) VALUES($1,$2,'debe',2,'Saldo inicial QA',$3)",[E,newCustomer,U]);
 assert.equal((await call('/shared/collectors',{token:owner,body:{empresaId:E,usuario:actors.vendedor,activo:true,limiteCentavos:1000}})).status,200);
 const cobro=await call('/shared/collections',{token:seller,body:delegated});assert.equal(cobro.status,200);assert.deepEqual(await call('/shared/collections',{token:seller,body:delegated}),cobro);
 assert.equal(Number((await pool.query('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[newCustomer])).rows[0].saldo_actual),1);
 assert.equal((await call('/shared/collections',{token:tokens.chofer,body:delegated})).status,403);
 const collectedGoal={id:randomUUID(),empresaId:E,version:0,input:{...ownGoal.input,id:randomUUID(),metrica:'cobrado',objetivo:200}};assert.equal((await call('/admin/goals/commands',{token:owner,body:collectedGoal})).status,200);assert.equal((await call('/goals',{token:seller})).body.objetivos.find(g=>g.metrica==='cobrado').real,100);
 const original=ficha.body.compras.find(v=>v.lineas.some(l=>Number(l.cantidad)===2)),item=original.lineas[0],before=Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual);
 const returned={id:randomUUID(),empresaId:E,datos:{ventaId:original.id,motivo:'Revisión de mercadería QA',lineas:[{ventaItemId:item.id,cantidad:1,disposicion:'revision'}]}};
 assert.equal((await call('/shared/returns',{token:seller,body:returned})).status,403);
 const receiptReturn=await call('/shared/returns',{token:owner,body:returned});assert.equal(receiptReturn.status,200,JSON.stringify(receiptReturn));assert.deepEqual(await call('/shared/returns',{token:owner,body:returned}),receiptReturn);
 assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),before);
 const inspection={empresaId:E,devolucionId:receiptReturn.body.devolucionId,ventaItemId:item.id,disposicion:'vendible',motivo:'Inspección autorizada QA'};
 assert.equal((await call('/shared/returns/inspect',{token:owner,body:inspection})).status,200);assert.equal((await call('/shared/returns/inspect',{token:owner,body:inspection})).status,200);
 assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),before+1);
 assert.equal((await call('/shared/customers/'+C,{token:owner})).body.devoluciones.length,1);
 const metricsAfterReturn=(await call('/admin/dashboard',{token:owner})).body;assert.equal(metricsAfterReturn.resumen.cobrado,1100);assert.equal(metricsAfterReturn.resumen.devoluciones,1);assert.equal(metricsAfterReturn.resumen.vendido,3000);
 // Listas derivadas y presentaciones conservan el precio base SIGO y el UUID recibido.
 const priceList=randomUUID(),pack=randomUUID();
 assert.equal((await call('/shared/pricing',{token:seller,body:{empresaId:E,datos:{tipo:'lista',id:priceList,nombre:'Lista distribuidores',activa:true}}})).status,403);
 assert.equal((await call('/shared/pricing',{token:owner,body:{empresaId:E,datos:{tipo:'lista',id:priceList,nombre:'Lista distribuidores',activa:true}}})).status,200);
 assert.equal((await call('/shared/pricing',{token:owner,body:{empresaId:E,datos:{tipo:'presentacion',id:pack,productoId:P,listaId:priceList,presentacion:'pack',unidadesBase:6,ajustePorcentaje:-10,minUnidades:6,desde:new Date(Date.now()-60000).toISOString(),hasta:new Date(Date.now()+86400000).toISOString(),activa:true}}})).status,200);
 const latestPlan=(await call('/admin/state',{token:owner})).body;
 assert.equal((await call('/admin/commands',{token:owner,body:{id:randomUUID(),empresaId:E,version:latestPlan.revision,operacion:'cliente',input:{id:newCustomer,vendedorId:V,rutaId:R,listaId:priceList,habilitado:true}}})).status,200);
 const updated=(await call('/catalog',{token:seller})).body;assert.equal(updated.clientes.find(c=>c.id===newCustomer).listaId,priceList);assert.equal(Number(updated.precios.find(p=>p.id===pack).precio),54);
 assert.equal(Number((await pool.query('SELECT precio_venta FROM public.productos WHERE id=$1',[P])).rows[0].precio_venta),10);
 const variantOrder={...pedido,pedidoId:randomUUID(),clienteId:newCustomer,lineas:[{productoId:P,precioId:pack,presentacion:'pack',unidadesBase:6,cantidad:6,precioUnitario:9,observacion:'Entregar pack cerrado'}],comerciales:{condicionPago:'transferencia',observacion:'Avisar antes de llegar'}};
 const variantReceipt=await call('/orders',{token:seller,body:variantOrder});assert.equal(variantReceipt.status,200,JSON.stringify(variantReceipt));assert.deepEqual(await call('/orders',{token:seller,body:variantOrder}),variantReceipt);
 const stored=(await pool.query('SELECT comerciales,lineas FROM mayorista.pedidos WHERE pedido_id=$1',[variantOrder.pedidoId])).rows[0];assert.equal(stored.comerciales.condicionPago,'transferencia');assert.equal(stored.lineas[0].precioId,pack);
 assert.equal((await call('/orders',{token:seller,body:{...variantOrder,pedidoId:randomUUID(),lineas:[{...variantOrder.lineas[0],precioUnitario:8}]}})).status,409);
 assert.equal((await call('/orders',{token:seller,body:{...variantOrder,pedidoId:randomUUID(),lineas:[{...variantOrder.lineas[0],cantidad:1}]}})).status,409);
 // Ofertas SIGO vigentes combinan su descuento con la política comercial; no se copia otro precio base.
 await pool.query('INSERT INTO public.ofertas_productos_sigo VALUES($1,$2,10,current_date-1,current_date+1)',[E,P]);
 const offered=(await call('/catalog',{token:seller})).body;assert.equal(Number(offered.precios.find(p=>p.id===pack).precio),48.6);assert.equal(offered.ofertas.length,1);assert.deepEqual(await call('/orders',{token:seller,body:variantOrder}),variantReceipt);
 const offeredOrder={...variantOrder,pedidoId:randomUUID(),lineas:[{...variantOrder.lineas[0],precioUnitario:8.1}]};assert.equal((await call('/orders',{token:seller,body:offeredOrder})).status,200);
 await pool.query('UPDATE public.ofertas_productos_sigo SET fecha_inicio=current_date-4,fecha_fin=current_date-2 WHERE empresa_id=$1 AND producto_id=$2',[E,P]);assert.equal((await call('/catalog',{token:seller})).body.ofertas.length,0);assert.deepEqual((await call('/orders',{token:seller,body:offeredOrder})).status,200);assert.equal((await call('/orders',{token:seller,body:{...offeredOrder,pedidoId:randomUUID()}})).status,409);
 // Sustitución con cotización servidor, faltante original conservado y stock del sustituto una vez.
 const substitute=randomUUID(),subPrice=randomUUID();
 await pool.query('INSERT INTO public.productos(id,empresa_id,nombre,precio_venta,stock_actual,activo) VALUES($1,$2,$3,3,20,true)',[substitute,E,'Sustituto SIGO QA']);
 assert.equal((await call('/shared/pricing',{token:owner,body:{empresaId:E,datos:{tipo:'presentacion',id:subPrice,productoId:substitute,listaId:priceList,presentacion:'unidad',unidadesBase:1,ajustePorcentaje:0,minUnidades:1,desde:new Date(Date.now()-60000).toISOString(),hasta:new Date(Date.now()+86400000).toISOString(),activa:true}}})).status,200);
 const secondLoad=randomUUID();let root=(await call('/cargas',{token:owner})).body;
 for(const [tipo,input] of [['aprobar',{pedidoId:variantOrder.pedidoId}],['codigo',{productoId:substitute,codigo:'SUB-001',unidadesBase:1}],['crear',{id:secondLoad,camion:'QA-002',ruta:R,chofer:'Chofer sustitución',responsable:'Armador sustitución',modo:'individual'}],['asignar',{cargaId:secondLoad,pedidoId:variantOrder.pedidoId}]]){const r=await call('/cargas/commands',{token:owner,body:{id:randomUUID(),empresaId:E,version:root.revision,tipo,input}});assert.equal(r.status,200,JSON.stringify(r));root=r.body;}
 assert.equal((await call('/operations/loads',{token:owner,body:{cargaId:secondLoad,armadorUserId:actors.armador,choferUserId:actors.chofer}})).status,200);
 let version=0;const step=async(role,tipo,input={})=>{const r=await call('/operations/loads/commands',{token:tokens[role],body:{id:randomUUID(),empresaId:E,version,tipo,input:{cargaId:secondLoad,...input}}});if(r.status===200)version++;return r;};
 assert.equal((await step('armador','iniciar')).status,200);
 const substitution={pedidoId:variantOrder.pedidoId,productoId:P,faltante:6,sustitutoId:substitute,precioId:subPrice,cantidad:6,precioUnitario:0.01,nombre:'Nombre no confiable',nota:'Cambio autorizado por gerencia'};
 assert.equal((await step('armador','sustituir',substitution)).status,403);
 const changed=await step('gerencia','sustituir',substitution);assert.equal(changed.status,200,JSON.stringify(changed));const changedOrder=changed.body.load.pedidos[variantOrder.pedidoId];assert.equal(changedOrder.lineas[0].cantidad,6);assert.equal(changedOrder.lineas[0].sustituciones[0].autorizadoPor,U);assert.equal(changedOrder.lineas[1].precioUnitario,3);assert.equal(changedOrder.lineas[1].nombre,'Sustituto SIGO QA');
 assert.equal((await step('armador','escanear',{codigo:'SUB-001',cantidad:6,modo:'picking'})).status,200);assert.equal((await step('armador','verificar')).status,200);assert.equal((await step('armador','cargar',{nota:'Hoja de carga controlada'})).body.load.estado,'cargada');
 assert.equal((await step('gerencia','salir',{nota:'Salida con sustitución'})).status,200);
 const deliveredId=randomUUID(),delivered=await call('/operations/loads/commands',{token:tokens.chofer,body:{id:deliveredId,empresaId:E,version,tipo:'entregar',input:{cargaId:secondLoad,pedidoId:variantOrder.pedidoId,lineas:[{productoId:P,entregado:0,devuelto:0},{productoId:substitute,entregado:6,devuelto:0}],nota:'Sustituto recibido por cliente'}}});assert.equal(delivered.status,200,JSON.stringify(delivered));
 const sharedSub={id:deliveredId,empresaId:E,tipo:'entrega',datos:{pedidoId:variantOrder.pedidoId,clienteId:newCustomer,medioPago:'cuenta_corriente',lineas:[{productoId:substitute,cantidad:6,precioUnitario:3}]}};
 const substitutedSale=await call('/shared/commerce',{token:owner,body:sharedSub});assert.equal(substitutedSale.body.estado,'confirmado',JSON.stringify(substitutedSale));assert.deepEqual(await call('/shared/commerce',{token:owner,body:sharedSub}),substitutedSale);
 assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),before+1);assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[substitute])).rows[0].stock_actual),14);
 const subVenta=(await pool.query('SELECT medio_pago,total FROM public.ventas_sigo WHERE id=$1',[substitutedSale.body.ventaId])).rows[0];assert.equal(subVenta.medio_pago,'transferencia');assert.equal(Number(subVenta.total),18);
 // Devolución del chofer → registro SIGO con UUID físico, sin repetir contrapartida.
 const currentLoad=(await call('/operations/loads',{token:owner})).body.cargas.find(l=>l.cargaId===secondLoad),physicalId=randomUUID();
 const physical=await call('/operations/loads/commands',{token:tokens.chofer,body:{id:physicalId,empresaId:E,version:currentLoad.version,tipo:'devolver',input:{cargaId:secondLoad,pedidoId:variantOrder.pedidoId,productoId:substitute,cantidad:2,nota:'Devolución física de sustituto QA'}}});assert.equal(physical.status,200,JSON.stringify(physical));
 const reconcile={empresaId:E,cargaId:secondLoad,eventoId:physicalId,disposicion:'vendible',motivo:'Recepción vendible autorizada QA'};
 assert.equal((await call('/shared/returns/from-load',{token:tokens.chofer,body:reconcile})).status,403);
 const reconciled=await call('/shared/returns/from-load',{token:owner,body:reconcile});assert.equal(reconciled.status,200,JSON.stringify(reconciled));assert.deepEqual(await call('/shared/returns/from-load',{token:owner,body:reconcile}),reconciled);assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[substitute])).rows[0].stock_actual),16);
 assert.equal((await call('/shared/returns/from-load',{token:owner,body:{...reconcile,disposicion:'averiada'}})).status,409);
 assert.equal((await pool.query('SELECT comando_id FROM public.sigo_mayorista_devoluciones_control WHERE devolucion_id=$1',[reconciled.body.devolucionId])).rows[0].comando_id,physicalId);
 // Usuarios SIGO conservan sus roles canónicos; permisos Mayorista viven en su membresía propia.
 assert.equal((await call('/admin/users/candidates',{token:owner})).status,200);
 const employeeId=randomUUID();await pool.query('ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text');await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[employeeId,'existing-staff@qa.invalid']);await pool.query("INSERT INTO public.empresa_usuarios VALUES($1,$2,true,'seller')",[E,employeeId]);const authCount=Number((await pool.query('SELECT count(*) FROM auth.users')).rows[0].count);
 assert.ok((await call('/admin/users/candidates',{token:owner})).body.some(u=>u.id===employeeId));
 const link={id:randomUUID(),empresaId:E,tipo:'crear',input:{userId:employeeId,nombre:'Usuario SIGO existente',email:'existing-staff@qa.invalid',password:'AccesoMayoristaExistente2026!',rol:'vendedor',vendedorId:V}};
 const linked=await call('/admin/users/commands',{token:owner,body:link});assert.equal(linked.status,200,JSON.stringify(linked));assert.deepEqual(await call('/admin/users/commands',{token:owner,body:link}),linked);assert.equal(Number((await pool.query('SELECT count(*) FROM auth.users')).rows[0].count),authCount);
 const employeeLogin=await call('/auth/login',{body:{empresaId:E,email:link.input.email,password:link.input.password}});assert.equal(employeeLogin.status,200);assert.equal((await call('/me',{token:employeeLogin.body.accessToken})).body.fuenteComercial,'sigo');assert.equal((await pool.query('SELECT rol FROM public.empresa_usuarios WHERE empresa_id=$1 AND user_id=$2',[E,employeeId])).rows[0].rol,'seller');
 const forbiddenNew={id:randomUUID(),empresaId:E,tipo:'crear',input:{userId:randomUUID(),nombre:'No crear otro usuario SIGO',email:'no-create@qa.invalid',password:'ClaveMayoristaSegura2026!',rol:'vendedor',vendedorId:V}};
 assert.equal((await call('/admin/users/commands',{token:owner,body:forbiddenNew})).status,422);
 const permissions={id:randomUUID(),empresaId:E,tipo:'permisos',input:{userId:actors.armador,rol:'chofer',vendedorId:null,activo:true}};
 assert.equal((await call('/admin/users/commands',{token:owner,body:permissions})).status,200);
 const reassigned=await call('/auth/login',{body:creds.armador});assert.equal(reassigned.status,200);assert.equal((await call('/me',{token:reassigned.body.accessToken})).body.rol,'chofer');assert.equal((await pool.query('SELECT rol FROM public.empresa_usuarios WHERE empresa_id=$1 AND user_id=$2',[E,actors.armador])).rows[0].rol,'warehouse');
 assert.equal((await call('/admin/users/commands',{token:owner,body:{...permissions,id:randomUUID(),input:{...permissions.input,rol:'armador'}}})).status,200);
 // Cuenta corriente ya cobrada: solo gerencia autoriza crédito real a favor, sin alterar RPC Minorista.
 const paidProfile=(await call('/shared/customers/'+C,{token:owner})).body,remainingSale=paidProfile.compras.find(v=>v.id!==original.id&&v.medio_pago==='cuenta_corriente'&&v.estado==='confirmada'),balanceBeforePaid=Number(paidProfile.cliente.saldo_actual);
 const payment={id:randomUUID(),empresaId:E,datos:{clienteId:C,centavos:Math.round(balanceBeforePaid*100),medio:'efectivo',comprobante:'Saldar cuenta antes de devolución QA'}};assert.equal((await call('/shared/collections',{token:owner,body:payment})).status,200);
 const paidReturn={id:randomUUID(),empresaId:E,datos:{ventaId:remainingSale.id,motivo:'Saldo a favor autorizado por gerencia QA',autorizarSaldoFavor:true,lineas:[{ventaItemId:remainingSale.lineas[0].id,cantidad:1,disposicion:'averiada'}]}};
 const paidStock=Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual);
 assert.equal((await call('/shared/returns',{token:owner,body:{...paidReturn,datos:{...paidReturn.datos,autorizarSaldoFavor:false}}})).status,409);
 assert.equal((await call('/shared/returns',{token:tokens.administracion,body:paidReturn})).status,403);
 const paidReceipt=await call('/shared/returns',{token:owner,body:paidReturn});assert.equal(paidReceipt.status,200,JSON.stringify(paidReceipt));assert.deepEqual(await call('/shared/returns',{token:owner,body:paidReturn}),paidReceipt);assert.equal(Number((await pool.query('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[C])).rows[0].saldo_actual),-10);assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),paidStock);
 // Primer ingreso desde SIGO: reutiliza identidad canónica y crea únicamente metadata del módulo.
 const freshCompany=randomUUID();await pool.query('INSERT INTO public.empresas VALUES($1,true)',[freshCompany]);await pool.query("INSERT INTO public.empresa_usuarios VALUES($1,$2,true,'owner')",[freshCompany,U]);const connection=await pool.connect();try{await connection.query('BEGIN');await connection.query('SET LOCAL ROLE authenticated');await connection.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[U]);await connection.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[freshCompany,'mayorista']);await connection.query('COMMIT');}finally{connection.release();}
 service=make({sourceRevision:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',authenticateSigo:async token=>{const root=await verifyRootToken(token);return {id:root.userId,email:creds.gerencia.email};}});
 const forgedBridge=await call('/auth/sigo',{token:seller,body:{empresaId:freshCompany,userId:U,rol:'gerencia'}});assert.equal(forgedBridge.status,403);
 const direct=await call('/auth/sigo',{token:owner,body:{empresaId:freshCompany}});assert.equal(direct.status,200,JSON.stringify(direct));const directPrincipal=(await call('/me',{token:direct.body.accessToken})).body;assert.equal(directPrincipal.userId,U);assert.equal(directPrincipal.rol,'gerencia');assert.equal(directPrincipal.fuenteComercial,'sigo');assert.equal((await call('/catalog',{token:direct.body.accessToken})).body.productos.length,0);assert.equal((await pool.query('SELECT count(*) FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[freshCompany,U])).rows[0].count,'1');
 const directAgain=await call('/auth/sigo',{token:owner,body:{empresaId:freshCompany}});assert.equal(directAgain.status,200);assert.equal((await pool.query('SELECT count(*) FROM mayorista.miembros WHERE empresa_id=$1',[freshCompany])).rows[0].count,'1');
 await pool.query('UPDATE public.sigo_empresa_modulos SET habilitado=false WHERE empresa_id=$1',[freshCompany]);assert.equal((await call('/auth/sigo',{token:owner,body:{empresaId:freshCompany}})).status,403);assert.equal((await call('/auth/logout',{token:direct.body.accessToken,body:{}})).status,200);
 await call('/auth/logout',{token:owner,body:{}});assert.equal((await call('/shared/commerce',{token:owner})).status,401);
 await verifyQaSigoLink(pool,{make,E,origin});
 console.log('PASS fuente compartida backend: catálogo SIGO, cinco roles, UUID recuperable, escritores QA bloqueados, crédito y aislamiento');
 return [{name:'Backend conectado a fuente SIGO por empresa; cinco roles y escritores QA bloqueados',status:'pass'}];
}
