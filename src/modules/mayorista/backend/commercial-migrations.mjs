import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {commercialGrants} from './commercial-grants.mjs';
const root=new URL('../../../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
/** Ensambla fuentes fijadas, sin conexiones ni aplicación implícita. */
export async function prepareCommercialMigrations(role){
 const manifest=JSON.parse(await readFile(new URL('docs/mayorista/preproduccion/inventario-migraciones.json',root),'utf8')),steps=[];
 if(manifest.productionApproved!==false||manifest.autoApply!==false||manifest.sources?.length!==20)throw Error('MIGRATION_INVENTORY_INVALID');
 for(const [index,item] of manifest.sources.entries()){
  if(item.order!==index+1||manifest.excluded.includes(item.path)||!item.path.endsWith('.sql')||item.path.includes('..')||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('MIGRATION_INVENTORY_INVALID');
  const text=await readFile(new URL(item.path,root),'utf8');if(hash(text)!==item.sha256)throw Error('MIGRATION_SOURCE_DRIFT');
  let sql=text.replace(/^\s*(begin;|rollback;).*$/gmi,'').replace(/set search_path=public\b/gi,"SET search_path=''");
  if(item.path.endsWith('railway/private-auth-schema.sql'))sql=sql.replace(/create schema mayorista_private;/i,'');
  if(/create\s+(schema\s+auth|role\s)/i.test(sql))throw Error('MIGRATION_FIXTURE_REJECTED');
  steps.push({version:item.order,sourceHash:hash(sql),sourceFileHash:item.sha256,sql});
 }
 const sql=commercialGrants(role);steps.push({version:21,sourceHash:hash(sql),sql});
 return steps;
}
/** Sólo invocación explícita por operador autorizado. El servidor no llama este instalador.
 * pool/target se validan por el llamador con credenciales de migración distintas del runtime.
 * Una transacción: fallo revierte DDL, binding y ledger. No baja versiones ni limpia datos. */
export async function installCommercialMigrations({pool,profile,profileText,profileHash,approval}){
 const steps=await prepareCommercialMigrations(profile?.runtimeRole);
 if(typeof profileText!=='string'||hash(profileText)!==profileHash||JSON.stringify(JSON.parse(profileText))!==JSON.stringify(profile)||approval?.profileHash!==profileHash||approval?.action!=='install-commercial-schema'||!/^[a-f0-9]{64}$/.test(profileHash)||profile?.approved!==true||steps?.length!==21||steps.some((s,i)=>s.version!==i+1||!/^[a-f0-9]{64}$/.test(s.sourceHash))||!profile.databaseName||!profile.migrationRole||profile.migrationRole===profile.runtimeRole)throw Error('MIGRATION_APPROVAL_REQUIRED');
 const o=pool?.options;if(!o||o.host!==profile.databaseHost||Number(o.port)!==profile.databasePort||o.database!==profile.databaseName||o.user!==profile.migrationUser||o.ssl?.rejectUnauthorized!==true||o.ssl?.servername!==profile.databaseHost||!o.ssl.ca||profile.projectId==='b9a7da94-1d87-46fe-b4da-c7e241ebe185'||profile.environmentId==='2addc3e9-f088-42df-a72c-c233fd4308cb')throw Error('MIGRATION_POOL_MISMATCH');
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='120s'");await c.query("SELECT pg_advisory_xact_lock(hashtext('sigo-mayorista-commercial-release'))");
  const target=(await c.query('SELECT current_database() AS db,current_user AS role,inet_server_addr()::text AS address')).rows[0];
  if(target?.db!==profile.databaseName||target.role!==profile.migrationRole)throw Error('MIGRATION_TARGET_MISMATCH');
  const state=(await c.query("SELECT to_regclass('mayorista_private.release_migrations') AS ledger,to_regnamespace('mayorista') AS operational,to_regnamespace('mayorista_private') AS private,to_regclass('public.sigo_empresa_tipo_negocio') AS activation,to_regclass('public.sigo_mayorista_comercio_fuente') AS source")).rows[0];
  if(!state?.ledger){
   if(state?.operational||state?.private||state?.activation||state?.source)throw Error('UNMANAGED_SCHEMA_REQUIRES_RECONCILIATION');
   const prereq=(await c.query("SELECT to_regclass('public.empresas') AS companies,to_regclass('auth.sessions') AS sessions,to_regprocedure('public.tiene_permiso_empresa(uuid,text)') AS permissions,to_regclass('public.ventas_sigo') AS sales,to_regclass('public.productos') AS products")).rows[0];
   if(!prereq||Object.values(prereq).some(v=>!v))throw Error('CANONICAL_SCHEMA_MISSING');
   await c.query('CREATE SCHEMA mayorista_private;REVOKE ALL ON SCHEMA mayorista_private FROM PUBLIC,anon,authenticated;CREATE TABLE mayorista_private.release_migrations(version integer primary key,source_hash text not null,installed_at timestamptz not null default now());CREATE TABLE mayorista_private.release_binding(id boolean primary key check(id),profile_hash text not null,project_id text not null,environment_id text not null);REVOKE ALL ON mayorista_private.release_migrations,mayorista_private.release_binding FROM PUBLIC,anon,authenticated;');
   await c.query('INSERT INTO mayorista_private.release_binding VALUES(true,$1,$2,$3)',[profileHash,profile.projectId,profile.environmentId]);
  }
  const binding=(await c.query('SELECT profile_hash,project_id,environment_id FROM mayorista_private.release_binding WHERE id=true')).rows[0];
  if(binding?.profile_hash!==profileHash||binding.project_id!==profile.projectId||binding.environment_id!==profile.environmentId)throw Error('MIGRATION_BINDING_MISMATCH');
  const installed=(await c.query('SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version')).rows;
  if(installed.some((r,i)=>r.version!==i+1||steps[i]?.sourceHash!==r.source_hash)||installed.length!==0&&installed.length!==21)throw Error('MIGRATION_LEDGER_DRIFT');
  if(!installed.length)for(const step of steps){await c.query(step.sql);await c.query('INSERT INTO mayorista_private.release_migrations(version,source_hash) VALUES($1,$2)',[step.version,step.sourceHash]);}
  await c.query('COMMIT');return {installed:21,reused:installed.length===21,seeded:false};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
