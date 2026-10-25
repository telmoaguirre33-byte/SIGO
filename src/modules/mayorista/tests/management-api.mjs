import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyManagementApi({pool,call,tokens,empresaId:E,otraEmpresa:B,vendedorId:V}){
 const results=[],check=async(name,fn)=>{await fn();results.push({name,status:'pass'});console.log('PASS:',name);};
 const from=new Date();from.setUTCDate(1);const end=new Date(from);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
 const input={id:randomUUID(),vendedorId:V,metrica:'pedidos',periodo:'mensual',desde:from.toISOString().slice(0,10),hasta:end.toISOString().slice(0,10),objetivo:50,activa:true};
 const command={id:randomUUID(),empresaId:E,version:0,input};
 await check('Panel separa pedido, entrega, venta, factura y cobro por fuentes reales',async()=>{
   const r=await call('/admin/dashboard?periodo=mes',{token:tokens.gerencia});assert.equal(r.status,200);
   assert.equal(r.body.empresaId,E);assert.equal(r.body.resumen.facturado,null);assert.equal(r.body.resumen.vendido,null);assert.equal(r.body.resumen.margen,null);assert.ok(r.body.resumen.pedidos>0);assert.ok(r.body.resumen.mercaderiaEntregada>0);assert.ok(r.body.resumen.cobrado>0);
 });
 await check('Filtros y permisos de panel se validan en servidor',async()=>{
   for(const role of ['vendedor','armador','chofer'])assert.equal((await call('/admin/dashboard',{token:tokens[role]})).status,403);
   assert.equal((await call('/admin/dashboard?periodo=personalizado&desde=2026-02-30&hasta=2026-03-03',{token:tokens.gerencia})).status,422);
   const other=await call('/admin/dashboard',{token:tokens.ajeno});assert.equal(other.status,200);assert.equal(other.body.resumen.pedidos,0);
   const route=await call('/admin/dashboard?rutaId='+randomUUID(),{token:tokens.gerencia});assert.equal(route.body.resumen.mercaderiaEntregada,0);
 });
 await check('Objetivos persistentes mantienen UUID/version y rechazan reintento alterado',async()=>{
   const created=await call('/admin/goals/commands',{token:tokens.gerencia,body:command});assert.equal(created.status,200);assert.equal(created.body.version,1);
   assert.deepEqual((await call('/admin/goals/commands',{token:tokens.gerencia,body:command})).body,created.body);
   assert.equal((await call('/admin/goals/commands',{token:tokens.gerencia,body:{...command,input:{...input,objetivo:60}}})).status,409);
   assert.equal((await call('/admin/goals/commands',{token:tokens.administracion,body:{...command,id:randomUUID()}})).status,409);
 });
 await check('Vendedor recibe exclusivamente sus metas y sus resultados confirmados',async()=>{
   assert.equal((await call('/admin/goals/commands',{token:tokens.gerencia,body:{...command,id:randomUUID(),input:{...input,id:randomUUID(),vendedorId:null}}})).status,200);
   const seller=await call('/goals',{token:tokens.vendedor});assert.equal(seller.status,200);assert.equal(seller.body.objetivos.length,1);assert.equal(seller.body.objetivos[0].vendedorId,V);assert.ok(seller.body.objetivos[0].real>0);
   assert.equal((await call('/goals',{token:tokens.ajeno})).body.objetivos.length,0);
   for(const role of ['vendedor','armador','chofer'])assert.equal((await call('/admin/goals/commands',{token:tokens[role],body:{...command,id:randomUUID()}})).status,403);
   assert.equal((await call('/admin/goals/commands',{token:tokens.gerencia,body:{...command,id:randomUUID(),empresaId:B}})).status,403);
   assert.ok((await call('/catalog',{token:tokens.vendedor})).body.metas.every(g=>g.vendedorId===V));
 });
 await check('RLS impide editar metas a vendedor y consultar las de otra empresa',async()=>{
   const U=(await call('/me',{token:tokens.vendedor})).body.userId,c=await pool.connect();
   try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[U]);
    assert.equal((await c.query('UPDATE mayorista.metas SET objetivo=1 WHERE empresa_id=$1',[E])).rowCount,0);
    assert.equal((await c.query('SELECT * FROM mayorista.metas WHERE empresa_id=$1 AND vendedor_id IS NULL',[E])).rows.length,0);
    assert.equal((await c.query('SELECT * FROM mayorista.metas WHERE empresa_id=$1',[B])).rows.length,0);
   }finally{await c.query('ROLLBACK');c.release();}
 });
 return results;
}
