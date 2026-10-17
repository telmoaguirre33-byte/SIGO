import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import emitir from '../../../../api/mayorista/nota-credito.js';
import {WSFE} from '../../../../api/arca/wsaa.js';
import {assertSharedFixture} from './shared-fixture-policy.mjs';
/** Protocolo SIGO existente + RPC/arca_comprobantes PostgreSQL; ninguna solicitud ARCA externa. */
export async function verifySharedCreditNotes(pool,{devolucionId,exercise}={}){
 await assertSharedFixture(pool);const E='30000000-0000-4000-8000-000000000001',U='30000000-0000-4000-8000-000000000011',S=randomUUID();
 await pool.query('INSERT INTO mayorista_private.sesiones(session_id,user_id,empresa_id,vence_en) VALUES($1,$2,$3,now()+interval \'1 hour\')',[S,U,E]);
 const act=async(sql,args)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[U,JSON.stringify({sub:U,session_id:S,exp:Math.floor(Date.now()/1000)+3600})]);const r=await c.query(sql,args);await c.query('COMMIT');return r.rows[0]?.r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 if(!devolucionId){const sale=(await pool.query('SELECT a.venta_id,i.id FROM public.arca_comprobantes a JOIN public.venta_items_sigo i ON i.empresa_id=a.empresa_id AND i.venta_id=a.venta_id WHERE a.empresa_id=$1 AND a.cae IS NOT NULL LIMIT 1',[E])).rows[0];devolucionId=(await act('SELECT public.devolver_mayorista_sigo($1,$2,$3::jsonb) AS r',[E,randomUUID(),JSON.stringify({ventaId:sale.venta_id,motivo:'NC simulada para devolución averiada',lineas:[{ventaItemId:sale.id,cantidad:1,disposicion:'averiada'}]})])).devolucionId;}
 const previousFetch=globalThis.fetch,env={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY};process.env.SUPABASE_URL='https://nc.qa.invalid';process.env.SUPABASE_ANON_KEY='qa-fixture-public';
 let ambiente='homologacion',requests=0,authorized=false,lostAck=true;
 const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}}),soap=v=>new Response(v,{headers:{'Content-Type':'text/xml'}});
 globalThis.fetch=async(url,init={})=>{const u=new URL(url),path=u.pathname;
  if(url===WSFE.homologacion){const action=init.headers.SOAPAction.split('/').at(-1);assert.equal(ambiente,'homologacion');
   if(action==='FECompUltimoAutorizado')return soap('<CbteNro>12</CbteNro>');
   if(action==='FECompConsultar')return soap(authorized?'<ResultGet><CodAutorizacion>98765432109876</CodAutorizacion><FchVto>20270101</FchVto><Resultado>A</Resultado></ResultGet>':'');
   if(action==='FECAESolicitar'){assert.ok(init.body.includes('<ar:CbteTipo>13</ar:CbteTipo>'));assert.ok(init.body.includes('<ar:CbtesAsoc>'));assert.ok(init.body.includes('<ar:Tipo>11</ar:Tipo>'));requests++;authorized=true;return soap('<FECAEDetResponse><Resultado>A</Resultado><CAE>98765432109876</CAE><CAEFchVto>20270101</CAEFchVto></FECAEDetResponse>');}throw Error('Acción inesperada');
  }
  const body=init.body?JSON.parse(init.body):{};
  if(path.endsWith('/rpc/tiene_permiso_empresa'))return json(true);
  if(path.endsWith('/arca_config'))return json([{empresa_id:E,ambiente,cuit_emisor:'20123456789',activo:true,ultima_prueba_ok:true}]);
  if(path.startsWith('/storage/'))return json({version:1,service:'wsfe',ambiente:'homologacion',cuit:'20123456789',token:'nc-fixture',sign:'nc-fixture',generationTime:new Date(Date.now()-60000).toISOString(),expirationTime:new Date(Date.now()+3600000).toISOString()});
  const name=path.split('/').at(-1);const rpc={leer_nota_credito_mayorista_sigo:['$1,$2',[body.p_empresa_id,body.p_devolucion]],reservar_nota_credito_mayorista_sigo:['$1,$2,$3',[body.p_empresa_id,body.p_devolucion,body.p_numero]],confirmar_nota_credito_mayorista_sigo:['$1,$2,$3::jsonb',[body.p_empresa_id,body.p_devolucion,JSON.stringify(body.p_datos)]]};
  if(Object.hasOwn(rpc,name)){if(name==='confirmar_nota_credito_mayorista_sigo'&&lostAck){lostAck=false;throw Error('Acuse NC perdido');}const [params,args]=rpc[name];return json(await act('SELECT public.'+name+'('+params+') AS r',args));}
  throw Error('Transporte fiscal externo inesperado: '+path);
 };
 const call=async body=>{let status,result;const res={setHeader(){return this;},status(s){status=s;return this;},send(v){result=JSON.parse(v);return this;}};await emitir({method:'POST',headers:{authorization:'Bearer nc-fixture-session'},body},res);return {status,body:result};},request={empresaId:E,devolucionId};
 try{
  const stock=(await pool.query('SELECT id,stock_actual FROM public.productos WHERE empresa_id=$1 ORDER BY id',[E])).rows,balance=(await pool.query('SELECT id,saldo_actual FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows;
  ambiente='produccion';assert.equal((await call(request)).body.error,'MAYORISTA_HOMOLOGATION_ONLY');assert.equal(requests,0);ambiente='homologacion';assert.equal((await call(request)).status,502);assert.equal(requests,1);
  if(exercise)await exercise({call,request});else{const reconciled=await call(request);assert.equal(reconciled.status,200,JSON.stringify(reconciled));assert.equal(reconciled.body.reconciled,true);}
  assert.equal((await call(request)).body.alreadyIssued,true);assert.equal(requests,1);assert.equal(Number((await pool.query("SELECT count(*) FROM public.arca_comprobantes WHERE empresa_id=$1 AND request_id=$2",[E,'mayorista_nc:'+devolucionId])).rows[0].count),1);
  assert.deepEqual((await pool.query('SELECT id,stock_actual FROM public.productos WHERE empresa_id=$1 ORDER BY id',[E])).rows,stock);assert.deepEqual((await pool.query('SELECT id,saldo_actual FROM public.clientes_sigo WHERE empresa_id=$1 ORDER BY id',[E])).rows,balance);
 }finally{globalThis.fetch=previousFetch;for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;await pool.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE session_id=$1',[S]);}
 console.log('PASS NC: ARCA SIGO reutilizada, factura asociada, reserva canónica, conciliación después de acuse perdido; stock/cuenta sin repetir');return [{name:'Nota crédito SIGO con transporte homologación simulado, reserva y conciliación idempotentes',status:'pass'}];
}
