import {test} from 'node:test';import assert from 'node:assert/strict';import {createLoadsState,applyLoadCommand,orderBalance,orderState} from '../cargas/model.mjs';
const actor={empresaId:'qa',userId:'gerencia-qa',rol:'administrador'};
function setup(){let s=createLoadsState('qa');const send=(tipo,input)=>{s=applyLoadCommand(s,{id:crypto.randomUUID(),empresaId:'qa',version:s.revision,tipo,input},actor);return s;};send('aprobar',{pedido:{empresaId:'qa',pedidoId:'pedido',clienteId:'cliente',estado:'recibido',lineas:[{productoId:'sku',cantidad:1,precioUnitario:10},{productoId:'sku',cantidad:6,precioUnitario:9}]}});return {get:()=>s,send};}
test('SKU comprado por unidad y pack en oferta se consolida sin perder sus precios',()=>{const {get}=setup(),line=get().pedidos.pedido.lineas[0];assert.equal(line.cantidad,7);assert.equal(line.totalCentavos,6400);assert.deepEqual(line.desglosePrecios,[{cantidad:1,precioUnitario:10,centavos:1000},{cantidad:6,precioUnitario:9,centavos:5400}]);});
test('Importe de entrega parcial usa prorrateo exacto en centavos y conserva desglose original',()=>{const {get}=setup(),p=structuredClone(get().pedidos.pedido);p.lineas[0].entregado=7;assert.equal(orderBalance(p).totalCentavos,6400);p.lineas[0].entregado=3;assert.equal(orderBalance(p).totalCentavos,2743);assert.equal(p.lineas[0].desglosePrecios.length,2);});

test('Sustitución conserva solicitud, faltante, responsable, tiempo y transiciones permitidas',()=>{
 const {get,send}=setup();send('crear',{id:'carga',camion:'QA',ruta:'ruta',chofer:'chofer',responsable:'armador',modo:'individual'});send('asignar',{cargaId:'carga',pedidoId:'pedido'});send('iniciar',{cargaId:'carga'});
 assert.throws(()=>send('cargar',{cargaId:'carga',nota:'Control'}),/Verificá/);
 send('sustituir',{cargaId:'carga',pedidoId:'pedido',productoId:'sku',faltante:7,sustitutoId:'otro',cantidad:4,precioUnitario:3,nombre:'Otro SKU',nota:'Cliente acepta cambio'});
 const p=get().cargas.carga.pedidos.pedido;assert.equal(p.lineas[0].cantidad,7);assert.equal(p.lineas[0].sustituciones[0].faltante,7);assert.equal(p.lineas[1].sustitucionDe.autorizadoPor,actor.userId);assert.ok(Date.parse(p.lineas[1].sustitucionDe.fecha));
 assert.throws(()=>send('contar',{cargaId:'carga',productoId:'sku',cantidad:7,nota:'Reponer original'}),/sustitución/);
 send('codigo',{productoId:'otro',codigo:'SUB-01',unidadesBase:1});send('escanear',{cargaId:'carga',codigo:'SUB-01',cantidad:4,modo:'picking'});send('verificar',{cargaId:'carga'});send('cargar',{cargaId:'carga',nota:'Control firmado'});assert.equal(orderState({order:{pedidoId:'pedido'},load:get().cargas.carga}),'en_carga');
 send('salir',{cargaId:'carga',nota:'Salida autorizada'});assert.equal(orderState({order:{pedidoId:'pedido'},load:get().cargas.carga}),'despachado');assert.throws(()=>send('sustituir',{cargaId:'carga'}),/preparación/);
});

test('Carga consolidada prepara el original de otro pedido sin reponer la línea sustituida',()=>{
 const {get,send}=setup();
 send('aprobar',{pedido:{empresaId:'qa',pedidoId:'segundo',clienteId:'otro-cliente',estado:'recibido',lineas:[{productoId:'sku',cantidad:2,precioUnitario:10}]}});
 send('crear',{id:'carga',camion:'QA',ruta:'ruta',chofer:'chofer',responsable:'armador',modo:'consolidada'});
 for(const pedidoId of ['pedido','segundo'])send('asignar',{cargaId:'carga',pedidoId});
 send('iniciar',{cargaId:'carga'});
 send('sustituir',{cargaId:'carga',pedidoId:'pedido',productoId:'sku',faltante:7,sustitutoId:'otro',cantidad:4,precioUnitario:3,nombre:'Otro SKU',nota:'Cliente acepta cambio'});
 send('codigo',{productoId:'sku',codigo:'ORIGINAL',unidadesBase:1});send('codigo',{productoId:'otro',codigo:'SUSTITUTO',unidadesBase:1});
 assert.throws(()=>send('escanear',{cargaId:'carga',codigo:'ORIGINAL',cantidad:2,modo:'picking'}),/sustituto/);
 send('escanear',{cargaId:'carga',pedidoId:'segundo',codigo:'ORIGINAL',cantidad:2,modo:'picking'});
 send('escanear',{cargaId:'carga',codigo:'SUSTITUTO',cantidad:4,modo:'picking'});
 send('verificar',{cargaId:'carga'});
 const load=get().cargas.carga;assert.equal(load.estado,'verificada');assert.equal(load.pedidos.pedido.lineas[0].preparado,0);assert.equal(load.pedidos.segundo.lineas[0].preparado,2);assert.equal(load.pedidos.pedido.lineas[1].preparado,4);
});

