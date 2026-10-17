import {qaReadiness} from './readiness.mjs';
import {operationalAsset} from './static-assets.mjs';
import {trustedSigoVerifier} from '../security/sigo-bridge.mjs';
import {interactiveQa} from './interactive-qa.mjs';
import {startupDiagnostic} from './startup-diagnostic.mjs';
import pg from 'pg';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {createIsolatedService} from './service.mjs';import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
const root=path.resolve(fileURLToPath(new URL('../demo/dist/',import.meta.url)));
/** Límite acotado de memoria. No usa Railway Agent ni servicios auxiliares. */
export function requestLimiter({now=Date.now,maxKeys=10000}={}){
 const entries=new Map();return async request=>{const key=request.headers.get('x-mayorista-peer')??'local',login=new URL(request.url).pathname.startsWith('/auth/'),bucket=(login?'login:':'api:')+key,time=now(),entry=entries.get(bucket);if(entry&&entry.until>time){entry.count++;return entry.count<=(login?30:600);}if(entries.size>=maxKeys){for(const [k,v] of entries)if(v.until<=time)entries.delete(k);if(entries.size>=maxKeys)return false;}entries.set(bucket,{count:1,until:time+60000});return true;};
}
/** Un contexto operativo por proceso. El origen solo se valida en CORS, nunca selecciona datos. */
export function operationalContext(pool,interactive){
 return interactive?{pool:interactive.pool,qaSigoLink:interactive.link}:{pool};
}
export async function startRailwayServer(env=process.env){
 const config=railwayRuntime(env),pool=new pg.Pool(config.policy.config);try{await assertInstalledQA(pool);}catch(error){await pool.end();throw error;}
 const interactive=await interactiveQa(env);
 const serviceOptions={enabled:true,...config,origin:config.origin,databasePolicy:config.policy,operational:true,inventoryRequired:true,accountsEnabled:true,sharedSourceEnabled:env.MAYORISTA_SHARED_SOURCE_QA==='true',rateLimit:requestLimiter(),emitMetrics:metric=>console.log(JSON.stringify(metric)),authenticateSigo:trustedSigoVerifier(env)};
 const handler=createIsolatedService({...serviceOptions,...operationalContext(pool,interactive)});
 const sw=await readFile(path.join(root,'operational-sw.js'),'utf8'),assetNames=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>'/'+m[1]);const allowed=new Set([...assetNames,'/operational-sw.js']);
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,config.origin),headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000'};
  if(url.pathname==='/health'&&req.method==='GET'){res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"status":"ok","module":"mayorista"}');return;}
  if(url.pathname==='/readiness'&&req.method==='GET'){
   const report=await qaReadiness({base:pool,operational:interactive?.pool??pool,head:env.RAILWAY_GIT_COMMIT_SHA});
   res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...report,interactiveQa:interactive?{enabled:true,empresaSigo:interactive.externalEmpresaId,empresaQA:interactive.qaEmpresaId,source:'synthetic_railway_qa_only'}:{enabled:false}}));return;
  }
  if(url.pathname==='/'&&req.method==='GET'){res.writeHead(302,{...headers,Location:'/portal.html'});res.end();return;}
  if(req.method==='GET'&&allowed.has(url.pathname)){
   const {content,assetHeaders}=await operationalAsset(root,url.pathname,config.origin);
   res.writeHead(200,{...headers,...assetHeaders});res.end(content);return;
  }
  const ownHeaders=new Headers(req.headers);ownHeaders.set('x-mayorista-peer',req.socket.remoteAddress??'unknown');const response=await handler(new Request(url,{method:req.method,headers:ownHeaders,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Servicio no disponible"}');}});
 const port=Number(env.PORT??8080);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto inválido');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve)});
 return {server,pool,close:async()=>{await new Promise(resolve=>server.close(resolve));if(interactive)await interactive.pool.end();await pool.end();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startRailwayServer().then(app=>{console.log('Mayorista QA iniciado');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}).catch(error=>{console.error(JSON.stringify(startupDiagnostic(error,process.env)));process.exitCode=1;});

