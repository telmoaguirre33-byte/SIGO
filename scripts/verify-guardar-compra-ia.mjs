import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let passed = 0;
async function test(name, fn) { await fn(); console.log(`PASS ${++passed}: ${name}`); }
function load(path, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { if (!(name in mocks)) throw new Error(`Unexpected import ${name}`); return mocks[name]; }, console, localStorage: storage, setTimeout, clearTimeout });
  return exports;
}
const values = new Map();
const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
const helpers = load('src/guardarCompraIA.ts');
const base = () => ({ factura: { proveedor: { razon_social:'QA proveedor',cuit:null }, fecha:'2026-09-25',tipo_comprobante:'Remito',numero_comprobante:'QA-1',total:99999,advertencias:['Total distinto'],confianza_general:.1,items:[{descripcion:'QA artículo',codigo:null,codigo_barras:null,cantidad:6,costo_unitario:100,total_linea:900,confianza:.1}] }, productos:[],vinculos:{},barras:{},codigos:{},precios:{0:'150'},margenes:{0:'50'} });
await test('new product without EAN/internal code is allowed', () => { const r=helpers.construirCompraIA(base());assert.equal(r.items[0].codigo_barras,null);assert.equal(r.items[0].codigo_interno,null);assert.equal(r.items[0].precio_venta,150); });
await test('reviewed discrepancies/confidence do not block save',()=>assert.equal(helpers.construirCompraIA(base()).items.length,1));
await test('existing product reuses its own code, not supplier code',()=>{const i=base();i.productos=[{id:'p1',nombre:'QA artículo',codigo_interno:'PROPIO-1',codigo_barras:null}];i.factura.items[0].codigo='PROVEEDOR-9';const r=helpers.construirCompraIA(i).items[0];assert.equal(r.producto_id,'p1');assert.equal(r.codigo_interno,'PROPIO-1');assert.equal(r.precio_venta,null);});
await test('explicit association wins over invoice codes',()=>{const i=base();i.productos=[{id:'p1',nombre:'Otro',codigo_interno:'1'}];i.vinculos[0]='p1';assert.equal(helpers.construirCompraIA(i).items[0].producto_id,'p1');});
await test('ambiguous identities need explicit association',()=>{const i=base();i.productos=[{id:'1',nombre:'QA artículo'},{id:'2',nombre:'QA artículo'}];assert.throws(()=>helpers.construirCompraIA(i),/más de un producto/);});
await test('empty purchase rejected',()=>{const i=base();i.factura.items=[];assert.throws(()=>helpers.construirCompraIA(i));});
await test('invalid quantity/cost/price rejected',()=>{for(const key of ['cantidad','costo_unitario']) { const i=base();i.factura.items[0][key]=NaN;assert.throws(()=>helpers.construirCompraIA(i)); } const i=base();i.precios[0]='';assert.throws(()=>helpers.construirCompraIA(i));});
await test('7, 15, 30 lines accepted without barcodes',()=>{for(const n of [7,15,30]){const i=base();i.factura.items=Array.from({length:n},(_,k)=>({...i.factura.items[0],descripcion:`QA ${k}`}));i.precios=Object.fromEntries(Array.from({length:n},(_,k)=>[k,'150']));assert.equal(helpers.construirCompraIA(i).items.length,n);}});
await test('document number is optional at save',()=>{const i=base();i.factura.numero_comprobante=null;assert.equal(helpers.construirCompraIA(i).numero_comprobante,null);});
function harness(rpc, verify=async()=>({estado:'OK',detalle:'ok'})) {
  const refs=[];let hook=0;const effects=[];const callbacks=[];
  const component=load('src/GuardarCompraIA.tsx', {
    'react': {useRef:value=>{const index=hook++;return refs[index]??(refs[index]={current:value});},useState:initial=>[initial,()=>{}],useEffect:fn=>effects.push(fn)},
    'react/jsx-runtime': {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    './supabase':{supabase:{rpc}}, './compras':{verificarCompraSigo:verify}, './guardarCompraIA':helpers,
  }).default;
  const props={...base(),empresaId:'tenant',idempotencyKey:'draft-key',onAntesGuardar:()=>callbacks.push('draft'),onEstado:x=>callbacks.push(['busy',x]),onPendiente:x=>callbacks.push(['pending',x]),onError:x=>callbacks.push(['error',x]),onGuardada:(id,result)=>callbacks.push(['saved',id,result])};
  const rendered=component(props);const cleanup=effects.map(fn=>fn());
  function find(node) { if(node?.type==='button')return node;const children=node?.props?.children;for(const c of Array.isArray(children)?children:[children]){const result=find(c);if(result)return result;} }
  return {click:()=>find(rendered).props.onClick(),callbacks,unmount:()=>cleanup.forEach(f=>f?.()),props};
}
const success={data:{compra_id:'purchase-1',items:[{producto_id:'p1',cantidad:6,costo_unitario:100,stock_antes:0}]},error:null};
const tick=()=>new Promise(r=>setTimeout(r,0));
await test('single RPC and duplicate click suppression',async()=>{values.clear();let resolve,calls=0;const h=harness(async(name,args)=>{calls++;assert.equal(name,'guardar_compra_ia_sigo');assert.equal(args.p_compra.items[0].codigo_barras,null);assert.ok(values.size);return new Promise(r=>resolve=r);});h.click();h.click();assert.equal(calls,1);resolve(success);await tick();assert.equal(h.callbacks.filter(c=>c[0]==='saved').length,1);assert.equal(values.size,0);});
await test('network failure preserves immutable request for retry',async()=>{values.clear();const h=harness(async()=>{throw new Error('Failed to fetch');});h.click();await tick();assert.equal(values.size,1);let sent;const retry=harness(async(_,args)=>{sent=args.p_compra;return success;});retry.props.factura.items[0].costo_unitario=999;retry.click();await tick();assert.equal(sent.items[0].costo_unitario,100);assert.equal(values.size,0);});
await test('PostgreSQL rollback unlocks correction and retains invoice',async()=>{values.clear();const h=harness(async()=>({data:null,error:{code:'P0001',message:'INVALID_ITEM'}}));h.click();await tick();assert.equal(values.size,0);assert.equal(h.props.factura.items.length,1);assert.equal(h.callbacks.filter(c=>c[0]==='saved').length,0);});
await test('readback error never retries a committed purchase',async()=>{values.clear();let calls=0;const h=harness(async()=>{calls++;return success;},async()=>{throw new Error('offline');});h.click();await tick();assert.equal(calls,1);assert.equal(h.callbacks.find(c=>c[0]==='saved')[2].estado,'NO_VERIFICADO');});
await test('unmount/tenant change suppresses stale UI callbacks',async()=>{values.clear();let resolve;const h=harness(async()=>new Promise(r=>resolve=r));h.click();h.unmount();resolve(success);await tick();assert.equal(h.callbacks.filter(c=>c[0]==='saved').length,0);});
await test('draft persistence failure prevents all writes',async()=>{values.clear();let calls=0;const h=harness(async()=>{calls++;return success;});h.props.onAntesGuardar=()=>{throw new Error('storage full');};h.click();await tick();assert.equal(calls,0);});
console.log(`${passed}/${passed} Compra IA save tests passed (RPC/network mocks; no production writes).`);
