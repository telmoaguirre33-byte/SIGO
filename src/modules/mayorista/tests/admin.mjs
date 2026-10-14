import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminState,saveSeller,saveRoute,assignCustomer,setGoal,managementReport,reportCsv} from '../admin/model.mjs';
function fixture(){let s=createAdminState('empresa-a');s=saveSeller(s,{id:'v1',nombre:'Lucía',zona:'Sur'});return saveRoute(s,{id:'r1',nombre:'Centro',zona:'Sur'});}
test('administración agrega vendedores sin modificar estado previo',()=>{const s=createAdminState('e');const next=saveSeller(s,{id:'v',nombre:'Vendedor',zona:'Sur'});assert.equal(s.vendedores.length,0);assert.equal(next.vendedores.length,1);});
test('administración rechaza registros de otra empresa',()=>assert.throws(()=>saveSeller(fixture(),{id:'v2',nombre:'Otro',zona:'Norte',empresaId:'empresa-b'})));
test('cliente solo se asigna a vendedor y ruta existentes',()=>{const s=fixture();assert.throws(()=>assignCustomer(s,{id:'c',nombre:'Comercio',direccion:'Calle',vendedorId:'v2',rutaId:'r1'}));assert.throws(()=>assignCustomer(s,{id:'c',nombre:'Comercio',direccion:'Calle',vendedorId:'v1',rutaId:'r2'}));});
test('no desactivar vendedor con clientes asignados',()=>{const s=assignCustomer(fixture(),{id:'c',nombre:'Comercio',direccion:'Calle',vendedorId:'v1',rutaId:'r1'});assert.throws(()=>saveSeller(s,{id:'v1',nombre:'Lucía',zona:'Sur',activo:false}));});
test('objetivos requieren vendedor activo y valores válidos',()=>{const s=fixture();assert.throws(()=>setGoal(s,{vendedorId:'v1',importe:-1,visitas:10}));assert.throws(()=>setGoal(s,{vendedorId:'v2',importe:100,visitas:10}));assert.equal(setGoal(s,{vendedorId:'v1',importe:100,visitas:10}).objetivos.length,1);});
test('informe elimina duplicados y filtra otra empresa',()=>{const s=fixture();const p={id:'p',empresaId:s.empresaId,vendedorId:'v1',estado:'sincronizado',lineas:[{cantidad:2,precioUnitario:10}]};const r=managementReport(s,[p,p,{...p,id:'otro',empresaId:'empresa-b'}],[{empresaId:'empresa-b',vendedorId:'v1'}])[0];assert.equal(r.pedidos,1);assert.equal(r.importe,20);assert.equal(r.visitas,0);assert.equal(r.recibidosSimulador,1);});
test('CSV neutraliza fórmulas y preserva comillas',()=>{const csv=reportCsv([{vendedor:'=HYPERLINK("malicioso")',zona:'@SUM(1)',importe:10}]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'="));assert.ok(csv.includes("'@"));assert.ok(csv.includes('""malicioso""'));});

import {saveVehicle} from '../admin/model.mjs';
test('Vehículo y calendario de ruta persisten como metadata sin otro stock',()=>{
 let s=createAdminState('a');s=saveVehicle(s,{id:'v',nombre:'Camión',patente:'abc123',capacidad:1000,chofer:'Chofer',activo:true});assert.equal(s.vehiculos[0].patente,'ABC123');assert.throws(()=>saveVehicle(s,{id:'x',nombre:'X',patente:'X',capacidad:-1,chofer:'X'}));s=saveRoute(s,{id:'r',nombre:'Centro',zona:'Centro',dias:[5,1,1]});assert.deepEqual(s.rutas[0].dias,[1,5]);assert.throws(()=>saveRoute(s,{id:'x',nombre:'X',zona:'X',dias:[7]}));
});
