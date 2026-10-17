import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreAcceptanceOrder} from '../backend/acceptance-order-request.mjs';

const original={pedidoId:'order',empresaId:'qa',vendedorId:'seller',clienteId:'original',lineas:[{productoId:'p',cantidad:2,precioUnitario:10}]};
const saved={path:'/orders',body:original};
const catalog={clientes:[{id:'new-first',vendedorId:'seller',listaId:'new-list'},{id:'original',vendedorId:'seller',listaId:'original-list'}],precios:[{id:'wrong-price',productoId:'q',listaId:'new-list'},{id:'right-price',productoId:'q',listaId:'original-list'}]};
const proposed={substitute:'q',body:{...original,clienteId:'new-first',lineas:[{productoId:'p',cantidad:2,precioUnitario:11}]}};

test('Reanudación conserva cliente/precio/cuerpo originales aunque cambie el catálogo',()=>{
 const resumed=restoreAcceptanceOrder(proposed,saved,catalog);
 assert.deepEqual(resumed.body,original);assert.notEqual(resumed.body,original);
 assert.equal(resumed.customer.id,'original');assert.equal(resumed.subPrice.id,'right-price');
 assert.equal(saved.body.clienteId,'original');assert.equal(proposed.body.clienteId,'new-first');
});
test('Primera ejecución usa el pedido propuesto',()=>{
 assert.deepEqual(restoreAcceptanceOrder(proposed,undefined,catalog).body,proposed.body);
});
test('Reanudación rechaza corrupción del diario o asignación revocada sin emitir otro pedido',()=>{
 for(const key of ['pedidoId','empresaId','vendedorId'])assert.throws(()=>restoreAcceptanceOrder(proposed,{...saved,body:{...original,[key]:'other'}},catalog),/divergente/);
 assert.throws(()=>restoreAcceptanceOrder(proposed,{...saved,path:'/another'},catalog),/divergente/);
 assert.throws(()=>restoreAcceptanceOrder(proposed,saved,{...catalog,clientes:catalog.clientes.slice(0,1)}),/asignado/);
});
