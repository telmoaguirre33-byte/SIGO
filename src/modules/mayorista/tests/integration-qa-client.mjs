import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMayoristaClient} from '../demo/dist/sync/http-client.mjs';
const empresaId=randomUUID(),userId=randomUUID(),requests=[];
const fetchImpl=async(url,input)=>{requests.push({url,input});return new Response(JSON.stringify(url.endsWith('/auth/sigo')?{accessToken:'unit-only-token',expiresAt:Date.now()+60000}:{empresaId,userId,rol:'gerencia'}),{status:200,headers:{'Content-Type':'application/json'}});};
for(const baseUrl of ['https://backend.example.com','https://backend.example.com/integracion-qa']){
 requests.length=0;const c=createMayoristaClient({enabled:true,baseUrl,fetchImpl});await c.loginSigo(empresaId,'unit-sigo-token');await c.catalog();await c.logout();assert.deepEqual(requests.map(r=>r.url),['/auth/sigo','/me','/catalog','/auth/logout'].map(p=>baseUrl+p));assert.ok(requests.every(r=>!r.url.includes('unit-sigo-token')&&r.input.credentials==='omit'));
}
for(const baseUrl of ['http://backend.example.com/integracion-qa','https://backend.example.com/integracion-qa/','https://backend.example.com/other','https://backend.example.com/integracion-qa?token=x','https://user:pass@backend.example.com/integracion-qa','https://backend.example.com/integracion-qa#x']){
 const c=createMayoristaClient({enabled:true,baseUrl,fetchImpl});await assert.rejects(()=>c.catalog(),/HTTPS/);
}
console.log('PASS transporte: raíz conservada, prefijo QA exacto, rechazo de credenciales/query/fragmentos y rutas arbitrarias. Transporte de este test es un doble, no la aceptación publicada.');

import {operationalPage,encryptedDatabase} from '../security/operational-context.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
for(const prefix of ['', '/integracion-qa']){
 const base='https://backend.example.com'+prefix;
 for(const page of ['secure.html','portal.html']){
  assert.deepEqual(operationalPage({enabled:true,approvedOrigin:base},base+'/'+page),{enabled:true,baseUrl:base});
  assert.equal(operationalPage({enabled:true,approvedOrigin:base},'http://backend.example.com'+prefix+'/'+page).enabled,false);
  assert.equal(operationalPage({enabled:false,approvedOrigin:base},base+'/'+page).enabled,false);
 }
}
assert.equal(operationalPage({enabled:true,approvedOrigin:'https://backend.example.com'},'https://backend.example.com/integracion-qa/secure.html').enabled,false);
assert.equal(operationalPage({enabled:true,approvedOrigin:'https://backend.example.com/integracion-qa'},'https://backend.example.com/secure.html').enabled,false);
assert.equal(encryptedDatabase('https://backend.example.com/security/encrypted-workspace.mjs'),'sigo-mayorista-secure-v1');
assert.equal(encryptedDatabase('https://backend.example.com/integracion-qa/security/encrypted-workspace.mjs'),'sigo-mayorista-integration-qa-secure-v1');
const sw=await readFile(new URL('../demo/dist/operational-sw.js',import.meta.url),'utf8');
for(const prefix of ['', '/integracion-qa']){
 const listeners={},deleted=[],names=['sigo-mayorista-operational-v9','sigo-mayorista-operational-v10','sigo-mayorista-integracion-qa-v0','sigo-mayorista-integracion-qa-v1','unrelated'];
 const self={registration:{scope:'https://backend.example.com'+prefix+'/'},clients:{claim:async()=>{}},addEventListener:(event,fn)=>{listeners[event]=fn}};
 vm.runInNewContext(sw,{self,URL,caches:{keys:async()=>names,delete:async key=>deleted.push(key)}});
 let completion;listeners.activate({waitUntil:p=>completion=p});await completion;
 assert.deepEqual(deleted,prefix?['sigo-mayorista-integracion-qa-v0']:['sigo-mayorista-operational-v9']);
}
console.log('PASS rutas de vendedor/portal y limpieza de caché separadas por instalación. P0 conserva su namespace cifrado.');
