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
