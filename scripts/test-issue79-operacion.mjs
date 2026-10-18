import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
let passed=0;
async function test(name,fn){await fn();console.log(`PASS ${++passed}: ${name}`);}
async function load(path,mocks={}){
 const context=vm.createContext({Date,Map,Set,Number,JSON,console});
 const module=new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'transform'}),{context});
 await module.link(name=>{assert.ok(name in mocks,name);const value=mocks[name];return new vm.SyntheticModule(Object.keys(value),function(){for(const[k,v]of Object.entries(value))this.setExport(k,v);},{context});});
 await module.evaluate();return module.namespace;
}
const search=await load('src/busquedaCaja.ts');
await test('F10 all 40 matches and accent normalization',()=>{
 const catalog=Array.from({length:40},(_,i)=>({id:String(i),nombre:`Lápiz número ${i}`}));
 const results=search.buscarIndiceCaja(search.crearIndiceCaja(catalog),'lapiz');
 assert.equal(results.length,40);assert.equal(results[39].id,'39');
});
await test('F10 5,000-product catalog indexed once, no truncation',()=>{
 const catalog=Array.from({length:5000},(_,i)=>({id:String(i),nombre:`Artículo útil ${i}`}));
 const index=search.crearIndiceCaja(catalog);const start=performance.now();
 for(let i=0;i<50;i++)assert.equal(search.buscarIndiceCaja(index,'articulo util').length,5000);
 const elapsed=performance.now()-start;assert.ok(elapsed<2000,`50 searches took ${elapsed}ms`);console.log(`5000 products x 50 searches: ${elapsed.toFixed(1)}ms`);
});
const sales=Array.from({length:200},(_,i)=>({id:`s${i}`,empresa_id:'tenant',estado:'confirmada',numero:i,total:6,medio_pago:'efectivo',created_at:'2026-10-18T12:00:00Z'}));
const items=sales.flatMap(s=>Array.from({length:6},(_,j)=>({id:`${s.id}-${j}`,empresa_id:'tenant',venta_id:s.id,producto_id:'p1',cantidad:1,subtotal:1,productos:{nombre:'QA',stock_actual:1}})));
const clients=Array.from({length:1001},(_,i)=>({id:`c${i}`,empresa_id:'tenant',activo:true,nombre:`QA${i}`}));
const calls=[];
const db={from(table){let data=table==='ventas_sigo'?sales:table==='venta_items_sigo'?items:table==='clientes_sigo'?clients:[];const call={table,orders:[],filters:[]};calls.push(call);const q={
 select(){return q;},eq(k,v){call.filters.push([k,v]);data=data.filter(r=>r[k]===v);return q;},in(k,values){data=data.filter(r=>values.includes(r[k]));return q;},gte(){return q;},lte(){return q;},order(k){call.orders.push(k);return q;},
 range(a,b){call.range=[a,b];return Promise.resolve({data:data.slice(a,b+1),error:null});},limit(n){throw Error(`Unpaginated limit ${n}`);}
};return q;}};
const ranking=await load('src/rankingProductos.ts',{'./supabase':{supabase:db}});
await test('F14 ranking includes 1,200 lines in one 200-sale block',async()=>{
 const rows=await ranking.cargarRankingProductosSigo('tenant','2026-10-01','2026-10-18');assert.equal(rows[0].unidades,1200);assert.equal(rows[0].importe,1200);
 assert.ok(calls.filter(c=>c.table==='venta_items_sigo').some(c=>c.range[0]===1000));
});
const client=await load('src/clientes.ts',{'./supabase':{supabase:db}});
await test('F14 clients cross default PostgREST limit with stable ordering',async()=>{
 assert.equal((await client.listarClientesSigo('tenant')).length,1001);
 assert.ok(calls.filter(c=>c.table==='clientes_sigo').every(c=>c.orders.includes('id')));
});
const risk=await load('src/stockRiesgo.ts',{'./supabase':{supabase:db},'./productos':{listarProductosSigo:async()=>[{id:'p1',nombre:'QA',stock_actual:1,costo_actual:1}]}});
await test('F14 stock risk uses all item pages',async()=>{
 const out=await risk.cargarRiesgoStockSigo('tenant',30);assert.equal(out.productosPrioritarios[0].ventasPeriodo,1200);
});
const returns=await load('src/devoluciones.ts',{'./supabase':{supabase:db}});
await test('F11 historical sale search and pagination preserve tenant',async()=>{
 const page=await returns.listarVentasDevolviblesSigo('tenant',40,{pagina:2});assert.equal(page.length,40);assert.equal(page[0].id,'s80');
 const old=await returns.listarVentasDevolviblesSigo('tenant',40,{busqueda:'#199'});assert.equal(old[0].id,'s199');
 await assert.rejects(returns.listarVentasDevolviblesSigo('tenant',40,{busqueda:'or=(true)'}),/número/);
 assert.ok(calls.filter(c=>c.table==='ventas_sigo').every(c=>c.filters.some(([k,v])=>k==='empresa_id'&&v==='tenant')));
});
const dates=await load('src/fechaLocal.ts');
await test('F13 local date near UTC midnight',()=>{
 process.env.TZ='America/Argentina/Buenos_Aires';assert.equal(dates.fechaLocalIso(new Date('2026-10-18T01:00:00Z')),'2026-10-17');
 process.env.TZ='Pacific/Auckland';assert.equal(dates.fechaLocalIso(new Date('2026-10-18T12:00:00Z')),'2026-10-19');
});
console.log(`${passed}/${passed} issue #79 operation tests passed; isolated data.`);
