import {ApiError} from '../api/receive-order.mjs';
import {assertIsolatedPool} from '../api/postgres-repository.mjs';
import {orderState} from '../cargas/model.mjs';
/** Proyección acotada: después de listar pedidos propios con RLS, solo devuelve
 * el estado público de esos mismos pedidos. No expone cargas, eventos ni terceros.
 * No concede permisos SQL ni ejecuta comandos comerciales. */
export async function sellerOrderStatuses({pool,databasePolicy,principal,orders}){
 (databasePolicy?.assertPool??assertIsolatedPool)(pool);
 if(principal.rol!=='vendedor'||!principal.vendedorId||orders.some(p=>p.empresaId!==principal.empresaId||p.vendedorId!==principal.vendedorId))throw new ApiError(403,'Historial fuera del vendedor');
 if(!orders.length)return orders;
 const rows=(await pool.query(`SELECT p.pedido_id,
   (SELECT ce.datos->'pedidos'->p.pedido_id::text FROM mayorista.cargas_estado ce WHERE ce.empresa_id=p.empresa_id) AS approved,
   (SELECT co.datos FROM mayorista.cargas_operativas co WHERE co.empresa_id=p.empresa_id AND co.datos->'pedidos' ? p.pedido_id::text LIMIT 1) AS load,
   (SELECT ep.comando->>'estado' FROM mayorista.eventos_pedido ep WHERE ep.empresa_id=p.empresa_id AND ep.pedido_id=p.pedido_id AND ep.comando->>'tipo'='estado' ORDER BY ep.version DESC LIMIT 1) AS legacy_state
   FROM mayorista.pedidos p JOIN mayorista.miembros m ON m.empresa_id=p.empresa_id AND m.vendedor_id=p.vendedor_id
   JOIN mayorista_private.usuarios u ON u.user_id=m.user_id
   JOIN mayorista_private.sesiones s ON s.user_id=m.user_id AND s.empresa_id=m.empresa_id
   WHERE p.empresa_id=$1 AND p.vendedor_id=$2 AND p.pedido_id=ANY($3::uuid[]) AND m.user_id=$4 AND m.rol='vendedor' AND m.activo AND u.activo AND s.session_id=$5 AND NOT s.revocada AND s.vence_en>now()`,[principal.empresaId,principal.vendedorId,orders.map(p=>p.pedidoId),principal.userId,principal.sessionId])).rows;
 if(rows.length!==orders.length)throw new ApiError(403,'Acceso al historial revocado');
 return orders.map(p=>{const row=rows.find(r=>r.pedido_id===p.pedidoId);return {...p,estadoOperativo:row.load||row.approved?orderState({order:p,approved:row.approved,load:row.load}):row.legacy_state??p.estado};});
}
