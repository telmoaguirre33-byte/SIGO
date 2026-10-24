const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const base = path.resolve(__dirname, '..');
const source = base;
const req = createRequire(path.join(source, 'package.json'));
const esbuild = req('esbuild');
const { JSDOM } = req('jsdom');
const dom = new JSDOM('<div id="app"></div>', {url:'https://local.test'});
Object.assign(global, {window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true});
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');

function load(file, mocks) {
  const code = esbuild.transformSync(fs.readFileSync(path.join(base,'src',file),'utf8'), {loader:file.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code;
  const mod = {exports:{}};
  new Function('require','module','exports',code)((id)=>Object.hasOwn(mocks,id)?mocks[id]:req(id),mod,mod.exports);
  return mod.exports;
}
let rpcArgs;
const product = {id:'p',empresa_id:'e',nombre:'Producto',unidad_medida:'kg',unidad_revision:'7',stock_actual:0,costo_actual:10,costo_ultima_compra:10,precio_venta:15,activo:true,codigo_interno:'P',codigo_barras:'123'};
let rejectRpc=false;let rpcErrorMessage="CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED";
const query = (data=[]) => {
 const obj = {then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};
 for(const key of ['select','eq','in','order','limit','range','update'])obj[key]=()=>obj;
 return obj;
};
const supabase = {from:(name)=>query(name==='productos'?[product]:[]),rpc:async(name,args)=>{rpcArgs=args;return {data:rejectRpc?null:'purchase',error:rejectRpc?{message:rpcErrorMessage}:null}}};
const purchases = load('compras.ts',{'./supabase':{supabase},'./ventaPorMedidas':load('ventaPorMedidas.ts',{})});
const item = (unit,qty=1,cost=10)=>({producto_id:'p',cantidad:qty,costo_unitario:cost,...(unit===undefined?{}:{unidad_medida:unit})});
let checks=0;
function ok(fn){fn();checks++;}
(async()=>{
 ok(()=>assert.throws(()=>purchases.consolidarItemsCompra([item('kg',1.0004)]),/tres decimales/));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item('kg',1.001)])[0].cantidad,1.001));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item('kg',0.1),item('kg',0.2)])[0].cantidad,0.3));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item(undefined,1.0004)])[0].cantidad,1.0004));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item(undefined,0.1),item(undefined,0.2)])[0].cantidad,0.1+0.2));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item('kg',0.1+0.2)])[0].cantidad,0.3));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item('kg',0.1,10),item('kg',0.2,40)])[0].costo_unitario,30));

 ok(()=>assert.deepEqual(purchases.consolidarItemsCompra([item('kg',2,10),item('kg',1,40)]),[item('kg',3,20)]));
 ok(()=>assert.deepEqual(purchases.consolidarItemsCompra([item(undefined),item(undefined)]),[item(undefined,2)]));
 ok(()=>assert.deepEqual(purchases.consolidarItemsCompra([item(null),item(null)]),[item(null,2)]));
 for(const units of [['kg','unidad'],['kg',undefined],[undefined,'kg'],['kg',null],[null,'kg']])
   ok(()=>assert.throws(()=>purchases.consolidarItemsCompra(units.map(u=>item(u))),/unidades diferentes/));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([item('kg'),{...item('unidad'),producto_id:'other'}]).length,2));
 const revised = (revision)=>({...item('kg'),unidad_revision:revision});
 ok(()=>assert.equal(purchases.consolidarItemsCompra([revised('9007199254740993')])[0].unidad_revision,'9007199254740993'));
 ok(()=>assert.equal(purchases.consolidarItemsCompra([revised('7'),revised('7')])[0].unidad_revision,'7'));
 for(const revision of ['8',null,undefined])ok(()=>assert.throws(()=>purchases.consolidarItemsCompra([revised('7'),revised(revision)]),/revisiones.*diferentes/));
 for(const revision of [7,'07','-1','9223372036854775808'])ok(()=>assert.throws(()=>purchases.consolidarItemsCompra([revised(revision)]),/revisión.*válida/));
 const input = {empresaId:'e',proveedorId:'s',items:[item('unidad')],idempotencyKey:'key'};
 await purchases.confirmarCompraSigo({...input,items:[item('kg',0.1),item('kg',0.2)]});
 ok(()=>assert.equal(rpcArgs.p_items[0].cantidad,0.3));
 rejectRpc=true;rpcErrorMessage='CORRECTED_PRODUCT_QUANTITY_INVALID';
 await assert.rejects(()=>purchases.confirmarCompraSigo(input),/máximo tres decimales/);checks++;
 rejectRpc=false;rpcErrorMessage='CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED';
 await purchases.confirmarCompraSigo({...input,items:[revised('7')]});
 ok(()=>assert.equal(rpcArgs.p_items[0].unidad_revision,'7'));
 await purchases.confirmarCompraSigo(input);
 ok(()=>assert.equal(rpcArgs.p_items[0].unidad_medida,'unidad')); // Fresh kg catalog must not rewrite snapshot.
 await purchases.confirmarCompraSigo({...input,items:[item(undefined)]});
 ok(()=>assert.equal(Object.hasOwn(rpcArgs.p_items[0],'unidad_medida'),false));
 rejectRpc=true;
 await assert.rejects(()=>purchases.confirmarCompraSigo({...input,items:[item(undefined)]}),/volvé a seleccionar/); checks++;
 let sent;
 let history=[];let historySent;let historyCalls=0;let historyReject=false;
 let backendReject=false;
 const mockPurchases={...purchases,listarComprasSigo:async()=>history,listarProveedoresSigo:async()=>[{id:'s',empresa_id:'e',razon_social:'Proveedor',activo:true}],confirmarCompraSigo:async(args)=>{sent=args;if(backendReject)throw new Error('Revisá y volvé a seleccionar el producto');return 'purchase';},verificarCompraSigo:async()=>({estado:'OK',detalle:'ok'})};
 const UI=load('ComprasOperativas.tsx',{'./BarcodeScanner':{__esModule:true,default:()=>null},'./GuardarCompraIA':{__esModule:true,default:()=>null},'./supabase':{supabase:{from:(table)=>query(table==='compra_items_sigo'?[{producto_id:'p',cantidad:2,costo_unitario:10,productos:{nombre:'Producto'}}]:[]),rpc:async(name,args)=>{assert.equal(name,'cambiar_compra_sigo');historyCalls++;historySent=args;return {error:historyReject?{message:'CORRECTED_PRODUCT_PURCHASE_CHANGE_REVIEW_REQUIRED'}:null}}}},'./facturaIA':{analizarFacturaCompraSigo:()=>{throw Error('IA not in scope')}},'./productos':{listarProductosSigo:async()=>[{...product}],guardarProductoSigo:()=>{throw Error('writes forbidden')}},'./compras':mockPurchases}).default;
 let root;
 async function mount(empresaId='e',vista='manual'){root=createRoot(document.getElementById('app'));await act(async()=>{root.render(React.createElement(UI,{empresaId,vista}))});}
 async function unmount(){await act(async()=>root.unmount());}
 async function selectProduct(){const el=document.querySelector('tbody select');await act(async()=>{el.value='p';el.dispatchEvent(new window.Event('change',{bubbles:true}))});}

 await mount();await selectProduct();
 ok(()=>assert.match(document.querySelector('tbody').textContent,/Unidad capturada: kg/));
 product.unidad_medida='unidad';product.unidad_revision='8';
 backendReject=true;
 await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 ok(()=>assert.equal(sent.items[0].unidad_medida,'kg'));
 ok(()=>assert.equal(sent.items[0].unidad_revision,'7'));
 ok(()=>assert.match(document.querySelector('tbody').textContent,/Unidad capturada: kg/));
 // JSON round-trip verifies optional metadata is retained without inventing a legacy unit.
 ok(()=>assert.equal(JSON.parse(JSON.stringify(sent.items))[0].unidad_medida,'kg'));
 ok(()=>assert.equal(Object.hasOwn(JSON.parse(JSON.stringify([item(undefined)]))[0],'unidad_medida'),false));
 backendReject=false;
 await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 ok(()=>assert.equal(document.querySelector('tbody select').value,''));
 await unmount();
 // Catalog without units must remain absent, never become kg or unidad.
 product.unidad_medida=null;product.unidad_revision=null;
 await mount();await selectProduct();
 backendReject=true;
 await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 ok(()=>assert.equal(sent.items[0].unidad_medida,null));
 ok(()=>assert.equal(sent.items[0].unidad_revision,null));
 ok(()=>assert.match(document.querySelector('tbody').textContent,/sin verificar/));
 await unmount();

 history=[{id:'purchase',empresa_id:'e',proveedor_id:'s',fecha_compra:'2026-10-24',estado:'confirmada',total:20}];
 product.unidad_medida='kg';product.unidad_revision='7';
 await mount('e','historial');
 async function click(label,last=false){
   const buttons=[...document.querySelectorAll('button')].filter(x=>x.textContent===label);
   const button=last?buttons.at(-1):buttons[0];
   assert.ok(button,label);
   await act(async()=>button.click());
 }
 await click('Modificar');
 ok(()=>assert.match(document.body.textContent,/Unidad capturada: kg/));
 await selectProduct(); // Explicit selection also captures current editor catalog.
 product.unidad_medida='unidad';product.unidad_revision='8'; // Server catalog changes after editor's snapshot.
 historyReject=true;
 await click('Guardar cambios');
 ok(()=>assert.equal(historySent.p_items[0].unidad_medida,'kg'));
 ok(()=>assert.equal(historySent.p_items[0].unidad_revision,'7'));
 ok(()=>assert.equal(historyCalls,1));
 ok(()=>assert.match(document.body.textContent,/Cerrá el editor/));
 ok(()=>assert.match(document.body.textContent,/Unidad capturada: kg/));
 await click('Cerrar');
 await unmount();
 product.unidad_medida=null;product.unidad_revision=null;
 await mount('e','historial');
 await click('Modificar');
 await click('Guardar cambios');
 ok(()=>assert.equal(historySent.p_items[0].unidad_medida,null));
 ok(()=>assert.match(document.body.textContent,/sin verificar/));
 await click('Cerrar');
 await unmount();
 product.unidad_medida='kg';product.unidad_revision='7';
 await mount('e','historial');
 await click('Abrir compra'); // Detail-to-edit transition retains opening snapshot too.
 product.unidad_medida='unidad';product.unidad_revision='8';
 await click('Modificar',true);
 await click('Guardar cambios');
 ok(()=>assert.equal(historySent.p_items[0].unidad_medida,'kg'));
 ok(()=>assert.equal(historySent.p_items[0].unidad_revision,'7'));
 await click('Cerrar');
 await click('Eliminar / anular');
 window.confirm=()=>true;historyReject=false;
 await click('Eliminar / anular',true);
 ok(()=>assert.equal(historySent.p_accion,'anular'));
 ok(()=>assert.equal(historySent.p_items,null)); // No client unit guessing for reversal.
 await unmount();
 console.log(JSON.stringify({status:'PASS',checks,syntheticOnly:true,covered:['kg precision validation and integer accumulation','legacy quantity contract unchanged','weighted consolidation','legacy optional unit','mixed units rejected','RPC snapshot retained','backend review error','manual selection capture','JSON snapshot round-trip','legacy absence preserved','success cleanup','edit capture and stale catalog','detail-to-edit snapshot','edit rejection no retry','annul without client items']},null,2));
})().catch(err=>{console.error(err);process.exitCode=1});
