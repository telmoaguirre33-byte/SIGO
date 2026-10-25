import assert from 'node:assert/strict';
import {installLaunchSchema} from '../backend/launch-upgrade.mjs';
import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
const statements=[],name='mayorista_acceptance_e1031f20aff5';let failRls=false;
const raw={options:{},connect:async()=>({release(){},query:async(sql,args)=>{statements.push({sql,args});if(sql.includes('infrastructure_binding'))return {rows:[{project_id:QA_RAILWAY.projectId,environment_id:QA_RAILWAY.environmentId,schema_version:1}]};if(sql.includes(' AS installed'))return {rows:[{installed:'exists'}]};if(sql.includes('relrowsecurity')){assert.ok(args[0].startsWith(name+'_module.'));return {rows:[{relrowsecurity:true,relforcerowsecurity:!failRls}]};}if(sql.includes(' AS importer'))return {rows:[{importer:'exists',directory:'exists',assignment:'exists'}]};return {rows:[]};}})};
const pool=acceptanceNamespace(raw,name);assert.equal((await installLaunchSchema(pool)).namespace,name);assert.equal(statements.filter(s=>s.sql.includes('relrowsecurity')).length,5);assert.equal(statements.at(-1).sql,'COMMIT');assert.ok(!statements.some(s=>/CREATE|INSERT|UPDATE|DELETE/.test(s.sql)));
failRls=true;await assert.rejects(()=>installLaunchSchema(pool),e=>e.message==='LAUNCH_RLS_INVALID'&&e.launchStage==='rls');assert.equal(statements.at(-1).sql,'ROLLBACK');
console.log('PASS predeploy: regclass parametrizado usa namespace sintético; RLS obligatorio, reejecución sin siembra y rollback ante fallo');
