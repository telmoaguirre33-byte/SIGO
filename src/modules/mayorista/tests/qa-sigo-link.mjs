import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createQaSigoLink,createSigoReadOnlyVerifier} from '../security/qa-sigo-link.mjs';
/** Solo el fixture PostgreSQL aislado ya preparado, nunca conexiones remotas. */
export async function verifyQaSigoLink(pool,{make,E,origin}){
 const external=randomUUID(),uid=randomUUID();let active=true,role='admin',requests=[];
 const remote=createSigoReadOnlyVerifier({origin:'https://auth.qa.invalid',anonKey:'public-test-key',fetcher:async(url,input)=>{
  requests.push([url,input.method]);assert.equal(new URL(url).origin,'https://auth.qa.invalid');assert.equal(input.headers.Authorization,'Bearer external-test-token');
  const path=new URL(url).pathname;let result;
  if(path==='/auth/v1/user')result={id:uid,email:'external-admin@qa.invalid'};
  else if(path==='/rest/v1/rpc/mis_empresas_sigo')result=[{empresa_id:external,rol:role}];
  else if(path==='/rest/v1/rpc/listar_modulos_empresa_sigo')result=[{clave:'mayorista_distribuidora',habilitado:active}];
  else throw Error('Solicitud remota comercial prohibida');
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 await pool.query('CREATE TABLE mayorista_private.qa_interactive_scope(id boolean primary key,external_empresa_id uuid,qa_empresa_id uuid);CREATE TABLE mayorista_private.qa_link_audit(external_empresa_id uuid,qa_empresa_id uuid,user_id uuid,rol text)');
 await pool.query('INSERT INTO mayorista_private.qa_interactive_scope VALUES(true,$1,$2)',[external,E]);
 let link=createQaSigoLink({pool,externalEmpresaId:external,qaEmpresaId:E,verifyRemote:remote}),service=make({qaSigoLink:link});
 const call=async(path,token,body)=>{const r=await service(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};};
 assert.equal((await call('/auth/sigo','external-test-token',{empresaId:randomUUID()})).status,403);
 const login=await call('/auth/sigo','external-test-token',{empresaId:external});assert.equal(login.status,200,JSON.stringify(login));const token=login.body.accessToken;
 const me=await call('/me',token);assert.equal(me.status,200);assert.equal(me.body.empresaId,E);assert.equal(me.body.sigoEmpresaId,external);assert.equal(me.body.qaAislado,true);assert.equal(me.body.fuenteComercial,'sigo');assert.equal(me.body.rol,'administracion');
 for(const endpoint of ['/admin/state','admin/catalog','orders','cargas','operations/loads','accounts','inventory','admin/users','visits','catalog','admin/reports','admin/dashboard','goals'].map(p=>p.startsWith('/')?p:'/'+p)){const r=await call(endpoint,token);assert.equal(r.status,200,endpoint+' '+JSON.stringify(r));}
 const before=(await pool.query('SELECT count(*) FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[E,uid])).rows[0].count;
 assert.equal((await call('/auth/sigo','external-test-token',{empresaId:external})).status,200);assert.equal((await pool.query('SELECT count(*) FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[E,uid])).rows[0].count,before);
 active=false;assert.equal((await call('/me',token)).status,403);active=true;role='seller';assert.equal((await call('/me',token)).status,403);role='admin';
 const oldLink=link;link=createQaSigoLink({pool,externalEmpresaId:external,qaEmpresaId:E,verifyRemote:remote});service=make({qaSigoLink:link});assert.equal((await call('/me',token)).status,401);
 assert.equal((await pool.query('SELECT count(*) FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[E,uid])).rows[0].count,'1');
 assert.ok(requests.every(([url])=>['/auth/v1/user','/rest/v1/rpc/mis_empresas_sigo','/rest/v1/rpc/listar_modulos_empresa_sigo'].includes(new URL(url).pathname)));
 oldLink.forget({sessionId:me.body.sessionId});
 console.log('PASS vínculo QA: identidad SIGO y flag solo lectura; otra empresa denegada; páginas/API aisladas; revocación y reinicio seguros');
}
