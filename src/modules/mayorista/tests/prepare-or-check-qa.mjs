import {test} from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';
import {prepareOrCheckQA} from '../backend/prepare-or-check-qa.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
const env={MAYORISTA_QA_ENABLED:'true',MAYORISTA_BUDGET_VERIFIED:'true',MAYORISTA_MONTHLY_BUDGET_USD:'15',RAILWAY_PROJECT_ID:QA_RAILWAY.projectId,RAILWAY_ENVIRONMENT_ID:QA_RAILWAY.environmentId,MAYORISTA_DATABASE_SERVICE_ID:QA_RAILWAY.databaseServiceId,DATABASE_URL:'postgresql://qa:fixture-password@postgres.railway.internal:5432/railway',MAYORISTA_DB_CA_PEM:'-----BEGIN CERTIFICATE-----fixture-only',MAYORISTA_PUBLIC_ORIGIN:'https://qa.example.test',MAYORISTA_AUTH_PRIVATE_KEY:generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})};
function fixture({missing=false,foreign=false}={}){
 const calls=[];class Pool{constructor(){calls.push('pool');}async query(){calls.push('query');if(missing)throw Object.assign(new Error('missing'),{code:'42P01'});return {rows:[{project_id:foreign?'foreign':QA_RAILWAY.projectId,environment_id:QA_RAILWAY.environmentId,schema_version:1}]};}async end(){calls.push('end');}}
 return {Pool,calls};
}
test('predeploy en base instalada comprueba identidad y no vuelve a instalar ni crear usuarios',async()=>{
 const {Pool,calls}=fixture();let installed=false;
 assert.deepEqual(await prepareOrCheckQA(env,{Pool,install:async()=>{installed=true;}}),{installed:false,verified:true});assert.equal(installed,false);assert.deepEqual(calls,['pool','query','end']);
});
test('esquema ajeno se rechaza sin instalar y se cierra el pool',async()=>{
 const {Pool,calls}=fixture({foreign:true});let installed=false;await assert.rejects(prepareOrCheckQA({...env,MAYORISTA_BOOTSTRAP_INSTALL_ONCE:'true'},{Pool,install:async()=>{installed=true;}}));assert.equal(installed,false);assert.equal(calls.at(-1),'end');
});
test('base sin marcador exige autorización explícita; no hay DDL automático por defecto',async()=>{
 const {Pool,calls}=fixture({missing:true});let installed=false;await assert.rejects(prepareOrCheckQA(env,{Pool,install:async()=>{installed=true;}}),/no autorizada/);assert.equal(installed,false);assert.equal(calls.at(-1),'end');
});
test('primera instalación autorizada cierra comprobación antes de ejecutar el instalador',async()=>{
 const {Pool,calls}=fixture({missing:true});const result=await prepareOrCheckQA({...env,MAYORISTA_BOOTSTRAP_INSTALL_ONCE:'true'},{Pool,install:async()=>{assert.equal(calls.at(-1),'end');calls.push('install');}});assert.deepEqual(result,{installed:true,verified:true});assert.equal(calls.filter(c=>c==='install').length,1);
});
