import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {installProductionFixture,inspectProductionSnapshot} from './production-schema-fixture.mjs';

// Sólo PostgreSQL efímero del job existente. Sin DATABASE_URL, Supabase ni Railway.
const {values}=parseArgs({options:{repo:{type:'string',default:'.'},schema:{type:'string'},out:{type:'string'}}});
if(!values.schema||!values.out)throw Error('Use --repo <checkout> --schema <reviewed-schema.fixture.json> --out <artifact.json>');
const root=resolve(values.repo),snapshot=JSON.parse(await readFile(resolve(values.schema),'utf8'));
const review=inspectProductionSnapshot(snapshot);assert.equal(review.ready,true);
const local=path=>import(pathToFileURL(resolve(root,path)).href);
const {default:pg}=await local('src/modules/mayorista/backend/node_modules/pg/lib/index.js');
const {acceptanceNamespace}=await local('src/modules/mayorista/railway/acceptance-namespace.mjs');
const {prepareCommercialMigrations,applyCommercialMigrationTransaction}=await local('src/modules/mayorista/backend/commercial-migrations.mjs');
const pool=new pg.Pool({host:'127.0.0.1',port:55471,database:'mayorista_qa',user:'postgres',password:'mayorista_ci_only',max:2});
const suffix=randomBytes(6).toString('hex'),namespace='mayorista_acceptance_'+suffix,role='prod_schema_ci_'+suffix;
const fixture=acceptanceNamespace(pool,namespace),results=[];
const profile={databaseName:'mayorista_qa',migrationRole:'postgres',runtimeRole:role,projectId:'isolated-ci-schema',environmentId:'ephemeral'};
const profileHash=createHash('sha256').update(namespace).digest('hex'),steps=await prepareCommercialMigrations(role);
const U=randomUUID(),UB=randomUUID(),E=randomUUID(),B=randomUUID(),P0=randomUUID(),PB=randomUUID(),C0=randomUUID(),S=randomUUID();
let createdRole=false,fixed;
const artifact={sourceHead:snapshot.sourceHead,executionHead:process.env.GITHUB_SHA??null,target:'CI localhost:55471/mayorista_qa',namespace,fixture:review,productionApplied:false,businessRowsExported:0,realProductionRuntimeRoleVerified:false,results};
try{
 const target=(await pool.query('SELECT current_database() db,current_user executor,inet_server_addr()::text address')).rows[0];
 assert.equal(target.db,'mayorista_qa');assert.equal(target.executor,'postgres');assert.equal(typeof target.address,'string');
 // El servicio Docker puede reportar inet_server_addr del bridge. La conexión
 // del proceso está fijada a loopback:puerto CI y no admite configuración externa.
 assert.equal(pool.options.host,'127.0.0.1');assert.equal(pool.options.port,55471);
 for(const r of ['anon','authenticated'])assert.equal((await pool.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) present',[r])).rows[0].present,true,'CI bootstrap roles required');
 await pool.query('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOBYPASSRLS');createdRole=true;
 fixed=await fixture.connect();
 // Una sola sesión fija para search_path y orden de DDL; jamás pool.query para ese setup.
 const session={acceptanceNamespace:namespace,schemas:fixture.schemas,query:(...args)=>fixed.query(...args)};
 artifact.fixtureInstallation=await installProductionFixture(session,snapshot);
 const q=(...args)=>fixed.query(...args);
 await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[U]);
 await q('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[U,'owner@fixture.invalid',UB,'other@fixture.invalid']);
 await q('INSERT INTO public.empresas(id,nombre,created_by) VALUES($1,$2,$3),($4,$5,$6)',[E,'Empresa sintética CI',U,B,'Segunda sintética CI',UB]);
 await q("INSERT INTO public.empresa_usuarios(empresa_id,user_id,rol,activo) VALUES($1,$2,'owner',true),($3,$4,'owner',true)",[E,U,B,UB]);
 await q('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[S,U]);
 await q("INSERT INTO public.productos(id,empresa_id,nombre,precio_venta,stock_actual,codigo_interno) VALUES($1,$2,'Minorista baseline',123.45,17,'BASELINE')",[P0,E]);
 await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[UB]);
 await q("INSERT INTO public.productos(id,empresa_id,nombre,precio_venta,stock_actual,codigo_interno) VALUES($1,$2,'Otra empresa',50,3,'OTHER')",[PB,B]);
 await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[U]);
 await q("INSERT INTO public.clientes_sigo(id,empresa_id,nombre,limite_credito,saldo_actual,created_by) VALUES($1,$2,'Minorista baseline',1000,7,$3)",[C0,E,U]);
 const baseline=async()=>JSON.stringify((await q(`SELECT
 (SELECT jsonb_agg(t ORDER BY id) FROM public.empresas t) companies,
 (SELECT jsonb_agg(t ORDER BY id) FROM public.productos t WHERE id=ANY($1::uuid[])) products,
 (SELECT jsonb_agg(t ORDER BY id) FROM public.clientes_sigo t WHERE id=$2) clients`,[[P0,PB],C0])).rows);
 const before=await baseline();
 const run=async(plan=steps)=>applyCommercialMigrationTransaction(fixed,{profile,profileHash,steps:plan});
 await assert.rejects(()=>run(steps.map(s=>s.version===21?{...s,sql:s.sql+';SELECT * FROM missing_production_schema_fixture_rollback;'}:s)),e=>e.code==='42P01');
 assert.deepEqual((await q("SELECT to_regnamespace('mayorista') module,to_regnamespace('mayorista_private') private")).rows[0],{module:null,private:null});
 assert.equal((await q("SELECT count(*)::int n FROM public.sigo_modulos_catalogo WHERE clave='mayorista_distribuidora'")).rows[0].n,0);
 assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='public.sigo_empresa_modulos'::regclass AND tgname='sigo_mayorista_auditar_flag'")).rows[0].n,0);
 assert.equal(await baseline(),before);results.push('rollback real v21 revierte DDL/catalogo/trigger/ledger y conserva baseline Minorista');
 assert.deepEqual(await run(),{installed:21,reused:false,seeded:false});
 assert.deepEqual(await run(),{installed:21,reused:true,seeded:false});assert.equal(await baseline(),before);
 assert.deepEqual((await q('SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version')).rows,steps.map(s=>({version:s.version,source_hash:s.sourceHash})));
 await q("UPDATE mayorista_private.release_migrations SET source_hash=repeat('0',64) WHERE version=1");await assert.rejects(()=>run(),/MIGRATION_LEDGER_DRIFT/);
 await q('UPDATE mayorista_private.release_migrations SET source_hash=$1 WHERE version=1',[steps[0].sourceHash]);
 await q('DELETE FROM mayorista_private.release_migrations WHERE version=21');await assert.rejects(()=>run(),/MIGRATION_LEDGER_DRIFT/);
 await q('INSERT INTO mayorista_private.release_migrations(version,source_hash) VALUES(21,$1)',[steps[20].sourceHash]);
 results.push('instala 21, replay no-op, hashes exactos, rechazo drift y ledger parcial sobre esquema exportado');

 await q("SELECT public.declarar_tipo_negocio_sigo($1,'mixto')",[E]);
 await q('SELECT mayorista_private.bootstrap_commercial_identity($1,$2,$3,$4,$5,$6)',[U,E,'owner@fixture.invalid','a'.repeat(32),'b'.repeat(128),'a'.repeat(40)]);
 const act=async(sql,args=[])=>{
  await q('BEGIN');
  try{await q('SET LOCAL ROLE '+role);await q("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[U,JSON.stringify({sub:U,session_id:S,exp:Math.floor(Date.now()/1000)+3600})]);const result=await q(sql,args);await q('COMMIT');return result;}
  catch(e){await q('ROLLBACK');throw e;}
 };
 const actualRole=(await act('SELECT current_user name,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user')).rows[0];
 assert.deepEqual(actualRole,{name:role,rolsuper:false,rolbypassrls:false});
 const imported=(await act("SELECT mayorista.importar_fila($1,'productos','product-ci',$2::jsonb) result",[E,JSON.stringify({nombre:'Producto importado CI',codigo:'NEW-CI',ean:'7790000000001',precio:'12.50'})])).rows[0].result;
 const P=imported.registroId;assert.equal(imported.accion,'creada');
 const product=(await q('SELECT costo_actual,costo_ultima_compra,margen_ganancia,margen_porcentaje,stock_actual FROM public.productos WHERE id=$1',[P])).rows[0];
 assert.equal(Number(product.costo_actual),0);assert.equal(Number(product.costo_ultima_compra),0);assert.equal(Number(product.margen_ganancia),12.5);assert.equal(Number(product.margen_porcentaje),100);assert.equal(Number(product.stock_actual),0);
 await act("SELECT mayorista.importar_fila($1,'stock','product-ci',$2::jsonb)",[E,JSON.stringify({codigo:'NEW-CI',cantidad:'10'})]);
 const duplicate=(await act("SELECT mayorista.importar_fila($1,'productos','same-code-ci',$2::jsonb) result",[E,JSON.stringify({nombre:'Nombre distinto',codigo:'NEW-CI',precio:'99.99'})])).rows[0].result;
 assert.equal(duplicate.registroId,P);assert.equal(duplicate.accion,'existente_conservado');
 const C=(await act("SELECT mayorista.importar_fila($1,'clientes','client-ci',$2::jsonb) result",[E,JSON.stringify({nombre:'Cliente importado CI',documento:'CI-ONLY-001'})])).rows[0].result.registroId;
 results.push('rol CI limitado importa producto con costos=0/margen real y cliente; código existente conserva producto; apertura stock protegida');

 const command=randomUUID(),order=randomUUID(),payload={pedidoId:order,clienteId:C,medioPago:'cuenta_corriente',lineas:[{productoId:P,cantidad:2,precioUnitario:12.5}]};
 const deliver=(id=command,data=payload,company=E)=>act('SELECT public.registrar_entrega_mayorista_sigo($1,$2,$3::jsonb) result',[company,id,JSON.stringify(data)]);
 const sale=(await deliver()).rows[0].result;assert.equal(sale.estado,'confirmado');assert.deepEqual((await deliver()).rows[0].result,sale);
 const operational=async()=>JSON.stringify((await q(`SELECT
 (SELECT stock_actual FROM public.productos WHERE id=$1) stock,
 (SELECT saldo_actual FROM public.clientes_sigo WHERE id=$2) balance,
 (SELECT count(*) FROM public.ventas_sigo WHERE empresa_id=$3) sales,
 (SELECT count(*) FROM public.cliente_movimientos_sigo WHERE empresa_id=$3) movements,
 (SELECT count(*) FROM public.caja_movimientos_sigo WHERE empresa_id=$3) cash`,[P,C,E])).rows);
 assert.equal(Number((await q('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),8);
 assert.equal(Number((await q('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[C])).rows[0].saldo_actual),25);
 await assert.rejects(()=>deliver(command,{...payload,lineas:[{productoId:P,cantidad:3,precioUnitario:12.5}]}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>deliver(randomUUID(),payload,B),/MAYORISTA_FORBIDDEN/);
 const stable=await operational();
 await q("UPDATE public.productos SET categoria='NO_VENDIBLE' WHERE id=$1",[P]);
 await assert.rejects(()=>deliver(randomUUID()),/PRODUCT_NOT_SELLABLE/);assert.equal(await operational(),stable);
 await q("UPDATE public.productos SET categoria=NULL,codigo_interno='LEGACY-DUP-CI' WHERE id=$1",[P]);
 await assert.rejects(()=>deliver(randomUUID()),/PRODUCT_IDENTITY_REVIEW_REQUIRED/);assert.equal(await operational(),stable);
 await q("UPDATE public.productos SET codigo_interno='NEW-CI' WHERE id=$1",[P]);
 await assert.rejects(()=>q('UPDATE public.productos SET activo=false WHERE id=$1',[P]),/PRODUCT_HAS_STOCK/);
 results.push('entrega CC/replay stock único; guards NO_VENDIBLE/LEGACY e inactivación rechazan sin venta/saldo/stock parcial; otra empresa denegada');

 const payment=randomUUID();
 const collect=()=>act('SELECT public.registrar_cobro_mayorista_sigo($1,$2,$3,$4,500,$5,$6) result',[E,payment,C,order,'transferencia','CI-RECEIPT-ONLY']);
 assert.deepEqual((await collect()).rows[0].result,(await collect()).rows[0].result);
 assert.equal(Number((await q('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[C])).rows[0].saldo_actual),20);
 // Comprobante puramente sintético. Ninguna llamada externa/emisión ARCA.
 await q("INSERT INTO public.arca_comprobantes(empresa_id,venta_id,punto_venta,tipo_cbte,numero_cbte,cae,resultado) VALUES($1,$2,1,1,1,'00000000000001','A')",[E,sale.ventaId]);
 const item=(await q('SELECT id FROM public.venta_items_sigo WHERE venta_id=$1',[sale.ventaId])).rows[0].id;
 const returnKey=randomUUID(),returnData={ventaId:sale.ventaId,motivo:'Devolución sintética CI',lineas:[{ventaItemId:item,cantidad:1,disposicion:'vendible'}]};
 const giveBack=(key=returnKey,data=returnData)=>act('SELECT public.devolver_mayorista_sigo($1,$2,$3::jsonb) result',[E,key,JSON.stringify(data)]);
 const returned=(await giveBack()).rows[0].result;assert.deepEqual((await giveBack()).rows[0].result,returned);
 assert.equal(Number((await q('SELECT stock_actual FROM public.productos WHERE id=$1',[P])).rows[0].stock_actual),9);
 assert.equal(Number((await q('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[C])).rows[0].saldo_actual),7.5);
 const reserve=()=>act('SELECT public.reservar_nota_credito_mayorista_sigo($1,$2,1) result',[E,returned.devolucionId]);
 const reserved=(await reserve()).rows[0].result;assert.deepEqual((await reserve()).rows[0].result,reserved);
 assert.equal(reserved.reserva.venta_id,null);
 const confirm=()=>act('SELECT public.confirmar_nota_credito_mayorista_sigo($1,$2,$3::jsonb) result',[E,returned.devolucionId,JSON.stringify({cae:'00000000000002',resultado:'A',caeVencimiento:'2099-12-31',observaciones:[]})]);
 assert.deepEqual((await confirm()).rows[0].result,(await confirm()).rows[0].result);
 assert.equal((await q('SELECT count(*)::int n FROM public.arca_comprobantes WHERE empresa_id=$1',[E])).rows[0].n,2);
 results.push('cobro y devolución RPC productivas idempotentes; NC sintética venta_id NULL con guard real, reserva/replay/confirmación sin red ARCA');
 assert.equal(await baseline(),before);results.push('baseline Minorista sintético y otra empresa conservados tras operación Mayorista');
 artifact.status='pass';console.log('PASS esquema productivo sin datos: '+results.join('; '));
}catch(e){artifact.status='fail';artifact.error={name:e.name,code:e.code??null,message:e.message};throw e;}
finally{
 if(fixed){await fixed.query('ROLLBACK').catch(()=>{});await fixed.query('RESET ROLE').catch(()=>{});await fixed.query('RESET search_path').catch(()=>{});fixed.release();}
 for(const schema of Object.values(fixture.schemas))await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
 if(createdRole){await pool.query('DROP OWNED BY '+role);await pool.query('DROP ROLE '+role);}
 await pool.end();await mkdir(dirname(resolve(values.out)),{recursive:true});await writeFile(resolve(values.out),JSON.stringify(artifact,null,2)+'\n');
}
