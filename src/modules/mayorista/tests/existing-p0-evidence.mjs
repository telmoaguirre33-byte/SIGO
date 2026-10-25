import assert from 'node:assert/strict';
import {verifyExistingP0QA,P0_EVIDENCE_REVISION,P0_NAMESPACE} from '../backend/verify-existing-p0-qa.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
const E='30000000-0000-4000-8000-000000000001';
function fixture(change={}){
 const calls=[];let released=false;
 const client={release(){released=true;},async query(sql,args){
  calls.push(sql);assert.match(sql,/^(SELECT|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)\b/);
  if(!sql.startsWith('SELECT'))return {rows:[]};
  if(sql.includes('infrastructure_binding'))return {rows:[{project_id:QA_RAILWAY.projectId,environment_id:change.invalidBinding?'other':QA_RAILWAY.environmentId,schema_version:1}]};
  if(sql.includes('acceptance_runs')){assert.equal(args[0],P0_EVIDENCE_REVISION);return {rows:change.missingShared?[]:[{report:{status:'ready_for_qa',revision:P0_EVIDENCE_REVISION,fixtureNamespace:'mayorista_acceptance_'+P0_EVIDENCE_REVISION.slice(0,12),productionActivation:false,...change.shared}}]};}
  if(sql.includes('pg_namespace'))return {rows:[{n:change.missingNamespace?7:8}]};
  assert.ok(sql.includes(P0_NAMESPACE+'_private.'));
  if(sql.includes('qa_interactive_scope'))return {rows:[{external_empresa_id:'8728d172-7c1b-4de3-88ae-c20fc19c1fce',qa_empresa_id:change.otherCompany?'other':E}]};
  if(sql.includes('qa_demo_manifest'))return {rows:[{datos:{namespace:P0_NAMESPACE,accounts:Array(change.accountCount??14),vehicles:Array(3)}}]};
  if(sql.includes('qa_live_reports'))return {rows:change.missingLive?[]:[{report:{status:'pass',run:'p0-live-70c2783-v1',namespace:P0_NAMESPACE,empresaId:E,concurrency:8,roles:5,balancesRestored:true,productionActivation:false,...change.live}}]};
  throw Error('Consulta inesperada');
 }};
 return {pool:{connect:async()=>client},calls,get released(){return released;}};
}
const good=fixture(),result=await verifyExistingP0QA(good.pool);
assert.equal(result.readOnly,true);assert.equal(result.interfaces,'pending');assert.equal(good.calls.at(-1),'COMMIT');assert.equal(good.released,true);
for(const change of [{invalidBinding:true},{missingShared:true},{shared:{revision:'other'}},{shared:{productionActivation:true}},{missingNamespace:true},{otherCompany:true},{accountCount:13},{missingLive:true},{live:{status:'failed'}},{live:{balancesRestored:false}},{live:{namespace:'other'}},{live:{roles:4}}]){
 const f=fixture(change);await assert.rejects(verifyExistingP0QA(f.pool),e=>e.message==='P0_EVIDENCE_GATE_BLOCKED'&&!!e.stage&&/^P0_/.test(e.reason));assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.released,true);
}
console.log('PASS gate de evidencia previa: solo lectura, identidad QA, revisiones explícitas, rollback y rechazo de evidencia ausente/divergente; no ejecuta aceptación ni siembra');
