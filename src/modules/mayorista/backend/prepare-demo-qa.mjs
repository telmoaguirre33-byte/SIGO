import {interactiveQa} from './interactive-qa.mjs';
import {prepareDemoCompany} from './demo-company.mjs';
export async function prepareDemoQA(env){
 const qa=await interactiveQa(env);
 if(!qa)throw Error('Demo requiere QA interactivo aislado');
 try{return await prepareDemoCompany(qa.pool,{externalEmpresaId:qa.externalEmpresaId,password:env.MAYORISTA_BOOTSTRAP_PASSWORD});}finally{await qa.pool.end();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])prepareDemoQA(process.env).then(r=>console.log(JSON.stringify({event:'MAYORISTA_DEMO_PREPARED',...r}))).catch(e=>{console.error(JSON.stringify({event:'MAYORISTA_DEMO_FAILED',reason:e.code??'PREPARATION_FAILED',productionChanged:false}));process.exitCode=1;});
