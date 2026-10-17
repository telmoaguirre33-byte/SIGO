import assert from 'node:assert/strict';
import {exportReport,REPORT_TYPES} from '../commercial/report-export.mjs';
const filters={periodo:'personalizado',desde:'2026-01-01',hasta:'2026-01-31'},data={empresaId:'E',orders:[],customers:[{id:'C',nombre:'Comercio',vendedorId:'V',rutaId:'R'}],sellers:[{id:'V',nombre:'Vendedor'}],routes:[{id:'R',nombre:'Ruta',zona:'Centro'}],visits:[],loads:[],ledger:[{clienteId:'C',tipo:'venta',centavos:1000,fecha:'2026-01-02'},{clienteId:'C',tipo:'cobranza',centavos:-300,fecha:'2026-01-03'}],collections:[],products:[],inventory:[],sales:[{clienteId:'C',vendedorId:'V',rutaId:'R',estado:'confirmada',centavos:1000,unidades:1,fecha:'2026-01-02'}],invoices:null,costs:null,dueBalances:null};
for(const tipo of Object.keys(REPORT_TYPES)){const r=exportReport(data,{...filters,tipo});assert.ok(Array.isArray(r.rows));assert.ok(r.headers.length>0);assert.equal(r.empresaId,'E');assert.equal(r.revision.length,64);}
assert.equal(exportReport(data,{...filters,tipo:'ventas'}).rows[0].at(-1),10);
assert.equal(exportReport(data,{...filters,tipo:'cobranzas'}).rows[0].at(-1),3);
assert.equal(exportReport(data,{...filters,tipo:'deuda'}).rows[0][2],7);
assert.equal(exportReport(data,{...filters,tipo:'facturacion'}).available,false);
assert.equal(exportReport(data,{...filters,tipo:'ventas',vendedorId:'OTRO'}).total,0);
assert.equal(exportReport(data,{...filters,tipo:'ventas',zona:'OTRA'}).total,0);
assert.throws(()=>exportReport(data,{...filters,tipo:'ventas',limit:501}));
assert.notEqual(exportReport(data,{...filters,tipo:'ventas'}).revision,exportReport({...data,sales:[{...data.sales[0],centavos:2000}]},{...filters,tipo:'ventas'}).revision);
console.log('PASS informes: 11 tipos, filtros, pesos/centavos, deuda al cierre, fuente ausente, paginación y revisión de exportación');
