import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {commercialRuntime,profileHash,commercialReadiness} from '../backend/commercial-runtime.mjs';
import {prepareCommercialMigrations,installCommercialMigrations} from '../backend/commercial-migrations.mjs';
const ref='abcdefghijklmnopqrst',keys=generateKeyPairSync('ed25519');
const profile={formatVersion:1,approved:true,projectId:randomUUID(),environmentId:randomUUID(),databaseHost:'db.'+ref+'.supabase.co',databasePort:5432,databaseName:'postgres',databaseUser:'sigo_mayorista_app',runtimeRole:'sigo_mayorista_app',migrationRole:'postgres',migrationUser:'postgres',connectionMode:'direct',supabaseProjectRef:ref,authOrigin:'https://'+ref+'.supabase.co',publicOrigin:'https://mayorista.example.com',sigoOrigin:'https://sigo.example.com'};
profile.publicKeySha256=profileHash(keys.publicKey.export({format:'der',type:'spki'}));
const text=JSON.stringify(profile),env={MAYORISTA_PRODUCTION_ENABLED:'true',MAYORISTA_RUNTIME_MODE:'commercial',MAYORISTA_RELEASE_PROFILE_SHA256:profileHash(text),RAILWAY_PROJECT_ID:profile.projectId,RAILWAY_ENVIRONMENT_ID:profile.environmentId,DATABASE_URL:'postgresql://sigo_mayorista_app:ci-only@'+profile.databaseHost+':5432/postgres',MAYORISTA_DB_CA_PEM:'-----BEGIN CERTIFICATE-----\nCI_ONLY_NOT_A_CERT\n-----END CERTIFICATE-----',MAYORISTA_AUTH_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}),MAYORISTA_SIGO_AUTH_URL:profile.authOrigin,MAYORISTA_SIGO_AUTH_ANON_KEY:'sb_publishable_ci_only'};
const config=commercialRuntime(env,text);assert.equal(config.policy.config.ssl.rejectUnauthorized,true);assert.equal(config.policy.config.max,6);
for(const patch of [{MAYORISTA_PRODUCTION_ENABLED:'false'},{MAYORISTA_RELEASE_PROFILE_SHA256:'0'.repeat(64)},{MAYORISTA_QA_ENABLED:'true'},{MAYORISTA_BOOTSTRAP_EMAIL:'prohibited'},{RAILWAY_ENVIRONMENT_ID:randomUUID()},{DATABASE_URL:env.DATABASE_URL+'?sslmode=disable'},{MAYORISTA_SIGO_AUTH_ANON_KEY:'sb_secret_ci_only'}])assert.throws(()=>commercialRuntime({...env,...patch},text));
assert.throws(()=>config.policy.assertPool({options:{...config.policy.config,ssl:{...config.policy.config.ssl,rejectUnauthorized:false}}}));
assert.throws(()=>commercialRuntime(env,JSON.stringify({...profile,approved:false})));
const steps=await prepareCommercialMigrations(profile.runtimeRole);assert.equal(steps.length,21);assert.ok(!steps.some(s=>/create schema auth|CREATE ROLE|PREPARED_DEMO|INSERT INTO auth.users/i.test(s.sql)));assert.ok(steps.slice(0,20).every(s=>!/^\s*(begin;|rollback;)/mi.test(s.sql)));assert.ok(!steps.some(s=>/set search_path=public\b/i.test(s.sql)));
let installed=[],binding=null,rollback=false,failedVersion=0;const statements=[];
const migrationPool={options:{host:profile.databaseHost,port:5432,database:'postgres',user:'postgres',ssl:{ca:env.MAYORISTA_DB_CA_PEM,rejectUnauthorized:true,servername:profile.databaseHost}},connect:async()=>({release(){},query:async(sql,args)=>{
 statements.push(sql);if(sql==='BEGIN'){rollback=false;return {rows:[]};}if(sql==='ROLLBACK'){rollback=true;return {rows:[]};}
 if(sql.startsWith('SELECT current_database'))return {rows:[{db:'postgres',role:'postgres'}]};
 if(sql.includes(' AS ledger'))return {rows:[{ledger:binding?'exists':null}]};
 if(sql.includes(' AS companies'))return {rows:[{companies:'exists',sessions:'exists',permissions:'exists',sales:'exists',products:'exists'}]};
 if(sql.startsWith('INSERT INTO mayorista_private.release_binding')){binding={profile_hash:args[0],project_id:args[1],environment_id:args[2]};return {rows:[]};}
 if(sql.startsWith('SELECT profile_hash'))return {rows:[binding]};
 if(sql.startsWith('SELECT version'))return {rows:installed.map(r=>({...r}))};
 if(sql.startsWith('INSERT INTO mayorista_private.release_migrations')){if(args[0]===failedVersion)throw Error('INTERRUPTED');installed.push({version:args[0],source_hash:args[1]});}
 return {rows:[]};
}})};
const input={pool:migrationPool,profile,profileText:text,profileHash:profileHash(text),approval:{profileHash:profileHash(text),action:'install-commercial-schema'}};
await assert.rejects(()=>installCommercialMigrations({...input,approval:null}),/APPROVAL/);assert.equal(statements.length,0);
assert.equal((await installCommercialMigrations(input)).reused,false);assert.equal(installed.length,21);const before=statements.filter(s=>s.startsWith('CREATE FUNCTION')).length;assert.equal((await installCommercialMigrations(input)).reused,true);assert.equal(statements.filter(s=>s.startsWith('CREATE FUNCTION')).length,before);
installed[0].source_hash='0'.repeat(64);await assert.rejects(()=>installCommercialMigrations(input),/LEDGER_DRIFT/);assert.equal(rollback,true);
installed=[];failedVersion=3;await assert.rejects(()=>installCommercialMigrations(input),/INTERRUPTED/);assert.equal(rollback,true);
const readPool={options:config.policy.config,connect:async()=>({release(){},query:async(sql)=>{if(sql.includes('current_database'))return {rows:[{db:'postgres',name:profile.runtimeRole,rolsuper:false,rolbypassrls:true,member:true}]};return {rows:[]};}})};
await assert.rejects(()=>commercialReadiness(readPool,config,'a'.repeat(40)),/no preparado/);
console.log('PASS runtime comercial: perfil/hash/target/TLS, QA y bootstrap rechazados; bundle 21 pasos, repetición no-op, drift/interrupción rollback y rol BYPASSRLS rechazado. Transacciones de este unit test son dobles, no PostgreSQL.');
