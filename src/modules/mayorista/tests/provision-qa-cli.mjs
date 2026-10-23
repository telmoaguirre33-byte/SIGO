import {test} from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {verifiedPublicCA,variableCommand,provisionQA,API_SERVICE,QA_ORIGIN} from '../railway/provision-qa-cli.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'qa-cert-chain-'));
let publicChain;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(dir,'root.key'),'-out',path.join(dir,'root.crt'),'-subj','/CN=QA-test-root'],{stdio:'ignore'});
 execFileSync('openssl',['req','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'server.key'),'-out',path.join(dir,'server.csr'),'-subj','/CN=postgres.railway.internal','-addext','subjectAltName=DNS:postgres.railway.internal'],{stdio:'ignore'});
 execFileSync('openssl',['x509','-req','-in',path.join(dir,'server.csr'),'-CA',path.join(dir,'root.crt'),'-CAkey',path.join(dir,'root.key'),'-CAcreateserial','-days','1','-copy_extensions','copy','-out',path.join(dir,'server.crt')],{stdio:'ignore'});
 publicChain=(await readFile(path.join(dir,'root.crt'),'utf8'))+(await readFile(path.join(dir,'server.crt'),'utf8'));
}finally{await rm(dir,{recursive:true,force:true});}
test('certificados públicos verifican cadena, hostname y vigencia; rechazan material incompleto o vencido',()=>{
 const r=verifiedPublicCA(publicChain);assert.match(r.pem,/BEGIN CERTIFICATE/);assert.match(r.fingerprint,/^[0-9A-F:]+$/);assert.throws(()=>verifiedPublicCA('untrusted'));assert.throws(()=>verifiedPublicCA(publicChain,Date.now()+3*86400000));
});
test('sin presupuesto confirmado el puente no llama Railway ni cambia configuración',async()=>{
 let called=false;await assert.rejects(provisionQA({run:async()=>{called=true;}}),/presupuesto/);assert.equal(called,false);
});
test('variables usan stdin y siempre apuntan al servicio y entorno QA',()=>{
 const args=variableCommand('MAYORISTA_AUTH_PRIVATE_KEY');assert.ok(args.includes('--stdin'));assert.ok(args.includes('--skip-deploys'));assert.ok(args.includes(API_SERVICE));assert.ok(args.includes(QA_RAILWAY.environmentId));assert.throws(()=>variableCommand('KEY=secret'));assert.ok(!args.some(a=>a.includes('PRIVATE KEY-----')));
});
test('puente rechaza bootstrap existente antes de obtener certificados o reemplazar usuarios',async()=>{
 const calls=[];const run=async args=>{calls.push(args);return args[0]==='variable'?'{"MAYORISTA_BOOTSTRAP_COMPANY_ID":"existing"}':'{}';};
 await assert.rejects(provisionQA({run,budgetConfirmed:true}),/ya configurado/);assert.equal(calls.some(a=>a[0]==='ssh'||a[1]==='set'),false);
});
test('puente guarda secretos fuera de argv y comprueba login, rol, catálogo y revocación',async()=>{
 const calls=[],steps=[],values={},credentials=[];
 const run=async(args,input)=>{calls.push({args,input});if(args[0]==='ssh')return publicChain;if(args[0]==='variable'&&args[1]==='list')return '{}';if(args[0]==='variable'&&args[1]==='set'){values[args[2]]=input;return '{}';}if(args[0]==='deployment')return JSON.stringify([{id:'deployment-qa-fixture',status:'SUCCESS',createdAt:new Date().toISOString(),meta:{}}]);return '{}';};
 const requested=[];
 const request=async(url,options={})=>{
  requested.push({url,options});
  if(url.endsWith('/health'))return Response.json({status:'ok',module:'mayorista'});
  if(url.endsWith('/secure.webmanifest'))return Response.json({name:'SIGO Vendedor',start_url:'./secure.html',display:'standalone',icons:[192,512].flatMap(s=>['any','maskable'].map(p=>({sizes:s+'x'+s,purpose:p,src:'./icon-'+s+'-'+p+'.png'})))});
  if(url.includes('.png')){const size=url.includes('192')?192:512,b=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(size,16);b.writeUInt32BE(size,20);return new Response(b);}
  if(url.endsWith('/auth/login')){const data=JSON.parse(options.body);assert.equal(data.password,credentials[0].password);return Response.json({accessToken:'signed-fixture-token'});}
  if(url.endsWith('/me'))return Response.json({empresaId:credentials[0].empresaId,rol:'gerencia',permissions:['admin:gestionar']});
  if(url.endsWith('/admin/catalog')||url.endsWith('/auth/logout'))return Response.json({});
  throw new Error('Ruta inesperada');
 };
 const result=await provisionQA({run,request,budgetConfirmed:true,onStep:s=>steps.push(s),persistCredentials:async c=>credentials.push(c)});
 assert.equal(result.online,true);assert.equal(result.origin,QA_ORIGIN);assert.equal(result.physicalAndroid,false);assert.equal(values.MAYORISTA_BOOTSTRAP_PASSWORD,'');assert.equal(values.MAYORISTA_BOOTSTRAP_INSTALL_ONCE,'false');
 assert.ok(!JSON.stringify(calls.map(c=>c.args)).includes(credentials[0].password));assert.ok(!JSON.stringify(steps).includes(credentials[0].password));
 assert.equal(requested.filter(r=>r.url.endsWith('/auth/logout')).length,1);
 assert.ok(calls.some(c=>c.args[0]==='link'&&c.args.includes(QA_RAILWAY.projectId)));
});
