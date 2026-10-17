import {createHash} from 'node:crypto';
import {assertSharedFixture} from '../tests/shared-fixture-policy.mjs';
export const RESET_OPERATION='seller1-password-20261017-v1';
export const RESET_COMPANY='30000000-0000-4000-8000-000000000001';
const EMAIL='vendedor1@distribuidora.qa.invalid';
const operationId='qa-access:'+RESET_OPERATION;

/** CLI administrativa, nunca endpoint HTTP. Solo cuenta demo existente y una ejecución.
 * Recibe un verificador scrypt, nunca la contraseña en claro. No siembra ni instala DDL. */
export async function resetSeller1QA(pool,record){
 if(record?.operation!==RESET_OPERATION||!/^[a-f0-9]{32}$/.test(record?.salt??'')||!/^[a-f0-9]{128}$/.test(record?.hash??''))throw Error('Verificador QA inválido');
 await assertSharedFixture(pool);
 const fingerprint=createHash('sha256').update(record.salt+':'+record.hash).digest('hex');
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const binding=(await c.query('SELECT external_empresa_id,qa_empresa_id FROM mayorista_private.qa_interactive_scope WHERE id=true')).rows[0];
  if(binding?.qa_empresa_id!==RESET_COMPANY||binding.external_empresa_id!=='8728d172-7c1b-4de3-88ae-c20fc19c1fce')throw Error('Vínculo QA no autorizado');
  const manifest=(await c.query('SELECT datos FROM mayorista_private.qa_demo_manifest WHERE version=1 AND empresa_id=$1',[RESET_COMPANY])).rows[0]?.datos;
  const expected=manifest?.accounts?.filter(a=>a.email===EMAIL&&a.rol==='vendedor');
  if(manifest?.namespace!==pool.acceptanceNamespace||expected?.length!==1)throw Error('Cuenta demo no conciliada');
  const target=(await c.query(`SELECT u.user_id FROM mayorista_private.usuarios u
   JOIN mayorista_private.qa_local_accounts a ON a.user_id=u.user_id
   JOIN mayorista.miembros m ON m.user_id=u.user_id AND m.empresa_id=a.empresa_id
   WHERE u.email=$1 AND u.user_id=$2 AND a.empresa_id=$3 AND u.activo AND a.activo AND m.activo AND m.rol='vendedor' AND m.vendedor_id=$4
   FOR UPDATE OF u,a,m`,[EMAIL,expected[0].userId,RESET_COMPANY,expected[0].vendedorId])).rows;
  if(target.length!==1||Number((await c.query('SELECT count(*) AS n FROM mayorista.miembros WHERE user_id=$1',[target[0].user_id])).rows[0].n)!==1)throw Error('Cuenta ausente, revocada o compartida; no se modifica');
  const prior=(await c.query('SELECT request,response FROM mayorista_private.qa_live_journal WHERE run_id=$1 AND step=$2',[operationId,'password'])).rows[0];
  if(prior){
   if(prior.request?.fingerprint!==fingerprint||prior.response?.status!=='pass')throw Error('Restablecimiento previo divergente; revisión obligatoria');
   await c.query('COMMIT');return {status:'already_applied',email:EMAIL};
  }
  const updated=await c.query('UPDATE mayorista_private.usuarios SET salt=$2,password_hash=$3 WHERE user_id=$1 AND email=$4 RETURNING user_id',[target[0].user_id,record.salt,record.hash,EMAIL]);
  if(updated.rows.length!==1)throw Error('Actualización no conciliada');
  await c.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE empresa_id=$1 AND user_id=$2',[RESET_COMPANY,target[0].user_id]);
  await c.query('INSERT INTO mayorista_private.qa_live_journal(run_id,step,request,response) VALUES($1,$2,$3,$4)',[operationId,'password',{fingerprint,email:EMAIL,authorization:'explicit-user-approval-20261017'},{status:'pass',userId:target[0].user_id}]);
  await c.query('COMMIT');return {status:'pass',email:EMAIL};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}

export async function runResetSeller1QA(env){
 if(env.MAYORISTA_RESET_SELLER1_APPROVED!=='true')throw Error('Restablecimiento QA sin autorización explícita');
 const {railwayRuntime}=await import('./railway-runtime.mjs');
 const {acceptanceNamespace}=await import('../railway/acceptance-namespace.mjs');
 const {default:pg}=await import('pg');
 const config=railwayRuntime(env);
 if(config.origin!=='https://mayorista-api-qa-qa.up.railway.app')throw Error('Origen fuera de QA');
 const pool=acceptanceNamespace(new pg.Pool({...config.policy.config,max:2,application_name:'sigo-mayorista-qa-acceptance'}),'mayorista_acceptance_e1031f20aff5');
 try{
  const record=JSON.parse(Buffer.from(env.MAYORISTA_RESET_SELLER1_RECORD??'','base64url').toString());
  const result=await resetSeller1QA(pool,record);console.log(JSON.stringify({event:'MAYORISTA_QA_SELLER1_PASSWORD_RESET',...result}));return result;
 }finally{await pool.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])runResetSeller1QA(process.env).catch(()=>{console.error('Restablecimiento QA no completado; revisar alcance o estado privado.');process.exitCode=1;});
