import {test} from 'node:test';import assert from 'node:assert/strict';
import {bootstrapIds} from '../backend/bootstrap-identity.mjs';
test('bootstrap permite UUID explícitos públicos y no acepta identificadores malformados',()=>{
 const empresaId='00000000-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000002';
 assert.deepEqual(bootstrapIds({MAYORISTA_BOOTSTRAP_COMPANY_ID:empresaId,MAYORISTA_BOOTSTRAP_USER_ID:userId}),{empresaId,userId});
 assert.throws(()=>bootstrapIds({MAYORISTA_BOOTSTRAP_COMPANY_ID:'wrong'}));assert.throws(()=>bootstrapIds({MAYORISTA_BOOTSTRAP_USER_ID:''}));
});
test('sin UUID explícitos se conservan identidades aleatorias independientes',()=>{
 const a=bootstrapIds(),b=bootstrapIds();assert.notEqual(a.empresaId,b.empresaId);assert.notEqual(a.userId,b.userId);assert.match(a.empresaId,/^[0-9a-f-]{36}$/);
});
