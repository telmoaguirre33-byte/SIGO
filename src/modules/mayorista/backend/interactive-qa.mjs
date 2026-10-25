import pg from 'pg';
import {installQaLocalAccounts} from './qa-local-accounts.mjs';
import {createHash} from 'node:crypto';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {acceptanceNamespace,installAcceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {schemaPackage} from '../railway/schema-package.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
import {verifyBusinessTypeSQL} from '../tests/business-type-sql.mjs';
import {verifySharedCommerceSQL} from '../tests/shared-commerce-sql.mjs';
import {prepareSharedBackendFixture} from '../tests/shared-backend.mjs';
import {createQaSigoLink,createSigoReadOnlyVerifier} from '../security/qa-sigo-link.mjs';
const QA_COMPANY='30000000-0000-4000-8000-000000000001';
export async function interactiveQa(env,{Pool=pg.Pool}={}){
 if(env.MAYORISTA_INTERACTIVE_QA!=='true')return null;
 const config=railwayRuntime(env),externalEmpresaId=env.MAYORISTA_QA_SIGO_EMPRESA_ID,origin=env.MAYORISTA_SIGO_AUTH_URL;
 if(!/^[a-f0-9-]{36}$/i.test(externalEmpresaId??'')||!config.integrationOrigins.length)throw Error('Empresa/origen de prueba no configurados');
 const verifyRemote=createSigoReadOnlyVerifier({origin,anonKey:env.MAYORISTA_SIGO_AUTH_ANON_KEY});
 const name='mayorista_acceptance_'+createHash('sha256').update('interactive-qa-v1:'+externalEmpresaId+':'+origin).digest('hex').slice(0,12);
 const raw=new Pool({...config.policy.config,max:2,application_name:'sigo-mayorista-qa-acceptance'}),pool=acceptanceNamespace(raw,name),lock=await raw.connect();let failed=false;
 try{
  await assertInstalledQA({query:(...args)=>lock.query(...args)});
  await lock.query("SELECT pg_advisory_lock(hashtext('mayorista-interactive-qa-v1'))");
  const exists=(await lock.query('SELECT nspname FROM pg_namespace WHERE nspname=$1',[pool.schemas.public])).rows.length;
  // La conexión del lock se libera antes del bootstrap; la exclusión entre startups la mantiene el lock de sesión.
  if(!exists){
   // Usa otro pool limitado durante la inicialización; no crea DB/servicios ni usa una fuente externa.
   const initializer=acceptanceNamespace(new Pool({...config.policy.config,max:2,application_name:'sigo-mayorista-qa-acceptance'}),name);
   try{
    await installAcceptanceNamespace(initializer,await schemaPackage(),[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);
    await verifyBusinessTypeSQL(initializer);await verifySharedCommerceSQL(initializer);await prepareSharedBackendFixture(initializer,{origin:config.origin});
    await initializer.query('UPDATE mayorista_private.usuarios SET activo=false;UPDATE mayorista_private.sesiones SET revocada=true');
    await initializer.query("UPDATE mayorista.empresas SET nombre='lapizcito5 · QA AISLADO' WHERE empresa_id=$1",[QA_COMPANY]);
    await initializer.query(`CREATE TABLE mayorista_private.qa_interactive_scope(id boolean primary key default true check(id),external_empresa_id uuid not null,qa_empresa_id uuid not null,auth_origin text not null,created_at timestamptz not null default now());
     CREATE TABLE mayorista_private.qa_link_audit(id bigint generated always as identity primary key,external_empresa_id uuid not null,qa_empresa_id uuid not null,user_id uuid not null,rol text not null,fecha timestamptz not null default now());
     ALTER TABLE mayorista_private.qa_interactive_scope ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista_private.qa_link_audit ENABLE ROW LEVEL SECURITY;REVOKE ALL ON mayorista_private.qa_interactive_scope,mayorista_private.qa_link_audit FROM public,anon,authenticated;`);
    await initializer.query('INSERT INTO mayorista_private.qa_interactive_scope(id,external_empresa_id,qa_empresa_id,auth_origin) VALUES(true,$1,$2,$3)',[externalEmpresaId,QA_COMPANY,origin]);
   }finally{await initializer.end();}
  }
  const binding=(await pool.query('SELECT * FROM mayorista_private.qa_interactive_scope WHERE id=true')).rows[0];
  if(binding?.external_empresa_id!==externalEmpresaId||binding.qa_empresa_id!==QA_COMPANY||binding.auth_origin!==origin)throw Error('Namespace QA existente no conciliado; no se sobrescribe');
  await assertInstalledQA(pool);
  await installQaLocalAccounts(pool);
  return {pool,namespace:name,externalEmpresaId,qaEmpresaId:QA_COMPANY,link:createQaSigoLink({pool,externalEmpresaId,qaEmpresaId:QA_COMPANY,verifyRemote,allowLocalAccounts:true})};
 }catch(e){failed=true;throw e;}finally{await lock.query("SELECT pg_advisory_unlock(hashtext('mayorista-interactive-qa-v1'))").catch(()=>{});lock.release();if(failed)await pool.end().catch(()=>{});}
}

