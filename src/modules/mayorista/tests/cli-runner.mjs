import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveRailwayLauncher,safeCLIError,createRailwayRunner} from '../railway/cli-runner.mjs';
import {readPublicBundle,verifiedPublicBundle} from '../railway/provision-qa-cli.mjs';
test('Windows npx encuentra launcher oficial incluso con espacios',()=>{
 const launcher=resolveRailwayLauncher({platform:'win32',node:'C:\\Program Files\\nodejs\\node.exe',execute:(file,args,options)=>{assert.equal(file,'where.exe');assert.deepEqual(args,['railway.cmd']);assert.equal(options.shell,false);return 'C:\\Users\\QA User\\npm\\_npx\\test\\node_modules\\.bin\\railway.cmd\r\n';},exists:p=>p==='C:\\Users\\QA User\\npm\\_npx\\test\\node_modules\\@railway\\cli\\bin\\railway.js'});
 assert.equal(launcher.file,'C:\\Program Files\\nodejs\\node.exe');assert.equal(launcher.prefix.length,1);
});
test('Windows npm global encuentra launcher; shim desconocido no se ejecuta',()=>{
 const execute=()=> 'C:\\QA User\\npm\\railway.cmd\r\n';
 const l=resolveRailwayLauncher({platform:'win32',execute,exists:p=>p==='C:\\QA User\\npm\\node_modules\\@railway\\cli\\bin\\railway.js'});assert.ok(l.prefix[0].endsWith('railway.js'));
 assert.throws(()=>resolveRailwayLauncher({platform:'win32',execute,exists:()=>false}),/LAUNCHER_NOT_FOUND/);
 assert.throws(()=>resolveRailwayLauncher({platform:'win32',execute:()=>{throw new Error('ENOENT');}}),/CLI_NOT_FOUND/);
});
test('argv conserva espacios, metacaracteres y secretos solo por stdin sin shell',async()=>{
 const args=['ssh','--','cat','/cert with spaces/root.crt'];const secret='secret\n$(never) & dangerous';
 const run=createRailwayRunner({launcher:{file:'node',prefix:['C:\\QA User\\railway.js']},cwd:'/tmp',execute:(file,actual,options)=>{assert.equal(file,'node');assert.deepEqual(actual,['C:\\QA User\\railway.js',...args]);assert.equal(options.shell,false);assert.equal(options.input,secret);assert.ok(!actual.includes(secret));return 'ok';}});
 assert.equal(await run(args,secret),'ok');
});
test('diagnósticos SSH clasifican fallos sin revelar stdout, stderr ni secretos',()=>{
 for(const [evidence,code] of [['Host key verification failed','SSH_HOST_KEY_NOT_VERIFIED'],['Permission denied (publickey)','SSH_PERMISSION_DENIED'],['Failed to execute ssh command: ENOENT','SSH_OPENSSH_UNAVAILABLE'],['connection timed out','SSH_CONNECTIVITY'],['cat: root.crt: No such file','SSH_CERTIFICATE_UNAVAILABLE'],['unknown','SSH_FAILED']]){
  const error=safeCLIError('ssh',{stderr:evidence+' PRIVATE-password-token'});assert.ok(error.message.startsWith(code+':'));assert.ok(!error.message.includes('PRIVATE-password-token'));
 }
 assert.match(safeCLIError('whoami',{stderr:'NOT_AUTHENTICATED'}).message,/CLI_NOT_AUTHENTICATED/);
});
test('runner sanitiza error de ejecución; Linux no usa shim',async()=>{
 assert.deepEqual(resolveRailwayLauncher({platform:'linux'}),{file:'railway',prefix:[]});
 const run=createRailwayRunner({launcher:{file:'railway',prefix:[]},execute:()=>{throw {stderr:'secret',code:'ETIMEDOUT'};}});
 await assert.rejects(run(['variable','set']),e=>e.message.startsWith('CLI_TIMEOUT:')&&!e.message.includes('secret'));
});
test('bundle QA público real valida cadena, hostname y scope sin red ni claves privadas',async()=>{
 const bundle=await readPublicBundle();const ca=verifiedPublicBundle(bundle);assert.equal(ca.fingerprint,bundle.fingerprint);
 for(const name of ['projectId','environmentId','databaseServiceId'])assert.throws(()=>verifiedPublicBundle({...bundle,[name]:'foreign'}),/ajeno/);
 assert.throws(()=>verifiedPublicBundle({...bundle,fingerprint:'wrong'}),/Huella/);
 assert.throws(()=>verifiedPublicBundle(bundle,Date.parse('2035-01-01')),/vigencia/);
 assert.ok(!JSON.stringify(bundle).includes('PRIVATE KEY'));
});
