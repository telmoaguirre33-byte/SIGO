import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

// Invocar el JavaScript oficial con Node evita shell:true y el quoting de .cmd.
export function resolveRailwayLauncher({platform=process.platform,execute=execFileSync,exists=existsSync,node=process.execPath}={}){
 if(platform!=='win32')return {file:'railway',prefix:[]};
 let shims;
 try{shims=String(execute('where.exe',['railway.cmd'],{encoding:'utf8',timeout:10000,shell:false,windowsHide:true}));}
 catch{throw new Error('RAILWAY_CLI_NOT_FOUND: instalar @railway/cli en el entorno de ejecución.');}
 for(const line of shims.split(/\r?\n/)){
  const shim=line.trim().replace(/^"|"$/g,'');
  if(!/railway\.cmd$/i.test(shim))continue;
  const dir=path.win32.dirname(shim);
  for(const candidate of [path.win32.resolve(dir,'../@railway/cli/bin/railway.js'),path.win32.resolve(dir,'node_modules/@railway/cli/bin/railway.js')]){
   if(exists(candidate))return {file:node,prefix:[candidate]};
  }
 }
 throw new Error('RAILWAY_CLI_LAUNCHER_NOT_FOUND: no se encontró bin/railway.js del paquete oficial; no se ejecuta un shim con shell.');
}
export function safeCLIError(command,error){
 const evidence=String(error?.code??'')+' '+String(error?.message??'')+' '+String(error?.stdout??'')+' '+String(error?.stderr??'');
 let code='CLI_FAILED';
 if(command==='ssh'){
  if(/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(evidence))code='SSH_HOST_KEY_NOT_VERIFIED';
  else if(/permission denied|publickey/i.test(evidence))code='SSH_PERMISSION_DENIED';
  else if(/no such file|cannot open.*\.crt/i.test(evidence))code='SSH_CERTIFICATE_UNAVAILABLE';
  else if(/failed to execute ssh|ENOENT|not recognized|not found.*ssh/i.test(evidence))code='SSH_OPENSSH_UNAVAILABLE';
  else if(/timed? ?out|ETIMEDOUT|connection refused|could not resolve|network is unreachable/i.test(evidence))code='SSH_CONNECTIVITY';
  else code='SSH_FAILED';
 }else if(command==='whoami'&&/NOT_AUTHENTICATED|not signed in|not authenticated|unauthorized/i.test(evidence))code='CLI_NOT_AUTHENTICATED';
 else if(/ETIMEDOUT|timed? ?out/i.test(evidence))code='CLI_TIMEOUT';
 return new Error(code+': Railway CLI falló; salida sensible omitida. SSH registrado no demuestra conectividad. No se desactiva TLS ni la verificación de host.');
}
export function createRailwayRunner({cwd,execute=execFileSync,launcher=resolveRailwayLauncher(),env=process.env}={}){
 return async(args,input,{interactive=false}={})=>{
  try{return execute(launcher.file,[...launcher.prefix,...args],{cwd,env:{...env,RAILWAY_CALLER:'skill:use-railway@1.3.5',RAILWAY_AGENT_SESSION:'mayorista-qa-cli-'+process.pid},input,encoding:'utf8',timeout:interactive?600000:180000,maxBuffer:1024*1024,shell:false,windowsHide:!interactive,...(interactive?{stdio:'inherit'}:{})});}
  catch(error){throw safeCLIError(args[0],error);}
 };
}
