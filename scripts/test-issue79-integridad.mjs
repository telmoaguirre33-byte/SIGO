import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

let passed = 0;
async function test(name, fn) { await fn(); console.log(`PASS ${++passed}: ${name}`); }
const values = new Map();
const localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
async function load(path, mocks, extra = '') {
  const source = readFileSync(path, 'utf8') + extra;
  const code = path.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'transform' }) : source;
  const context = vm.createContext({ console, process: { env: {} }, localStorage, crypto: webcrypto, TextEncoder, TextDecoder, Date, Map, Set, Number, JSON });
  const mod = new vm.SourceTextModule(code, { context, identifier: path });
  await mod.link(spec => {
    assert.ok(spec in mocks, `Unexpected dependency ${spec}`);
    const exports = mocks[spec];
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}
const stock = await load('src/stockImportExcel.ts', { './productos': { guardarProductoSigo() { throw Error('WRITES_FORBIDDEN'); } } });
const headers = ['Producto','EAN','Stock actual','Costo','Precio de venta'];
const product = { id:'p1', nombre:'Artículo', codigo_barras:'0000123', codigo_interno:null };
const row = (value, code='0000123', products=[product]) => stock.prepararImportacionStock([headers,['Artículo',code,value,10,20]],products).filas[0];
await test('F02 XLSX native decimal never becomes thousands', () => {
  for (const n of [1.234, 12.345, 1234.56, 0, 1.005]) assert.equal(row(n).stockActual,n);
});
await test('F02 CSV decimal/grouping and invalid input', () => {
  assert.equal(row('1.234,56').stockActual,1234.56);
  assert.equal(row('1,234.56').stockActual,1234.56);
  assert.equal(row('1,25').stockActual,1.25);
  for (const text of ['1.234','1,234','NaN','10x','1e3','Infinity','1..2','-1']) assert.equal(row(text).estado,'error',text);
});
await test('F03 EAN contradiction blocks same-name fallback', () => {
  const r=row(2,'9999'); assert.equal(r.estado,'error'); assert.equal(r.productoId,null);
  assert.equal(row(2).productoId,'p1');
  assert.equal(row(2,'').productoId,'p1');
});
for (const file of ['api/arca/cae.js','api/arca/cae-v2.js']) {
  const wsaa = Object.fromEntries(['WSAA','WSFE','escapeXml','decodeXml','extraer','extraerErroresWsfe','leerTicketWsaa','descargarSecreto','autenticarWsaa','guardarTicketWsaa'].map(k=>[k,()=>{throw Error('EXTERNAL_CALL_FORBIDDEN');}]));
  const extra = file.endsWith('v2.js') ? '\nexport { detalleFiscal };' : '';
  const fiscal = await load(file, { './wsaa.js': wsaa }, extra);
  const detail = (rate,id=5) => fiscal.detalleFiscal(6,121,[{producto_id:'p1',subtotal:121}],new Map([['p1',{iva_alicuota_id:id,iva_tasa:rate,precio_incluye_iva:true}]]));
  await test(`F04 ${file}: invalid IVA rejected before emission`, () => {
    for (const rate of [null, undefined, '', ' ', false, true, NaN, Infinity, -1, 0, 10.5]) assert.throws(()=>detail(rate),/FISCAL_DATA_REQUIRED/);
    assert.equal(detail(21).impIva,21);
    assert.equal(detail(0,3).impIva,0);
    assert.throws(()=>detail(21,99),/FISCAL_DATA_REQUIRED/);
  });
}
let rpcCalls = [], committed = new Map(), fail = '', resolveRpc;
const db = {
  async rpc(name, params) {
    rpcCalls.push({name,...params});
    if (fail === 'before') throw Error('timeout before commit');
    if (fail === 'wait') await new Promise(r=>{resolveRpc=r;});
    const id=committed.get(params.p_idempotency_key) ?? `return-${committed.size+1}`;
    committed.set(params.p_idempotency_key,id);
    if (fail === 'after') throw Error('timeout after commit');
    return {data:id,error:null};
  },
  from(table) {
    assert.equal(table,'devoluciones_sigo'); const filters={};
    return { select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){
      assert.equal(filters.empresa_id,'tenant'); assert.equal(filters.venta_id,'sale');
      return {data:committed.has(filters.idempotency_key)?{id:committed.get(filters.idempotency_key)}:null,error:null};
    }};
  },
};
let returns = await load('src/devoluciones.ts', { './supabase': {supabase:db} });
const input = {empresaId:'tenant',ventaId:'sale',motivo:'Producto incorrecto',items:[{ventaItemId:'item',cantidad:1}]};
const reset=()=>{values.clear();rpcCalls=[];committed.clear();fail='';};
await test('F01 timeout after commit reconciles original, one stock/cash effect', async()=>{
  reset();fail='after';assert.equal(await returns.registrarDevolucionSigo(input),'return-1');
  assert.equal(committed.size,1);assert.equal(values.size,0);
});
await test('F01 retry after reload preserves original key and blocks changed payload',async()=>{
  reset();fail='before';await assert.rejects(returns.registrarDevolucionSigo(input),/pendiente/);
  returns=await load('src/devoluciones.ts',{'./supabase':{supabase:db}});
  await assert.rejects(returns.registrarDevolucionSigo({...input,motivo:'Otra operación'}),/pendiente/);
  fail='';assert.equal(await returns.reintentarDevolucionPendienteSigo('tenant'),'return-1');
  assert.equal(rpcCalls.length,2);assert.equal(rpcCalls[0].p_idempotency_key,rpcCalls[1].p_idempotency_key);
});
await test('F01 concurrent clicks share same request',async()=>{
  reset();fail='wait';const a=returns.registrarDevolucionSigo(input);const b=returns.registrarDevolucionSigo(input);
  assert.equal(rpcCalls.length,1);resolveRpc();assert.equal(await a,await b);assert.equal(committed.size,1);
});
await test('F01 storage failure prevents RPC',async()=>{
  reset();const before=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};
  try {await assert.rejects(returns.registrarDevolucionSigo(input),/quota/);assert.equal(rpcCalls.length,0);}finally{localStorage.setItem=before;}
});
let failedTable = '';
const reportDb = {from(table){return {select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},range(){return Promise.resolve({data:[],error:table===failedTable?Error('offline'):null});}};}};
const reports=await load('src/informes.ts',{'./supabase':{supabase:reportDb},'./reportesClient':{reportesClient:reportDb},'./reportesDatos':{listarProductosInforme:async()=>[],listarClientesInforme:async()=>[]},'./productos':{listarProductosSigo:async()=>[]},'./clientes':{listarClientesSigo:async()=>[]}});
await test('F05 failed source cannot produce zero summary',async()=>{
  for(const table of ['ventas_sigo','compras_sigo','caja_movimientos_sigo']){failedTable=table;await assert.rejects(reports.cargarResumenOperativoSigo('tenant'),/Informe incompleto/);}
  failedTable='';assert.equal((await reports.cargarResumenOperativoSigo('tenant')).ventasTotal,0);
});
console.log(`${passed}/${passed} issue #79 integrity tests passed; isolated data, zero external calls.`);
