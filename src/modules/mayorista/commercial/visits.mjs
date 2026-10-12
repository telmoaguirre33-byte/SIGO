import {createHash} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeVisit(input){
  if(![input?.id,input?.empresaId,input?.vendedorId,input?.clienteId].every(v=>uuid.test(v))||!['con_pedido','sin_pedido','ausente'].includes(input.resultado)||typeof input.nota!=='string'||input.nota.length>1000||!Number.isFinite(Date.parse(input.registradaEn)))throw new ApiError(422,'Visita inválida');
  let gps=null;
  if(input.gps?.error!==undefined){if(![1,2,3,'no_disponible'].includes(input.gps.error))throw new ApiError(422,'Error GPS inválido');gps={error:input.gps.error};}
  else if(input.gps){const {latitud,longitud,precision}=input.gps;if(![latitud,longitud,precision].every(Number.isFinite)||Math.abs(latitud)>90||Math.abs(longitud)>180||precision<0||precision>100000)throw new ApiError(422,'Coordenadas inválidas');gps={latitud,longitud,precision};}
  return {id:input.id.toLowerCase(),empresaId:input.empresaId.toLowerCase(),vendedorId:input.vendedorId.toLowerCase(),clienteId:input.clienteId.toLowerCase(),resultado:input.resultado,nota:input.nota,gps,registradaEn:new Date(input.registradaEn).toISOString()};
}
export function createVisitsTransaction({query,principal}){
  const fields='visita_id AS id,empresa_id AS "empresaId",vendedor_id AS "vendedorId",recibida_en AS "recibidaEn",huella';
  return {
    visits:async()=> (await query('SELECT datos,recibida_en FROM mayorista.visitas WHERE empresa_id=$1 ORDER BY recibida_en DESC LIMIT 500',[principal.empresaId])).rows.map(r=>({...r.datos,recibidaEn:r.recibida_en.toISOString()})),
    receiveVisit:async input=>{
      const visit=normalizeVisit(input);if(visit.empresaId!==principal.empresaId||visit.vendedorId!==principal.vendedorId||!principal.permissions?.includes('pedidos:crear'))throw new ApiError(403,'Visita fuera de la sesión');
      const hash=createHash('sha256').update(JSON.stringify(visit)).digest('hex');let row=(await query(`SELECT ${fields} FROM mayorista.visitas WHERE empresa_id=$1 AND visita_id=$2`,[visit.empresaId,visit.id])).rows[0];
      if(!row){if(!(await query('SELECT cliente_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2 AND vendedor_id=$3 AND habilitado',[visit.empresaId,visit.clienteId,visit.vendedorId])).rows.length)throw new ApiError(403,'Cliente no asignado');
        row=(await query(`INSERT INTO mayorista.visitas(empresa_id,visita_id,vendedor_id,cliente_id,datos,huella) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(empresa_id,visita_id) DO NOTHING RETURNING ${fields}`,[visit.empresaId,visit.id,visit.vendedorId,visit.clienteId,JSON.stringify(visit),hash])).rows[0]??(await query(`SELECT ${fields} FROM mayorista.visitas WHERE empresa_id=$1 AND visita_id=$2`,[visit.empresaId,visit.id])).rows[0];
      }
      if(!row||row.huella!==hash)throw new ApiError(409,'UUID de visita reutilizado');
      return {id:row.id,empresaId:row.empresaId,vendedorId:row.vendedorId,recibidaEn:row.recibidaEn.toISOString()};
    }
  };
}
