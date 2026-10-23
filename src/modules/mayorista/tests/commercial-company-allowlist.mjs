import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {commercialRuntime,integrationQaRuntime,profileHash} from '../backend/commercial-runtime.mjs';
import {createIsolatedAuth,passwordRecord} from '../security/isolated-auth.mjs';
import {createSigoBridge} from '../security/sigo-bridge.mjs';
import {createIsolatedService} from '../backend/service.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';

// Únicamente UUIDs efímeros, crypto local y dobles de DB/Auth. Sin red ni base real.
const keys=generateKeyPairSync('ed25519'),allowed=randomUUID(),excluded=randomUUID(),userId=randomUUID(),sellerId=randomUUID();
const origin='https://commercial-ci.example.com',issuer='commercial-allowlist-unit',password='unit-only-password';
const passwordData=await passwordRecord(password);
const profile={formatVersion:1,approved:true,allowedCompanyIds:[allowed],projectId:randomUUID(),environmentId:randomUUID(),databaseHost:'db.abcdefghijklmnopqrst.supabase.co',databasePort:5432,databaseName:'postgres',databaseUser:'sigo_commercial_app',runtimeRole:'sigo_commercial_app',connectionMode:'direct',supabaseProjectRef:'abcdefghijklmnopqrst',authOrigin:'https://abcdefghijklmnopqrst.supabase.co',publicOrigin:origin,sigoOrigin:'https://sigo.example.com',publicKeySha256:profileHash(keys.publicKey.export({format:'der',type:'spki'}))};
const runtimeEnv=p=>({MAYORISTA_PRODUCTION_ENABLED:'true',MAYORISTA_RUNTIME_MODE:'commercial',MAYORISTA_RELEASE_PROFILE_SHA256:profileHash(JSON.stringify(p)),RAILWAY_PROJECT_ID:p.projectId,RAILWAY_ENVIRONMENT_ID:p.environmentId,DATABASE_URL:'postgresql://'+p.databaseUser+':unit-only@'+p.databaseHost+':'+p.databasePort+'/postgres?sslmode=verify-full',MAYORISTA_DB_CA_PEM:'-----BEGIN CERTIFICATE-----\nUNIT_ONLY_NOT_A_CERT\n-----END CERTIFICATE-----',MAYORISTA_AUTH_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}),MAYORISTA_SIGO_AUTH_URL:p.authOrigin,MAYORISTA_SIGO_AUTH_ANON_KEY:'sb_publishable_unit_only'});
const runtime=p=>commercialRuntime(runtimeEnv(p),JSON.stringify(p));
const rejectsStatus=status=>error=>error.status===status;
const bearer=empresaId=>{const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const raw=enc({alg:'EdDSA',typ:'JWT'})+'.'+enc({iss:issuer,aud:'sigo-mayorista-isolated',sub:userId,sid:randomUUID(),empresaId,exp:Math.floor(Date.now()/1000)+3600});return raw+'.'+sign(null,Buffer.from(raw),keys.privateKey).toString('base64url');};
function fixture(){
 const calls=[],sessions=new Map();
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT user_id,salt,password_hash'))return {rows:[{user_id:userId,salt:passwordData.salt,password_hash:passwordData.hash}]};
  if(sql.startsWith('INSERT INTO mayorista_private.sesiones')){sessions.set(args[0],{user_id:args[1],empresa_id:args[2]});return {rows:[]};}
  if(sql.startsWith('SELECT s.user_id'))return {rows:sessions.has(args[0])?[{...sessions.get(args[0]),nombre:'Unit',email:'unit@example.invalid'}]:[]};
  if(sql.startsWith('SELECT vendedor_id,rol'))return {rows:[{vendedor_id:sellerId,rol:'vendedor'}]};
  if(sql.startsWith('SELECT empresa_id,nombre'))return {rows:[{empresa_id:args[0],nombre:'Unit company'}]};
  if(sql.startsWith('SELECT nombre FROM mayorista.vendedores'))return {rows:[{nombre:'Unit seller'}]};
  if(sql.startsWith('SELECT user_id FROM mayorista_private.usuarios'))return {rows:[{user_id:userId}]};
  if(sql.startsWith('SELECT mayorista_private.bootstrap_commercial_identity'))return {rows:[]};
  if(sql.includes('AS "empresaId"'))return {rows:[{empresaId:allowed,nombre:'Allowed'},{empresaId:excluded,nombre:'Excluded'}]};
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/.test(sql))return {rows:[]};
  throw Error('Unexpected unit SQL: '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})},databasePolicy={assertPool:p=>assert.equal(p,pool)};
 const options={enabled:true,pool,databasePolicy,privateKey:keys.privateKey,publicKey:keys.publicKey,issuer,operational:true,commercialMode:true,allowedCompanyIds:[allowed]};
 return {calls,pool,options,auth:createIsolatedAuth(options)};
}

test('commercial profile requires nonempty valid unique company IDs, bound to profile hash',()=>{
 for(const ids of [undefined,null,[],['bad'],[allowed,allowed],[allowed,allowed.toUpperCase()]]){
  const p={...profile,allowedCompanyIds:ids};assert.throws(()=>runtime(p),rejectsStatus(503));
 }
 const p={...profile,allowedCompanyIds:[allowed]},c=runtime(p);p.allowedCompanyIds.push(excluded);
 assert.deepEqual(c.allowedCompanyIds,[allowed]);assert.deepEqual(c.profile.allowedCompanyIds,[allowed]);assert.ok(Object.isFrozen(c.allowedCompanyIds));
 assert.throws(()=>c.allowedCompanyIds.push(excluded),TypeError);
 const upper={...profile,allowedCompanyIds:[allowed.toUpperCase()]},upperConfig=runtime(upper);
 assert.deepEqual(upperConfig.allowedCompanyIds,[allowed]);assert.equal(JSON.stringify(upperConfig.profile),JSON.stringify(upper));
 const tampered=JSON.stringify({...profile,allowedCompanyIds:[excluded]});assert.throws(()=>commercialRuntime(runtimeEnv(profile),tampered),rejectsStatus(503));
});

test('integration QA profile remains valid without a commercial company list',()=>{
 const p={...profile,purpose:'integration-qa',apiPrefix:'/integracion-qa',projectId:QA_RAILWAY.projectId,environmentId:QA_RAILWAY.environmentId,databaseHost:'aws-0-us-east-2.pooler.supabase.com',databasePort:6543,databaseUser:'sigo_qa_mayorista_backend.xcapcnczxljxwxzigtvs',runtimeRole:'sigo_qa_mayorista_backend',connectionMode:'transaction_pooler',supabaseProjectRef:'xcapcnczxljxwxzigtvs',authOrigin:'https://xcapcnczxljxwxzigtvs.supabase.co',publicOrigin:'https://mayorista-api-qa-qa.up.railway.app',sigoOrigin:'https://commercial-test-telmoaguirre33-byte.vercel.app',sigoOrigins:['https://commercial-test-telmoaguirre33-byte.vercel.app']};delete p.allowedCompanyIds;
 const env={...runtimeEnv(p),MAYORISTA_PRODUCTION_ENABLED:'false',MAYORISTA_RUNTIME_MODE:'integration-qa',MAYORISTA_INTEGRATION_QA_ENABLED:'true',MAYORISTA_SHARED_SOURCE_QA:'true',RAILWAY_SERVICE_ID:'9053689a-0e32-4f3c-b5da-3c01e480a9c6'};
 const c=integrationQaRuntime(env,JSON.stringify(p));assert.equal(c.allowedCompanyIds,undefined);assert.equal(c.policy.config.max,2);
});

test('commercial runtime rejects QA switches, preview origins and the known integration project',()=>{
 for(const key of ['MAYORISTA_INTEGRATION_QA_ENABLED','MAYORISTA_SHARED_SOURCE_QA']){
  for(const value of ['true','false'])assert.throws(()=>commercialRuntime({...runtimeEnv(profile),[key]:value},JSON.stringify(profile)),rejectsStatus(503));
  assert.ok(commercialRuntime({...runtimeEnv(profile),[key]:''},JSON.stringify(profile)));
 }
 for(const key of ['publicOrigin','sigoOrigin'])for(const value of ['https://commercial-preview.vercel.app','https://commercial-preview.vercel.app.'])assert.throws(()=>runtime({...profile,[key]:value}),rejectsStatus(503));
 const ref='xcapcnczxljxwxzigtvs';assert.throws(()=>runtime({...profile,supabaseProjectRef:ref,databaseHost:'db.'+ref+'.supabase.co',authOrigin:'https://'+ref+'.supabase.co'}),rejectsStatus(503));
});

test('excluded login, trusted sign-in, signed existing token and logout do not reach DB',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.auth.signIn({empresaId:excluded,email:'unit@example.invalid',password}),rejectsStatus(403));
 await assert.rejects(()=>f.auth.signInTrustedIdentity(userId,excluded),rejectsStatus(403));
 await assert.rejects(()=>f.auth.verify(bearer(excluded)),rejectsStatus(403));
 await assert.rejects(()=>f.auth.signOut(bearer(excluded)),rejectsStatus(403));
 await assert.rejects(()=>f.auth.verify('invalid.signature.token'),rejectsStatus(401));
 assert.equal(f.calls.length,0);
});

test('excluded SSO is rejected before provider authentication or identity bootstrap',async()=>{
 const f=fixture();let providerCalls=0;
 const sso=createSigoBridge({...f.options,auth:f.auth,sourceRevision:'a'.repeat(40),authenticateSigo:async()=>{providerCalls++;return {id:userId,email:'unit@example.invalid'};}});
 await assert.rejects(()=>sso(new Request(origin+'/auth/sigo',{headers:{Authorization:'Bearer unit-only'}}),excluded),rejectsStatus(403));
 assert.equal(providerCalls,0);assert.equal(f.calls.length,0);
});

test('allowed password and SSO login still issue verifiable sessions and preserve seller role',async()=>{
 const f=fixture();
 const session=await f.auth.signIn({empresaId:allowed,email:'unit@example.invalid',password});
 const p=await f.auth.verify(session.accessToken);assert.equal(p.empresaId,allowed);assert.equal(p.rol,'vendedor');assert.ok(p.permissions.includes('pedidos:crear'));
 const sso=createSigoBridge({...f.options,auth:f.auth,sourceRevision:'a'.repeat(40),authenticateSigo:async()=>({id:userId,email:'unit@example.invalid'})});
 const trusted=await sso(new Request(origin+'/auth/sigo',{headers:{Authorization:'Bearer unit-only'}}),allowed);
 assert.equal((await f.auth.verify(trusted.accessToken)).empresaId,allowed);
 assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT INTO mayorista_private.sesiones')).length,2);
 assert.equal(f.calls.filter(c=>c.sql.startsWith('SELECT mayorista_private.bootstrap_commercial_identity')).length,1);
});

test('seller companies are scoped in SQL before LIMIT and never expose excluded tenants',async()=>{
 const f=fixture(),result=await f.auth.sellerCompanies({email:'unit@example.invalid',password});
 assert.deepEqual(result.empresas,[{empresaId:allowed,nombre:'Allowed'}]);
 const listing=f.calls.find(c=>c.sql.includes('AS "empresaId"'));
 assert.match(listing.sql,/m\.empresa_id=ANY\(\$2::uuid\[\]\)/);assert.ok(listing.sql.indexOf('ANY($2::uuid[])')<listing.sql.indexOf('ORDER BY'));assert.deepEqual(listing.args,[userId,[allowed]]);
 assert.equal(f.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)),false);
});

test('service guards the early orders handler and all authenticated commands before persistence',async()=>{
 const f=fixture();let providerCalls=0;
 const service=createIsolatedService({...f.options,origin,rateLimit:async()=>true,sharedSourceEnabled:true,sourceRevision:'a'.repeat(40),authenticateSigo:async()=>{providerCalls++;return {id:userId,email:'unit@example.invalid'};}});
 for(const [path,method,body] of [['/orders','POST',{}],['/orders','GET'],['/me','GET'],['/admin/users/commands','POST',{}],['/auth/logout','POST',{}],['/auth/sigo','POST',{empresaId:excluded}],['/auth/login','POST',{empresaId:excluded,email:'unit@example.invalid',password}]]){
  const response=await service(new Request(origin+path,{method,headers:{Origin:origin,Authorization:'Bearer '+bearer(excluded),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal(response.status,403,path);
 }
 assert.equal(providerCalls,0);assert.equal(f.calls.length,0);
 assert.throws(()=>createIsolatedService({...f.options,qaSigoLink:{}}),rejectsStatus(503));
});

test('existing commercialMode mocks without an allowlist retain their trusted SSO path',async()=>{
 let bootstrap=0;
 const sso=createSigoBridge({commercialMode:true,pool:{query:async()=>{bootstrap++;return {rows:[]};}},auth:{signInTrustedIdentity:async()=>({unit:true})},sourceRevision:'a'.repeat(40),authenticateSigo:async()=>({id:userId,email:'unit@example.invalid'})});
 assert.deepEqual(await sso(new Request(origin+'/auth/sigo',{headers:{Authorization:'Bearer unit-only'}}),excluded),{unit:true});assert.equal(bootstrap,1);
});
