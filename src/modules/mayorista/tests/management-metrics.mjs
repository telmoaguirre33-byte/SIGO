import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateManagementMetrics,normalizeReportFilters,loadCommercialEvents,goalProgress} from '../commercial/management-metrics.mjs';
import {normalizeGoal} from '../commercial/goals.mjs';
import {approvedOrigins} from '../api/origins.mjs';
import {renderManagementPanel} from '../admin/management-panel.mjs';
import {createLoadsState,applyLoadCommand} from '../cargas/model.mjs';
const when='2026-10-14T12:00:00Z',filters=normalizeReportFilters({periodo:'mes'},new Date(when));
const order={pedidoId:'p',clienteId:'c',vendedorId:'v',recibidoEn:when,lineas:[{productoId:'x',cantidad:3,precioUnitario:1/3}]};
const load={id:'l',ruta:'r',estado:'en_reparto',pedidos:{p:{pedidoId:'p',clienteId:'c',lineas:[{productoId:'x',cantidad:3,preparado:3,totalCentavos:100,entregado:2,devuelto:1}],entrega:{fecha:when},rendicion:{estado:'presentada',centavos:67}}},historial:[{id:'e',tipo:'entregar',fecha:when,input:{pedidoId:'p',lineas:[{productoId:'x',entregado:3,devuelto:0}]}},{id:'d',tipo:'devolver',fecha:when,input:{pedidoId:'p',productoId:'x',cantidad:1}}]};
const source={empresaId:'E',orders:[order],customers:[{id:'c',vendedorId:'v',rutaId:'r',habilitado:true}],sellers:[{id:'v',nombre:'Vendedor'}],routes:[{id:'r',zona:'Centro'}],products:[{id:'x',nombre:'Producto',activo:true}],loads:[load],visits:[{clienteId:'c',vendedorId:'v',registradaEn:when},{clienteId:'c',vendedorId:'v',registradaEn:when}]};
test('pedido recibido no se convierte en venta, entrega, factura o cobranza',()=>{
 const r=calculateManagementMetrics({...source,loads:[]},filters).resumen;
 assert.equal(r.pedidos,1);assert.equal(r.vendido,null);assert.equal(r.facturado,null);assert.equal(r.cobrado,0);assert.equal(r.mercaderiaEntregada,0);assert.equal(r.ticketPromedio,null);
});
test('entrega y devolución usan su fecha e importes exactos; rendición presentada no cuenta como cobro',()=>{
 const r=calculateManagementMetrics(source,filters).resumen;
 assert.equal(r.mercaderiaEntregada,3);assert.equal(r.importeEntregado,67);assert.equal(r.unidadesDevueltas,1);assert.equal(r.cobrado,0);assert.equal(r.vendido,null);assert.equal(r.visitados,1);
});
test('devolución completa en fracciones anula exactamente centavos originales',()=>{
 const copy=structuredClone(load);copy.historial.push({id:'d2',tipo:'devolver',fecha:when,input:{pedidoId:'p',productoId:'x',cantidad:1}},{id:'d3',tipo:'devolver',fecha:when,input:{pedidoId:'p',productoId:'x',cantidad:1}});
 assert.equal(calculateManagementMetrics({...source,loads:[copy]},filters).resumen.importeEntregado,0);
});
test('historial repetido no duplica entrega; devoluciones en otro período no reescriben el anterior',()=>{
 const copy=structuredClone(load);copy.historial[1].fecha='2026-11-01T12:00:00Z';copy.historial.push(copy.historial[0]);
 assert.equal(loadCommercialEvents([copy],[order]).length,2);assert.equal(calculateManagementMetrics({...source,loads:[copy]},filters).resumen.importeEntregado,100);
});
test('venta, factura, margen y unidades solo desde comprobantes confirmados independientes',()=>{
 const r=calculateManagementMetrics({...source,sales:[{empresaId:'E',pedidoId:'p',clienteId:'c',vendedorId:'v',fecha:when,estado:'confirmada',centavos:500,unidades:7}],invoices:[{fecha:when,pedidoId:'p',estado:'confirmada',centavos:300},{fecha:when,pedidoId:'p',estado:'borrador',centavos:999}],costs:[{fecha:when,pedidoId:'p',centavos:200}]},filters).resumen;
 assert.equal(r.vendido,500);assert.equal(r.facturado,300);assert.equal(r.margen,300);assert.equal(r.unidades,7);assert.equal(r.importeEntregado,67);assert.equal(r.ticketPromedio,500);
});
test('asientos revisados y cobros directos no equivalen a factura; deuda y recuperación respetan apertura',()=>{
 const r=calculateManagementMetrics({...source,ledger:[{clienteId:'c',fecha:'2026-09-20T00:00:00Z',tipo:'entrega',centavos:'1000'},{clienteId:'c',pedidoId:'p',fecha:when,tipo:'cobranza',centavos:'-200'}],collections:[{clienteId:'c',fecha:when,tipo:'cobro',centavos:'300'}]},filters).resumen;
 assert.equal(r.cobrado,500);assert.equal(r.deudaPendiente,500);assert.equal(r.deuda_recuperada,500);assert.equal(r.deudaVencida,null);
});
test('filtros vendedor, ruta y zona excluyen movimientos ajenos',()=>{for(const f of [{vendedorId:'otro'},{rutaId:'otro'},{zona:'otra'}])assert.equal(calculateManagementMetrics(source,{...filters,...f}).resumen.importeEntregado,0);});
test('fechas válidas y límites de período no aceptan fechas normalizadas o intervalos invertidos',()=>{
 for(const pair of [['2026-02-30','2026-03-02'],['2026-10-15','2026-10-14'],['2025-01-01','2026-10-01']])assert.throws(()=>normalizeReportFilters({periodo:'personalizado',desde:pair[0],hasta:pair[1]}));
 assert.equal(normalizeReportFilters({periodo:'hoy'},new Date(when)).desde,'2026-10-14T00:00:00.000Z');
 assert.equal(normalizeReportFilters({periodo:'semana'},new Date(when)).desde,'2026-10-12T00:00:00.000Z');
});
test('objetivo / real / cumplimiento / falta y ausencia de fuente se distinguen',()=>{assert.deepEqual(goalProgress(100,75),{objetivo:100,real:75,cumplimiento:75,falta:25});assert.equal(goalProgress(100,125).falta,0);assert.equal(goalProgress(100,null).cumplimiento,null);});
const goal={id:'10000000-0000-4000-8000-000000000001',vendedorId:null,metrica:'pedidos',periodo:'mensual',desde:'2026-10-01',hasta:'2026-10-31',objetivo:10,activa:true};
test('objetivos validan alcance, calendario, moneda entera y métricas conocidas',()=>{
 assert.equal(normalizeGoal(goal).objetivo,10);
 for(const change of [{vendedorId:'ajeno'},{metrica:'inventada'},{objetivo:1.5},{desde:'2026-10-02'},{periodo:'semanal'},{activa:'true'}])assert.throws(()=>normalizeGoal({...goal,...change}));
 assert.doesNotThrow(()=>normalizeGoal({...goal,periodo:'diario',desde:'2026-10-14',hasta:'2026-10-14'}));
});
test('CORS se amplía solo con orígenes HTTPS exactos y explícitos',()=>{
 assert.deepEqual([...approvedOrigins('https://api.test')],['https://api.test']);assert.ok(approvedOrigins('https://api.test',['https://sigo.test']).has('https://sigo.test'));
 for(const extra of [['*'],['http://sigo.test'],['https://sigo.test/path'],['https://user:password@sigo.test'],['https://sigo.test/']])assert.throws(()=>approvedOrigins('https://api.test',extra));
});
test('panel escapa nombres y presenta fuentes ausentes sin cero ficticio',()=>{
 const r=calculateManagementMetrics({...source,sellers:[{id:'v',nombre:'<img src=x onerror=alert(1)>'}]},filters),html=renderManagementPanel(r);
 assert.ok(html.includes('Sin datos confirmados'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('PANEL MAYORISTA'));
});
test('devoluciones sin inspección quedan en revisión; solo clasificación explícita es vendible',()=>{
 const state=createLoadsState('E');state.cargas.l=structuredClone(load);
 const command={id:'receipt',empresaId:'E',version:0,tipo:'recibir_devoluciones',input:{cargaId:'l',lineas:[{productoId:'x',cantidad:1}],nota:'Recepción física'}};
 const actor={empresaId:'E',rol:'administrador',userId:'gerencia'};
 const normal=applyLoadCommand(state,command,actor);assert.deepEqual(normal.cargas.l.recepcionDevoluciones.lineas[0],{productoId:'x',cantidad:1,vendible:0,averiada:0,revision:1});
 const explicit=applyLoadCommand(state,{...command,input:{...command.input,lineas:[{productoId:'x',cantidad:1,vendible:1}]}},actor);assert.equal(explicit.cargas.l.recepcionDevoluciones.lineas[0].vendible,1);
 assert.throws(()=>applyLoadCommand(state,{...command,input:{...command.input,lineas:[{productoId:'x',cantidad:1,vendible:1,averiada:1}]}},actor));
});
