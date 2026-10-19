import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalAsset} from './static-assets.mjs';
/** Límite acotado de memoria. No usa Railway Agent ni servicios auxiliares. */
export function requestLimiter({now=Date.now,maxKeys=10000}={}){
 const entries=new Map();return async request=>{const key=request.headers.get('x-mayorista-peer')??'local',login=new URL(request.url).pathname.startsWith('/auth/'),bucket=(login?'login:':'api:')+key,time=now(),entry=entries.get(bucket);if(entry&&entry.until>time){entry.count++;return entry.count<=(login?30:600);}if(entries.size>=maxKeys){for(const [k,v] of entries)if(v.until<=time)entries.delete(k);if(entries.size>=maxKeys)return false;}entries.set(bucket,{count:1,until:time+60000});return true;};
}

export function operationalApplication(pathname,mount,base){
 if(!mount)return {...base,pathname,prefix:''};
 if(mount.prefix!=='/integracion-qa'||mount.config?.origin!==base.config.origin||typeof mount.handler!=='function'||typeof mount.readiness!=='function')throw Error('Montaje QA inválido');
 return pathname===mount.prefix||pathname.startsWith(mount.prefix+'/')?{...mount,pathname:pathname.slice(mount.prefix.length)||'/'}:{...base,pathname,prefix:''};
}
export async function startOperationalHttp({root,config,handler,readiness,env,mountedApplication}){
 const sw=await readFile(path.join(root,'operational-sw.js'),'utf8'),assetNames=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>'/'+m[1]);const allowed=new Set([...assetNames,'/operational-sw.js']);
 const server=createServer(async(req,res)=>{try{
  const incoming=new URL(req.url,config.origin),selected=operationalApplication(incoming.pathname,mountedApplication,{config,handler,readiness});
  const url=new URL(incoming);url.pathname=selected.pathname;
  const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000'};
  if(url.pathname==='/health'&&req.method==='GET'){res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"status":"ok","module":"mayorista"}');return;}
  if(url.pathname==='/readiness'&&req.method==='GET'){
   const report=await selected.readiness();
   res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(report));return;
  }
  if(url.pathname==='/'&&req.method==='GET'){res.writeHead(302,{...headers,Location:selected.prefix+'/portal.html'});res.end();return;}
  if(req.method==='GET'&&allowed.has(url.pathname)){
   const {content,assetHeaders}=await operationalAsset(root,url.pathname,selected.config.origin+selected.prefix);
   res.writeHead(200,{...headers,...assetHeaders});res.end(content);return;
  }
  const ownHeaders=new Headers(req.headers);ownHeaders.set('x-mayorista-peer',req.socket.remoteAddress??'unknown');const response=await selected.handler(new Request(url,{method:req.method,headers:ownHeaders,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}));res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Servicio no disponible"}');}});
 const port=Number(env.PORT??8080);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto inválido');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve)});
 return server;
}
