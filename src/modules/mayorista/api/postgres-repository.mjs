import {ApiError} from './receive-order.mjs';
export function assertIsolatedPool(pool){
  const o=pool?.options;
  if(!o || o.host!=='127.0.0.1' || Number(o.port)!==55471 || o.database!=='mayorista_qa')throw new ApiError(503,'Solo se permite PostgreSQL local de pruebas');
}
const columns=`empresa_id as "empresaId",pedido_id as "pedidoId",vendedor_id as "vendedorId",cliente_id as "clienteId",creado_en as "creadoEn",recibido_en as "recibidoEn",lineas,huella as hash,estado`;
function normalize(row){return row?{...row,creadoEn:row.creadoEn.toISOString(),recibidoEn:row.recibidoEn.toISOString()}:null;}
export function createPostgresRepository({enabled=false,pool}={}){
  return {withPrincipal:async(principal,fn)=>{
    if(!enabled)throw new ApiError(503,'Persistencia desactivada');assertIsolatedPool(pool);
    for(let attempt=0;attempt<4;attempt++){
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query('SET LOCAL ROLE authenticated');
      await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[principal.userId,JSON.stringify({sub:principal.userId,is_anonymous:false,session_id:principal.sessionId})]);
      const tx={
        find:async(e,id)=>normalize((await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2`,[e,id])).rows[0]),
        validateReferences:async order=>{
          const client=(await c.query('SELECT cliente_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2 AND vendedor_id=$3 AND habilitado',[order.empresaId,order.clienteId,order.vendedorId])).rows[0];
          if(!client)return ['cliente no asignado'];
          const ids=[...new Set(order.lineas.map(l=>l.productoId))];
          const products=(await c.query('SELECT producto_id FROM mayorista.productos WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[]) AND activo',[order.empresaId,ids])).rows;
          const prices=(await c.query('SELECT producto_id,precio,unidades_base FROM mayorista.precios WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[])',[order.empresaId,ids])).rows;
          const issues=[];
          for(const l of order.lineas){if(!products.some(p=>p.producto_id===l.productoId))issues.push('producto inactivo');if(!prices.some(p=>p.producto_id===l.productoId && Math.abs(Number(p.precio)/p.unidades_base-l.precioUnitario)<0.000001))issues.push('precio cambiado');}
          return issues;
        },
        insertOnce:async row=>{
          const result=await c.query(`INSERT INTO mayorista.pedidos(empresa_id,pedido_id,vendedor_id,cliente_id,creado_en,recibido_en,lineas,huella,estado) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(empresa_id,pedido_id) DO NOTHING RETURNING ${columns}`,[row.empresaId,row.pedidoId,row.vendedorId,row.clienteId,row.creadoEn,row.recibidoEn,JSON.stringify(row.lineas),row.hash,row.estado]);
          return normalize(result.rows[0])??tx.find(row.empresaId,row.pedidoId);
        },
        list:async()=> (await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 ORDER BY recibido_en DESC LIMIT 500`,[principal.empresaId])).rows.map(normalize)
      };
      const result=await fn(tx);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});if(!['40001','40P01'].includes(e.code)||attempt===3)throw e;}finally{c.release();}
    }
  }};
}
