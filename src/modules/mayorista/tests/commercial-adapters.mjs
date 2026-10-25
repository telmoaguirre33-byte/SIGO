import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {commercialGrants} from '../backend/commercial-grants.mjs';
import {assertSharedFixture} from './shared-fixture-policy.mjs';
/** PostgreSQL CI real, namespace existente de fixture; sin llamadas a Railway/Supabase. */
export async function verifyCommercialAdapters(pool,{make,origin,E,B,creds}){
 await assertSharedFixture(pool);const role='mayorista_commercial_ci_'+randomUUID().replace(/-/g,'').slice(0,10),pending=[];
 await pool.query('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT');
 try{
  await pool.query("ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb;UPDATE auth.users a SET email=u.email FROM mayorista_private.usuarios u WHERE a.id=u.user_id;CREATE TABLE mayorista_private.release_binding(id boolean primary key,profile_hash text,project_id text,environment_id text);CREATE TABLE mayorista_private.release_migrations(version integer primary key,source_hash text);");
  await pool.query(commercialGrants(role));
  const limited={options:pool.options,connect:async()=>{const c=await pool.connect();await c.query('SET ROLE '+role);return {query:c.query.bind(c),release(){const task=c.query('RESET ROLE').finally(()=>c.release());pending.push(task);}};},query:async(sql,args)=>{const c=await limited.connect();try{return await c.query(sql,args);}finally{c.release();}}};
  const policy={assertPool(p){assert.equal(p,limited);}},service=make({pool:limited,databasePolicy:policy,commercialMode:true,sourceRevision:'a'.repeat(40),authenticateSigo:async()=>{const u=(await pool.query('SELECT user_id FROM mayorista_private.usuarios WHERE email=$1',[creds.gerencia.email])).rows[0];return {id:u.user_id,email:creds.gerencia.email};}});
  const call=async(path,body,token)=>{const r=await service(new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};};
  assert.equal((await call('/auth/companies',{email:creds.vendedor.email,password:'incorrecta'})).status,401);
  const discover=await call('/auth/companies',{email:creds.vendedor.email,password:creds.vendedor.password});assert.equal(discover.status,200,JSON.stringify(discover));assert.ok(discover.body.empresas.some(e=>e.empresaId===E));assert.ok(!discover.body.empresas.some(e=>e.empresaId===B));assert.equal(discover.body.accessToken,undefined);
  const login=await call('/auth/login',creds.vendedor);assert.equal(login.status,200,JSON.stringify(login));const token=login.body.accessToken;
  assert.equal((await call('/me',null,token)).status,200);assert.equal((await call('/catalog',null,token)).status,200);
  assert.equal((await call('/auth/login',{...creds.vendedor,empresaId:B})).status,403);
  const sso=await call('/auth/sigo',{empresaId:E},'verified-ci-only');assert.equal(sso.status,200,JSON.stringify(sso));assert.equal((await call('/admin/users',null,sso.body.accessToken)).status,200);
  const membership=(await pool.query("SELECT user_id FROM mayorista.miembros WHERE empresa_id=$1 AND rol='vendedor' LIMIT 1",[E])).rows[0];await pool.query('UPDATE mayorista.miembros SET activo=false WHERE empresa_id=$1 AND user_id=$2',[E,membership.user_id]);
  try{assert.equal((await call('/me',null,token)).status,403);assert.equal((await call('/auth/companies',{email:creds.vendedor.email,password:creds.vendedor.password})).status,403);}finally{await pool.query('UPDATE mayorista.miembros SET activo=true WHERE empresa_id=$1 AND user_id=$2',[E,membership.user_id]);}
  assert.equal((await pool.query("SELECT has_function_privilege('anon','mayorista_private.bootstrap_commercial_identity(uuid,uuid,text,text,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false);
  console.log('PASS adaptadores comerciales PostgreSQL real: rol SIN BYPASSRLS, descubrimiento autenticado sin UUID, catálogo, SSO, directorio, aislamiento, revocación y helpers no públicos. Auth externo CI simulado.');
 }finally{
  await Promise.all(pending);await pool.query('DROP POLICY IF EXISTS commercial_directory_backend ON mayorista.miembros;DROP POLICY IF EXISTS commercial_directory_insert ON mayorista.miembros;DROP POLICY IF EXISTS commercial_directory_update ON mayorista.miembros;');
  await pool.query('DROP OWNED BY '+role);await pool.query('DROP ROLE '+role);
 }
}
