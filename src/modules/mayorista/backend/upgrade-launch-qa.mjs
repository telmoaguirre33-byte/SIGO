import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {verifyExistingP0QA,P0_NAMESPACE} from './verify-existing-p0-qa.mjs';
import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
/** Única ampliación QA aditiva. No semillas, no aceptación mutante, no esquemas/base/servicios nuevos. */
export async function upgradeLaunchQA(env,{Pool=pg.Pool}={}){
 const config=railwayRuntime(env),base=new Pool(config.policy.config);
 try{
  await assertInstalledQA(base);await verifyExistingP0QA(base);
  const pool=acceptanceNamespace(base,P0_NAMESPACE),c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('mayorista-launch-v1'))");await assertInstalledQA(c);
   if(!(await c.query("SELECT to_regclass('mayorista.puesta_marcha') AS installed")).rows[0].installed)await c.query(await readFile(new URL('../commercial/launch-schema-qa.sql',import.meta.url),'utf8'));
   for(const name of ['puesta_marcha','importaciones','importacion_filas','identidades_importacion']){
    const row=(await c.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',['mayorista.'+name])).rows[0];if(!row?.relrowsecurity||!row.relforcerowsecurity)throw Error('LAUNCH_RLS_INVALID');
   }
   await c.query('COMMIT');return {verified:true,upgrade:'launch-v1',namespace:P0_NAMESPACE,seeded:false,existingOrdersChanged:false};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }finally{await base.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])upgradeLaunchQA(process.env).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error('MAYORISTA_LAUNCH_UPGRADE_FAILED',e.code??e.message);process.exitCode=1;});
