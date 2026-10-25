import assert from 'node:assert/strict';
import {qaReadiness} from '../backend/readiness.mjs';
let calls=0;const base={},head='1'.repeat(40),verifyEvidence=async p=>{assert.equal(p,base);calls++;return {evidenceRevision:'2'.repeat(40)};};
const operational={query:async sql=>{assert.ok(/^SELECT/.test(sql));return {rows:[{launch:'exists',imports:'exists',subscription:'exists'}]};}};
const ready=await qaReadiness({base,operational,head,verifyEvidence});assert.equal(ready.head,head);assert.equal(ready.interfaces,'pending_physical');assert.equal(ready.productionActivation,false);assert.equal(calls,1);
await assert.rejects(()=>qaReadiness({base,head,operational,verifyEvidence:async()=>{throw Error('P0_EVIDENCE_GATE_BLOCKED');}}));
await assert.rejects(()=>qaReadiness({base,head,operational:{query:async()=>({rows:[{}]})},verifyEvidence}),/LAUNCH_UPGRADE_PENDING/);
console.log('PASS readiness: reutiliza evidencia P0 sin aceptar el HEAD como prueba comercial y exige ampliación QA instalada');
