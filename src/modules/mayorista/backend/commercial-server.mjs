import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {commercialRuntime,commercialReadiness} from './commercial-runtime.mjs';
import {startOperationalHttp,requestLimiter} from './http-server.mjs';
import {createIsolatedService} from './service.mjs';
import {trustedSigoVerifier} from '../security/sigo-bridge.mjs';
/** Entrada distinta de QA. No instala ni modifica esquema/configuración al arrancar. */
export async function startCommercialServer(env=process.env){
 if(!env.MAYORISTA_RELEASE_PROFILE_PATH)throw Error('Perfil comercial no configurado');
 const config=commercialRuntime(env,await readFile(env.MAYORISTA_RELEASE_PROFILE_PATH,'utf8')),pool=new pg.Pool(config.policy.config);
 try{
  await commercialReadiness(pool,config,env.RAILWAY_GIT_COMMIT_SHA);
  const handler=createIsolatedService({enabled:true,pool,...config,databasePolicy:config.policy,operational:true,inventoryRequired:true,accountsEnabled:true,sharedSourceEnabled:true,commercialMode:true,authenticateSigo:trustedSigoVerifier(env),rateLimit:requestLimiter(),emitMetrics:m=>console.log(JSON.stringify(m))});
  const server=await startOperationalHttp({root:fileURLToPath(new URL('../demo/dist/',import.meta.url)),config,handler,env,readiness:()=>commercialReadiness(pool,config,env.RAILWAY_GIT_COMMIT_SHA)});
  return {server,pool,close:async()=>{await new Promise(r=>server.close(r));await pool.end();}};
 }catch(e){await pool.end();throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startCommercialServer().then(app=>{console.log('Mayorista comercial iniciado');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}).catch(()=>{console.error('MAYORISTA_COMMERCIAL_START_REJECTED');process.exitCode=1;});
