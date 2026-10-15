import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';
import pg from '../backend/node_modules/pg/lib/index.js';
import {selectQaHandler} from '../backend/server.mjs';
import {interactiveQa} from '../backend/interactive-qa.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
/** SQL real en CI. Solo el transporte de Pool privado Railway se sustituye por localhost. */
export async function verifyInteractiveQa(base){
 const ordinary=()=>{},isolated=()=>{};assert.equal(selectQaHandler(new Headers({Origin:'https://preview.qa.invalid'}),['https://preview.qa.invalid'],ordinary,isolated),isolated);assert.equal(selectQaHandler(new Headers({Origin:'https://backend.qa.invalid'}),['https://preview.qa.invalid'],ordinary,isolated),ordinary);assert.equal(selectQaHandler(new Headers({Origin:'https://other.qa.invalid'}),['https://preview.qa.invalid'],ordinary,isolated),ordinary);
 assert.equal(base.options.host,'127.0.0.1');assert.equal(Number(base.options.port),55471);assert.equal(base.options.database,'mayorista_qa');
 const external=randomUUID(),authOrigin='https://identity.qa.invalid',namespace='mayorista_acceptance_'+createHash('sha256').update('interactive-qa-v1:'+external+':'+authOrigin).digest('hex').slice(0,12),opened=[];
 const rootBinding='SELECT project_id,environment_id,schema_version FROM mayorista_private.infrastructure_binding WHERE id=true';
 class LocalPool{
  constructor(){const p=new pg.Pool({...base.options,password:base.options.password,max:2});this.options=p.options;this.end=()=>p.end();const route=(target,sql,...args)=>sql===rootBinding?Promise.resolve({rows:[{project_id:QA_RAILWAY.projectId,environment_id:QA_RAILWAY.environmentId,schema_version:1}]}):target.query(sql,...args);this.query=(...args)=>route(p,...args);this.connect=async()=>{const c=await p.connect();return {query:(...args)=>route(c,...args),release:()=>c.release()};};}
 }
 const {privateKey}=generateKeyPairSync('ed25519');const env={MAYORISTA_INTERACTIVE_QA:'true',MAYORISTA_QA_ENABLED:'true',MAYORISTA_QA_SIGO_EMPRESA_ID:external,MAYORISTA_SIGO_AUTH_URL:authOrigin,MAYORISTA_SIGO_AUTH_ANON_KEY:'public-fixture-key',MAYORISTA_PUBLIC_ORIGIN:'https://backend.qa.invalid',MAYORISTA_SIGO_ORIGIN:'https://preview.qa.invalid',MAYORISTA_AUTH_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),RAILWAY_PROJECT_ID:QA_RAILWAY.projectId,RAILWAY_ENVIRONMENT_ID:QA_RAILWAY.environmentId,MAYORISTA_DATABASE_SERVICE_ID:QA_RAILWAY.databaseServiceId,MAYORISTA_BUDGET_VERIFIED:'true',MAYORISTA_MONTHLY_BUDGET_USD:'15',DATABASE_URL:'postgresql://fixture:fixture@postgres.railway.internal:5432/mayorista_qa?sslmode=verify-full',MAYORISTA_DB_CA_PEM:'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----'};
 try{
  assert.equal(await interactiveQa({}),null);
  const first=await interactiveQa(env,{Pool:LocalPool});opened.push(first);assert.equal(first.namespace,namespace);assert.equal(first.externalEmpresaId,external);
  assert.equal((await first.pool.query('SELECT count(*) FROM mayorista_private.usuarios WHERE activo')).rows[0].count,'0');
  const id=randomUUID();await first.pool.query('INSERT INTO mayorista.vendedores(empresa_id,vendedor_id,nombre,activo) VALUES($1,$2,$3,true)',[first.qaEmpresaId,id,'Persistencia de vínculo QA']);
  const second=await interactiveQa(env,{Pool:LocalPool});opened.push(second);assert.equal((await second.pool.query('SELECT nombre FROM mayorista.vendedores WHERE empresa_id=$1 AND vendedor_id=$2',[second.qaEmpresaId,id])).rows[0].nombre,'Persistencia de vínculo QA');
  assert.equal((await second.pool.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[namespace+'_private.qa_interactive_scope'])).rows[0].relrowsecurity,true);
  console.log('PASS QA interactivo: bootstrap dentro de misma DB, cuentas fixture desactivadas, binding exacto e idempotencia sin reset');
  return [{name:'Vínculo interactivo aislado en misma PostgreSQL: bootstrap y reinicio preservan datos',status:'pass'}];
 }finally{for(const entry of opened)await entry.pool.end();for(const suffix of ['public','module','private','auth'])await base.query('DROP SCHEMA IF EXISTS '+namespace+'_'+suffix+' CASCADE');}
}
