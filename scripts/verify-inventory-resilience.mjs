import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { EventEmitter } from "node:events";
import handler from "../api/inventario/analizar.js";

const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
const env = {...process.env};
process.env.SUPABASE_URL="https://synthetic.invalid";
process.env.SUPABASE_ANON_KEY="synthetic";
process.env.GEMINI_API_KEY="synthetic";
const image="data:image/jpeg;base64,/9j/2Q==";
const products=[{id:"p1",nombre:"Lápiz sintético",codigo_interno:"S-1",stock_actual:4,categoria:"Librería"},{id:"p2",nombre:"Regla sintética",codigo_interno:"S-2",stock_actual:0,categoria:"Librería"},{id:"other",nombre:"Gaseosa sintética",codigo_interno:"S-3",stock_actual:6,categoria:"Bebidas"}];
const raw={bloque:"Librería",detectados:[{descripcion:"Lápiz",catalogo_id:"p1",estado:"sin_stock",confianza:.95,foto:1,x:0,y:0}],ids_catalogo_no_vistos:["p1","p2","unknown"]};
const response=(data,status=200,headers={})=>new Response(typeof data==="string"?data:JSON.stringify(data),{status,headers});
function apiMock({upstream=200,data=raw,permission=true,authStatus=200,productStatus=200,network=false,hang=false,bodyHang=false,finishReason="STOP",count="0-2/3"}={}){
 const calls=[];
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});
  assert.ok(options.signal instanceof AbortSignal,"every network operation has a deadline");
  if(url.includes("/auth/"))return response({id:"synthetic-user"},authStatus);
  if(url.includes("/rpc/")){assert.equal(JSON.parse(options.body).p_permiso,"stock.read");return response(permission,permission==="unavailable"?500:200);}
  if(url.includes("/productos?"))return response(products,productStatus,{"content-range":count});
  assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
  if(network)throw new TypeError("fetch failed");
  if(hang)return new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
  if(bodyHang)return new Response(new ReadableStream({start(controller){options.signal.addEventListener("abort",()=>controller.error(new DOMException("Aborted","AbortError")),{once:true});}}));
  return upstream!==200?response({},upstream):response({candidates:[{finishReason,content:{parts:[{text:typeof data==="string"?data:JSON.stringify(data)}]}}]});
 };
 return calls;
}
async function invoke(body={empresaId:"synthetic-company",imagenes:[image]},headers={authorization:"Bearer synthetic"},method="POST"){
 const req=Object.assign(new EventEmitter(),{body,headers,method});
 let status,output;
 const res={setHeader(){return this;},status(value){status=value;return this;},send(value){output=JSON.parse(value);return this;}};
 await handler(req,res);
 return {status,output};
}
let checks=0;
try{
 let calls=apiMock();let result=await invoke();
 assert.equal(result.status,200);
 assert.equal(result.output.hallazgos[0].estado,"ok","stock status comes from SIGO, never invented by AI");
 assert.equal(result.output.hallazgos[0].stock_actual,4);
 assert.equal(result.output.hallazgos[0].x,0,"edge coordinates must survive");
 assert.deepEqual(result.output.hallazgos.filter(x=>x.estado==="no_visto").map(x=>x.catalogo_id),["p2"]);
 assert.ok(calls.every(c=>!c.options.method||c.options.method==="POST"&&(c.url.includes("/rpc/")||c.url.includes("googleapis.com"))),"analysis never writes stock");
 checks+=6;
 apiMock({data:{...raw,detectados:[{...raw.detectados[0],catalogo_id:"other"}],ids_catalogo_no_vistos:["other"]}});result=await invoke();
 assert.equal(result.output.hallazgos.length,1,"unrelated products cannot become missing shelf items");assert.equal(result.output.hallazgos[0].estado,"revisar");assert.equal(result.output.hallazgos[0].catalogo_id,null);assert.equal(result.output.hallazgos[0].stock_actual,null);checks++;
 for(const status of [401,403,413,429,500,502,503,504]){
  apiMock({upstream:status});result=await invoke();
  assert.equal(result.status,[413,429,503,504].includes(status)?status:502);
  assert.equal(result.output.error,"AI_HTTP_"+status);
  assert.ok(!result.output.message.includes("nítida"));
  checks++;
 }
 for(const data of ['{"bloque":',{},null,{bloque:"L",detectados:[null],ids_catalogo_no_vistos:[]}]){
  apiMock({data});result=await invoke();assert.equal(result.status,502);assert.equal(result.output.error,"AI_INVALID_JSON");checks++;
 }
 apiMock({finishReason:"MAX_TOKENS"});result=await invoke();assert.equal(result.output.error,"AI_INCOMPLETE");checks++;
 calls=apiMock({permission:"unavailable"});result=await invoke();assert.equal(result.status,503);assert.equal(calls.length,2,"permission errors never fail open");checks++;
 apiMock({permission:false});assert.equal((await invoke()).status,403);checks++;
 apiMock({authStatus:401});assert.equal((await invoke()).status,401);checks++;
 apiMock({network:true});assert.equal((await invoke()).output.error,"NETWORK_ERROR");checks++;
 apiMock();assert.equal((await invoke(undefined,{})).status,401);assert.equal((await invoke(undefined,undefined,"GET")).status,405);checks+=2;
 calls=apiMock();assert.equal((await invoke({empresaId:"x",imagenes:Array(11).fill(image)})).status,400);assert.equal(calls.length,0);checks++;
 apiMock();assert.equal((await invoke({empresaId:"x",imagenes:["data:image/heic;base64,AAAA"]})).status,400);checks++;
 apiMock();assert.equal((await invoke({empresaId:"x",imagenes:["data:image/jpeg;base64,"+"A".repeat(4_000_000)]})).status,413);checks++;
 apiMock({hang:true});globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms>=25000?5:ms,...args);
 result=await invoke();assert.equal(result.status,504);assert.equal(result.output.error,"AI_TIMEOUT");globalThis.setTimeout=originalTimeout;checks++;
 apiMock({bodyHang:true});globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms>=25000?5:ms,...args);
 result=await invoke();assert.equal(result.status,504);assert.equal(result.output.error,"AI_TIMEOUT","timeout after headers must not become malformed JSON");globalThis.setTimeout=originalTimeout;checks++;
 for(const data of [{...raw,detectados:Array(201).fill(raw.detectados[0])},{...raw,ids_catalogo_no_vistos:Array(101).fill("p2")}]){apiMock({data});result=await invoke();assert.equal(result.output.error,"AI_INCOMPLETE","never silently truncate a completed analysis");checks++;}
 apiMock({data:{...raw,detectados:[{descripcion:"No listado",estado:"falta_sigo",confianza:.99}]},count:"0-1/100"});
 result=await invoke();assert.equal(result.output.hallazgos[0].estado,"revisar","partial catalog cannot prove absence");checks++;

 // Execute the actual TypeScript client with an isolated synthetic auth adapter.
 let source=await fs.readFile(new URL("../src/inventarioIA.ts",import.meta.url),"utf8");
 source=source.replace('import { supabase } from "./supabase";','const supabase={auth:{getSession:async()=>({data:{session:{access_token:"synthetic"}}})}};');
 const client=await import("data:text/javascript;base64,"+Buffer.from(stripTypeScriptTypes(source,{mode:"strip"})).toString("base64"));
 const item=(id,estado="ok")=>({id,codigo:id,descripcion:id,categoria:"L",estado,foto:estado==="no_visto"?0:1,x:20,y:30,confianza:.9,catalogo_id:id});
 const complete=[];
 calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});assert.equal(url,"/api/inventario/analizar");assert.equal(JSON.parse(options.body).imagenes.length,1);
  assert.ok(Buffer.byteLength(options.body)<4_000_000);
  return response({bloque:"L",hallazgos:[item("p"+calls.length)]});
 };
 const ten=await client.analizarInventarioSigo("synthetic-company",Array(10).fill(image),{onLote:l=>complete.push(l)});
 assert.equal(calls.length,10);assert.equal(ten.hallazgos.length,10);assert.equal(ten.hallazgos[9].foto,10);checks+=3;
 await client.analizarInventarioSigo("synthetic-company",Array(10).fill(image),{completados:complete});
 assert.equal(calls.length,10,"retrying a complete review sends no additional requests");checks++;
 const partial=[];let attempt=0;
 globalThis.fetch=async()=>++attempt===2?response({message:"Synthetic overload"},503):response({bloque:"L",hallazgos:[item("p"+attempt)]});
 await assert.rejects(client.analizarInventarioSigo("synthetic-company",Array(3).fill(image),{onLote:l=>partial.push(l)}),/Synthetic overload/);
 assert.equal(partial.length,1);
 globalThis.fetch=async()=>{attempt++;return response({bloque:"L",hallazgos:[item("p"+attempt)]});};
 await client.analizarInventarioSigo("synthetic-company",Array(3).fill(image),{completados:partial});
 assert.equal(attempt,4,"resume only processes the two unfinished photographs");checks+=2;
 const combined=client.consolidarInventario([{indice:0,resultado:{bloque:"L",hallazgos:[item("p2","no_visto")]}},{indice:1,resultado:{bloque:"L",hallazgos:[item("p2")]}}]);
 assert.equal(combined.hallazgos.length,1);assert.equal(combined.hallazgos[0].foto,2);checks++;
 for(const status of [401,403,413,429,500,502,503,504]){
  globalThis.fetch=async()=>response("<html>proxy error</html>",status);
  await assert.rejects(client.analizarInventarioSigo("x",[image]),error=>!error.message.includes("<html>")&&!error.message.includes("nítida"));checks++;
 }
 globalThis.fetch=async()=>response('{"bloque":');await assert.rejects(client.analizarInventarioSigo("x",[image]),/incompleta o inválida/);checks++;
 globalThis.fetch=async()=>{throw new TypeError("Failed to fetch");};await assert.rejects(client.analizarInventarioSigo("x",[image]),/conexión/);checks++;
 const aborter=new AbortController();let cancellationCalls=0;
 globalThis.fetch=async(url,options)=>{cancellationCalls++;aborter.abort();throw new DOMException("Aborted","AbortError");};
 await assert.rejects(client.analizarInventarioSigo("x",[image,image],{signal:aborter.signal}),/cancelado/);assert.equal(cancellationCalls,1);checks++;
 globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms>=25000?5:ms,...args);
 await assert.rejects(client.analizarInventarioSigo("x",[image]),/no respondió a tiempo/);checks++;
 const ui=await fs.readFile(new URL("../src/StockVsInventario.tsx",import.meta.url),"utf8");
 assert.ok(ui.includes("24*60*60*1000")&&ui.includes("vence>Date.now()"),"recovery expires after 24h");
 assert.ok(ui.includes("setRevisiones(actual=>[...actual.filter(r=>r.id!==id)"),"retries replace the same monthly revision");
 assert.ok(ui.includes("hallazgosMes.map")&&ui.includes("Stock SIGO"),"monthly Excel-compatible export includes stock");
 checks+=3;
 console.log("Inventory resilience: "+checks+" checks passed (synthetic; no Gemini/network/database writes).");
}finally{
 globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;
 for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];
 Object.assign(process.env,env);
}

