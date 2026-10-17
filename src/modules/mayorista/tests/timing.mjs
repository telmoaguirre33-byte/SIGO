import assert from 'node:assert/strict';
import {instrumentRequest,measureSQL,measuredJSON} from '../backend/timing.mjs';
const events=[];let release;const barrier=new Promise(r=>release=r);
const first=instrumentRequest(new Request('https://qa.invalid/orders'),async()=>{await measureSQL(async()=>{await barrier;});return new Response(measuredJSON({ok:true}));},{emit:e=>events.push(e)});
const second=await instrumentRequest(new Request('https://qa.invalid/catalog'),async()=>new Response(measuredJSON({ok:true})),{emit:e=>events.push(e)});release();await first;
assert.ok(second.headers.get('Server-Timing').includes('mayorista_json'));assert.equal(events.find(e=>e.path==='/catalog').queries,0);assert.equal(events.find(e=>e.path==='/orders').queries,1);assert.ok(events.every(e=>!Object.keys(e).some(k=>['token','userId','sql','password'].includes(k))));
console.log('PASS telemetría por petición concurrente: SQL/JSON separados, sin mezcla de contexto ni secretos');
