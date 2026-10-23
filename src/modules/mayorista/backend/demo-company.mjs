import {createHash} from 'node:crypto';
import {passwordRecord} from '../security/isolated-auth.mjs';
import {assertSharedFixture} from '../tests/shared-fixture-policy.mjs';
import {installQaLocalAccounts} from './qa-local-accounts.mjs';
export const DEMO_COMPANY='30000000-0000-4000-8000-000000000001';
export function demoId(kind,n){const h=createHash('sha256').update('sigo-distribuidora-p0-v1:'+kind+':'+n).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
/** Sembrado único, transaccional y sin reset. Solo el namespace interactivo sintético.
 * La contraseña entra desde configuración privada y nunca se registra en la evidencia. */
export async function prepareDemoCompany(pool,{password,externalEmpresaId,period=new Date().toISOString().slice(0,7)}={}){
 await assertSharedFixture(pool);
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(period))throw Error('Periodo demo inválido');
 const scope=(await pool.query('SELECT external_empresa_id,qa_empresa_id FROM mayorista_private.qa_interactive_scope WHERE id=true')).rows[0];
 if(!externalEmpresaId||scope?.external_empresa_id!==externalEmpresaId||scope.qa_empresa_id!==DEMO_COMPANY)throw Error('Demo fuera del vínculo sintético autorizado');
 await installQaLocalAccounts(pool);
 const c=await pool.connect(),E=DEMO_COMPANY;
 try{
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('sigo-distribuidora-demo-p0-v1'))");
  await c.query(`CREATE TABLE IF NOT EXISTS mayorista_private.qa_demo_manifest(version integer primary key,empresa_id uuid not null,datos jsonb not null,creado_en timestamptz not null default now());
   ALTER TABLE mayorista_private.qa_demo_manifest ENABLE ROW LEVEL SECURITY;REVOKE ALL ON mayorista_private.qa_demo_manifest FROM public,anon,authenticated;`);
  const prior=(await c.query('SELECT empresa_id,datos FROM mayorista_private.qa_demo_manifest WHERE version=1')).rows[0];
  if(prior){if(prior.empresa_id!==E)throw Error('Manifest demo divergente');await c.query('COMMIT');return prior.datos;}
  const hash=await passwordRecord(password);
  const U=demoId('user-gerencia',0),names=['Centro','Norte','Sur','Oeste'];
  const existingSellers=(await c.query('SELECT vendedor_id AS id,nombre,activo FROM mayorista.vendedores WHERE empresa_id=$1 ORDER BY vendedor_id',[E])).rows;
  if(existingSellers.length>8)throw Error('Más de 8 vendedores existentes: se requiere conciliación, no se borran');
  const sellers=Array.from({length:8},(_,i)=>({id:existingSellers[i]?.id??demoId('seller',i),nombre:'Vendedor QA '+(i+1),zona:names[i%4],activo:true}));
  const routes=sellers.map((s,i)=>({id:demoId('route',i),nombre:'Ruta QA '+(i+1),zona:s.zona,dias:[i%5+1]}));
  const lists=[0,1].map(i=>({id:demoId('list',i),nombre:i?'Mayorista volumen QA':'Mayorista base QA'}));
  for(const s of sellers)await c.query('INSERT INTO mayorista.vendedores(empresa_id,vendedor_id,nombre,activo) VALUES($1,$2,$3,true) ON CONFLICT(empresa_id,vendedor_id) DO UPDATE SET nombre=excluded.nombre,activo=true',[E,s.id,s.nombre]);
  for(const r of routes)await c.query('INSERT INTO mayorista.rutas VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,ruta_id) DO NOTHING',[E,r.id,r.nombre,r.zona]);
  for(const l of lists)await c.query('INSERT INTO mayorista.listas VALUES($1,$2,$3,true) ON CONFLICT(empresa_id,lista_id) DO NOTHING',[E,l.id,l.nombre]);
  const accounts=[...sellers.map((s,i)=>({userId:demoId('user-seller',i),email:'vendedor'+(i+1)+'@distribuidora.qa.invalid',rol:'vendedor',vendedorId:s.id})),...['gerencia','administracion','armador','chofer','chofer','chofer'].map((rol,i)=>({userId:rol==='gerencia'?U:demoId('user-'+rol,i),email:rol+(rol==='chofer'?i-2:'')+'@distribuidora.qa.invalid',rol,vendedorId:null}))];
  for(const a of accounts){
   await c.query('INSERT INTO auth.users(id) VALUES($1)',[a.userId]);
   await c.query('INSERT INTO public.empresa_usuarios(empresa_id,user_id,activo,rol) VALUES($1,$2,true,$3)',[E,a.userId,a.rol==='gerencia'?'owner':a.rol==='administracion'?'admin':a.rol==='vendedor'?'seller':'warehouse']);
   await c.query('INSERT INTO mayorista_private.usuarios(user_id,email,nombre,salt,password_hash) VALUES($1,$2,$3,$4,$5)',[a.userId,a.email,a.rol+' QA',hash.salt,hash.hash]);
   await c.query('INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,$3,$4)',[E,a.userId,a.vendedorId,a.rol]);
   await c.query('INSERT INTO mayorista_private.qa_local_accounts(user_id,empresa_id) VALUES($1,$2)',[a.userId,E]);
  }
  const existingProducts=(await c.query('SELECT id FROM public.productos WHERE empresa_id=$1 ORDER BY id',[E])).rows;
  const existingClients=(await c.query('SELECT id FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows;
  if(existingProducts.length>5000||existingClients.length>1500)throw Error('Dataset existente excede el tamaño autorizado; no se borra');
  // Inserciones por lotes, sin una conexión o roundtrip por producto/cliente.
  const products=Array.from({length:5000-existingProducts.length},(_,i)=>({id:demoId('product',i),nombre:'Producto QA '+String(i+1).padStart(5,'0'),precio:10+i%90,codigo:'QA-P-'+String(i+1).padStart(5,'0')}));
  await c.query(`INSERT INTO public.productos(id,empresa_id,nombre,precio_venta,stock_actual,activo,marca,codigo_interno,codigo_barras)
   SELECT x.id,$1,x.nombre,x.precio,10000,true,'Distribuidora Ficticia',x.codigo,x.codigo FROM jsonb_to_recordset($2::jsonb) x(id uuid,nombre text,precio numeric,codigo text)`,[E,JSON.stringify(products)]);
  const freshClients=Array.from({length:1500-existingClients.length},(_,i)=>({id:demoId('customer',i),nombre:'Cliente Ficticio QA '+String(i+1).padStart(4,'0'),saldo:i%10===0?100:0}));
  await c.query(`INSERT INTO public.clientes_sigo(id,empresa_id,nombre,direccion,limite_credito,saldo_actual,created_by)
   SELECT x.id,$1,x.nombre,'Dirección sintética QA',100000,x.saldo,$3 FROM jsonb_to_recordset($2::jsonb) x(id uuid,nombre text,saldo numeric)`,[E,JSON.stringify(freshClients),U]);
  await c.query(`INSERT INTO public.cliente_movimientos_sigo(empresa_id,cliente_id,tipo,importe,concepto,created_by)
   SELECT $1,x.id,'debe',x.saldo,'Saldo inicial sintético P0',$3 FROM jsonb_to_recordset($2::jsonb) x(id uuid,saldo numeric) WHERE x.saldo>0`,[E,JSON.stringify(freshClients),U]);
  const clients=(await c.query('SELECT id,nombre,direccion FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows.map((x,i)=>({...x,vendedorId:sellers[i%8].id,rutaId:routes[i%8].id,listaId:lists[i%2].id,orden:Math.floor(i/8)+1}));
  await c.query(`INSERT INTO mayorista.clientes(empresa_id,cliente_id,vendedor_id,nombre,ruta_id,direccion,lista_id)
   SELECT $1,x.id,x."vendedorId",x.nombre,x."rutaId",coalesce(x.direccion,''),x."listaId" FROM jsonb_to_recordset($2::jsonb) x(id uuid,"vendedorId" uuid,nombre text,"rutaId" uuid,direccion text,"listaId" uuid)
   ON CONFLICT(empresa_id,cliente_id) DO UPDATE SET vendedor_id=excluded.vendedor_id,ruta_id=excluded.ruta_id,lista_id=excluded.lista_id`,[E,JSON.stringify(clients)]);
  const allProducts=(await c.query('SELECT id FROM public.productos WHERE empresa_id=$1 ORDER BY id',[E])).rows;
  const presentations=allProducts.flatMap(p=>lists.map((l,i)=>({id:demoId('price-'+l.id,p.id),product:p.id,list:l.id,adjustment:i?-5:0})));
  await c.query(`INSERT INTO public.sigo_mayorista_presentaciones(empresa_id,precio_id,producto_id,lista_id,presentacion,unidades_base,ajuste_porcentaje,min_unidades,desde,hasta,activa,actor_id)
   SELECT $1,x.id,x.product,x.list,'unidad',1,x.adjustment,1,now()-interval '1 day',now()+interval '365 days',true,$3 FROM jsonb_to_recordset($2::jsonb) x(id uuid,product uuid,list uuid,adjustment numeric)`,[E,JSON.stringify(presentations),U]);
  const from=period+'-01',to=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);
  for(const [i,s] of sellers.entries()){
   await c.query('INSERT INTO mayorista.objetivos VALUES($1,$2,$3,10000000,100) ON CONFLICT DO NOTHING',[E,s.id,period]);
   await c.query("INSERT INTO mayorista.metas(empresa_id,meta_id,vendedor_id,metrica,periodo,desde,hasta,objetivo,actualizado_por) VALUES($1,$2,$3,'vendido','mensual',$4,$5,10000000,$6)",[E,demoId('goal',i),s.id,from,to,U]);
  }
  const vehicles=[0,1,2].map(i=>({id:demoId('vehicle',i),nombre:'Vehículo QA '+(i+1),patente:'QA-00'+(i+1),capacidad:3000,chofer:'Chofer QA '+(i+1),activo:true}));
  const current=(await c.query('SELECT revision,datos FROM mayorista.administracion WHERE empresa_id=$1',[E])).rows[0];
  const plan={...current?.datos,empresaId:E,revision:(current?.revision??0)+1,vendedores:sellers,rutas:routes,clientes:clients,vehiculos:vehicles,objetivos:sellers.map(s=>({vendedorId:s.id,importe:100000,visitas:100}))};
  await c.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,$2,$3) ON CONFLICT(empresa_id) DO UPDATE SET revision=excluded.revision,datos=excluded.datos',[E,plan.revision,plan]);
  await c.query("UPDATE mayorista.empresas SET nombre='Distribuidora Horizonte · FICTICIA QA' WHERE empresa_id=$1",[E]);
  const result={version:1,empresaId:E,synthetic:true,namespace:pool.acceptanceNamespace,sellers:8,customers:1500,products:5000,vehicles,warehouse:{id:demoId('warehouse',0),nombre:'Depósito Central QA',scope:'stock compartido único; sin multidepósito'},routes:8,priceLists:2,period,accounts};
  await c.query('INSERT INTO mayorista_private.qa_demo_manifest(version,empresa_id,datos) VALUES(1,$1,$2)',[E,result]);
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
