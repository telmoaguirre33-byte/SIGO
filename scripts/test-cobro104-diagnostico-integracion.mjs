// Regression: actual ventas.ts + alert helper, all data and transport synthetic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const E = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const Q = '44444444-4444-4444-8444-444444444444';
let mode = 'normal', rpcCalls = 0, fullCatalogReads = 0;

function result(table, filters) {
  const cabecera = {id:V,total:mode==='price_change'?120:100,medio_pago:'efectivo',cliente_id:null,estado:'confirmada'};
  const items = [{producto_id:mode==='wrong_product'?Q:P,cantidad:1,precio_unitario:mode==='price_change'?120:100,subtotal:mode==='price_change'?120:100}];
  if (table==='ventas_sigo') {
    if (mode==='header_unavailable') return {data:null,error:{message:'Synthetic read failure'}};
    return {data:filters.id===V?cabecera:null,error:null};
  }
  if (table==='venta_items_sigo') {
    if (mode==='details_unavailable') return {data:null,error:{message:'Synthetic detail failure'}};
    return {data:items,error:null};
  }
  if (table==='caja_movimientos_sigo') {
    if (mode==='cash_unavailable') return {data:null,error:{message:'Synthetic cash read failure'}};
    return {data:[{venta_id:V,medio_pago:'efectivo',importe:mode==='cash_mismatch'?90:mode==='price_change'?120:100}],error:null};
  }
  if (table==='cliente_movimientos_sigo') return {data:[],error:null};
  throw Error('Unexpected table '+table);
}
function from(table) {
  const filters={};
  const q={
    select(){return q}, eq(k,v){filters[k]=v;return q}, in(){return q}, limit(){return q},
    abortSignal(){return q}, maybeSingle:async()=>result(table,filters),
    then(resolve,reject){return Promise.resolve(result(table,filters)).then(resolve,reject)},
  };
  return q;
}
globalThis.__diagQA={
  supabase:{
    from,
    rpc(name,payload) {
      assert.equal(name,'confirmar_venta_sigo_v2');
      assert.equal(payload.p_empresa_id,E);
      assert.equal(payload.p_items[0].producto_id,P);
      rpcCalls++;
      return {abortSignal:async signal=>{signal.throwIfAborted();return {data:V,error:null};}};
    },
  },
  readCatalog(){fullCatalogReads++;throw Error('FULL_CATALOG_BEFORE_OR_AFTER_PAYMENT_FORBIDDEN');},
};
await build({
  stdin:{contents:"export { confirmarVentaSigo } from './src/ventas'; export { avisoCobroConfirmado } from './src/avisoCobroConfirmado';",resolveDir:process.cwd(),loader:'ts'},
  outfile:'.test-build/cobro104-diagnostico-integracion.mjs',
  bundle:true,format:'esm',platform:'node',
  plugins:[{name:'synthetic-transport',setup(b){
    b.onResolve({filter:/^\.\//},a=>['./supabase','./productos'].includes(a.path)?{path:a.path,namespace:'qa'}:null);
    b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:a.path==='./supabase'
      ?'export const supabase=globalThis.__diagQA.supabase;'
      :'export const listarProductosSigo=()=>globalThis.__diagQA.readCatalog();',loader:'ts'}));
  }}],
});
const { confirmarVentaSigo, avisoCobroConfirmado } = await import(pathToFileURL(process.cwd()+'/.test-build/cobro104-diagnostico-integracion.mjs'));
const states=['normal','header_unavailable','cash_unavailable','cash_mismatch','details_unavailable','wrong_product','price_change'];
for (const scenario of states) {
  mode=scenario;rpcCalls=0;fullCatalogReads=0;
  const venta=await confirmarVentaSigo({empresaId:E,items:[{productoId:P,cantidad:1,unidadMedida:'unidad'}],medioPago:'efectivo',idempotencyKey:'test-'+scenario});
  assert.equal(venta.ventaId,V);
  const verification=await venta.verificacion;
  const notice=avisoCobroConfirmado(verification,100);
  assert.equal(rpcCalls,1,'No duplicate RPC: '+scenario);
  assert.equal(fullCatalogReads,0,'No full catalog query in critical or diagnostic path: '+scenario);
  assert.equal(verification.integridadStock,'no_verificada','Stock delta cannot be claimed without prior reference');
  if(scenario==='normal'){
    assert.deepEqual({cabecera:verification.integridadCabecera,caja:verification.integridadCaja,detalle:verification.integridadDetalle},{cabecera:'ok',caja:'ok',detalle:'ok'});
    assert.equal(verification.integridad,'no_verificada');
    assert.deepEqual(notice,{texto:'',requiereRevision:false},'Do not show routine fake incomplete stock notice');
  } else if(['cash_mismatch','wrong_product'].includes(scenario)) {
    assert.equal(verification.integridad,'revisar');
    assert.equal(notice.requiereRevision,true);
    assert.match(notice.texto,/detectó una diferencia/);
  } else if(scenario==='price_change') {
    assert.equal(verification.integridadCabecera,'ok');
    assert.equal(verification.integridadCaja,'ok');
    assert.equal(verification.integridadDetalle,'ok');
    assert.equal(notice.requiereRevision,true);
    assert.match(notice.texto,/120/);
  } else {
    assert.equal(verification.integridad,'no_verificada');
    assert.match(notice.texto,/comprobación adicional/,'Actual missing verification must remain visible');
  }
  console.log('PASS',scenario);
}
console.log('PASS: seven post-sale checks; no live services or commercial rows.');
