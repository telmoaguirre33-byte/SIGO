/** Full SIGO entry and native screens; only Auth/PostgREST transport is replaced in CI.
 * Never served by Vercel/Railway. Companies and movements exist only in the CI namespace.
 */
import assert from 'node:assert/strict';
import {build} from '../../../../node_modules/esbuild/lib/main.js';
import {readFile,writeFile} from 'node:fs/promises';
import {assertSharedFixture} from './shared-fixture-policy.mjs';

export async function prepareUnifiedUi(pool,fixture){
 await assertSharedFixture(pool);
 const M='30000000-0000-4000-8000-000000000003',labels=new Map([[fixture.B,'SIGO Minorista CI'],[fixture.E,'SIGO Mayorista CI'],[M,'SIGO Mixto CI']]);
 const transport=`async function invoke(name,args={}){const r=await fetch('/__unified/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+window.unifiedToken},body:JSON.stringify({name,args})});const data=await r.json();return r.ok?{data,error:null}:{data:null,error:data};}
 async function user(){const r=await invoke('__user');return {data:{user:r.data},error:r.error};}
 function query(table){const state={table,filters:[]};const q={select(){return q;},eq(k,v){state.filters.push([k,v]);return q;},order(){return q;},limit(n){state.limit=n;return q;},range(a,b){state.limit=b-a+1;return q;},in(k,v){state.filters.push([k,v]);return q;},maybeSingle(){state.single=true;return q;},single(){state.single=true;return q;},abortSignal(){return q;},then(ok,bad){return invoke('__read',state).then(ok,bad);}};return q;}
 export const supabase={rpc(name,args){const p=invoke(name,args);p.abortSignal=()=>p;return p;},from:query,auth:{getUser:user,getSession:async()=>{const r=await user();return {data:{session:r.data.user?{access_token:window.unifiedToken,user:r.data.user}:null},error:r.error};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},channel:()=>({on(){return this;},subscribe(){return this;},unsubscribe(){}}),removeChannel:async()=>{}};`;
 const original=await readFile(new URL('../../../../src/main.tsx',import.meta.url),'utf8');
 assert.ok(original.includes('ReactDOM.createRoot(document.getElementById("root")!).render('));
 const entry=original.replace('ReactDOM.createRoot(document.getElementById("root")!).render(','const root=ReactDOM.createRoot(document.getElementById("root")!); export function unmountUnified(){root.unmount();} root.render(');
 const compiled=await build({stdin:{contents:entry,resolveDir:new URL('../../../../src/',import.meta.url).pathname,sourcefile:'unified-entry.tsx',loader:'tsx'},bundle:true,write:false,outdir:'/tmp/sigo-unified-bundle',format:'esm',jsx:'automatic',external:['/sigo-logo-oficial.png'],define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'ci-auth-postgrest-transport-only',setup(b){b.onResolve({filter:/[/.]supabase$/},()=>({path:'unified-supabase',namespace:'ci'}));b.onLoad({filter:/.*/,namespace:'ci'},()=>({contents:transport,loader:'js'}));}}]});
 async function prepare(){
  await pool.query('INSERT INTO public.empresas(id) VALUES($1)',[M]);
  await pool.query("INSERT INTO public.empresa_usuarios VALUES($1,$2,true,'owner')",[M,fixture.U]);
  await pool.query("INSERT INTO mayorista.empresas VALUES($1,'Empresa mixta CI',true)",[M]);
  await pool.query("INSERT INTO mayorista.miembros(empresa_id,user_id,rol) VALUES($1,$2,'gerencia')",[M,fixture.U]);
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.U]);
   for(const [id,type] of [[fixture.B,'minorista'],[fixture.E,'mayorista'],[M,'mixto']])await c.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[id,type]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  // Configure only this ephemeral CI destination, never the persistent QA binding.
  await pool.query('UPDATE public.sigo_mayorista_destino_predeterminado SET origen_aprobado=$1',[fixture.origin]);
  await pool.query("UPDATE public.sigo_mayorista_destinos SET origen_aprobado=$1,administracion_url=$1||'/portal.html',vendedor_url=$1||'/secure.html',aplicacion_disponible=true WHERE empresa_id=ANY($2::uuid[])",[fixture.origin,[fixture.B,fixture.E,M]]);
  await pool.query('INSERT INTO public.productos(id,empresa_id,nombre,precio_venta,stock_actual,activo) VALUES(gen_random_uuid(),$1,$2,15,22,true),(gen_random_uuid(),$3,$4,18,33,true)',[fixture.B,'Producto Minorista único CI',M,'Producto Mixto único CI']);
 }
 const reads=new Set(['productos','clientes_sigo','ventas_sigo','caja_movimientos_sigo','cliente_movimientos_sigo','compras_sigo','proveedores_sigo']);
 async function handle(req,res){
  const path=new URL(req.url,fixture.origin).pathname;
  if(path==='/__unified.js'||path==='/__unified.css'){res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':'text/javascript'});res.end(compiled.outputFiles.find(f=>f.path.endsWith(path.endsWith('.css')?'.css':'.js'))?.text??'');return true;}
  if(path!=='/__unified/rpc')return false;
  try{
   const actor=await fixture.verifyRootToken((req.headers.authorization??'').replace(/^Bearer /,''));
   let raw='';for await(const chunk of req)raw+=chunk;if(raw.length>10000)throw Error('Request limit');const {name,args={}}=JSON.parse(raw);let value;
   const memberships=(await pool.query('SELECT empresa_id,rol FROM public.empresa_usuarios WHERE user_id=$1 AND activo',[actor.userId])).rows;
   const company=args.p_empresa_id??args.filters?.find(([k])=>k==='empresa_id')?.[1];
   if(name==='__user')value={id:actor.userId,email:fixture.creds.gerencia.email,user_metadata:{},created_at:'2020-01-01T00:00:00Z'};
   else if(name==='mis_empresas_sigo')value=memberships.filter(r=>labels.has(r.empresa_id)).map(r=>({...r,nombre:labels.get(r.empresa_id),empresa_nombre:labels.get(r.empresa_id)}));
   else if(name==='es_superadmin_sigo')value=false;
   else {
    if(!memberships.some(r=>r.empresa_id===company))throw Error('Company denied');
    if(name==='__read'||name==='listar_productos_sigo'){
     const table=name==='listar_productos_sigo'?'productos':args.table;if(!reads.has(table))throw Error('Unsupported native read');
     // Actual canonical rows, no invented products, balances or successful writes.
     const rows=(await pool.query('SELECT * FROM public.'+table+' WHERE empresa_id=$1 LIMIT 100',[company])).rows;value=args.single?(rows[0]??null):rows;
    }else{
     const signatures={listar_modulos_empresa_sigo:'SELECT * FROM public.listar_modulos_empresa_sigo($1)',leer_tipo_negocio_sigo:'SELECT public.leer_tipo_negocio_sigo($1) AS value',obtener_acceso_mayorista_sigo:'SELECT * FROM public.obtener_acceso_mayorista_sigo($1)'};
     if(!signatures[name])throw Error('Unsupported native RPC');
     const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor.userId]);const r=await c.query(signatures[name],[company]);value=name==='leer_tipo_negocio_sigo'?r.rows[0].value:r.rows;await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    }
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
  }catch(e){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}
  return true;
 }
 return {prepare,handle,M,labels};
}

export async function exerciseUnifiedUi({unified,pool,fixture,evaluate,wait,command,passed}){
 await unified.prepare();
 await evaluate(`(async()=>{await window.portal?.destroy();window.seller?.dispose();window.activationModule?.unmountActivation();const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(fixture.creds.gerencia)})});if(!r.ok)throw Error('Unified login failed');window.unifiedToken=(await r.json()).accessToken;document.body.innerHTML='<div id="root"></div>';const css=document.createElement('link');css.rel='stylesheet';css.href='/__unified.css';document.head.append(css);window.unified=await import('/__unified.js');})()`);
 await wait("document.querySelector('select')?.options.length===3 && !!document.querySelector('.sidebar .menu')");
 async function select(id){await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===${JSON.stringify(id)}));s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(`document.querySelector('.user-card')?.textContent.includes(${JSON.stringify(unified.labels.get(id))})`);}
 const native=await evaluate("[...document.querySelectorAll('.sidebar .menu > .menu-item')].map(b=>b.textContent)");assert.ok(native.length>=10);
 for(const [id,enabled,product] of [[fixture.B,false,'Producto Minorista único CI'],[fixture.E,true,'Producto SIGO'],[unified.M,true,'Producto Mixto único CI']]){
  await select(id);await wait(enabled?"document.querySelectorAll('.mayorista-menu-section nav button').length===10":"!document.querySelector('.mayorista-menu-section')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.sidebar .menu > .menu-item')].map(b=>b.textContent)"),native);
  await evaluate("[...document.querySelectorAll('.sidebar .menu > button')].find(b=>b.textContent.includes('Productos')).click()");
  const expected=(await pool.query('SELECT nombre FROM public.productos WHERE empresa_id=$1 ORDER BY nombre LIMIT 1',[id])).rows[0].nombre;
  await wait('document.querySelector(".main")?.textContent.includes('+JSON.stringify(expected)+')');
  if(id!==fixture.B)assert.equal(await evaluate("document.querySelector('.main').textContent.includes('Producto Minorista único CI')"),false);
  if(enabled){
   await evaluate("document.querySelector('.mayorista-menu-section nav button').click()");await wait("!!document.querySelector('.mayorista-page-overlay nav [data-tab=panel]') && !document.querySelector('.mayorista-page-overlay [aria-busy=true]')");
   assert.equal(await evaluate("!!document.querySelector('.mayorista-page-overlay [data-form=login]')"),false);
   await evaluate("document.querySelector('.mayorista-page-header button').click()");await wait("!document.querySelector('.mayorista-page-overlay')");
  }
  await passed('SIGO root real: '+unified.labels.get(id)+'; menú nativo conservado, productos canónicos aislados'+(enabled?', módulo dentro de SIGO con SSO':''));
  const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(new URL('./artifacts/unified-'+(id===fixture.B?'minorista':id===fixture.E?'mayorista':'mixto')+'.png',import.meta.url),Buffer.from(screenshot.data,'base64'));
 }
 await evaluate('window.unified.unmountUnified()');
}
