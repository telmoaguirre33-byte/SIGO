import pg from 'pg';
import {installLaunchSchema} from './launch-upgrade.mjs';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
import {verifyExistingP0QA,P0_NAMESPACE} from './verify-existing-p0-qa.mjs';
import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
/** Única ampliación QA aditiva. No semillas, no aceptación mutante, no esquemas/base/servicios nuevos. */
export async function upgradeLaunchQA(env,{Pool=pg.Pool}={}){
 const config=railwayRuntime(env),base=new Pool(config.policy.config);
 try{
  await assertInstalledQA(base);console.log(JSON.stringify(await verifyExistingP0QA(base)));
  return await installLaunchSchema(acceptanceNamespace(base,P0_NAMESPACE));
 }finally{await base.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])upgradeLaunchQA(process.env).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({event:'MAYORISTA_LAUNCH_UPGRADE_FAILED',stage:e.launchStage??'evidence',code:e.code??e.message}));process.exitCode=1;});
