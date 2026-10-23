import {test} from 'node:test';import assert from 'node:assert/strict';
import {startupDiagnostic,REQUIRED_RUNTIME_VARIABLES} from '../backend/startup-diagnostic.mjs';
test('el diagnóstico identifica configuración ausente y no revela valores',()=>{
 const env={DATABASE_URL:'postgresql://secret-user:secret-password@private/db',MAYORISTA_AUTH_PRIVATE_KEY:'SECRET_PRIVATE_KEY'};
 const report=startupDiagnostic(new Error('raw failure '+env.DATABASE_URL),env),json=JSON.stringify(report);
 assert.equal(report.reason,'STARTUP_FAILURE');assert.ok(report.missingVariables.includes('MAYORISTA_DB_CA_PEM'));assert.ok(!report.missingVariables.includes('DATABASE_URL'));
 for(const secret of ['secret-password','secret-user','SECRET_PRIVATE_KEY','raw failure'])assert.ok(!json.includes(secret));
});
test('falta de esquema QA se distingue de errores de TLS y autenticación',()=>{
 for(const [code,reason] of [['42P01','QA_SCHEMA_NOT_INSTALLED'],['ERR_TLS_CERT_ALTNAME_INVALID','TLS_HOSTNAME_INVALID'],['28P01','DATABASE_AUTH_FAILED']])assert.equal(startupDiagnostic({code}).reason,reason);
});
test('configuración completa no oculta rechazo de presupuesto o entorno',()=>{
 const env=Object.fromEntries(REQUIRED_RUNTIME_VARIABLES.map(name=>[name,'configured']));
 assert.deepEqual(startupDiagnostic(new Error('Presupuesto Railway pendiente de verificar'),env),{event:'MAYORISTA_QA_STARTUP_BLOCKED',reason:'BUDGET_NOT_VERIFIED',missingVariables:[]});
 assert.equal(startupDiagnostic(new Error('Entorno Railway no autorizado'),env).reason,'QA_ENVIRONMENT_INVALID');
});
test('errores inesperados no vuelcan mensajes, stack, detail ni códigos arbitrarios',()=>{
 const report=startupDiagnostic({message:'private secret',stack:'private stack',detail:'private row',code:'PRIVATE_CODE'});
 assert.equal(report.reason,'STARTUP_FAILURE');assert.ok(!JSON.stringify(report).includes('private'));assert.ok(!JSON.stringify(report).includes('PRIVATE_CODE'));
});
