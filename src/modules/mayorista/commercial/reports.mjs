import {ApiError} from '../api/receive-order.mjs';import {administrative} from '../security/company-roles.mjs';
export function createReportTransaction({query,principal}){return {managementReport:async()=>{if(!administrative(principal))throw new ApiError(403,'Sin permisos gerenciales');const E=principal.empresaId;return {empresaId:E,vendedores:(await query(`SELECT v.vendedor_id AS "vendedorId",v.nombre,
 (SELECT count(*)::int FROM mayorista.clientes c WHERE c.empresa_id=v.empresa_id AND c.vendedor_id=v.vendedor_id) AS clientes,
 (SELECT count(*)::int FROM mayorista.pedidos p WHERE p.empresa_id=v.empresa_id AND p.vendedor_id=v.vendedor_id) AS pedidos,
 (SELECT coalesce(sum((l->>'cantidad')::numeric*(l->>'precioUnitario')::numeric),0)::text FROM mayorista.pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.lineas) l WHERE p.empresa_id=v.empresa_id AND p.vendedor_id=v.vendedor_id) AS importe,
 (SELECT count(*)::int FROM mayorista.visitas x WHERE x.empresa_id=v.empresa_id AND x.vendedor_id=v.vendedor_id) AS visitas
 FROM mayorista.vendedores v WHERE v.empresa_id=$1 ORDER BY v.nombre`,[E])).rows,cargas:(await query("SELECT datos->>'estado' AS estado,count(*)::int AS cantidad FROM mayorista.cargas_operativas WHERE empresa_id=$1 GROUP BY datos->>'estado'",[E])).rows};}};}
