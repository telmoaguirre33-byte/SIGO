import pg from 'pg';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {schemaPackage} from '../railway/schema-package.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
import {verifyBusinessTypeSQL} from '../tests/business-type-sql.mjs';
import {verifySharedCommerceSQL} from '../tests/shared-commerce-sql.mjs';
import {verifySharedBackend} from '../tests/shared-backend.mjs';
import {verifySharedFiscal} from '../tests/shared-fiscal.mjs';
import {upgradeManagementQA} from './upgrade-management-qa.mjs';
/** DB de aceptación dentro del PostgreSQL QA EXISTENTE. Ninguna conexión a producción.
 * Persiste ventas, Caja, stock, cuenta, crédito y reserva fiscal para inspección posterior.
 * No crea servicios, puertos, dominios ni suscripciones. */
export async function verifyPersistentSharedQA(env){
 if(env.MAYORISTA_SHARED_SOURCE_QA!=='true')throw Error('Aceptación compartida QA no habilitada');
 const revision=env.RAILWAY_GIT_COMMIT_SHA;if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('Revisión Railway no verificada');
 const config=railwayRuntime(env),base=new pg.Pool(config.policy.config),name='mayorista_acceptance_'+revision.slice(0,12);let fixture,lock;
 try{
  await assertInstalledQA(base);await upgradeManagementQA(env);
  lock=await base.connect();await lock.query("SELECT pg_advisory_lock(hashtext('mayorista-shared-qa-acceptance'))");
  await lock.query(`CREATE TABLE IF NOT EXISTS mayorista_private.acceptance_runs(revision text primary key,fixture_database text not null,verified_at timestamptz not null default now(),report jsonb not null);
   ALTER TABLE mayorista_private.acceptance_runs ENABLE ROW LEVEL SECURITY;REVOKE ALL ON mayorista_private.acceptance_runs FROM public,anon,authenticated;`);
  const existing=(await lock.query('SELECT report FROM mayorista_private.acceptance_runs WHERE revision=$1',[revision])).rows[0];
  if(existing){const alive=(await lock.query('SELECT datname FROM pg_database WHERE datname=$1',[name])).rows[0];if(!alive)throw Error('Evidencia persistente no disponible');return existing.report;}
  if((await lock.query('SELECT datname FROM pg_database WHERE datname=$1',[name])).rows.length)throw Error('Fixture existente sin evidencia: no se sobrescribe');
  if(Number((await lock.query("SELECT count(*) FROM pg_database WHERE datname LIKE 'mayorista_acceptance_%'")).rows[0].count)>=10)throw Error('Revisar retención de fixtures QA antes de crear otro');
  await lock.query('CREATE DATABASE '+name);
  fixture=new pg.Pool({...config.policy.config,database:name,max:2,application_name:'sigo-mayorista-qa-acceptance'});
  await fixture.query('BEGIN');await fixture.query(await schemaPackage());await fixture.query('INSERT INTO mayorista_private.infrastructure_binding VALUES(true,$1,$2,1)',[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);await fixture.query('COMMIT');
  const controls=[...await verifyBusinessTypeSQL(fixture),...await verifySharedCommerceSQL(fixture),...await verifySharedBackend(fixture),...await verifySharedFiscal(fixture)];
  await fixture.query('UPDATE mayorista_private.sesiones SET revocada=true; UPDATE mayorista_private.usuarios SET activo=false');
  const counts=(await fixture.query(`SELECT (SELECT count(*) FROM public.ventas_sigo) AS ventas,(SELECT count(*) FROM public.arca_comprobantes) AS comprobantes,(SELECT count(*) FROM mayorista.pedidos) AS pedidos`)).rows[0];
  const report={status:'ready_for_qa',revision,scope:'persistent_isolated_shared_fixture',fiscalTransport:'simulated_wsfe',productionActivation:false,controls,counts};
  await lock.query('INSERT INTO mayorista_private.acceptance_runs(revision,fixture_database,report) VALUES($1,$2,$3)',[revision,name,report]);
  return report;
 }finally{if(fixture)await fixture.end();if(lock){await lock.query("SELECT pg_advisory_unlock(hashtext('mayorista-shared-qa-acceptance'))").catch(()=>{});lock.release();}await base.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])verifyPersistentSharedQA(process.env).then(report=>console.log(JSON.stringify({event:'MAYORISTA_SHARED_QA_VERIFIED',...report}))).catch(()=>{console.error(JSON.stringify({event:'MAYORISTA_SHARED_QA_FAILED',productionChanged:false}));process.exitCode=1;});
