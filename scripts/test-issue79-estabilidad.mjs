import assert from 'node:assert/strict';
import inventory, { leerCatalogoInventario, construirHallazgosInventario } from '../api/inventario/analizar.js';
import report from '../api/informes/consultar.js';
const originalFetch=globalThis.fetch;
const names=['SUPABASE_URL','SUPABASE_ANON_KEY','GEMINI_API_KEY'];
const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
process.env.SUPABASE_URL='https://isolated.invalid';process.env.SUPABASE_ANON_KEY='qa-anon';
let passed=0;
async function test(name,fn){await fn();console.log(`PASS ${++passed}: ${name}`);}
function res(){return{statusCode:0,body:null,setHeader(){return this;},status(n){this.statusCode=n;return this;},send(b){this.body=JSON.parse(b);return this;}};}
const tenant='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
try{
 await test('F09 catalog traverses default 1,000-row limit',async()=>{
  const rows=Array.from({length:1501},(_,i)=>({id:String(i),nombre:`QA ${i}`}));let calls=0;
  globalThis.fetch=async(url)=>{const u=new URL(url);assert.equal(u.searchParams.get('empresa_id'),`eq.${tenant}`);assert.equal(u.searchParams.get('order'),'id.asc');calls++;const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));return new Response(JSON.stringify(rows.slice(offset,offset+limit)),{headers:{'content-range':`${offset}-${Math.min(offset+limit,1501)-1}/1501`}});};
  const out=await leerCatalogoInventario('https://isolated.invalid','qa','Bearer qa',tenant);assert.equal(out.productos.length,1501);assert.equal(out.completo,true);assert.equal(calls,2);
 });
 await test('F09 partial catalog cannot declare missing products',async()=>{
  globalThis.fetch=async(url)=>{const offset=Number(new URL(url).searchParams.get('offset'));return new Response(JSON.stringify(Array.from({length:1000},(_,i)=>({id:String(offset+i)}))),{headers:{'content-range':`${offset}-${offset+999}/6000`}});};
  const out=await leerCatalogoInventario('https://isolated.invalid','qa','Bearer qa',tenant);assert.equal(out.completo,false);assert.equal(out.productos.length,5000);
  const raw={detectados:[{descripcion:'Fuera del recorte',estado:'falta_sigo',confianza:1}]};
  assert.equal(construirHallazgosInventario(raw,out.productos,false,1)[0].estado,'revisar');
  assert.equal(construirHallazgosInventario(raw,[],true,1)[0].estado,'falta_sigo');
 });
 await test('F09 observed stock overrides model claims and invented IDs',()=>{
  const raw={detectados:[{catalogo_id:'p1',estado:'falta_sigo',confianza:1},{catalogo_id:'invented',estado:'ok',confianza:1}]};
  const rows=construirHallazgosInventario(raw,[{id:'p1',nombre:'QA',stock_actual:5}],true,1);assert.equal(rows[0].estado,'ok');assert.equal(rows[0].stock_actual,5);assert.equal(rows[1].estado,'revisar');
 });
 await test('F09 failed products.read authorization is closed',async()=>{
  let calls=0;globalThis.fetch=async(url)=>{calls++;return new Response(JSON.stringify(calls===1?{id:'qa'}:{error:'offline'}),{status:calls===1?200:503});};
  const response=res();await inventory({method:'POST',headers:{authorization:'Bearer qa'},body:{empresaId:tenant,imagenes:['data:image/png;base64,AA==']}},response);assert.equal(response.statusCode,403);assert.equal(calls,2);
 });
 const query={empresaId:tenant,table:'ventas_sigo',select:'total,created_at',filters:[['empresa_id','eq',tenant],['estado','eq','confirmada']],orders:[['id',true]],range:[0,999]};
 let reads=0,permissionCalls=0;
 globalThis.fetch=async(url,init={})=>{
  if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'qa'}));
  if(url.endsWith('/rpc/tiene_permiso_empresa')){
   permissionCalls++;const args=JSON.parse(init.body);assert.equal(args.p_permiso,'reports.read');
   const allowed=init.headers.Authorization==='Bearer admin-granted'&&args.p_empresa_id===tenant;
   return new Response(JSON.stringify(allowed));
  }
  reads++;const u=new URL(url);assert.equal(u.searchParams.get('empresa_id'),`eq.${tenant}`);assert.equal(init.headers.Authorization,'Bearer admin-granted');
  return new Response(JSON.stringify([{total:121,created_at:'2026-10-18T12:00:00Z'}]));
 };
 await test('F15 backend enforces reports.read for every role and company',async()=>{
  for(const role of ['owner-denied','admin-denied','seller','warehouse','client']){
   const response=res();await report({method:'POST',headers:{authorization:`Bearer ${role}`},body:query},response);assert.equal(response.statusCode,403,role);
  }
  assert.equal(reads,0);
  const response=res();await report({method:'POST',headers:{authorization:'Bearer admin-granted'},body:query},response);assert.equal(response.statusCode,200);assert.equal(reads,1);
  const foreign=res();await report({method:'POST',headers:{authorization:'Bearer admin-granted'},body:{...query,empresaId:other,filters:[]}},foreign);assert.equal(foreign.statusCode,403);assert.equal(reads,1);assert.equal(permissionCalls,7);
 });
 await test('F15 tenant substitution rejected even with granted reports.read',async()=>{
  const response=res();await report({method:'POST',headers:{authorization:'Bearer admin-granted'},body:{...query,filters:[['empresa_id','eq',other]]}},response);assert.equal(response.statusCode,403);assert.equal(reads,1);
 });
 await test('F15 invalid limits and unavailable permission backend cannot yield data',async()=>{
  const invalid=res();await report({method:'POST',headers:{authorization:'Bearer admin-granted'},body:{...query,range:[0,1000]}},invalid);assert.equal(invalid.statusCode,400);
  globalThis.fetch=async(url)=>new Response(JSON.stringify({error:'offline'}),{status:url.endsWith('/auth/v1/user')?200:503});
  const response=res();await report({method:'POST',headers:{authorization:'Bearer admin-granted'},body:query},response);assert.equal(response.statusCode,403);
 });
 console.log(`${passed}/${passed} issue #79 stability tests passed; all HTTP mocked, no live data or AI requests.`);
}finally{globalThis.fetch=originalFetch;for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
