import {interactiveQa} from './interactive-qa.mjs';
import {prepareDemoCompany} from './demo-company.mjs';
import {isDeepStrictEqual} from 'node:util';
export async function prepareDemoQA(env,options){
 const qa=await interactiveQa(env,options);
 if(!qa)throw Error('Demo requiere QA interactivo aislado');
 let result;
 try{result=await prepareDemoCompany(qa.pool,{externalEmpresaId:qa.externalEmpresaId,password:env.MAYORISTA_BOOTSTRAP_PASSWORD});}finally{await qa.pool.end();}
 // Nuevo pool físico y mismo binding. La evidencia corresponde a la DB persistente,
 // no a la copia de aceptación utilizada por las pruebas de CI.
 const reopened=await interactiveQa(env,options);
 try{
  const E=qa.qaEmpresaId;
  const counts=(await reopened.pool.query(`SELECT
   (SELECT count(*)::int FROM public.productos WHERE empresa_id=$1) AS products,
   (SELECT count(*)::int FROM public.clientes_sigo WHERE empresa_id=$1) AS customers,
   (SELECT count(*)::int FROM mayorista.vendedores WHERE empresa_id=$1) AS sellers,
   (SELECT count(*)::int FROM mayorista_private.qa_local_accounts WHERE empresa_id=$1 AND activo) AS accounts`,[E])).rows[0];
  if(reopened.namespace!==qa.namespace||counts.products!==5000||counts.customers!==1500||counts.sellers!==8||counts.accounts!==14)throw Error('Dataset persistente no conciliado');
  const manifest=(await reopened.pool.query('SELECT datos FROM mayorista_private.qa_demo_manifest WHERE version=1 AND empresa_id=$1',[E])).rows[0]?.datos;
  if(!isDeepStrictEqual(manifest,result))throw Error('Manifest no persiste tras reconectar');
  const report={status:'seed_persisted',revision:env.RAILWAY_GIT_COMMIT_SHA,namespace:qa.namespace,empresaId:E,verifiedAt:new Date().toISOString(),counts,poolReopened:true,operationalAcceptance:'pending',scaleAcceptance:'pending',productionActivation:false};
  await reopened.pool.query(`CREATE TABLE IF NOT EXISTS mayorista_private.qa_demo_evidence(id boolean primary key check(id),report jsonb not null);
   ALTER TABLE mayorista_private.qa_demo_evidence ENABLE ROW LEVEL SECURITY;REVOKE ALL ON mayorista_private.qa_demo_evidence FROM public,anon,authenticated;`);
  await reopened.pool.query('INSERT INTO mayorista_private.qa_demo_evidence VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET report=excluded.report',[report]);
  return {...result,persistence:report};
 }finally{await reopened.pool.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])prepareDemoQA(process.env).then(r=>console.log(JSON.stringify({event:'MAYORISTA_DEMO_PREPARED',...r}))).catch(e=>{console.error(JSON.stringify({event:'MAYORISTA_DEMO_FAILED',reason:e.code??'PREPARATION_FAILED',productionChanged:false}));process.exitCode=1;});
