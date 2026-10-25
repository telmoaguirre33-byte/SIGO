import {test} from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {createSharedCommerce} from '../integration/shared-commerce.mjs';
const E=randomUUID(),P=randomUUID(),C=randomUUID(),O=randomUUID(),eventId=randomUUID(),sale=randomUUID();
const load={pedidos:{[O]:{clienteId:C,entrega:{fecha:new Date().toISOString()},lineas:[{productoId:P,cantidad:6,precioUnitario:10}]}},historial:[{id:eventId,tipo:'entregar',input:{pedidoId:O,lineas:[{productoId:P,entregado:2,devuelto:4}]}}]};
test('QA no escribe en stock ni cuentas SIGO por tener un enlace visual',async()=>{let calls=0;const bridge=createSharedCommerce({empresaId:E,sourceMode:'qa',rpc:async()=>{calls++;}});await assert.rejects(()=>bridge.delivery(load,O,'efectivo'));assert.equal(calls,0);});
test('entrega parcial envía unidades realmente entregadas y conserva UUID después de perder acuse',async()=>{
 const calls=[],bridge=createSharedCommerce({empresaId:E,sourceMode:'sigo',rpc:async(name,args)=>{calls.push({name,args});if(calls.length===1)throw Error('Acuse perdido');return {estado:'confirmado',empresaId:E,comandoId:eventId,ventaId:sale};}});
 await assert.rejects(()=>bridge.delivery(load,O,'cuenta_corriente'));await bridge.delivery(load,O,'cuenta_corriente');
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].args.p_comando_id,eventId);assert.equal(calls[1].args.p_datos.lineas[0].cantidad,2);
});
test('entrega rechazada no genera venta y un acuse ajeno no se acepta',async()=>{
 const refused=structuredClone(load);refused.historial[0].input.lineas[0].entregado=0;
 const bridge=createSharedCommerce({empresaId:E,sourceMode:'sigo',rpc:async()=>({estado:'confirmado',comandoId:eventId,empresaId:randomUUID(),ventaId:sale})});
 await assert.rejects(()=>bridge.delivery(refused,O,'efectivo'));await assert.rejects(()=>bridge.delivery(load,O,'efectivo'));
});
test('cobranza usa el UUID recibido, monto en centavos y RPC de cuenta SIGO',async()=>{
 const id=randomUUID(),mov=randomUUID();let payload;
 const bridge=createSharedCommerce({empresaId:E,sourceMode:'sigo',rpc:async(name,args)=>{payload={name,args};return {estado:'confirmado',empresaId:E,comandoId:id,movimientoId:mov};}});
 await bridge.collection({id,clienteId:C,pedidoId:O,centavos:500,medio:'transferencia',comprobante:'Recibo'});
 assert.equal(payload.args.p_centavos,500);assert.equal(payload.args.p_comando_id,id);assert.equal(payload.name,'registrar_cobro_mayorista_sigo');
});
