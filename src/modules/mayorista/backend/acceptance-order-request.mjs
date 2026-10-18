import assert from 'node:assert/strict';

// El diario es la fuente del pedido al reanudar; el catálogo puede cambiar de orden.
// Nunca reemplaza el cuerpo persistido ni cambia su UUID para eludir un conflicto.
export function restoreAcceptanceOrder(proposed,saved,catalog){
 if(saved)assert.equal(saved.path,'/orders','Ruta del pedido persistido divergente');
 const body=structuredClone(saved?.body??proposed.body);
 for(const key of ['pedidoId','empresaId','vendedorId'])assert.equal(body[key],proposed.body[key],'Ámbito del pedido persistido divergente: '+key);
 const customer=catalog.clientes.find(c=>c.id===body.clienteId&&c.vendedorId===body.vendedorId);
 assert.ok(customer,'Cliente persistido ya no está asignado al vendedor; requiere revisión');
 const subPrice=catalog.precios.find(p=>p.productoId===proposed.substitute&&p.listaId===customer.listaId);
 assert.ok(subPrice,'Cotización del sustituto no disponible para el cliente persistido');
 return {...proposed,body,customer,subPrice};
}
