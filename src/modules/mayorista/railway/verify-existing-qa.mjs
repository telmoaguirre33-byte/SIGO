import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {QA_ORIGIN} from './provision-qa-cli.mjs';

// Solo comprobación HTTP. No instala, crea usuarios, migra ni modifica Railway.
export async function verifyExistingQA({credentials,request=fetch,skipHealth=false}={}){
 if(credentials&&credentials.origin!==QA_ORIGIN)throw new Error('Origen ajeno a MAYORISTA-QA');
 const checks=[];
 const call=async(route,{token,...options}={})=>request(QA_ORIGIN+route,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:QA_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});
 const expect=async(route,options,status=200)=>{const response=await call(route,options);if(response.status!==status)throw new Error('QA '+route+': HTTP '+response.status+'; esperado '+status);checks.push({route,status});return response;};
 if(skipHealth&&!credentials)throw new Error('Archivo privado requerido para login-only');
 if(!skipHealth){
  const health=await(await expect('/health')).json();
  if(health.status!=='ok'||health.module!=='mayorista')throw new Error('Identidad /health no verificada');
 }
 await expect('/admin/catalog',{},401);
 if(!credentials)return {origin:QA_ORIGIN,checks,authenticated:false,qaWritesTested:false};
 if(!credentials.empresaId||!credentials.email||!credentials.password)throw new Error('Archivo privado de credenciales incompleto');
 const auth=await(await expect('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresaId:credentials.empresaId,email:credentials.email,password:credentials.password})})).json();
 if(typeof auth.accessToken!=='string')throw new Error('Login sin token');
 const token=auth.accessToken;
 let revoked=false;
 try{
  const me=await(await expect('/me',{token})).json();
  if(me.empresaId!==credentials.empresaId||me.rol!=='gerencia'||!me.permissions?.includes('admin:gestionar'))throw new Error('Empresa/rol gerencia no verificados');
  await expect('/admin/catalog',{token});
  await expect('/auth/logout',{method:'POST',token});revoked=true;
  await expect('/me',{token},401);
 }finally{if(!revoked)try{await call('/auth/logout',{method:'POST',token});}catch{/* no revelar token ni errores remotos */}}
 return {origin:QA_ORIGIN,checks,authenticated:true,qaWritesTested:false,allRolesTested:false,crossCompanyTested:false};
}
async function main(){
 const args=process.argv.slice(2);const skipHealth=args.includes('--login-only');
 if(skipHealth)args.splice(args.indexOf('--login-only'),1);let credentials;
 if(args.length){
  if(args.length!==2||args[0]!=='--credentials')throw new Error('Uso: node verify-existing-qa.mjs [--login-only] [--credentials archivo-privado.json]');
  const info=await stat(args[1]);
  if(process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Error('Archivo de credenciales debe tener permisos 0600');
  credentials=JSON.parse(await readFile(args[1],'utf8'));
 }
 try{console.log(JSON.stringify(await verifyExistingQA({credentials,skipHealth}),null,2));}
 catch(error){throw new Error(error.message.startsWith('QA ')||/^(Identidad|Empresa|Login|Origen|Archivo)/.test(error.message)?error.message:'Verificación externa no completada (red/TLS/respuesta). No se imprime contenido sensible.');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
