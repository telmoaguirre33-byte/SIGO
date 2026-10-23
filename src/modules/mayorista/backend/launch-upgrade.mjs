import {readFile} from 'node:fs/promises';
import {assertInstalledQA} from './railway-runtime.mjs';
/** El llamador ya verificó el binding y la evidencia P0; la conexión conserva el namespace QA. */
export async function installLaunchSchema(pool){
 const c=await pool.connect();let stage='binding';
 try{
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('mayorista-launch-v1'))");await assertInstalledQA(c);
  stage='migration';
  if(!(await c.query("SELECT to_regclass('mayorista.puesta_marcha') AS installed")).rows[0].installed)await c.query(await readFile(new URL('../commercial/launch-schema-qa.sql',import.meta.url),'utf8'));
  stage='rls';
  for(const name of ['puesta_marcha','importaciones','importacion_filas','identidades_importacion','suscripciones']){
   // El adaptador traduce SQL, NO valores de parámetros. Resolver explícitamente el esquema validado.
   const relation=(pool.schemas?.mayorista??'mayorista')+'.'+name;
   const row=(await c.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=to_regclass($1)',[relation])).rows[0];
   if(!row?.relrowsecurity||!row.relforcerowsecurity)throw Error('LAUNCH_RLS_INVALID');
  }
  stage='functions';
  const functions=(await c.query("SELECT to_regprocedure('mayorista.importar_fila(uuid,text,text,jsonb)') AS importer,to_regprocedure('mayorista.padron_clientes(uuid,text,uuid,uuid,text,integer,integer)') AS directory,to_regprocedure('mayorista.fichas_asignacion(uuid,uuid[])') AS assignment")).rows[0];
  if(!functions?.importer||!functions?.directory||!functions?.assignment)throw Error('LAUNCH_FUNCTIONS_MISSING');
  await c.query('COMMIT');return {verified:true,upgrade:'launch-v1',namespace:pool.acceptanceNamespace,seeded:false,existingOrdersChanged:false};
 }catch(e){await c.query('ROLLBACK');throw Object.assign(e,{launchStage:stage});}finally{c.release();}
}
