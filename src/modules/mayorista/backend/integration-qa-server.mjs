import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {integrationQaRuntime,commercialReadiness} from './commercial-runtime.mjs';
import {createIsolatedService} from './service.mjs';
import {startRailwayServer} from './server.mjs';
import {requestLimiter} from './http-server.mjs';
import {trustedSigoVerifier} from '../security/sigo-bridge.mjs';
import {integrationQaEnvironment} from './integration-qa-env.mjs';
export async function prepareIntegrationQaApplication(env=process.env){
 const own=integrationQaEnvironment(env),config=integrationQaRuntime(own,env.MAYORISTA_INTEGRATION_PROFILE_JSON),pool=new pg.Pool(config.policy.config);
 const readiness=async()=>({...await commercialReadiness(pool,config,own.RAILWAY_GIT_COMMIT_SHA),runtime:'integration-qa',productionAcceptance:false});
 try{
  await readiness();
  const handler=createIsolatedService({enabled:true,pool,...config,databasePolicy:config.policy,operational:true,inventoryRequired:true,accountsEnabled:true,sharedSourceEnabled:true,commercialMode:true,authenticateSigo:trustedSigoVerifier(own),rateLimit:requestLimiter(),emitMetrics:m=>console.log(JSON.stringify(m))});
  return {prefix:'/integracion-qa',config,handler,readiness,close:()=>pool.end()};
 }catch(error){await pool.end();throw error;}
}
export async function startIntegrationQaServer(env=process.env){
 const mountedApplication=await prepareIntegrationQaApplication(env);
 try{const legacy=await startRailwayServer(env,{mountedApplication});return {server:legacy.server,close:async()=>{await legacy.close();await mountedApplication.close();}};}
 catch(error){await mountedApplication.close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const run=process.argv.includes('--check')?prepareIntegrationQaApplication().then(async app=>{console.log(JSON.stringify(await app.readiness()));await app.close();}):startIntegrationQaServer().then(app=>{console.log('Mayorista QA e integración iniciados con contextos separados');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));});
 run.catch(()=>{console.error('MAYORISTA_INTEGRATION_QA_REJECTED');process.exitCode=1;});
}
