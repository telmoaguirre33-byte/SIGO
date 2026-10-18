import {qaReadiness} from './readiness.mjs';
import {trustedSigoVerifier} from '../security/sigo-bridge.mjs';
import {interactiveQa} from './interactive-qa.mjs';
import {startupDiagnostic} from './startup-diagnostic.mjs';
import pg from 'pg';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {createIsolatedService} from './service.mjs';import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
const root=path.resolve(fileURLToPath(new URL('../demo/dist/',import.meta.url)));
export {requestLimiter} from './http-server.mjs';
import {requestLimiter,startOperationalHttp} from './http-server.mjs';
/** Un contexto operativo por proceso. El origen solo se valida en CORS, nunca selecciona datos. */
export function operationalContext(pool,interactive){
 return interactive?{pool:interactive.pool,qaSigoLink:interactive.link}:{pool};
}
export async function startRailwayServer(env=process.env){
 const config=railwayRuntime(env),pool=new pg.Pool(config.policy.config);try{await assertInstalledQA(pool);}catch(error){await pool.end();throw error;}
 const interactive=await interactiveQa(env);
 const serviceOptions={enabled:true,...config,origin:config.origin,databasePolicy:config.policy,operational:true,inventoryRequired:true,accountsEnabled:true,sharedSourceEnabled:env.MAYORISTA_SHARED_SOURCE_QA==='true',rateLimit:requestLimiter(),emitMetrics:metric=>console.log(JSON.stringify(metric)),authenticateSigo:trustedSigoVerifier(env)};
 const handler=createIsolatedService({...serviceOptions,...operationalContext(pool,interactive)});
 const server=await startOperationalHttp({root,config,handler,env,readiness:async()=>({...await qaReadiness({base:pool,operational:interactive?.pool??pool,head:env.RAILWAY_GIT_COMMIT_SHA}),interactiveQa:interactive?{enabled:true,empresaSigo:interactive.externalEmpresaId,empresaQA:interactive.qaEmpresaId,source:'synthetic_railway_qa_only'}:{enabled:false}})});
 return {server,pool,close:async()=>{await new Promise(resolve=>server.close(resolve));if(interactive)await interactive.pool.end();await pool.end();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startRailwayServer().then(app=>{console.log('Mayorista QA iniciado');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}).catch(error=>{console.error(JSON.stringify(startupDiagnostic(error,process.env)));process.exitCode=1;});

