import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestProjectAuth} from '../api/test-project-auth.mjs';
import {createOrderHttpHandler} from '../api/http-handler.mjs';
const userId=crypto.randomUUID(),empresaId=crypto.randomUUID(),vendedorId=crypto.randomUUID();
const claims={sub:userId,session_id:crypto.randomUUID(),aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
const token='fake-header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fake-signature';
const opts={enabled:true,projectUrl:'https://test-only.supabase.co',approvedTestProjectRef:'test-only',publishableKey:'sb_publishable_fake_test',empresaId,lookupMembership:async()=>({userId,empresaId,vendedorId,activo:true,rol:'vendedor'}),isSessionActive:async()=>true,fetchImpl:async()=>new Response(JSON.stringify({id:userId,is_anonymous:false}),{status:200})};
test('auth de prueba deniega sin habilitación y sin tocar red',async()=>assert.rejects(createTestProjectAuth().verify(token),e=>e.status===503));
test('auth solo permite el proyecto de prueba aprobado y clave pública',async()=>{for(const change of [{projectUrl:'https://otro.supabase.co'},{publishableKey:'sb_secret_fake'}])await assert.rejects(createTestProjectAuth({...opts,...change}).verify(token),e=>e.status===503);});
test('auth consulta usuario validado, sesión y pertenencia vigente',async()=>{const p=await createTestProjectAuth(opts).verify(token);assert.equal(p.empresaId,empresaId);assert.equal(p.vendedorId,vendedorId);await assert.rejects(createTestProjectAuth({...opts,isSessionActive:async()=>false}).verify(token),e=>e.status===401);await assert.rejects(createTestProjectAuth({...opts,lookupMembership:async()=>({userId,empresaId:'otra',activo:true})}).verify(token),e=>e.status===403);});
test('metadata editable no concede permisos',async()=>{await assert.rejects(createTestProjectAuth({...opts,fetchImpl:async()=>new Response(JSON.stringify({id:userId,user_metadata:{role:'admin'}})),lookupMembership:async()=>null}).verify(token),e=>e.status===403);});
const origin='https://vendedor.example.test';
function req(body='{}',overrides={}){return new Request('https://api.example.test/orders',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer fake',...overrides.headers},body,...overrides});}
test('HTTP permanece desactivado por defecto',async()=>assert.equal((await createOrderHttpHandler()(req())).status,503));
test('HTTP valida método, origen, sesión y rate limit',async()=>{const h=createOrderHttpHandler({enabled:true,allowedOrigin:origin,receive:async()=>({}),rateLimit:async()=>true});assert.equal((await h(new Request('https://api.example.test/orders',{headers:{Origin:origin}}))).status,405);assert.equal((await h(req('{}',{headers:{Origin:'https://otro.test'}}))).status,403);assert.equal((await h(req('{}',{headers:{Origin:origin,'Content-Type':'application/json'}}))).status,401);const blocked=createOrderHttpHandler({enabled:true,allowedOrigin:origin,receive:async()=>({}),rateLimit:async()=>false});assert.equal((await blocked(req())).status,429);});
test('HTTP limita cuerpo y rechaza JSON inválido',async()=>{const h=createOrderHttpHandler({enabled:true,allowedOrigin:origin,receive:async()=>({}),rateLimit:async()=>true});assert.equal((await h(req('{'))).status,422);assert.equal((await h(req('x'.repeat(262145)))).status,413);});
test('HTTP retorna acuse sin filtrar errores internos',async()=>{const receipt={pedidoId:crypto.randomUUID()};const h=createOrderHttpHandler({enabled:true,allowedOrigin:origin,receive:async()=>receipt,rateLimit:async()=>true});const r=await h(req());assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(await r.json(),receipt);const bad=createOrderHttpHandler({enabled:true,allowedOrigin:origin,receive:async()=>{throw new Error('DSN-secreto')},rateLimit:async()=>true});assert.ok(!(await (await bad(req())).text()).includes('DSN'));});

const {createMayoristaClient}=await import('../demo/dist/sync/http-client.mjs');
test('Logout durante login pendiente no recupera token ni identidad',async()=>{
 let release;const response=new Promise(r=>release=r);let requests=0;const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.example.test/',fetchImpl:async()=>{requests++;return response;}});
 const signing=client.login({empresaId});await client.logout();release(new Response(JSON.stringify({accessToken:'qa-test-token',expiresAt:Date.now()+100000})));await assert.rejects(signing,/cancelado/);assert.equal(client.identity(),null);assert.equal(requests,1);
});
test('Logout borra inmediatamente sesión aunque revocación remota siga pendiente',async()=>{
 let revoke;const blocked=new Promise(r=>revoke=r);const client=createMayoristaClient({enabled:true,baseUrl:'https://qa.example.test/',fetchImpl:async url=>url.endsWith('/auth/login')?new Response(JSON.stringify({accessToken:'qa-token',expiresAt:Date.now()+100000})):url.endsWith('/me')?new Response(JSON.stringify({empresaId,vendedorId,userId})):blocked});
 await client.login({empresaId});const signingOut=client.logout();assert.equal(client.identity(),null);await assert.rejects(()=>client.send({empresaId,vendedorId}),/Iniciá sesión/);revoke(new Response('{}'));await signingOut;assert.equal(client.identity(),null);
});
