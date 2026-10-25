import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {operationalAsset} from '../backend/static-assets.mjs';
import {createSigoReadOnlyVerifier} from '../security/qa-sigo-link.mjs';
import {createMayoristaClient} from '../demo/dist/sync/http-client.mjs';
const E=randomUUID(),U=randomUUID(),me={empresaId:E,userId:U,rol:'administracion'},json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function transport(handler){let issued=0;return async(url,input)=>{const path=new URL(url).pathname;if(path==='/auth/sigo'){issued++;return json({accessToken:'qa-'+issued,expiresAt:Date.now()+3600000});}if(path==='/me')return json(me);return handler(path,input,issued);};}
test('portal.html y todos sus recursos se sirven con raíz terminada en barra y CSP real',async()=>{
 const root=fileURLToPath(new URL('../demo/dist/',import.meta.url));
 const portal=await operationalAsset(root,'/portal.html','https://qa.invalid'),body=portal.content.toString(),script=body.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];assert.ok(portal.assetHeaders['Content-Security-Policy'].includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
 const sw=await readFile(new URL('../demo/dist/operational-sw.js',import.meta.url),'utf8');for(const [,file] of sw.matchAll(/'\.\/([^']+)'/g)){const r=await operationalAsset(root,'/'+file,'https://qa.invalid');assert.ok(r.content.length,file);}
 await assert.rejects(operationalAsset(root,'/../../secret','https://qa.invalid'),/fuera del paquete/);
});
test('revalidación remota reintenta solo lecturas transitorias y comprueba las tres fuentes',async()=>{
 const paths=[];let transient=true;const verify=createSigoReadOnlyVerifier({origin:'https://auth.qa.invalid',anonKey:'public-fixture',fetcher:async(url,input)=>{paths.push(new URL(url).pathname);if(transient){transient=false;throw new DOMException('fixture','TimeoutError');}return json(url.endsWith('/user')?{id:U,email:'qa@example.invalid'}:url.endsWith('mis_empresas_sigo')?[{empresa_id:E,rol:'admin'}]:[{clave:'mayorista_distribuidora',habilitado:true}]);}});
 assert.equal((await verify('only-in-memory',E)).user.id,U);assert.equal(paths.length,4);assert.ok(paths.every(p=>['/auth/v1/user','/rest/v1/rpc/mis_empresas_sigo','/rest/v1/rpc/listar_modulos_empresa_sigo'].includes(p)));
});
test('denegación remota no se reintenta ni se confunde con caída; caída sigue siendo 503',async()=>{
 for(const status of [401,403,503]){let calls=0;const verify=createSigoReadOnlyVerifier({origin:'https://auth.qa.invalid',anonKey:'public-fixture',fetcher:async()=>{calls++;return json({},status);}});await assert.rejects(verify('token',E),e=>e.status===status);assert.equal(calls,status===503?2:1);}
});
test('401 concurrentes renuevan desde SIGO una sola vez y conservan identidad',async()=>{
 let roots=0;const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.invalid/',expectedEmpresaId:E,getSigoToken:async()=>{roots++;await new Promise(r=>setTimeout(r,10));return 'sigo-memory';},fetchImpl:transport(async(path,input)=>input.headers.Authorization==='Bearer qa-1'?json({},401):json([]))});
 await client.loginSigo(E,'first-root');await Promise.all([client.orders(),client.catalog(),client.accounts()]);assert.equal(roots,1);assert.deepEqual(client.identity(),me);
});
test('403 de una función conserva sesión y no intenta elevar permisos',async()=>{
 let roots=0;const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.invalid/',expectedEmpresaId:E,getSigoToken:async()=>{roots++;return 'sigo';},fetchImpl:transport(async path=>json([],path==='/admin/users/candidates'?403:200))});await client.loginSigo(E,'sigo');await assert.rejects(client.sharedUserCandidates(),e=>e.status===403);assert.deepEqual(client.identity(),me);assert.deepEqual(await client.orders(),[]);assert.equal(roots,0);
});
test('503 y desconexión conservan identidad; nunca repiten escrituras automáticamente',async()=>{
 let mode='503',writes=0;const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.invalid/',fetchImpl:transport(async(path,input)=>{if(input.method==='POST')writes++;if(mode==='offline')throw TypeError('offline');return json([],mode==='503'?503:200);})});await client.loginSigo(E,'sigo');await assert.rejects(client.adminCommand({id:randomUUID()}),e=>e.status===503);assert.equal(writes,1);mode='offline';await assert.rejects(client.orders(),e=>e.status===0);assert.deepEqual(client.identity(),me);mode='online';assert.deepEqual(await client.orders(),[]);
});
test('logout durante renovación pendiente no resucita sesión ni inicia otro login',async()=>{
 let release;const waiting=new Promise(r=>release=r);let logins=0;const fetcher=transport(async(path)=>json({},path==='/auth/logout'?200:401));const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.invalid/',expectedEmpresaId:E,getSigoToken:()=>waiting,fetchImpl:async(url,input)=>{if(url.endsWith('/auth/sigo'))logins++;return fetcher(url,input);}});await client.loginSigo(E,'sigo');const read=client.orders();await new Promise(r=>setTimeout(r,5));await client.logout();release('new-root');await assert.rejects(read,/cancelado/);assert.equal(client.identity(),null);assert.equal(logins,1);
});
test('renovación jamás cambia silenciosamente de usuario o empresa',async()=>{
 let count=0;const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.invalid/',expectedEmpresaId:E,getSigoToken:async()=>'sigo',fetchImpl:async(url)=>url.endsWith('/auth/sigo')?json({accessToken:'qa-'+(++count),expiresAt:Date.now()+3600000}):url.endsWith('/me')?json({...me,userId:count>1?randomUUID():U}):json({},url.endsWith('/auth/logout')?200:401)});await client.loginSigo(E,'sigo');await assert.rejects(client.orders(),e=>e.status===403);assert.equal(client.identity(),null);
});
