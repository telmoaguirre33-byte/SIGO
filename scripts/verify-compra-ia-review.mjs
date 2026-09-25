import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); }
let passed = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { passed += 1; console.log(`PASS ${name}`); }); }
function loadTs(path, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path, 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: path, reportDiagnostics: true });
  assert.equal(out.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, `syntax ${path}`);
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: name => { assert.ok(name in mocks, `Unmocked import ${name}`); return mocks[name]; }, console, Number, String, Math, Map, Set, JSON, Date, Object, Array, Promise, Error, AbortController, DOMException, ...globals };
  vm.runInNewContext(out.outputText, context, { filename: path });
  return { exports: module.exports, context };
}
const helpers = loadTs('src/compraIARevision.ts').exports;
const rawItem = (description = 'Articulo de prueba', qty = 2, cost = 100) => ({ descripcion: description, codigo: null, codigo_barras: null, cantidad: qty, costo_unitario: cost, total_linea: qty * cost, confianza: 0.95 });
const rawDocument = (overrides = {}) => ({ proveedor: { razon_social: 'Proveedor de prueba', cuit: null }, fecha: '2026-09-23', tipo_comprobante: 'Presupuesto', numero_comprobante: null, moneda: 'ARS', total: 200, confianza_general: 0.95, items: [rawItem()], ...overrides });
const serverCode = fs.readFileSync('api/compras/analizar-factura.js', 'utf8').replace('export default async function handler', 'async function handler');
let geminiBody = null, permission = true, externalCalls = 0;
const fixture = rawDocument();
const serverContext = { console: { info() {}, error() {} }, AbortController, setTimeout, clearTimeout, process: { env: { SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'TEST_ONLY_NOT_A_SECRET', GEMINI_API_KEY: 'TEST_ONLY_NOT_A_SECRET' } }, fetch: async (url, init) => {
  externalCalls += 1;
  if (url === 'https://supabase.test/auth/v1/user') return { ok: true };
  if (url === 'https://supabase.test/rest/v1/rpc/tiene_permiso_empresa') return { ok: true, json: async () => permission };
  assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'), 'only mocked Gemini permitted');
  geminiBody = JSON.parse(init.body);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture) }] } }] }) };
} };
vm.createContext(serverContext);
vm.runInContext(serverCode, serverContext);
const normalize = serverContext.normalizarFacturaIA;
async function callServer(body) {
  const res = { code: 0, body: null, status(n) { this.code = n; return this; }, setHeader() { return this; }, send(s) { this.body = JSON.parse(s); return this; } };
  await serverContext.handler({ method: 'POST', headers: { authorization: 'Bearer TEST_ONLY' }, body: { empresaId: 'EMPRESA-TEST', ...body } }, res);
  return res;
}
await test('presupuesto sin numero conserva ocho renglones y no inventa identidad', () => {
  const items = Array.from({ length: 8 }, (_, i) => rawItem(`Articulo QA ${i+1}`, i+1, 100));
  const d = normalize(rawDocument({ items, total: 3600 }));
  assert.equal(d.numero_comprobante, null); assert.equal(d.items.length, 8); assert.equal(d.total, 3600); assert.equal(d.tipo_comprobante, 'Presupuesto');
});
await test('mensaje sin proveedor y sin numero devuelve borrador', () => {
  const d = normalize(rawDocument({ proveedor: {}, tipo_comprobante: 'Mensaje' }));
  assert.equal(d.proveedor.razon_social, null); assert.equal(d.numero_comprobante, null); assert.equal(d.items.length, 1); assert.ok(d.advertencias.length >= 2);
});
await test('cantidad faltante no se inventa ni elimina el producto', () => {
  const d = normalize(rawDocument({ items: [{ ...rawItem(), cantidad: null, confianza: 0.1 }] }));
  assert.equal(d.items.length, 1); assert.equal(d.items[0].cantidad, 0); assert.equal(d.items[0].requiere_revision, true);
});
await test('costo no finito queda pendiente y no se transforma en costo valido', () => {
  const d = normalize(rawDocument({ items: [{ ...rawItem(), costo_unitario: Infinity }] }));
  assert.equal(d.items.length, 1); assert.equal(d.items[0].costo_unitario, 0); assert.equal(d.items[0].requiere_revision, true);
});
await test('lectura de baja confianza se conserva marcada para revision', () => {
  const d = normalize(rawDocument({ confianza_general: 0.1, items: [{ ...rawItem(), confianza: 0.1 }] }));
  assert.equal(d.requiere_revision, true); assert.equal(d.items[0].requiere_revision, true);
});
await test('numero real y total declarado no se reescriben', () => {
  const d = normalize(rawDocument({ numero_comprobante: '0001-00000002', total: 999 }));
  assert.equal(d.numero_comprobante, '0001-00000002'); assert.equal(d.total, 999); assert.equal(d.items[0].total_linea, 200); assert.ok(d.advertencias.some(x => x.includes('total de la factura')));
});
await test('limite de 300 lineas sigue rechazando truncamiento', () => assert.throws(() => normalize(rawDocument({ items: Array.from({ length: 301 }, () => rawItem()) })), /TOO_MANY_INVOICE_ITEMS/));
await test('codigos conflictivos siguen protegidos', () => assert.throws(() => normalize(rawDocument({ items: [{ ...rawItem('A'), codigo: 'QA-CODE' }, { ...rawItem('B'), codigo: 'QA-CODE' }] })), /AMBIGUOUS_INVOICE_CODES/));
await test('API acepta texto con permiso sin generar imagen artificial', async () => {
  const r = await callServer({ documentType: 'texto', documentText: '2 Articulos de prueba costo unitario 100' });
  assert.equal(r.code, 200); assert.equal(r.body.factura.numero_comprobante, null); assert.ok(geminiBody.contents[0].parts[1].text.includes('2 Articulos')); assert.equal(geminiBody.contents[0].parts[1].inlineData, undefined);
});
await test('API sigue aceptando imagen y PDF', async () => {
  for (const [documentType, documentDataUrl] of [['imagen','data:image/jpeg;base64,VEVTVA=='],['pdf','data:application/pdf;base64,VEVTVA==']]) {
    const r = await callServer({ documentType, documentDataUrl }); assert.equal(r.code,200); assert.ok(geminiBody.contents[0].parts[1].inlineData);
  }
});
await test('texto vacio largo o entrada mixta se rechaza antes de llamar IA', async () => {
  const before=externalCalls;
  for(const body of [{documentType:'texto',documentText:'  '},{documentType:'texto',documentText:'x'.repeat(30001)},{documentType:'texto',documentText:'x',documentDataUrl:'data:image/jpeg;base64,VEVTVA=='},{documentType:'html',documentDataUrl:'data:image/jpeg;base64,VEVTVA=='}]) assert.equal((await callServer(body)).code,400);
  assert.equal(externalCalls,before);
});
await test('texto no evita el permiso purchases.write', async () => {
  permission=false; try { assert.equal((await callServer({documentType:'texto',documentText:'un articulo'})).code,403); } finally {permission=true;}
});
let sentClientBody = null;
const query = new Proxy({}, { get: (_,key) => key === 'then' ? undefined : () => key === 'range' ? Promise.resolve({ data: [], error: null }) : query });
const client = loadTs('src/facturaIA.ts', { './supabase': {supabase:{auth:{getSession:async()=>({data:{session:{access_token:'TEST_ONLY'}}})},from:()=>query}}}, { window: {setTimeout,clearTimeout}, fetch: async(_,init)=>{sentClientBody=JSON.parse(init.body);return{ok:true,json:async()=>({factura:normalize(rawDocument({proveedor:{}}))})};} }).exports;
await test('cliente acepta y devuelve mensaje sin proveedor ni numero', async()=>{
 const d=await client.analizarFacturaCompraSigo('EMPRESA-TEST','2 articulos costo 100');
 assert.equal(d.numero_comprobante,null);assert.equal(d.proveedor.razon_social,null);assert.equal(d.items.length,1);assert.equal(sentClientBody.documentType,'texto');assert.equal(sentClientBody.documentDataUrl,undefined);
});
await test('cliente valida texto vacio y limite', async()=>{
 await assert.rejects(client.analizarFacturaCompraSigo('EMPRESA-TEST','  '), /Pegá un mensaje/);
 await assert.rejects(client.analizarFacturaCompraSigo('EMPRESA-TEST','x'.repeat(30001)), /Pegá un mensaje/);
});
await test('pack de seis conserva costo preciso y porcentaje sobre costo',()=>{
 const r=helpers.resolverPrecioCompra(20000/6,undefined,'60');assert.equal(r.precio,5333.33);assert.equal(6*(20000/6),20000);
 assert.equal(helpers.resolverPrecioCompra(20000/6,undefined,'40').precio,4666.67);
});
await test('numeros con coma y campos vacios no se convierten en cero valido',()=>{
 assert.equal(helpers.numeroCompra('40,5'),40.5);assert.equal(helpers.numeroCompra('1.234,56'),1234.56);assert.ok(Number.isNaN(helpers.numeroCompra('')));assert.ok(Number.isNaN(helpers.numeroCompra('Infinity')));
});
await test('precio manual se conserva al cambiar costo',()=>{
 const r=helpers.resolverPrecioCompra(200,undefined,undefined,'350','precio');assert.equal(r.precio,350);assert.equal(r.margen,75);
});

// Execute the actual TSX component with a deterministic hook/JSX adapter and mocked read services.
// This is a component regression test, not an Android camera or real-Gemini end-to-end test.
const catalog=[{id:'P-QA',nombre:'Articulo existente',codigo_interno:'QA-EXISTE',codigo_barras:null,precio_venta:130,margen_porcentaje:30,costo_actual:100,stock_actual:5}];
const invoice=()=>({...rawDocument(),items:[{...rawItem('Articulo existente',2,100),codigo:'QA-EXISTE'},rawItem('Articulo nuevo',3,200)],total:800,advertencias:[],referencia_borrador:'BORRADOR-QA'});
const storageKey='sigo:compra-ia:borrador:EMPRESA-TEST';
function initialStorage(doc=invoice()) { return new Map([[storageKey,JSON.stringify({facturaIA:doc})]]); }
function harness(storage=initialStorage()) {
 const slots=[]; let cursor=0,dirty=true,pending=[],tree,writeCalls=0,failStorage=false,failAnalysis=false;
 const timers=new Map();let timerId=0;
 const setTimer=fn=>{const id=++timerId;timers.set(id,fn);return id;};
 const react={useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(init){const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},useMemo(fn){cursor++;return fn();},useEffect(fn,deps){const i=cursor++;const before=slots[i];if(!before||!deps||deps.some((d,k)=>!Object.is(d,before.deps[k]))){slots[i]={deps,cleanup:before?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type,props,key)=>({type,props:{...props},key});
 const mutations=()=>{writeCalls++;throw new Error('Business writes forbidden in review tests');};
 const component=loadTs('src/ComprasOperativas.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'./BarcodeScanner':{default:()=>null},'./compraIARevision':helpers,'./compraIARevision.css':{},
  './facturaIA':{analizarFacturaCompraSigo:async()=>{if(failAnalysis)throw new Error('Lectura fallida de prueba');return invoice();}},
  './productos':{listarProductosSigo:async()=>catalog,guardarProductoSigo:mutations},
  './compras':{listarProveedoresSigo:async()=>[{id:'PROV-QA',empresa_id:'EMPRESA-TEST',razon_social:'Proveedor de prueba',activo:true,cuit:null}],listarComprasSigo:async()=>[],guardarProveedorSigo:mutations,confirmarCompraSigo:mutations,verificarCompraSigo:mutations},
 },{crypto:{randomUUID:()=>`qa-${++timerId}`},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(failStorage)throw new Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},window:{setTimeout:setTimer,clearTimeout:id=>timers.delete(id)},document:{getElementById:()=>({scrollIntoView(){}})}}).exports.default;
 function walk(n,out=[]){if(Array.isArray(n)){n.forEach(x=>walk(x,out));return out;}if(!n||typeof n!=='object')return out;out.push(n);walk(n.props?.children,out);return out;}
 function text(n){if(n==null||typeof n==='boolean')return'';if(Array.isArray(n))return n.map(text).join('');if(typeof n==='object')return text(n.props?.children);return String(n);}
 async function settle(){for(let i=0;i<30;i++){if(dirty){dirty=false;cursor=0;tree=component({empresaId:'EMPRESA-TEST',vista:'ia'});const work=pending;pending=[];work.forEach(fn=>fn());}await Promise.resolve();await Promise.resolve();if(!dirty&&i>4)return;}throw new Error('component did not settle');}
 const find=(predicate)=>{const n=walk(tree).find(predicate);assert.ok(n,'Expected element');return n;};
 const input=label=>find(n=>n.props?.['aria-label']===label);
 const button=label=>find(n=>n.type==='button'&&text(n).includes(label));
 async function edit(label,value){input(label).props.onChange({target:{value}});await settle();}
 async function click(label){const b=button(label);assert.ok(!b.props.disabled,`button disabled ${label}`);b.props.onClick();await settle();}
 return{settle,edit,click,input,button,find,text,get tree(){return tree;},storage,get writeCalls(){return writeCalls;},failStorage(){failStorage=true;},failAnalysis(){failAnalysis=true;},async flushTimers(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());await settle();}};
}
await test('UI permite 60 para todos y 40 para existente sin perder la excepcion',async()=>{
 const h=harness();await h.settle();await h.edit('Porcentaje sobre costo para todos','60');await h.click('APLICAR % A TODOS');
 assert.equal(h.input('Precio de venta para Articulo existente').props.value,'160');assert.equal(h.input('Precio de venta para Articulo nuevo').props.value,'320');
 await h.edit('Margen para Articulo existente','40');assert.equal(h.input('Precio de venta para Articulo existente').props.value,'140');assert.equal(h.input('Margen para Articulo nuevo').props.value,'60');
 await h.click('GUARDAR BORRADOR');const saved=JSON.parse(h.storage.get(storageKey));assert.equal(saved.margenesFactura['0'],'40');assert.equal(saved.margenesFactura['1'],'60');
 const h2=harness(h.storage);await h2.settle();assert.equal(h2.input('Margen para Articulo existente').props.value,'40');assert.equal(h2.input('Precio de venta para Articulo nuevo').props.value,'320');
 await h2.click('PREPARAR COMPRA');await h2.click('GUARDAR BORRADOR');const staged=JSON.parse(h.storage.get(storageKey)).compraPreparadaIA;
 assert.equal(staged.numeroComprobante,null);assert.equal(staged.items[0].precioVenta,140);assert.equal(staged.items[0].margenPorcentaje,40);assert.equal(staged.items[1].precioVenta,320);assert.equal(staged.referenciaBorrador,'BORRADOR-QA');assert.equal(h.writeCalls+h2.writeCalls,0);
});
await test('UI conserva precio manual al editar costo y volver a abrir borrador',async()=>{
 const h=harness();await h.settle();await h.click('REVISAR / CORREGIR');await h.edit('Precio de venta para Articulo existente','350');await h.edit('Costo unitario para Articulo existente','200');
 assert.equal(h.input('Precio de venta para Articulo existente').props.value,'350');assert.equal(h.input('Margen para Articulo existente').props.value,'75');await h.click('GUARDAR BORRADOR');
 const h2=harness(h.storage);await h2.settle();assert.equal(h2.input('Precio de venta para Articulo existente').props.value,'350');assert.equal(JSON.parse(h.storage.get(storageKey)).modosPrecioFactura['0'],'precio');assert.equal(h2.writeCalls,0);
});
await test('UI recalcula porcentaje elegido al editar costo',async()=>{
 const h=harness();await h.settle();await h.edit('Margen para Articulo existente','60');await h.click('REVISAR / CORREGIR');await h.edit('Costo unitario para Articulo existente','200');assert.equal(h.input('Precio de venta para Articulo existente').props.value,'320');assert.equal(h.input('Margen para Articulo existente').props.value,'60');
});
await test('UI guarda aunque falte proveedor cantidad o precio pero no prepara',async()=>{
 const doc=invoice();doc.proveedor={razon_social:null,cuit:null};doc.items[1].cantidad=0;const h=harness(initialStorage(doc));await h.settle();await h.click('GUARDAR BORRADOR');assert.equal(JSON.parse(h.storage.get(storageKey)).facturaIA.items.length,2);await h.click('PREPARAR COMPRA');assert.ok(h.text(h.tree).includes('Completá o elegí el proveedor'));assert.equal(h.writeCalls,0);
});
await test('UI no confirma lectura incierta sin revision explicita',async()=>{
 const doc=invoice();doc.items[0].requiere_revision=true;const h=harness(initialStorage(doc));await h.settle();await h.edit('Porcentaje sobre costo para todos','60');await h.click('APLICAR % A TODOS');await h.click('PREPARAR COMPRA');assert.ok(h.text(h.tree).includes('Confirmá que revisaste'));assert.equal(h.writeCalls,0);
});
await test('UI no pierde el borrador previo si falla una nueva lectura de mensaje',async()=>{
 const h=harness();await h.settle();h.failAnalysis();const t=h.find(n=>n.type==='textarea');t.props.onChange({target:{value:'Mensaje de prueba'}});await h.settle();await h.click('LEER MENSAJE CON IA');assert.ok(h.text(h.tree).includes('Lectura fallida de prueba'));assert.ok(h.input('Margen para Articulo existente'));assert.equal(h.writeCalls,0);
});
await test('UI no informa guardado exitoso si falla el almacenamiento',async()=>{
 const h=harness();await h.settle();h.failStorage();await h.click('GUARDAR BORRADOR');assert.ok(h.text(h.tree).includes('No se pudo guardar el borrador.'));assert.ok(!h.text(h.tree).includes('✓ Borrador guardado'));assert.equal(h.writeCalls,0);
});
await test('CSS incluye reglas de tarjetas moviles (verificacion estatica, no navegador real)',()=>{
 const css=fs.readFileSync('src/compraIARevision.css','utf8');assert.ok(css.includes('@media (max-width: 640px)'));assert.ok(css.includes('.compra-ia-items td'));assert.ok(css.includes('display: block'));assert.ok(css.includes('min-height: 44px'));
});
console.log(`COMPRA_IA_REVIEW_REGRESSION_OK ${passed} tests. No real Gemini, database writes, production changes or Android-camera session were used.`);
