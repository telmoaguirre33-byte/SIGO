import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crearPresupuestoFiscal, fetchFiscal, FISCAL_REQUEST_BUDGET_MS } from '../api/arca/lib/request-budget.js';
import { leerTicketWsaa, guardarTicketWsaa } from '../api/arca/wsaa.js';

const never = () => new Promise(() => {});
test('total budget keeps four seconds below the unchanged Vercel duration', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url)));
  const seconds = config.functions['api/arca/*.js'].maxDuration;
  assert.equal(seconds,30); assert.equal(FISCAL_REQUEST_BUDGET_MS,26000);
  assert.ok(FISCAL_REQUEST_BUDGET_MS <= seconds*1000-4000);
});
test('hung operation is aborted and rejected even if its transport ignores abort', async () => {
  const budget = crearPresupuestoFiscal({totalMs:40}); let calls=0, signal;
  const start=performance.now();
  await assert.rejects(budget.run('test_hung',20,s=>{calls++;signal=s;return never();}),{code:'ARCA_REQUEST_DEADLINE'});
  assert.equal(calls,1); assert.equal(signal.aborted,true); assert.ok(performance.now()-start<500);
});
test('success cancels its timer; no delayed abortion or second invocation', async () => {
  const budget=crearPresupuestoFiscal({totalMs:100}); let signal,calls=0;
  assert.equal(await budget.run('test_success',20,s=>{signal=s;calls++;return 7;}),7);
  await new Promise(r=>setTimeout(r,30)); assert.equal(signal.aborted,false); assert.equal(calls,1);
});
test('one monotonic deadline limits sequential steps and preserves persistence reserve', async () => {
  let time=0;const budget=crearPresupuestoFiscal({totalMs:100,now:()=>time});let calls=0;
  await budget.run('first',80,()=>{time=70;calls++;return true;});
  await assert.rejects(budget.run('not_enough',80,()=>{calls++;},35),{code:'ARCA_REQUEST_DEADLINE'});
  assert.equal(calls,1);assert.throws(()=>budget.require(31,'before_issue'),{code:'ARCA_REQUEST_DEADLINE'});
});
test('response body is inside the operation deadline, not only fetch headers', async () => {
  const old=globalThis.fetch;let signal;
  try {
    globalThis.fetch=async (_url,init)=>{signal=init.signal;return {ok:true,status:200,json:never};};
    await assert.rejects(fetchFiscal({presupuesto:crearPresupuestoFiscal({totalMs:35})},'body','https://synthetic.invalid',{},20),{code:'ARCA_REQUEST_DEADLINE'});
    assert.equal(signal.aborted,true);
  } finally {globalThis.fetch=old;}
});
test('WSAA Storage read timeout propagates; it is not mistaken for a missing ticket and refreshed', async () => {
  const old=globalThis.fetch;let signal,calls=0;
  try {
    globalThis.fetch=async (_url,init)=>{calls++;signal=init.signal;return {ok:true,status:200,text:never};};
    await assert.rejects(leerTicketWsaa({url:'https://synthetic.invalid',presupuesto:crearPresupuestoFiscal({totalMs:20})},'synthetic','produccion','30000000007'),{code:'ARCA_REQUEST_DEADLINE'});
    assert.equal(signal.aborted,true);assert.equal(calls,1);
  } finally {globalThis.fetch=old;}
});
test('WSAA ticket persistence is bounded and receives abort signal', async () => {
  const old=globalThis.fetch;let signal,calls=0;
  try {
    globalThis.fetch=async (_url,init)=>{calls++;signal=init.signal;return never();};
    await assert.rejects(guardarTicketWsaa({url:'https://synthetic.invalid',presupuesto:crearPresupuestoFiscal({totalMs:20})},'synthetic','produccion','30000000007',{token:'synthetic',sign:'synthetic'}),{code:'ARCA_REQUEST_DEADLINE'});
    assert.equal(signal.aborted,true);assert.equal(calls,1);
  } finally {globalThis.fetch=old;}
});
test('concurrent requests never share or reset each other deadline', async () => {
  const a=crearPresupuestoFiscal({totalMs:15}),b=crearPresupuestoFiscal({totalMs:150});
  await assert.rejects(a.run('one',15,never),{code:'ARCA_REQUEST_DEADLINE'});
  assert.ok(b.remaining()>50);assert.equal(await b.run('two',50,()=>42),42);
});
