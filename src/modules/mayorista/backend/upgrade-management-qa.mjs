import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {startupDiagnostic} from './startup-diagnostic.mjs';
/** Ampliación puntual de la base QA EXISTENTE. No bootstrap, no reset, no infraestructura nueva. */
export async function upgradeManagementQA(env,{Pool=pg.Pool}={}){
  const config=railwayRuntime(env),pool=new Pool(config.policy.config);
  try{
    await assertInstalledQA(pool);
    const c=await pool.connect();
    try{
      await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('mayorista-management-v1'))");
      if(!(await c.query("SELECT to_regclass('mayorista.metas') AS metas")).rows[0].metas){
        const sql=(await readFile(new URL('../commercial/goals-schema-qa.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,'');
        await c.query(sql);
      }
      const row=(await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='mayorista.metas'::regclass")).rows[0];
      if(!row?.relrowsecurity||!row.relforcerowsecurity)throw new Error('RLS de objetivos no verificado');
      await c.query('COMMIT');return {verified:true,module:'mayorista',upgrade:'management-v1'};
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])upgradeManagementQA(process.env).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify(startupDiagnostic(e,process.env)));process.exitCode=1;});
