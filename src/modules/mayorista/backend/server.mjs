import {startupDiagnostic} from './startup-diagnostic.mjs';
import pg from 'pg';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import {createHash} from 'node:crypto';
import {createIsolatedService} from './service.mjs';import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
const root=fileURLToPath(new URL('../demo/dist/',import.meta.url));
/** Límite acotado de memoria. No usa Railway Agent ni servicios auxiliares. */
export function requestLimiter({now=Date.now,maxKeys=10000}={}){
 const entries=new Map();return async request=>{const key=request.headers.get('x-mayorista-peer')??'local',login=new URL(request.url).pathname==='/auth/login',bucket=(login?'login:':'api:')+key,time=now(),entry=entries.get(bucket);if(entry&&entry.until>time){entry.count++;return entry.count<=(login?30:600);}if(entries.size>=maxKeys){for(const [k,v] of entries)if(v.until<=time)entries.delete(k);if(entries.size>=maxKeys)return false;}entries.set(bucket,{count:1,until:time+60000});return true;};
}
export async function startRailwayServer(env=process.env){
 const config=railwayRuntime(env),pool=new pg.Pool(config.policy.config);try{await assertInstalledQA(pool);}catch(error){await pool.end();throw error;}
 const handler=createIsolatedService({enabled:true,pool,...config,origin:config.origin,databasePolicy:config.policy,operational:true,inventoryRequired:true,accountsEnabled:true,sharedSourceEnabled:env.MAYORISTA_SHARED_SOURCE_QA==='true',rateLimit:requestLimiter()});
 const sw=await readFile(path.join(root,'operational-sw.js'),'utf8'),assetNames=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>'/'+m[1]);const allowed=new Set([...assetNames,'/operational-sw.js']);
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,config.origin),headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000'};
  if(url.pathname==='/health'&&req.method==='GET'){res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"status":"ok","module":"mayorista"}');return;}
  if(url.pathname==='/'&&req.method==='GET'){res.writeHead(302,{...headers,Location:'/portal.html'});res.end();return;}
  if(req.method==='GET'&&allowed.has(url.pathname)){
   const f=path.resolve(root,'.'+url.pathname);if(!f.startsWith(root+path.sep))throw new Error();let content;
   if(url.pathname==='/secure-config.mjs')content=Buffer.from('export const secureConfig=Object.freeze('+JSON.stringify({enabled:true,approvedOrigin:config.origin})+');');else content=await readFile(f);
   const type=({'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(f)]??'application/octet-stream';
   const scripts=[...content.toString().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");
   res.writeHead(200,{...headers,'Content-Type':type,'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self' "+scripts.join(' ')+"; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(content);return;
  }
  const ownHeaders=new Headers(req.headers);ownHeaders.set('x-mayorista-peer',req.socket.remoteAddress??'unknown');const response=await handler(new Request(url,{method:req.method,headers:ownHeaders,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Servicio no disponible"}');}});
 const port=Number(env.PORT??8080);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto inválido');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve)});
 return {server,pool,close:async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startRailwayServer().then(app=>{console.log('Mayorista QA iniciado');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}).catch(error=>{console.error(JSON.stringify(startupDiagnostic(error,process.env)));process.exitCode=1;});
