import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {commercialRuntime,integrationQaRuntime,profileHash} from '../backend/commercial-runtime.mjs';
import {integrationQaEnvironment} from '../backend/integration-qa-env.mjs';
import {operationalApplication,startOperationalHttp} from '../backend/http-server.mjs';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
const keys=generateKeyPairSync('ed25519'),origin='https://mayorista-api-qa-qa.up.railway.app';
const profile={formatVersion:1,approved:true,purpose:'integration-qa',apiPrefix:'/integracion-qa',projectId:QA_RAILWAY.projectId,environmentId:QA_RAILWAY.environmentId,databaseHost:'aws-0-us-east-2.pooler.supabase.com',databasePort:6543,databaseName:'postgres',databaseUser:'sigo_qa_mayorista_backend.xcapcnczxljxwxzigtvs',runtimeRole:'sigo_qa_mayorista_backend',connectionMode:'transaction_pooler',supabaseProjectRef:'xcapcnczxljxwxzigtvs',authOrigin:'https://xcapcnczxljxwxzigtvs.supabase.co',publicOrigin:origin,sigoOrigin:'https://comercial-branch-telmoaguirre33-byte.vercel.app',sigoOrigins:['https://comercial-branch-telmoaguirre33-byte.vercel.app'],publicKeySha256:profileHash(keys.publicKey.export({format:'der',type:'spki'}))};
const text=JSON.stringify(profile),env={MAYORISTA_PRODUCTION_ENABLED:'false',MAYORISTA_RUNTIME_MODE:'integration-qa',MAYORISTA_INTEGRATION_QA_ENABLED:'true',MAYORISTA_RELEASE_PROFILE_SHA256:profileHash(text),RAILWAY_PROJECT_ID:profile.projectId,RAILWAY_ENVIRONMENT_ID:profile.environmentId,RAILWAY_SERVICE_ID:'9053689a-0e32-4f3c-b5da-3c01e480a9c6',DATABASE_URL:'postgresql://'+profile.databaseUser+':unit-only@'+profile.databaseHost+':6543/postgres?sslmode=verify-full',MAYORISTA_DB_CA_PEM:'-----BEGIN CERTIFICATE-----\nUNIT_NOT_A_CERT\n-----END CERTIFICATE-----',MAYORISTA_AUTH_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}),MAYORISTA_SIGO_AUTH_URL:profile.authOrigin,MAYORISTA_SIGO_AUTH_ANON_KEY:'sb_publishable_unit_only'};
test('QA canónico usa TLS estricto, dos conexiones y emisor distinto del QA histórico',()=>{
 const c=integrationQaRuntime(env,text);assert.equal(c.policy.config.max,2);assert.equal(c.policy.config.ssl.rejectUnauthorized,true);assert.match(c.issuer,/integration-qa/);assert.match(c.issuer,/xcapcnczxljxwxzigtvs/);assert.deepEqual(c.integrationOrigins,profile.sigoOrigins);
});
test('modo comercial conserva prohibición sobre los identificadores del QA histórico',()=>assert.throws(()=>commercialRuntime({...env,MAYORISTA_PRODUCTION_ENABLED:'true',MAYORISTA_RUNTIME_MODE:'commercial'},text)));
test('QA no puede habilitarse fuera de su proyecto, entorno, servicio y Supabase aprobado',()=>{
 for(const patch of [{projectId:randomUUID()},{environmentId:randomUUID()},{supabaseProjectRef:'pafnbxfgpedbvpimjmun'},{purpose:'commercial'},{apiPrefix:'/orders'},{databaseHost:'db.pafnbxfgpedbvpimjmun.supabase.co'},{runtimeRole:'postgres'},{publicOrigin:'https://sigo-gestion.com'},{sigoOrigins:['https://attacker.example.com']}]){const t=JSON.stringify({...profile,...patch});assert.throws(()=>integrationQaRuntime({...env,MAYORISTA_RELEASE_PROFILE_SHA256:profileHash(t)},t));}
 for(const patch of [{RAILWAY_SERVICE_ID:randomUUID()},{MAYORISTA_PRODUCTION_ENABLED:'true'},{MAYORISTA_INTEGRATION_QA_ENABLED:'false'},{MAYORISTA_RELEASE_PROFILE_SHA256:'0'.repeat(64)},{MAYORISTA_SIGO_AUTH_URL:'https://pafnbxfgpedbvpimjmun.supabase.co'},{MAYORISTA_SIGO_AUTH_ANON_KEY:'sb_secret_unit_only'},{DATABASE_URL:env.DATABASE_URL.replace('verify-full','disable')}])assert.throws(()=>integrationQaRuntime({...env,...patch},text));
});
test('pool ajeno, TLS degradado o conexiones adicionales se rechazan',()=>{
 const c=integrationQaRuntime(env,text);c.policy.assertPool({options:c.policy.config});
 for(const patch of [{max:3},{host:'postgres.railway.internal'},{user:'postgres'},{ssl:{...c.policy.config.ssl,rejectUnauthorized:false}}])assert.throws(()=>c.policy.assertPool({options:{...c.policy.config,...patch}}));
});
test('configuración nueva nunca hereda credenciales ni bootstrap de P0',()=>{
 const e=integrationQaEnvironment({DATABASE_URL:'legacy-dsn',MAYORISTA_AUTH_PRIVATE_KEY:'legacy-signing',MAYORISTA_BOOTSTRAP_PASSWORD:'legacy-password',MAYORISTA_QA_ENABLED:'true',MAYORISTA_INTEGRATION_DATABASE_URL:'canonical-dsn',MAYORISTA_INTEGRATION_AUTH_PRIVATE_KEY:'canonical-signing'});
 assert.equal(e.DATABASE_URL,'canonical-dsn');assert.equal(e.MAYORISTA_AUTH_PRIVATE_KEY,'canonical-signing');assert.equal(e.MAYORISTA_BOOTSTRAP_PASSWORD,undefined);assert.equal(e.MAYORISTA_QA_ENABLED,undefined);assert.equal(e.MAYORISTA_PRODUCTION_ENABLED,'false');
});
const legacy={config:{origin},handler:()=>1,readiness:()=>1};
const mounted={prefix:'/integracion-qa',config:{origin},handler:()=>2,readiness:()=>2};
test('rutas originales mantienen su aplicación y estado sin montaje activo',()=>{
 for(const pathname of ['/orders','/auth/sigo','/secure.html','/readiness']){const r=operationalApplication(pathname,undefined,legacy);assert.equal(r.handler,legacy.handler);assert.equal(r.pathname,pathname);}
});
test('prefijo QA fijo selecciona otra aplicación y conserva las rutas originales',()=>{
 for(const pathname of ['/orders','/auth/sigo','/secure.html','/readiness']){const r=operationalApplication('/integracion-qa'+pathname,mounted,legacy);assert.equal(r.handler,mounted.handler);assert.equal(r.pathname,pathname);assert.equal(r.prefix,'/integracion-qa');const old=operationalApplication(pathname,mounted,legacy);assert.equal(old.handler,legacy.handler);}
 for(const pathname of ['/integracion-qa-extra/orders','/integracion-qab/orders'])assert.equal(operationalApplication(pathname,mounted,legacy).handler,legacy.handler);
});
test('montaje no admite prefijos arbitrarios ni otro origen de servidor',()=>{
 assert.throws(()=>operationalApplication('/orders',{...mounted,prefix:'/orders'},legacy));
 assert.throws(()=>operationalApplication('/orders',{...mounted,config:{origin:'https://attacker.example.com'}},legacy));
});

test('HTTP real conserva P0, enruta body y bearer QA y publica configuración con prefijo',async()=>{
 const reserve=createServer();await new Promise((ok,bad)=>{reserve.once('error',bad);reserve.listen(0,'127.0.0.1',ok)});const port=reserve.address().port;await new Promise(ok=>reserve.close(ok));
 const handler=context=>async req=>new Response(JSON.stringify({context,path:new URL(req.url).pathname,authorization:req.headers.get('Authorization'),peer:req.headers.get('x-mayorista-peer'),body:req.method==='POST'?await req.json():null}),{headers:{'Content-Type':'application/json'}});
 const app=await startOperationalHttp({root:fileURLToPath(new URL('../demo/dist/',import.meta.url)),config:{origin},handler:handler('P0'),readiness:async()=>({runtime:'qa-p0'}),env:{PORT:String(port)},mountedApplication:{prefix:'/integracion-qa',config:{origin},handler:handler('integration-qa'),readiness:async()=>({runtime:'integration-qa'})}});
 const local='http://127.0.0.1:'+port;
 try{
  for(const prefix of ['','/integracion-qa']){
   const response=await fetch(local+prefix+'/auth/sigo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer unit-token','x-mayorista-peer':'client-spoof'},body:JSON.stringify({empresaId:'unit-company'})});const d=await response.json();assert.equal(d.context,prefix?'integration-qa':'P0');assert.equal(d.path,'/auth/sigo');assert.equal(d.authorization,'Bearer unit-token');assert.notEqual(d.peer,'client-spoof');assert.deepEqual(d.body,{empresaId:'unit-company'});
   const redirect=await fetch(local+prefix+'/',{redirect:'manual'});assert.equal(redirect.headers.get('Location'),prefix+'/portal.html');
   const ready=await fetch(local+prefix+'/readiness');assert.equal((await ready.json()).runtime,prefix?'integration-qa':'qa-p0');
   const config=await fetch(local+prefix+'/secure-config.mjs');assert.ok((await config.text()).includes(origin+prefix));assert.ok(config.headers.get('Content-Security-Policy').includes("connect-src 'self'"));
  }
 }finally{await new Promise(ok=>app.close(ok));}
});
