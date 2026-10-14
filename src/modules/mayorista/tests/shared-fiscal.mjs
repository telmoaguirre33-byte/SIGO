import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import emitir from '../../../../api/mayorista/arca.js';
import {assertSharedFixture} from './shared-fixture-policy.mjs';
/** PostgreSQL real + emisor ARCA EXISTENTE. Solo transporte externo sustituido; jamás WSFE real. */
export async function verifySharedFiscal(pool,{exercise}={}){
 await assertSharedFixture(pool);
 const E='30000000-0000-4000-8000-000000000001',U='30000000-0000-4000-8000-000000000011',S=randomUUID();
 const migration=new URL('../../../../supabase/migrations/',import.meta.url);
 const ddl=await readFile(new URL('20260910021200_arca_config_segura.sql',migration),'utf8');
 await pool.query(ddl.slice(ddl.indexOf('create table if not exists public.arca_comprobantes'),ddl.indexOf('create index if not exists arca_comprobantes_empresa_fecha_idx')));
 await pool.query(await readFile(new URL('20260914003500_arca_cae_preflight_guards.sql',migration),'utf8'));
 await pool.query('ALTER TABLE public.ventas_sigo ADD COLUMN anulada_at timestamptz');
 await pool.query('UPDATE public.clientes_sigo SET arca_doc_tipo=80,condicion_iva_receptor_id=6,documento=$1 WHERE id=(SELECT cliente_id FROM public.ventas_sigo WHERE empresa_id=$2 ORDER BY created_at DESC LIMIT 1)',['20123456789',E]);
 await pool.query('INSERT INTO mayorista_private.sesiones(session_id,user_id,empresa_id,vence_en) VALUES($1,$2,$3,now()+interval \'1 hour\')',[S,U,E]);
 const operation=(await pool.query("SELECT comando_id,venta_id FROM public.sigo_mayorista_entregas_comerciales WHERE empresa_id=$1 AND estado='confirmado' ORDER BY recibido_en DESC LIMIT 1",[E])).rows[0];
 const originalFetch=globalThis.fetch,oldURL=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_ANON_KEY;
 process.env.SUPABASE_URL='https://sigo-fiscal.qa.invalid';process.env.SUPABASE_ANON_KEY='public-qa-fixture';
 let ambiente='homologacion',solicitudes=0,loseAck=true,authorized=false;
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 const act=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[U,JSON.stringify({sub:U,session_id:S,exp:Math.floor(Date.now()/1000)+3600})]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):{},path=u.pathname;
  if(path==='/auth/v1/user')return json({id:U});
  if(path.endsWith('/rpc/tiene_permiso_empresa'))return json(true);
  if(path.endsWith('/rpc/leer_comercio_mayorista_sigo')){if(body.p_empresa_id!==E)return json({},403);return json((await act(c=>c.query('SELECT public.leer_comercio_mayorista_sigo($1) AS r',[E]))).rows[0].r);}
  if(path.endsWith('/arca_config'))return json([{empresa_id:E,ambiente,cuit_emisor:'20123456789',certificado_ref:'fixture-private',certificado_vence:'2030-01-01',wsaa_service:'wsfe',wsfe_version:'WSFEv1',activo:true,ultima_prueba_ok:true}]);
  if(path.endsWith('/arca_puntos_venta'))return json([{id:randomUUID()}]);
  if(path.endsWith('/ventas_sigo'))return json((await pool.query('SELECT * FROM public.ventas_sigo WHERE empresa_id=$1 AND id=$2',[E,operation.venta_id])).rows);
  if(path.endsWith('/venta_items_sigo'))return json((await pool.query('SELECT producto_id,subtotal FROM public.venta_items_sigo WHERE empresa_id=$1 AND venta_id=$2',[E,operation.venta_id])).rows);
  if(path.endsWith('/clientes_sigo'))return json((await pool.query('SELECT documento,arca_doc_tipo,condicion_iva_receptor_id FROM public.clientes_sigo WHERE empresa_id=$1 AND id=(SELECT cliente_id FROM public.ventas_sigo WHERE empresa_id=$1 AND id=$2)',[E,operation.venta_id])).rows);
  if(path.endsWith('/arca_comprobantes')){
   if(init.method==='POST')return json((await pool.query('INSERT INTO public.arca_comprobantes(empresa_id,venta_id,punto_venta,tipo_cbte,numero_cbte,resultado,observaciones,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[body.empresa_id,body.venta_id,body.punto_venta,body.tipo_cbte,body.numero_cbte,body.resultado,JSON.stringify(body.observaciones),body.request_id])).rows);
   if(init.method==='PATCH'){if(loseAck){loseAck=false;throw Error('Acuse CAE perdido');}return json((await pool.query('UPDATE public.arca_comprobantes SET cae=$1,cae_vencimiento=$2,resultado=$3,observaciones=$4,emitido_at=$5 WHERE empresa_id=$6 AND venta_id=$7 RETURNING *',[body.cae,body.cae_vencimiento,body.resultado,JSON.stringify(body.observaciones),body.emitido_at,E,operation.venta_id])).rows);}
   return json((await pool.query('SELECT * FROM public.arca_comprobantes WHERE empresa_id=$1 AND venta_id=$2',[E,operation.venta_id])).rows);
  }
  if(path.startsWith('/storage/'))return json({version:1,service:'wsfe',ambiente:'homologacion',cuit:'20123456789',token:'fixture-token',sign:'fixture-sign',generationTime:new Date(Date.now()-60000).toISOString(),expirationTime:new Date(Date.now()+3600000).toISOString()});
  if(path==='/wsfe'){
   assert.equal(body.ambiente,'homologacion');
   if(body.action==='FECompUltimoAutorizado')return json({ok:true,body:'<CbteNro>40</CbteNro>'});
   if(body.action==='FECAESolicitar'){solicitudes++;authorized=true;return json({ok:true,body:'<FECAEDetResponse><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20270101</CAEFchVto></FECAEDetResponse>'});}
   if(body.action==='FECompConsultar')return json({ok:true,body:authorized?'<ResultGet><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20270101</FchVto><Resultado>A</Resultado></ResultGet>':''});
  }
  throw Error('Transporte fiscal inesperado: '+path);
 };
 const call=async body=>{let status,result;const res={setHeader(){return this;},status(s){status=s;return this;},send(v){result=JSON.parse(v);return this;}};await emitir({method:'POST',headers:{authorization:'Bearer fixture-session'},body},res);return {status,body:result};};
 const request={empresaId:E,comandoId:operation.comando_id,puntoVenta:1,tipoCbte:11,condicionIvaReceptorId:6};
 try{
  const stockBefore=(await pool.query('SELECT stock_actual FROM public.productos WHERE empresa_id=$1',[E])).rows;
  ambiente='produccion';assert.equal((await call(request)).body.error,'MAYORISTA_HOMOLOGATION_ONLY');assert.equal(solicitudes,0);
  ambiente='homologacion';assert.equal((await call({...request,comandoId:randomUUID()})).status,409);
  const lost=await call(request);assert.equal(lost.status,502);assert.equal(solicitudes,1);
  const recovered=await call(request);assert.equal(recovered.status,200);assert.equal(recovered.body.reconciled,true);assert.equal(recovered.body.comprobante.venta_id,operation.venta_id);
  assert.equal((await call(request)).body.alreadyIssued,true);assert.equal(solicitudes,1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM public.arca_comprobantes WHERE empresa_id=$1',[E])).rows[0].count),1);
  assert.deepEqual((await pool.query('SELECT stock_actual FROM public.productos WHERE empresa_id=$1',[E])).rows,stockBefore);
  assert.equal((await call({...request,empresaId:randomUUID()})).status,403);
  if(exercise)await exercise({call,request});
 }finally{globalThis.fetch=originalFetch;for(const [k,v] of [['SUPABASE_URL',oldURL],['SUPABASE_ANON_KEY',oldKey]])if(v===undefined)delete process.env[k];else process.env[k]=v;await pool.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE session_id=$1',[S]);}
 console.log('PASS ARCA existente: entrega → venta → reserva → CAE simulado → conciliación persistente, sin duplicar stock ni factura; producción bloqueada');
 return [{name:'ARCA existente con reserva PostgreSQL y acuse perdido conciliado; WSFE simulado, producción bloqueada',status:'pass'}];
}
