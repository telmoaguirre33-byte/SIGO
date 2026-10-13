import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {QA_RAILWAY} from './database-policy.mjs';
export const API_SERVICE='9053689a-0e32-4f3c-b5da-3c01e480a9c6';
export const QA_ORIGIN='https://mayorista-api-qa-qa.up.railway.app';
export function verifiedPublicCA(output,now=Date.now()){
 const blocks=String(output).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
 if(blocks?.length!==2)throw new Error('No se obtuvieron exactamente los dos certificados públicos QA');
 const root=new X509Certificate(blocks[0]),server=new X509Certificate(blocks[1]);
 if(!root.ca||!root.verify(root.publicKey)||!server.verify(root.publicKey)||!server.checkIssued(root)||server.checkHost('postgres.railway.internal')!=='postgres.railway.internal')throw new Error('CA o hostname privado QA no verificados');
 for(const certificate of [root,server])if(Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)throw new Error('Certificado QA fuera de vigencia');
 return {pem:blocks[0]+'\n',fingerprint:root.fingerprint256};
}
export function variableCommand(name){
 if(!/^[A-Z][A-Z0-9_]*$/.test(name))throw new Error('Nombre de variable inválido');
 return ['variable','set',name,'--stdin','--skip-deploys','--project',QA_RAILWAY.projectId,'--service',API_SERVICE,'--environment',QA_RAILWAY.environmentId,'--json'];
}
export async function provisionQA({run,budgetConfirmed=false,onStep=()=>{},request=fetch,persistCredentials=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 if(budgetConfirmed!==true)throw new Error('Confirmar presupuesto total QA de hasta US$15 antes de activar');
 if(typeof run!=='function')throw new Error('Railway CLI requerido');
 const scope=['--service',API_SERVICE,'--environment',QA_RAILWAY.environmentId];
 onStep('Verificando sesión y enlazando exclusivamente MAYORISTA-QA');
 await run(['whoami','--json']);
 await run(['link','--project',QA_RAILWAY.projectId,'--environment',QA_RAILWAY.environmentId,'--service',API_SERVICE]);
 const parsed=JSON.parse(await run(['variable','list',...scope,'--json']));
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Formato de variables Railway no reconocido');
 const existing=parsed;
 if(Object.hasOwn(existing,'MAYORISTA_BOOTSTRAP_COMPANY_ID'))throw new Error('Bootstrap ya configurado: no se reemplazan usuarios ni credenciales. Continuar verificación desde el servidor existente.');
 onStep('Obteniendo solo root.crt y server.crt por SSH administrativo');
 const ca=verifiedPublicCA(await run(['ssh','--project',QA_RAILWAY.projectId,'--environment',QA_RAILWAY.environmentId,'--service',QA_RAILWAY.databaseServiceId,'--','cat','/var/lib/postgresql/data/certs/root.crt','/var/lib/postgresql/data/certs/server.crt']));
 const empresaId=randomUUID(),userId=randomUUID(),password='Aa1!'+randomBytes(32).toString('base64url'),email='gerencia-qa@example.invalid';
 const privateKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
 const values={
  DATABASE_URL:'${{Postgres.DATABASE_URL}}',MAYORISTA_DATABASE_SERVICE_ID:QA_RAILWAY.databaseServiceId,
  MAYORISTA_DB_CA_PEM:ca.pem,MAYORISTA_AUTH_PRIVATE_KEY:privateKey,MAYORISTA_PUBLIC_ORIGIN:QA_ORIGIN,PORT:'8080',
  MAYORISTA_MONTHLY_BUDGET_USD:'15',MAYORISTA_BUDGET_VERIFIED:'true',MAYORISTA_QA_ENABLED:'true',
  MAYORISTA_BOOTSTRAP_INSTALL_ONCE:'true',MAYORISTA_BOOTSTRAP_ENABLE_COMPANY:'true',
  MAYORISTA_BOOTSTRAP_EMAIL:email,MAYORISTA_BOOTSTRAP_NAME:'Gerencia QA',MAYORISTA_BOOTSTRAP_COMPANY_NAME:'Mayorista QA',
  MAYORISTA_BOOTSTRAP_COMPANY_ID:empresaId,MAYORISTA_BOOTSTRAP_USER_ID:userId,MAYORISTA_BOOTSTRAP_PASSWORD:password
 };
 onStep('Guardando configuración por stdin; sin contraseñas en argumentos ni salida');
 for(const [name,value] of Object.entries(values)){
  if(Object.hasOwn(existing,name)&&['MAYORISTA_AUTH_PRIVATE_KEY','MAYORISTA_DB_CA_PEM'].includes(name))continue;
  await run(variableCommand(name),value);
 }
 // Conservar credenciales en un archivo local privado ANTES del único despliegue.
 await persistCredentials({origin:QA_ORIGIN,empresaId,userId,email,password});
 onStep('Desplegando la imagen existente con instalación inicial QA transaccional');
 await run(['redeploy','--from-source','--yes',...scope]);
 let success=false;
 for(let i=0;i<60;i++){
  const raw=JSON.parse(await run(['deployment','list','--project',QA_RAILWAY.projectId,...scope,'--limit','1','--json']));
  const deployments=Array.isArray(raw)?raw:raw.deployments;
  const d=deployments?.[0];
  if(!d||(d.serviceId!==undefined&&d.serviceId!==API_SERVICE)||(d.environmentId!==undefined&&d.environmentId!==QA_RAILWAY.environmentId))throw new Error('No se pudo verificar identidad del despliegue QA');
  onStep('Despliegue QA: '+d.status);
  if(d.status==='SUCCESS'){success=true;break;}
  if(['FAILED','CRASHED','NEEDS_APPROVAL','SKIPPED','REMOVED','REMOVING'].includes(d.status))throw new Error('Despliegue QA detenido: '+d.status);
  await sleep(10000);
 }
 if(!success)throw new Error('No se observó SUCCESS dentro del plazo; no repetir instalación');
 const get=async name=>{const r=await request(QA_ORIGIN+name,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Verificación HTTPS QA falló');return r;};
 const health=await(await get('/health')).json();if(health.status!=='ok'||health.module!=='mayorista')throw new Error('Health QA incorrecto');
 const manifest=await(await get('/secure.webmanifest')).json();
 if(manifest.name!=='SIGO Vendedor'||manifest.start_url!=='./secure.html'||manifest.display!=='standalone')throw new Error('Manifest operativo incorrecto');
 for(const size of [192,512])for(const purpose of ['any','maskable']){
  const icon=manifest.icons.find(i=>i.sizes===size+'x'+size&&i.purpose===purpose);
  if(!icon?.src.startsWith('./'))throw new Error('Icono PWA inválido');
  const bytes=Buffer.from(await(await get('/'+icon.src.slice(2))).arrayBuffer());
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size)throw new Error('PNG PWA inválido');
 }
 const auth=await request(QA_ORIGIN+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:QA_ORIGIN},body:JSON.stringify({empresaId,email,password}),signal:AbortSignal.timeout(20000)});
 if(!auth.ok)throw new Error('Login gerencia QA no verificado; conservar archivo privado');
 const login=await auth.json();if(typeof login.accessToken!=='string')throw new Error('Token QA no recibido');
 const me=await request(QA_ORIGIN+'/me',{headers:{Authorization:'Bearer '+login.accessToken,Origin:QA_ORIGIN},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!me.ok)throw new Error('Sesión QA no verificada');
 const principal=await me.json();if(principal.empresaId!==empresaId||principal.rol!=='gerencia'||!principal.permissions?.includes('admin:gestionar'))throw new Error('Permisos gerencia QA no verificados');
 const catalog=await request(QA_ORIGIN+'/admin/catalog',{headers:{Authorization:'Bearer '+login.accessToken,Origin:QA_ORIGIN},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!catalog.ok)throw new Error('API administrativa persistente QA no verificada');
 const logout=await request(QA_ORIGIN+'/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+login.accessToken,Origin:QA_ORIGIN},signal:AbortSignal.timeout(20000)});
 if(!logout.ok)throw new Error('Revocación de sesión QA no verificada');
 await run(variableCommand('MAYORISTA_BOOTSTRAP_PASSWORD'),'');
 await run(variableCommand('MAYORISTA_BOOTSTRAP_INSTALL_ONCE'),'false');
 onStep('QA ONLINE y login/PWA comprobados; aceptación Android e integral aún pendiente');
 return {online:true,origin:QA_ORIGIN,empresaId,userId,caFingerprint:ca.fingerprint,physicalAndroid:false,verifiedAt:new Date(now()).toISOString()};
}
async function main(){
 if(!process.argv.includes('--budget-confirmed'))throw new Error('Usar --budget-confirmed únicamente tras verificar que QA queda dentro de US$15/mes');
 const dir=await mkdtemp(path.join(tmpdir(),'mayorista-qa-cli-')),credentialsDir=await mkdtemp(path.join(tmpdir(),'mayorista-qa-login-'));
 const credentialFile=path.join(credentialsDir,'credenciales-qa.json');
 const run=async(args,input)=>{try{return execFileSync(process.platform==='win32'?'railway.cmd':'railway',args,{cwd:dir,env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.3.5',RAILWAY_AGENT_SESSION:'mayorista-qa-cli-'+process.pid},input,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,shell:process.platform==='win32'});}catch(error){
  const text=String(error.stdout??'')+String(error.stderr??'');
  if(args[0]==='whoami'&&/NOT_AUTHENTICATED|not signed in|not authenticated|unauthorized/i.test(text)){
   console.log('Railway necesita iniciar sesión. Completá OAuth en tu navegador; no compartas claves por chat.');
   execFileSync(process.platform==='win32'?'railway.cmd':'railway',['login'],{cwd:dir,env:process.env,stdio:'inherit',timeout:600000,shell:process.platform==='win32'});
   return execFileSync(process.platform==='win32'?'railway.cmd':'railway',args,{cwd:dir,env:process.env,encoding:'utf8',timeout:30000,shell:process.platform==='win32'});
  }
  throw new Error('Railway CLI falló en '+args[0]+'. No se imprimen salidas que puedan contener secretos.');
 }};
 try{
  const result=await provisionQA({run,budgetConfirmed:true,onStep:s=>console.log(s),persistCredentials:async credentials=>{await writeFile(credentialFile,JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});console.log('Credenciales QA guardadas SOLO en archivo privado local: '+credentialFile);}});
  console.log(JSON.stringify(result,null,2));
 }finally{await rm(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
