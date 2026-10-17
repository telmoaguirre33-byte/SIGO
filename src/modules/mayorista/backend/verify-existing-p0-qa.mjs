import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
export const P0_EVIDENCE_REVISION='0bf497e46a595838456c3010f0cf7556809bacfa';
export const P0_NAMESPACE='mayorista_acceptance_e1031f20aff5';
const COMPANY='30000000-0000-4000-8000-000000000001',RUN='p0-live-70c2783-v1';
/** Gate de despliegue: lee evidencia aprobada; nunca ejecuta suites, DDL ni sembrado. */
export async function verifyExistingP0QA(base){
 const c=await base.connect();let stage='binding';
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {assertInstalledQA}=await import('./railway-runtime.mjs');
  await assertInstalledQA(c);
  stage='shared_evidence';
  const report=(await c.query('SELECT report FROM mayorista_private.acceptance_runs WHERE revision=$1',[P0_EVIDENCE_REVISION])).rows[0]?.report;
  const name='mayorista_acceptance_'+P0_EVIDENCE_REVISION.slice(0,12);
  if(report?.status!=='ready_for_qa'||report.revision!==P0_EVIDENCE_REVISION||report.fixtureNamespace!==name||report.productionActivation!==false)throw Error('P0_SHARED_EVIDENCE_INVALID');
  const names=[...Object.values(acceptanceNamespace(base,name).schemas),...Object.values(acceptanceNamespace(base,P0_NAMESPACE).schemas)];
  if(Number((await c.query('SELECT count(*) AS n FROM pg_namespace WHERE nspname=ANY($1::text[])',[names])).rows[0].n)!==names.length)throw Error('P0_NAMESPACES_MISSING');
  const qa=acceptanceNamespace(c,P0_NAMESPACE);
  stage='demo_binding';await assertInstalledQA(qa);
  const binding=(await qa.query('SELECT external_empresa_id,qa_empresa_id FROM mayorista_private.qa_interactive_scope WHERE id=true')).rows[0];
  if(binding?.external_empresa_id!=='8728d172-7c1b-4de3-88ae-c20fc19c1fce'||binding.qa_empresa_id!==COMPANY)throw Error('P0_DEMO_BINDING_INVALID');
  const demo=(await qa.query('SELECT datos FROM mayorista_private.qa_demo_manifest WHERE version=1 AND empresa_id=$1',[COMPANY])).rows[0]?.datos;
  if(demo?.namespace!==P0_NAMESPACE||demo.accounts?.length!==14||demo.vehicles?.length!==3)throw Error('P0_DEMO_MANIFEST_INVALID');
  stage='live_evidence';
  const live=(await qa.query('SELECT report FROM mayorista_private.qa_live_reports WHERE run_id=$1',[RUN])).rows[0]?.report;
  if(live?.status!=='pass'||live.run!==RUN||live.namespace!==P0_NAMESPACE||live.empresaId!==COMPANY||live.concurrency!==8||live.roles!==5||live.balancesRestored!==true||live.productionActivation!==false)throw Error('P0_LIVE_EVIDENCE_INVALID');
  await c.query('COMMIT');
  return {event:'MAYORISTA_P0_EVIDENCE_REUSED',evidenceRevision:P0_EVIDENCE_REVISION,run:RUN,namespace:P0_NAMESPACE,reused:true,readOnly:true,interfaces:'pending'};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw Object.assign(Error('P0_EVIDENCE_GATE_BLOCKED'),{stage,reason:/^P0_[A-Z_]+$/.test(error.message)?error.message:'P0_EVIDENCE_READ_FAILED'});}finally{c.release();}
}
export async function runExistingP0QA(env){
 const {railwayRuntime}=await import('./railway-runtime.mjs');
 const {default:pg}=await import('pg');
 const config=railwayRuntime(env);
 if(config.origin!=='https://mayorista-api-qa-qa.up.railway.app')throw Error('P0_QA_ORIGIN_REQUIRED');
 const pool=new pg.Pool({...config.policy.config,max:1});
 try{return await verifyExistingP0QA(pool);}finally{await pool.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])runExistingP0QA(process.env).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({event:'MAYORISTA_P0_EVIDENCE_BLOCKED',stage:e.stage??'runtime',reason:e.reason??'P0_RUNTIME_INVALID',productionChanged:false}));process.exitCode=1;});
