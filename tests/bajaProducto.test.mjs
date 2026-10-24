import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function bundle(path, stub) {
 const out = await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:stub?[{name:'stub',setup(b){b.onResolve({filter:/^\.\/supabase$/},()=>({path:'db',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const supabase = globalThis.__bajaDb;',loader:'js'}));}}]:[]});
 return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text+`\n//${Math.random()}`).toString('base64')}`);
}
const { motivoBloqueoBaja } = await bundle('../src/bajaProducto.ts');
for(const stock of [100,0.75,-1,null,undefined,NaN,Infinity]) test(`Stock ${stock}: bloqueado sin tocar existencias`,()=>assert.ok(motivoBloqueoBaja({nombre:'Carne',stock_actual:stock,unidad_medida:'kg'})));
test('Stock cero permite solicitar, no autoriza saltar servidor',()=>assert.equal(motivoBloqueoBaja({nombre:'Carne',stock_actual:0,unidad_medida:'kg'}),null));
test('Mensaje explica stock100 y no recomienda borrarlo',()=>assert.match(motivoBloqueoBaja({nombre:'Carne',stock_actual:100,unidad_medida:'unidad'}),/100 unidad.*Sigue activo.*no pongas el stock en cero/));
async function fixture({rpc={data:true,error:null},read={data:{id:'p1',empresa_id:'e1',activo:false},error:null},throwRead=false,throwRpc=false}={}){
 const calls=[];globalThis.__bajaDb={rpc:async(...args)=>{calls.push(['rpc',...args]);if(throwRpc)throw Error('network');return rpc;},from(table){calls.push(['from',table]);const q={select(s){calls.push(['select',s]);return q;},eq(k,v){calls.push(['eq',k,v]);return q;},async maybeSingle(){if(throwRead)throw Error('red');return read;}};return q;}};
 const mod=await bundle('../src/productos.ts',true);return {calls,remove:()=>mod.eliminarProductoSigo('e1','p1')};
}
test('Baja confirmada exige ID/empresa correctos y activo=false',async()=>{const f=await fixture();await f.remove();assert.deepEqual(f.calls,[['rpc','eliminar_producto_sigo',{p_empresa_id:'e1',p_producto_id:'p1'}],['from','productos'],['select','id,empresa_id,activo'],['eq','empresa_id','e1'],['eq','id','p1']]);});
for(const data of [null,{id:'p1',empresa_id:'e1',activo:true},{id:'p2',empresa_id:'e1',activo:false},{id:'p1',empresa_id:'e2',activo:false},{id:'p1',empresa_id:'e1'}]) test(`No falso éxito: ${JSON.stringify(data)}`,async()=>{const f=await fixture({read:{data,error:null}});await assert.rejects(f.remove(),/no se pudo verificar la baja/);});
test('Readback falla: no confirma ni repite operación',async()=>{const f=await fixture({throwRead:true});await assert.rejects(f.remove(),/no se pudo verificar/);assert.equal(f.calls.filter(x=>x[0]==='rpc').length,1);});
test('RPC cero filas/false: no éxito ni readback',async()=>{const f=await fixture({rpc:{data:false,error:null}});await assert.rejects(f.remove(),/no fue confirmada/);assert.equal(f.calls.length,1);});
test('Servidor rechaza por stock después de preflight: error comprensible',async()=>{const f=await fixture({rpc:{data:null,error:{message:'PRODUCT_HAS_STOCK'}}});await assert.rejects(f.remove(),/producto sigue activo/);assert.equal(f.calls.length,1);});
test('Permiso/empresa rechazados: no lectura adicional',async()=>{const f=await fixture({rpc:{data:null,error:{message:'PERMISSION_DENIED'}}});await assert.rejects(f.remove());assert.equal(f.calls.length,1);});

test("Respuesta de RPC perdida: no anuncia éxito ni reintenta",async()=>{const f=await fixture({throwRpc:true});await assert.rejects(f.remove(),/Se perdió la respuesta/);assert.equal(f.calls.length,1);});
