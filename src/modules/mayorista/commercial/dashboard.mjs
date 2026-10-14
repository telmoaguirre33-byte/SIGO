import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
import {normalizeReportFilters,calculateManagementMetrics} from './management-metrics.mjs';
/** Todas las lecturas usan la transacción y el principal RLS de la petición. */
export function createDashboardTransaction({query,principal,readSharedMetrics}) {
  const E=principal.empresaId;
  const rows=async(sql,args=[E])=>(await query(sql,args)).rows;
  async function readMetricsData({personal=false}={}) {
    const data={empresaId:E,
      orders:await rows('SELECT pedido_id AS "pedidoId",vendedor_id AS "vendedorId",cliente_id AS "clienteId",recibido_en AS "recibidoEn",lineas,estado FROM mayorista.pedidos WHERE empresa_id=$1'),
      customers:await rows('SELECT cliente_id AS id,vendedor_id AS "vendedorId",ruta_id AS "rutaId",nombre,habilitado FROM mayorista.clientes WHERE empresa_id=$1'),
      routes:await rows('SELECT ruta_id AS id,nombre,zona FROM mayorista.rutas WHERE empresa_id=$1'),
      visits:(await rows('SELECT datos FROM mayorista.visitas WHERE empresa_id=$1')).map(r=>r.datos),
      products:await rows('SELECT producto_id AS id,nombre,activo FROM mayorista.productos WHERE empresa_id=$1'),
      sales:null,invoices:null,costs:null,dueBalances:null};
    if(!personal)Object.assign(data,{
      sellers:await rows('SELECT vendedor_id AS id,nombre FROM mayorista.vendedores WHERE empresa_id=$1'),
      loads:(await rows('SELECT datos FROM mayorista.cargas_operativas WHERE empresa_id=$1')).map(r=>r.datos),
      ledger:await rows('SELECT pedido_id AS "pedidoId",cliente_id AS "clienteId",tipo,centavos::text,creado_en AS fecha FROM mayorista.cuenta_movimientos WHERE empresa_id=$1'),
      collections:await rows('SELECT cliente_id AS "clienteId",tipo,centavos::text,creado_en AS fecha FROM mayorista.cobros_directos WHERE empresa_id=$1'),
      inventory:await rows('SELECT producto_id AS "productoId",unidades-reservadas AS disponibles FROM mayorista.inventario WHERE empresa_id=$1')});
    if(!personal){
      const root=(await rows('SELECT datos FROM mayorista.cargas_estado WHERE empresa_id=$1'))[0]?.datos;
      for(const load of Object.values(root?.cargas??{}))if(!data.loads.some(l=>l.id===load.id))data.loads.push({...load,historial:(root.historial??[]).filter(h=>h.input?.cargaId===load.id)});
    }
    if(readSharedMetrics){
      const shared=await readSharedMetrics(principal);
      if(shared?.empresaId!==E)throw new ApiError(403,'Fuente de otra empresa');
      for(const key of ['sales','invoices','costs','dueBalances'])if(shared[key]!==undefined){
        if(!Array.isArray(shared[key])||shared[key].some(e=>e.empresaId!==E||personal&&e.vendedorId!==principal.vendedorId))throw new ApiError(403,'Datos compartidos fuera del ámbito');
        data[key]=shared[key];
      }
    }
    return data;
  }
  return {readMetricsData,dashboard:async raw=>{
    if(!administrative(principal))throw new ApiError(403,'Sin permisos gerenciales');
    let filters;try{filters=normalizeReportFilters(raw);}catch(e){throw new ApiError(422,e.message);}
    return calculateManagementMetrics(await readMetricsData(),filters);
  }};
}
