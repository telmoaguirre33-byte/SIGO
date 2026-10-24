import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { esperarCobro, TiempoEsperaCobroError } from '../src/esperaCobro.ts';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const version = require('@supabase/supabase-js/package.json').version;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let releaseToken;
const token = new Promise(r => { releaseToken = r; });
let fetchEntered=0, dispatched=0, signalAuth, tokenCalls=0;
const authClient = createClient('https://synthetic.invalid', 'synthetic-test-placeholder', {
  accessToken: () => { tokenCalls++; return token; },
  global: { fetch: async (_url, init) => {
    fetchEntered++;
    assert.ok(init.signal.aborted, 'late token must carry an already aborted signal');
    init.signal.throwIfAborted();
    dispatched++;
    throw new Error('Unexpected synthetic dispatch');
  } },
});
let builders=0, successfulContinuations=0;
await assert.rejects(esperarCobro('envio', 35, signal => {
  signalAuth=signal; builders++;
  return authClient.rpc('synthetic_rpc', { p_value: 1 }).abortSignal(signal);
}).then(result => { successfulContinuations++; return result; }), TiempoEsperaCobroError);
assert.equal(builders,1); assert.equal(fetchEntered,0); assert.equal(dispatched,0); assert.equal(signalAuth.aborted,true);
releaseToken('synthetic-token-not-a-credential');
await sleep(60);
assert.equal(fetchEntered,1); assert.equal(dispatched,0); assert.equal(successfulContinuations,0); assert.ok(tokenCalls>=1); // SDK may also initialize realtime authentication; only one RPC/fetch is consumed.
results.push({case:'real SDK accessToken pending beyond deadline',pass:true,builders,tokenCalls,fetchEnteredAfterToken:fetchEntered,validDispatches:dispatched,successfulContinuations,aborted:signalAuth.aborted});
let streamController, bodySignal, bodyFetchCalls=0;
const bodyClient=createClient('https://synthetic.invalid','synthetic-test-placeholder',{
 accessToken: async()=>null,
 global:{fetch:async(_url,init)=>{
  bodyFetchCalls++; bodySignal=init.signal;
  return new Response(new ReadableStream({start(controller){streamController=controller;}}),{status:200,headers:{'Content-Type':'application/json'}});
 }}
});
let bodySuccess=0;
await assert.rejects(esperarCobro('envio',35,signal=>bodyClient.rpc('synthetic_rpc',{p_value:1}).abortSignal(signal)).then(r=>{bodySuccess++;return r;}),TiempoEsperaCobroError);
assert.equal(bodyFetchCalls,1);assert.equal(bodySignal.aborted,true);assert.equal(bodySuccess,0);
streamController.enqueue(new TextEncoder().encode('"11111111-1111-4111-8111-111111111111"'));streamController.close();
await sleep(60);assert.equal(bodySuccess,0);assert.equal(bodyFetchCalls,1);
results.push({case:'real SDK HTTP 200 with stalled Response.text body',pass:true,fetchCalls:bodyFetchCalls,signalAborted:bodySignal.aborted,successfulContinuationsAfterLateBody:bodySuccess});
const summary={status:'PASS',sdkVersion:version,network:'No network: all fetch calls replaced by local synthetic functions.',productionValidated:false,rootCauseAttributed:false,results};
console.log(JSON.stringify(summary,null,2));
