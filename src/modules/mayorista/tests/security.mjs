import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionMayorista} from '../security/session.mjs';
import {sealLocal,openLocal} from '../security/vault.mjs';
import {createOrderReceiver} from '../api/receive-order.mjs';

const principal={userId:crypto.randomUUID(),sessionId:crypto.randomUUID(),empresaId:crypto.randomUUID(),vendedorId:crypto.randomUUID(),expiresAt:Date.now()+3600000,permissions:['pedidos:crear']};
const order={pedidoId:crypto.randomUUID(),empresaId:principal.empresaId,vendedorId:principal.vendedorId,clienteId:crypto.randomUUID(),creadoEn:new Date().toISOString(),lineas:[{productoId:crypto.randomUUID(),cantidad:12,precioUnitario:1000}]};
const provider=p=>({signIn:async()=>({}),validateSession:async()=>p,signOut:async()=>{}});
test('sesión deniega acceso sin proveedor',async()=>assert.rejects(new SessionMayorista().login({})));
test('sesión verifica identidad y entrega copia',async()=>{const s=new SessionMayorista(provider(principal));const p=await s.login({});p.empresaId='otra';assert.equal(s.principal().empresaId,principal.empresaId);});
test('sesión limita empresa y permiso',async()=>{const s=new SessionMayorista(provider(principal));await s.login({});assert.throws(()=>s.authorize('pedidos:crear','otra'));assert.throws(()=>s.authorize('admin:gestionar',principal.empresaId));});
test('sesión expirada bloquea el dispositivo',async()=>{let now=Date.now();const s=new SessionMayorista(provider({...principal,expiresAt:now+100}),()=>now);await s.login({});now+=200;assert.throws(()=>s.principal());});
test('usuario anónimo o revocado no accede',async()=>{for(const flag of ['anonymous','revoked'])await assert.rejects(new SessionMayorista(provider({...principal,[flag]:true})).login({}));});
test('logout local cierra incluso si falla revocación remota',async()=>{const s=new SessionMayorista({...provider(principal),signOut:async()=>{throw new Error('red')}});await s.login({});await assert.rejects(s.logout());assert.throws(()=>s.principal());});
test('logout impide finalizar un login concurrente',async()=>{let release;const s=new SessionMayorista({...provider(principal),validateSession:()=>new Promise(r=>release=r)});const promise=s.login({});await new Promise(r=>setTimeout(r,0));await s.logout();release(principal);await assert.rejects(promise);assert.throws(()=>s.principal());});
test('cifrado recupera datos y no expone texto ni claves',async()=>{const envelope=await sealLocal(principal,{cliente:'Información privada'},'Clave-local-larga-2026');assert.ok(!JSON.stringify(envelope).includes('Información privada'));assert.deepEqual(await openLocal(principal,envelope,'Clave-local-larga-2026'),{cliente:'Información privada'});});
test('cifrado rechaza contraseña, empresa o contenido alterados',async()=>{const envelope=await sealLocal(principal,{pedido:1},'Clave-local-larga-2026');await assert.rejects(openLocal(principal,envelope,'Otra-clave-local-2026'));await assert.rejects(openLocal({...principal,empresaId:'otra'},envelope,'Clave-local-larga-2026'));const tampered=structuredClone(envelope);tampered.ciphertext[0]^=1;await assert.rejects(openLocal(principal,tampered,'Clave-local-larga-2026'));});
test('cifrado exige contraseña fuerte mínima',async()=>assert.rejects(sealLocal(principal,{},'1234')));

function fixture(p=principal,issues=[]) {
  const rows=new Map();let validations=0;
  const tx={find:async(e,id)=>rows.get(JSON.stringify([e,id])),validateReferences:async()=>{validations++;return issues;},insertOnce:async row=>{const key=JSON.stringify([row.empresaId,row.pedidoId]);if(!rows.has(key))rows.set(key,structuredClone(row));return rows.get(key);}};
  const receiver=createOrderReceiver({enabled:true,auth:{verify:async()=>p},repository:{withPrincipal:async(identity,fn)=>fn(tx)}});
  return {receiver,rows,get validations(){return validations;}};
}
test('API desactivada por defecto',async()=>assert.rejects(createOrderReceiver()({body:order}),e=>e.status===503));
test('API rechaza sesión vencida o anónima',async()=>{for(const p of [{...principal,expiresAt:0},{...principal,anonymous:true}])await assert.rejects(fixture(p).receiver({body:order}),e=>e.status===401);});
test('API rechaza falsificación de empresa o vendedor',async()=>{for(const field of ['empresaId','vendedorId'])await assert.rejects(fixture().receiver({body:{...order,[field]:crypto.randomUUID()}}),e=>e.status===403);});
test('API rechaza cantidades fraccionarias y UUID inválidos',async()=>{const f=fixture();await assert.rejects(f.receiver({body:{...order,pedidoId:'inventado'}}),e=>e.status===422);await assert.rejects(f.receiver({body:{...order,lineas:[{...order.lineas[0],cantidad:1.5}]}}),e=>e.status===422);assert.equal(f.rows.size,0);});
test('API verifica referencias y conserva conflicto sin inserción',async()=>{const f=fixture(principal,['precio cambió']);await assert.rejects(f.receiver({body:order}),e=>e.status===409);assert.equal(f.rows.size,0);});
test('API devuelve el mismo acuse después de caída posterior a recepción',async()=>{const f=fixture();const receipt=await f.receiver({body:order});const retry=await f.receiver({body:structuredClone(order)});assert.deepEqual(retry,receipt);assert.equal(f.rows.size,1);assert.equal(f.validations,1);});
test('API concurrente mantiene una sola recepción en repositorio de prueba',async()=>{const f=fixture();const receipts=await Promise.all(Array.from({length:20},()=>f.receiver({body:order})));assert.equal(f.rows.size,1);assert.ok(receipts.every(r=>r.recibidoEn===receipts[0].recibidoEn));});
test('UUID reutilizado con contenido diferente exige revisión',async()=>{const f=fixture();await f.receiver({body:order});await assert.rejects(f.receiver({body:{...order,lineas:[{...order.lineas[0],cantidad:13}]}}),e=>e.status===409);assert.equal(f.rows.size,1);});
