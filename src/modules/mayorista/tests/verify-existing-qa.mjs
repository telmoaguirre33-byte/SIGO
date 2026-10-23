import {test} from 'node:test';import assert from 'node:assert/strict';
import {verifyExistingQA} from '../railway/verify-existing-qa.mjs';import {QA_ORIGIN} from '../railway/provision-qa-cli.mjs';
const credentials={origin:QA_ORIGIN,empresaId:'fixture-company',email:'fixture@example.invalid',password:'fixture-private'};
function fixture({foreign=false,catalogFails=false}={}){
 let revoked=false;const calls=[];
 return {calls,request:async(url,options)=>{
  calls.push({url,method:options.method??'GET'});assert.equal(options.redirect,'error');assert.ok(url.startsWith(QA_ORIGIN));
  if(url.endsWith('/health'))return Response.json({status:'ok',module:'mayorista'});
  if(url.endsWith('/auth/login'))return Response.json({accessToken:'fixture-token'});
  if(url.endsWith('/me'))return revoked?Response.json({}, {status:401}):Response.json({empresaId:foreign?'foreign':credentials.empresaId,rol:'gerencia',permissions:['admin:gestionar']});
  if(url.endsWith('/auth/logout')){revoked=true;return Response.json({});}
  if(url.endsWith('/admin/catalog'))return Response.json({}, {status:!options.headers.Authorization?401:catalogFails?503:200});
  throw new Error('unexpected fixture');
 }};
}
test('verificador externo limita health/sin credenciales y no escribe datos comerciales',async()=>{const f=fixture();const r=await verifyExistingQA({request:f.request});assert.equal(r.authenticated,false);assert.equal(r.checks.length,2);assert.equal(r.qaWritesTested,false);});
test('verificador ejercita login, empresa/gerencia, catálogo y revocación con transporte simulado',async()=>{const f=fixture();const r=await verifyExistingQA({credentials,request:f.request});assert.equal(r.authenticated,true);assert.equal(r.checks.length,7);assert.equal(r.crossCompanyTested,false);assert.equal(r.allRolesTested,false);assert.ok(!JSON.stringify(r).includes(credentials.password));assert.ok(!JSON.stringify(r).includes('fixture-token'));});
test('verificador rechaza otro origen antes de acceder a red',async()=>{let called=false;await assert.rejects(verifyExistingQA({credentials:{...credentials,origin:'https://production.example'},request:()=>{called=true;}}),/ajeno/);assert.equal(called,false);});
test('empresa inesperada o API fallida no aprueban y cierran la sesión',async()=>{for(const options of [{foreign:true},{catalogFails:true}]){const f=fixture(options);await assert.rejects(verifyExistingQA({credentials,request:f.request}));assert.ok(f.calls.some(c=>c.url.endsWith('/auth/logout')));}});

test('login-only omite health aprobado externamente y verifica la sesión',async()=>{const f=fixture();const r=await verifyExistingQA({credentials,request:f.request,skipHealth:true});assert.equal(r.authenticated,true);assert.equal(r.checks.length,6);assert.ok(!f.calls.some(c=>c.url.endsWith('/health')));});
test('login-only sin credenciales falla antes de solicitar datos',async()=>{let called=false;await assert.rejects(verifyExistingQA({skipHealth:true,request:()=>{called=true;}}),/Archivo/);assert.equal(called,false);});
