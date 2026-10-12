import {ApiError} from '../api/receive-order.mjs';
import {createLoadsState,applyLoadCommand} from './model.mjs';
/** El llamador ya abrió transacción con rol authenticated/contexto verificado/RLS. */
export function createCargasTransaction({query,principal,findOrder,fulfillment}){
  const gate=()=>{if(principal.rol!=='administrador')throw new ApiError(403,'Sin permisos de cargas');};
  const read=async()=>{gate();return (await query('SELECT datos FROM mayorista.cargas_estado WHERE empresa_id=$1',[principal.empresaId])).rows[0]?.datos??createLoadsState(principal.empresaId);};
  return {
    cargasState:read,
    cargasCommand:async command=>{
      gate();if(command.empresaId!==principal.empresaId)throw new ApiError(403,'Otra empresa');
      const state=await read();let effective=command;
      if(state.comandos.some(c=>c.id===command.id)){try{return applyLoadCommand(state,command,principal);}catch(e){throw new ApiError(409,e.message);}}
      // No aceptar precios, clientes ni estado aprobado aportados por el cliente HTTP.
      if(command.tipo==='aprobar'){
        const row=await findOrder(principal.empresaId,command.input?.pedidoId);if(!row)throw new ApiError(404,'Pedido no recibido');
        const operation=await fulfillment({pedidoId:row.pedidoId});if(operation.estado!=='recibido')throw new ApiError(409,'Pedido ya procesado individualmente');
        const names=(await query('SELECT producto_id,nombre FROM mayorista.productos WHERE empresa_id=$1',[principal.empresaId])).rows;
        const customer=(await query('SELECT nombre,ruta_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2',[principal.empresaId,row.clienteId])).rows[0];
        effective={...command,input:{pedido:{...row,cliente:customer?.nombre??row.clienteId,rutaId:customer?.ruta_id??null,lineas:row.lineas.map(l=>({...l,nombre:names.find(n=>n.producto_id===l.productoId)?.nombre??l.productoId}))}}};
      }
      if(command.tipo==='codigo'){
        if(!(await query('SELECT producto_id FROM mayorista.productos WHERE empresa_id=$1 AND producto_id=$2 AND activo',[principal.empresaId,command.input?.productoId])).rows.length)throw new ApiError(422,'Producto no disponible');
      }
      let next;try{next=applyLoadCommand(state,effective,principal,new Date().toISOString(),command);}catch(e){throw new ApiError(409,e.message);}
      if(next.revision===state.revision)return next;
      for(const [id,p] of Object.entries(next.pedidos)){
        if(p.cargaId&&!state.pedidos[id]?.cargaId)await query('INSERT INTO mayorista.cargas_asignaciones(empresa_id,pedido_id,carga_id) VALUES($1,$2,$3)',[principal.empresaId,id,p.cargaId]);
        if(!p.cargaId&&state.pedidos[id]?.cargaId)await query('DELETE FROM mayorista.cargas_asignaciones WHERE empresa_id=$1 AND pedido_id=$2',[principal.empresaId,id]);
      }
      await query('INSERT INTO mayorista.cargas_estado(empresa_id,revision,datos) VALUES($1,$2,$3::jsonb) ON CONFLICT(empresa_id) DO UPDATE SET revision=excluded.revision,datos=excluded.datos',[principal.empresaId,next.revision,JSON.stringify(next)]);return next;
    }
  };
}
