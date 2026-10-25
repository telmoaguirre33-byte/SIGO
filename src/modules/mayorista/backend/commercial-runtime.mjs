import {prepareCommercialMigrations} from './commercial-migrations.mjs';
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
import {approvedOrigins} from '../api/origins.mjs';
const fail=()=>{throw new ApiError(503,'Destino comercial no preparado o no autorizado');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const publicAuthKey=k=>{if(typeof k!=='string')return false;if(k.startsWith('sb_publishable_'))return true;try{return JSON.parse(Buffer.from(k.split('.')[1],'base64url')).role==='anon';}catch{return false;}};
const hostname=v=>typeof v==='string'&&/^[a-z0-9.-]+$/i.test(v)&&!/(localhost|\.internal$|\.invalid$|\.test$|\.example$)/i.test(v);
export const profileHash=text=>createHash('sha256').update(text).digest('hex');
/** Perfil sin secretos revisado fuera de la aplicación. Deshabilitado por defecto. */
export function commercialRuntime(env,text){
 if(env.MAYORISTA_PRODUCTION_ENABLED!=='true'||env.MAYORISTA_RUNTIME_MODE!=='commercial'||typeof text!=='string'||profileHash(text)!==env.MAYORISTA_RELEASE_PROFILE_SHA256)fail();
 if(env.MAYORISTA_QA_ENABLED==='true'||env.MAYORISTA_INTERACTIVE_QA==='true'||Object.entries(env).some(([k,v])=>/^MAYORISTA_(BOOTSTRAP_|QA_|ACCEPT|SEED|RESET)/.test(k)&&v!==undefined&&v!==''))fail();
 let p;try{p=JSON.parse(text);}catch{fail();}
 if(p?.formatVersion!==1||p.approved!==true||!uuid(p.projectId)||!uuid(p.environmentId)||p.projectId===QA_RAILWAY.projectId||p.environmentId===QA_RAILWAY.environmentId||env.RAILWAY_PROJECT_ID!==p.projectId||env.RAILWAY_ENVIRONMENT_ID!==p.environmentId||!hostname(p.databaseHost)||!p.databaseName||!p.databaseUser||!p.runtimeRole||['postgres','supabase_admin','service_role','authenticated','anon'].includes(p.runtimeRole)||!/^[a-z][a-z0-9_]{2,62}$/.test(p.runtimeRole)||!Number.isInteger(p.databasePort)||![5432,6543].includes(p.databasePort)||typeof p.supabaseProjectRef!=='string'||!/^[a-z0-9]{20}$/.test(p.supabaseProjectRef)||!['direct','transaction_pooler'].includes(p.connectionMode))fail();
 if(p.connectionMode==='direct'&&(p.databaseHost!=='db.'+p.supabaseProjectRef+'.supabase.co'||p.databasePort!==5432)||p.connectionMode==='transaction_pooler'&&(!p.databaseHost.endsWith('.pooler.supabase.com')||p.databasePort!==6543))fail();
 if(p.databaseName!=='postgres'||p.databaseUser!==(p.connectionMode==='direct'?p.runtimeRole:p.runtimeRole+'.'+p.supabaseProjectRef)||p.authOrigin!=='https://'+p.supabaseProjectRef+'.supabase.co'||env.MAYORISTA_SIGO_AUTH_URL!==p.authOrigin||!publicAuthKey(env.MAYORISTA_SIGO_AUTH_ANON_KEY))fail();
 try{approvedOrigins(p.publicOrigin,[p.sigoOrigin]);if(new URL(p.publicOrigin).hostname.includes('qa')||!hostname(new URL(p.publicOrigin).hostname)||!hostname(new URL(p.sigoOrigin).hostname))fail();}catch{fail();}
 let u,key;try{u=new URL(env.DATABASE_URL);key=createPrivateKey(env.MAYORISTA_AUTH_PRIVATE_KEY);}catch{fail();}
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==p.databaseHost||Number(u.port||5432)!==p.databasePort||u.pathname!=='/'+p.databaseName||decodeURIComponent(u.username)!==p.databaseUser||!u.password||u.hash||[...u.searchParams].some(([k,v])=>k!=='sslmode'||v!=='verify-full')||key.asymmetricKeyType!=='ed25519'||profileHash(createPublicKey(key).export({format:'der',type:'spki'}))!==p.publicKeySha256||!env.MAYORISTA_DB_CA_PEM?.includes('-----BEGIN CERTIFICATE-----'))fail();
 const config=Object.freeze({host:p.databaseHost,port:p.databasePort,database:p.databaseName,user:p.databaseUser,password:decodeURIComponent(u.password),ssl:Object.freeze({ca:env.MAYORISTA_DB_CA_PEM,rejectUnauthorized:true,servername:p.databaseHost}),max:6,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,application_name:'sigo-mayorista-commercial'});
 const policy={config,assertPool(pool){const o=pool?.options;if(!o||['host','port','database','user','password','application_name'].some(k=>o[k]!==config[k])||o.ssl?.ca!==config.ssl.ca||o.ssl?.servername!==config.host||o.ssl?.rejectUnauthorized!==true||!Number.isInteger(o.max)||o.max<1||o.max>6)fail();}};
 return {profile:Object.freeze(p),hash:profileHash(text),policy,origin:p.publicOrigin,integrationOrigins:[p.sigoOrigin],privateKey:key,publicKey:createPublicKey(key),issuer:'sigo-mayorista-commercial:'+p.projectId+':'+p.environmentId};
}
/** Sin DDL, semillas ni escritura: comprueba DB, privilegios, versión y fuente canónica. */
export async function commercialReadiness(pool,config,head){
 config.policy.assertPool(pool);if(!/^[a-f0-9]{40}$/.test(head??''))fail();
 const c=await pool.connect();try{
  await c.query('BEGIN TRANSACTION READ ONLY');
  const role=(await c.query("SELECT current_database() AS db,current_user AS name,r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_roles privileged WHERE (privileged.rolsuper OR privileged.rolbypassrls) AND pg_has_role(current_user,privileged.oid,'MEMBER')) AS privileged_member,pg_has_role(current_user,'authenticated','MEMBER') AS member FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  if(role?.db!==config.profile.databaseName||role.name!==config.profile.runtimeRole||role.rolsuper||role.rolbypassrls||role.privileged_member||!role.member)fail();
  const bind=(await c.query('SELECT profile_hash,project_id,environment_id FROM mayorista_private.release_binding WHERE id=true')).rows[0];
  if(bind?.profile_hash!==config.hash||bind.project_id!==config.profile.projectId||bind.environment_id!==config.profile.environmentId)fail();
  const ledger=(await c.query('SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version')).rows;
  const expected=await prepareCommercialMigrations(config.profile.runtimeRole);if(ledger.length!==expected.length||ledger.some((r,i)=>r.version!==expected[i].version||r.source_hash!==expected[i].sourceHash))fail();
  const refs=(await c.query("SELECT to_regclass('public.empresas') AS company,to_regclass('auth.sessions') AS sessions,to_regprocedure('public.leer_catalogo_mayorista_sigo(uuid)') AS catalog,to_regprocedure('public.cotizar_pedido_mayorista_sigo(uuid,uuid,jsonb)') AS quote,to_regclass('mayorista.importaciones') AS imports")).rows[0];
  if(!refs||Object.values(refs).some(v=>!v))fail();
  const rls=(await c.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mayorista' AND c.relkind='r'")).rows;
  if(rls.length<20||rls.some(r=>!r.relrowsecurity||!r.relforcerowsecurity))fail();
  await c.query('ROLLBACK');return {status:'ready_for_pilot_acceptance',head,runtime:'commercial',schemaVersion:21,productionAcceptance:false};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
