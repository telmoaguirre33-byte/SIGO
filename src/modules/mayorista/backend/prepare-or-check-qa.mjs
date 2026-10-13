import {startupDiagnostic} from './startup-diagnostic.mjs';
import pg from 'pg';
import {railwayRuntime,assertInstalledQA} from './railway-runtime.mjs';
export async function prepareOrCheckQA(env,{Pool=pg.Pool,install=()=>import('./prepare-qa.mjs')}={}){
 const config=railwayRuntime(env),pool=new Pool(config.policy.config);let missing=false;
 try{await assertInstalledQA(pool);}catch(error){if(error.code==='42P01')missing=true;else throw error;}finally{await pool.end();}
 if(!missing)return {installed:false,verified:true};
 if(env.MAYORISTA_BOOTSTRAP_INSTALL_ONCE!=='true')throw new Error('Instalación inicial QA no autorizada');
 await install();if(process.exitCode)throw new Error('Instalación inicial QA rechazada');
 return {installed:true,verified:true};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])prepareOrCheckQA(process.env).then(r=>console.log(JSON.stringify({event:'MAYORISTA_QA_SCHEMA_READY',...r}))).catch(error=>{console.error(JSON.stringify({...startupDiagnostic(error,process.env),stage:'pre_deploy'}));process.exitCode=1;});
