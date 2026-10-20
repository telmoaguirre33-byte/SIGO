import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, devices } from "playwright";

// Bundles the real component, image preparation and HTTP client. Only the
// Supabase session adapter and external analysis HTTP response are synthetic.
// No remote endpoint, real tenant, provider invocation or stock write is used.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const artifacts=path.resolve(process.env.INVENTORY_UI_ARTIFACTS||path.join(root,"test-results/inventory-ui"));
await fs.mkdir(artifacts,{recursive:true});
const bundled=await build({
 stdin:{contents:'import React,{useState} from "react";import{createRoot}from"react-dom/client";import StockVsInventario from "./src/StockVsInventario";function Harness(){const[empresa,setEmpresa]=useState("synthetic-a");window.__setEmpresa=setEmpresa;return <StockVsInventario empresaId={empresa}/>;}createRoot(document.getElementById("root")).render(<Harness/>);',resolveDir:root,loader:"tsx"},
 bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},
 plugins:[{name:"synthetic-session",setup(builder){builder.onResolve({filter:/^\.\/supabase$/},()=>({path:"synthetic-session",namespace:"synthetic"}));builder.onLoad({filter:/.*/,namespace:"synthetic"},()=>({contents:'export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"synthetic-ui-session"}}})}};',loader:"js"}));}}],
});
const bundle=bundled.outputFiles[0].contents;
const css=await fs.readFile(path.join(root,"src/index.css"),"utf8");
const requests=[],attempts=new Map();
let failureAt=0,delayed=false;
function finding(n){return {id:"v-"+n,codigo:"SYN-"+n,descripcion:"Producto sintético "+n,categoria:"Librería",stock_actual:7,estado:"ok",foto:1,x:25,y:30,confianza:.95,catalogo_id:"p"+n};}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==="/bundle.js"){res.writeHead(200,{"Content-Type":"text/javascript"});return res.end(bundle);}
  if(req.url==="/style.css"){res.writeHead(200,{"Content-Type":"text/css"});return res.end(css);}
  if(req.url==="/api/inventario/analizar"){
   let body="";for await(const chunk of req)body+=chunk;
   const data=JSON.parse(body),n=(attempts.get(data.empresaId)||0)+1;attempts.set(data.empresaId,n);
   requests.push({empresaId:data.empresaId,n,body:data,bytes:Buffer.byteLength(body),authorization:req.headers.authorization});
   assert.equal(req.headers.authorization,"Bearer synthetic-ui-session");
   assert.equal(data.imagenes.length,1);
   assert.match(data.imagenes[0],/^data:image\/jpeg;base64,/);
   assert.ok(Buffer.byteLength(body)<4_000_000);
   if(n===failureAt){res.writeHead(503,{"Content-Type":"application/json"});return res.end(JSON.stringify({error:"AI_HTTP_503",message:"El proveedor de IA no está disponible. Reintentá la foto en unos minutos."}));}
   if(delayed){await new Promise(resolve=>setTimeout(resolve,100));}
   const hallazgos=[finding(n)];
   if(n===1)hallazgos.push({...finding(2),estado:"no_visto",foto:0});
   res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
   return res.end(JSON.stringify({bloque:"Librería",hallazgos}));
  }
  if(req.url!=="/"){res.writeHead(404);return res.end();}
  res.writeHead(200,{"Content-Type":"text/html"});
  res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 }catch(error){res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({message:error.message}));}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
let browser;
try{browser=await chromium.launch({headless:true});}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
let checks=0;
async function count(page,selector,total){await page.waitForFunction(({selector,total})=>document.querySelectorAll(selector).length===total,{selector,total});checks++;}
async function readDB(page){
 return await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open("sigo-inventario-fotos-v1",1);
  request.onsuccess=()=>{const db=request.result;const tx=db.transaction("fotos","readonly"),r=tx.objectStore("fotos").getAll();r.onsuccess=()=>resolve(r.result.map(f=>({empresaId:f.empresaId,nombre:f.nombre,vence:f.vence,orden:f.orden,size:f.blob.size})));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};
  request.onerror=()=>reject(request.error);
 }));
}
async function ready(page,tenant="synthetic-a",month="2026-01"){
 await page.getByRole("heading",{name:"Stock vs Inventario",exact:true}).waitFor();
 await page.waitForFunction(key=>localStorage.getItem(key)!==null,"sigo-stock-inventario-"+tenant+"-"+month);
 await readDB(page);
}
async function snapshot(page,tenant="synthetic-a",month="2026-01"){return await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||"{}"),"sigo-stock-inventario-"+tenant+"-"+month);}
async function files(page,total,prefix="foto",mimeType="image/png"){
 const data=await page.evaluate(({mimeType})=>{const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;const ctx=canvas.getContext("2d");ctx.fillStyle="#e8e4cf";ctx.fillRect(0,0,640,480);ctx.fillStyle="#222";ctx.font="30px sans-serif";ctx.fillText("SIGO prueba sintética",60,150);return canvas.toDataURL(mimeType);},{mimeType});
 const buffer=Buffer.from(data.split(",")[1],"base64");
 return Array.from({length:total},(_,i)=>({name:prefix+"-"+i+(mimeType==="image/png"?".png":".jpg"),mimeType,buffer}));
}
async function add(page,total,prefix="foto",camera=false){
 const payload=await files(page,total,prefix,camera?"image/jpeg":"image/png");
 await page.locator(camera?'input[capture="environment"]':'input[type="file"][multiple]').setInputFiles(payload);
}
async function analyze(page){await page.getByRole("button",{name:"✨ Analizar fotos",exact:true}).click();}
async function done(page){await page.getByRole("alert").filter({hasText:"Comparación terminada."}).waitFor();}
async function run(label,device){
 attempts.clear();requests.length=0;failureAt=0;
 const context=await browser.newContext({...device,acceptDownloads:true,locale:"es-AR",timezoneId:"UTC"});
 const page=await context.newPage(),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/*",route=>{const url=route.request().url();return url.startsWith(origin)||url.startsWith("data:")||url.startsWith("blob:")?route.continue():route.abort("blockedbyclient");});
 await page.clock.install({time:new Date("2026-01-30T12:00:00Z")});
 try{
  await page.goto(origin);await ready(page);
  assert.equal(await page.locator('input[capture="environment"]').getAttribute("capture"),"environment");checks++;
  await add(page,10);await count(page,".sigo-inventory-photo",10);
  failureAt=3;
  await analyze(page);
  await page.getByRole("alert").filter({hasText:"El proveedor de IA no está disponible"}).waitFor();
  assert.equal(requests.length,3);assert.equal((await snapshot(page)).lotes.length,2);checks+=2;
  // The real UI resumes only unfinished photos after a provider failure.
  failureAt=0;await analyze(page);await done(page);
  assert.equal(requests.length,11);assert.equal(requests.every(r=>r.empresaId==="synthetic-a"),true);checks+=2;
  await count(page,".sigo-inventory-photo small",10);
  await count(page,"tbody tr",10);
  assert.equal((await snapshot(page)).revisiones.length,1);assert.equal((await readDB(page)).length,10);checks+=2;
  // IDs p2 are visibly detected in the second image, so no false missing row remains.
  assert.equal(await page.locator("tbody").getByText("NO VISTO EN INVENTARIO",{exact:true}).count(),0);checks++;
  const marker=page.locator(".sigo-inventory-photo span[title]").first();
  assert.match(await marker.getAttribute("style"),/left:\s*25%/);assert.match(await marker.getAttribute("style"),/top:\s*30%/);checks+=2;
  await page.screenshot({path:path.join(artifacts,label+"-ten-photos.png"),fullPage:true});
  const beforeRetry=requests.length;
  await analyze(page);await done(page);
  assert.equal(requests.length,beforeRetry);assert.equal((await snapshot(page)).revisiones.length,1);checks+=2;
  await page.reload();await ready(page);
  await count(page,".sigo-inventory-photo",10);await count(page,".sigo-inventory-photo small",10);await count(page,"tbody tr",10);
  assert.equal(requests.length,beforeRetry);assert.equal((await snapshot(page)).lotes.length,10);checks+=2;
  await page.getByRole("button",{name:"Nueva revisión",exact:true}).click();
  await count(page,".sigo-inventory-photo",0);
  await page.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open("sigo-inventario-fotos-v1",1);r.onsuccess=()=>{const db=r.result,tx=db.transaction("fotos","readonly"),q=tx.objectStore("fotos").count();q.onsuccess=()=>resolve(q.result===0);tx.oncomplete=()=>db.close();};}));
  await add(page,1,"camara",true);await count(page,".sigo-inventory-photo",1);
  await analyze(page);await done(page);await count(page,"tbody tr",11);
  assert.equal((await snapshot(page)).revisiones.length,2);checks++;
  const downloadEvent=page.waitForEvent("download");
  await page.getByRole("button",{name:"▣ Exportar Excel",exact:true}).click();
  const download=await downloadEvent,csv=await fs.readFile(await download.path(),"utf8");
  assert.match(download.suggestedFilename(),/^SIGO-stock-inventario-2026-01\.csv$/);
  assert.ok(csv.startsWith("\ufeff"));assert.equal(csv.trim().split(/\r?\n/).length,12);assert.match(csv,/"Stock SIGO"/);assert.match(csv,/"7";"ok"/);checks+=5;

  // Tenant changes run through the mounted React component, sharing the same
  // origin/IndexedDB to catch accidental cross-company recovery.
  await page.evaluate(()=>window.__setEmpresa("synthetic-b"));await ready(page,"synthetic-b");await count(page,".sigo-inventory-photo",0);await count(page,"tbody tr",0);
  await add(page,1,"empresa-b");await count(page,".sigo-inventory-photo",1);await analyze(page);await done(page);
  assert.equal((await snapshot(page,"synthetic-b")).revisiones.length,1);assert.equal((await snapshot(page)).revisiones.length,2);checks+=2;
  await page.evaluate(()=>window.__setEmpresa("synthetic-a"));await ready(page);await count(page,".sigo-inventory-photo",1);await count(page,"tbody tr",11);
  assert.equal(await page.locator(".sigo-inventory-photo img").getAttribute("alt"),"camara-0.jpg");checks++;

  // Advance Date across the real photo expiry, then reload the mounted UI.
  await page.clock.setSystemTime(new Date("2026-01-31T12:01:00Z"));
  await page.reload();await ready(page);await count(page,".sigo-inventory-photo",0);await count(page,"tbody tr",11);
  assert.equal((await readDB(page)).filter(f=>f.empresaId==="synthetic-a").length,0);
  assert.equal((await snapshot(page)).lotes.length,0);checks+=2;
  // Month rollover while the component remains mounted must start an empty
  // monthly report and preserve the previous report under its original key.
  await page.clock.setSystemTime(new Date("2026-02-01T12:00:00Z"));await page.clock.runFor(60_001);
  await page.getByRole("heading",{name:/Reporte mensual.*febrero/}).waitFor();
  await ready(page,"synthetic-a","2026-02");await count(page,"tbody tr",0);
  assert.equal((await snapshot(page,"synthetic-a","2026-01")).revisiones.length,2);
  assert.equal((await snapshot(page,"synthetic-a","2026-02")).revisiones.length,0);
  await page.getByText(/Históricos guardados:.*2026-01/).waitFor();checks+=3;
  assert.deepEqual(errors,[],"the actual mounted UI must not throw browser exceptions");checks++;
  console.log(label+": real component input/canvas/API batches, partial retry, markers, IDB reload/24h expiry, monthly export/rollover and tenant isolation passed.");
 }catch(error){
  await page.screenshot({path:path.join(artifacts,label+"-failure.png"),fullPage:true}).catch(()=>{});
  const state=await page.evaluate(()=>({text:document.body.innerText,storage:{...localStorage}})).catch(()=>({}));
  await fs.writeFile(path.join(artifacts,label+"-failure.json"),JSON.stringify({error:String(error),requests:requests.map(({empresaId,n,bytes})=>({empresaId,n,bytes})),state},null,2));
  throw error;
 }finally{await context.close();}
}
try{
 await run("chromium",{viewport:{width:1440,height:1000}});
 await run("android-simulated",devices["Pixel 7"]);
 console.log("Inventory UI browser: "+checks+" checks passed. Synthetic local HTTP only; Gemini and physical Android remain unverified.");
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}

