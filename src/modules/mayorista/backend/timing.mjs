import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
const timing=new AsyncLocalStorage();
export async function measureSQL(fn){const scope=timing.getStore(),start=performance.now();try{return await fn();}finally{if(scope){scope.sqlMs+=performance.now()-start;scope.queries++;}}}
export function measuredJSON(value){const start=performance.now(),body=JSON.stringify(value),scope=timing.getStore();if(scope){scope.jsonMs+=performance.now()-start;scope.bytes+=Buffer.byteLength(body);}return body;}
/** Telemetría local sin proveedor nuevo, SQL textual, cuerpos ni identidades. */
export function instrumentRequest(request,fn,{emit=()=>{},head}={}){
 const scope={sqlMs:0,jsonMs:0,queries:0,bytes:0},start=performance.now();
 return timing.run(scope,async()=>{const response=await fn();const totalMs=performance.now()-start;response.headers.set('Server-Timing',`mayorista_db;dur=${scope.sqlMs.toFixed(2)}, mayorista_json;dur=${scope.jsonMs.toFixed(2)}, mayorista_total;dur=${totalMs.toFixed(2)}`);response.headers.set('Access-Control-Expose-Headers','Server-Timing');
  const path=new URL(request.url).pathname;
  if(['/catalog','/orders','/admin/dashboard','/admin/launch/customers','/admin/reports/export'].includes(path))emit({event:'MAYORISTA_REQUEST_TIMING',head,path,method:request.method,status:response.status,...scope,totalMs,sqlScope:'authenticated_repository',transferScope:'json_body_uncompressed'});
  return response;
 });
}
