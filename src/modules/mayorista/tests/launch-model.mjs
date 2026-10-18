import assert from 'node:assert/strict';
import {normalizeImport,launchConfig,subscriptionAccess,normalizeSubscription} from '../commercial/launch-model.mjs';
import {validateSharedOrder} from '../commercial/order-references.mjs';
const clients=normalizeImport('clientes',[['codigo','nombre','documento'],...Array.from({length:1500},(_,i)=>['C'+i,'Cliente '+i,'D'+i])]);assert.equal(clients.length,1500);assert.ok(clients.every(r=>!r.errors.length));
const products=normalizeImport('productos',[['codigo','nombre','precio'],...Array.from({length:5000},(_,i)=>['P'+i,'Producto '+i,'123,50'])]);assert.equal(products.length,5000);assert.ok(products.every(r=>!r.errors.length));
assert.ok(normalizeImport('productos',[['codigo','nombre','precio'],['A','Uno','10'],['a','Dos','20']])[1].errors.length);
assert.ok(normalizeImport('stock',[['codigo','cantidad'],['A','1.5']])[0].errors.length);
assert.ok(normalizeImport('productos',[['codigo','nombre','precio'],['A','Uno','-10']])[0].errors.length);
assert.equal(normalizeImport('precios',[['codigo','lista','presentacion','unidadesBase','ajuste'],['A','General','caja','10','5']])[0].row.unidadesBase,10);
assert.throws(()=>launchConfig({tipoNegocio:'mayorista',nombre:'Demo',fiscal:'produccion'}));
assert.equal(launchConfig({tipoNegocio:'mixto',nombre:'Demo'}).condicionPago,'efectivo');
for(const estado of ['prueba','activo','reactivado'])assert.equal(subscriptionAccess({estado,hasta:'2020-01-01'},Date.now()).estado,'vencido');
assert.equal(subscriptionAccess({estado:'suspendido',hasta:'2030-01-01'}).conservaDatos,true);
const order={clienteId:'C',vendedorId:'V',lineas:[{productoId:'P',cantidad:10,precioUnitario:50}]},principal={empresaId:'E'};let quoteCalls=0;
const query=async(sql,args)=>{assert.ok(!/catalogo|productos/.test(sql));assert.deepEqual(args,['E','C','V']);return {rows:[{}]};};
const quote=async()=>{quoteCalls++;return [{productoId:'P',cantidad:10,precioUnitario:50}];};
assert.deepEqual(await validateSharedOrder({query,principal,quote},order),[]);assert.equal(quoteCalls,1);
assert.deepEqual(await validateSharedOrder({query:async()=>({rows:[]}),principal,quote},order),['cliente no asignado']);assert.equal(quoteCalls,1);
assert.deepEqual(await validateSharedOrder({query,principal,quote:async()=>[{productoId:'Otro',cantidad:10,precioUnitario:50}]},order),['precio cambiado']);
console.log('PASS lanzamiento: 1500 clientes, 5000 productos, duplicados, validación, fiscal segura, suscripción sin borrado y pedido sin catálogo completo');

assert.throws(()=>normalizeSubscription({estado:'activo',hasta:'2030-01-01'}));
const trial=normalizeSubscription({estado:'prueba',hasta:'2030-01-01'});const suspended=normalizeSubscription({estado:'suspendido',hasta:'2030-01-01'},trial);assert.equal(suspended.conservaDatos,true);assert.throws(()=>normalizeSubscription({estado:'activo',hasta:'2030-01-01'},suspended));assert.equal(normalizeSubscription({estado:'reactivado',hasta:'2030-01-01'},suspended).aplicarSuspension,false);

assert.ok(normalizeImport('clientes',[['codigo','nombre','documento'],['A','Uno','20-12345678-1'],['B','Dos','20123456781']])[1].errors.includes('Identificador repetido en el archivo'));
