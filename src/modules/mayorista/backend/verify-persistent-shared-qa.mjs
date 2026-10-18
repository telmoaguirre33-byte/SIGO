import pg from 'pg';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {acceptanceNamespace,installAcceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {schemaPackage} from '../railway/schema-package.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
import {verifyBusinessTypeSQL} from '../tests/business-type-sql.mjs';
import {verifySharedCommerceSQL} from '../tests/shared-commerce-sql.mjs';
import {verifySharedBackend} from '../tests/shared-backend.mjs';
import {verifySharedFiscal} from '../tests/shared-fiscal.mjs';
import {upgradeManagementQA} from './upgrade-management-qa.mjs';
/** Esquemas de aceptación dentro de la base PostgreSQL QA EXISTENTE. Ninguna conexión a producción.
 * Persiste ventas, Caja, stock, cuenta, crédito y reserva fiscal para inspección posterior.
 * No crea servicios, puertos, dominios ni suscripciones. */
export async function verifyPersistentSharedQA(env){
 if(env.MAYORISTA_SHARED_SOURCE_QA!=='true')throw Error('Aceptación compartida QA no habilitada');
 const revision=env.RAILWAY_GIT_COMMIT_SHA;if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('Revisión Railway no verificada');
 const config=railwayRuntime(env),base=new pg.Pool(config.policy.config),name='mayorista_acceptance_'+revision.slice(0,12);let fixture,lock;
 try{
  await assertInstalledQA(base);await upgradeManagementQA(env);
  lock=await base.connect();await lock.query("SELECT pg_advisory_lock(hashtext('mayorista-shared-qa-acceptance'))");
  await lock.query(`CREATE TABLE IF NOT EXISTS mayorista_private.acceptance_runs(revision text primary key,fixture_database text not null,fixture_namespace text,verified_at timestamptz not null default now(),report jsonb not null);
   ALTER TABLE mayorista_private.acceptance_runs ADD COLUMN IF NOT EXISTS fixture_namespace text;
   ALTER TABLE mayorista_private.acceptance_runs ENABLE ROW LEVEL SECURITY;REVOKE ALL ON mayorista_private.acceptance_runs FROM public,anon,authenticated;`);
  const existing=(await lock.query('SELECT report FROM mayorista_private.acceptance_runs WHERE revision=$1',[revision])).rows[0];
  if(existing){const alive=(await lock.query('SELECT nspname FROM pg_namespace WHERE nspname=$1',[name+'_public'])).rows[0];if(!alive)throw Error('Evidencia persistente no disponible');return existing.report;}
  if((await lock.query('SELECT nspname FROM pg_namespace WHERE nspname LIKE $1',[name+'_%'])).rows.length)throw Error('Fixture existente sin evidencia: no se sobrescribe');
  if(Number((await lock.query("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'mayorista_acceptance_%_public'")).rows[0].count)>=10)throw Error('Revisar retención de fixtures QA antes de crear otro');
  const open=()=>acceptanceNamespace(new pg.Pool({...config.policy.config,max:2,application_name:'sigo-mayorista-qa-acceptance'}),name);
  fixture=open();await installAcceptanceNamespace(fixture,await schemaPackage(),[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);
  const controls=[...await verifyBusinessTypeSQL(fixture),...await verifySharedCommerceSQL(fixture),...await verifySharedBackend(fixture),...await verifySharedFiscal(fixture)];
  await fixture.query('UPDATE mayorista_private.sesiones SET revocada=true; UPDATE mayorista_private.usuarios SET activo=false');
  const countSQL=`SELECT (SELECT count(*) FROM public.ventas_sigo) AS ventas,(SELECT count(*) FROM public.arca_comprobantes) AS comprobantes,(SELECT count(*) FROM mayorista.pedidos) AS pedidos`;
  const counts=(await fixture.query(countSQL)).rows[0];
  await fixture.end();fixture=open();
  if(JSON.stringify((await fixture.query(countSQL)).rows[0])!==JSON.stringify(counts))throw Error('Persistencia tras reconexión fallida');
  controls.push({name:'Ventas, factura y pedido persisten tras cerrar y reabrir conexiones PostgreSQL',status:'pass'});
  const report={status:'ready_for_qa',revision,scope:'persistent_isolated_shared_schemas',fixtureNamespace:name,database:config.policy.config.database,fiscalTransport:'simulated_wsfe',productionActivation:false,controls,counts};
  await lock.query('INSERT INTO mayorista_private.acceptance_runs(revision,fixture_database,fixture_namespace,report) VALUES($1,$2,$3,$4)',[revision,config.policy.config.database,name,report]);
  return report;
 }finally{if(fixture)await fixture.end();if(lock){await lock.query("SELECT pg_advisory_unlock(hashtext('mayorista-shared-qa-acceptance'))").catch(()=>{});lock.release();}await base.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])verifyPersistentSharedQA(process.env).then(report=>console.log(JSON.stringify({event:'MAYORISTA_SHARED_QA_VERIFIED',...report}))).catch(()=>{console.error(JSON.stringify({event:'MAYORISTA_SHARED_QA_FAILED',productionChanged:false}));process.exitCode=1;});
