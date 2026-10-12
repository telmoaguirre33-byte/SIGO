import {ApiError} from '../api/receive-order.mjs';
import {orderBalance} from '../cargas/model.mjs';
/** Libro propio de Mayorista. Débitos por entrega, créditos por devolución y cobros
 * recién al revisar rendición. Nunca toca Caja ni cuentas corrientes de SIGO. */
export function createAccountsTransaction({query,principal}){
 const admin=()=>{if(principal.rol!=='administrador')throw new ApiError(403,'Sin permisos de cuentas mayoristas');};
 return {
  accounts:async()=>{admin();return {empresaId:principal.empresaId,cuentas:(await query('SELECT cliente_id AS "clienteId",sum(centavos)::text AS "saldoCentavos" FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 GROUP BY cliente_id ORDER BY cliente_id',[principal.empresaId])).rows,movimientos:(await query('SELECT pedido_id AS "pedidoId",cliente_id AS "clienteId",comando_id AS "comandoId",tipo,centavos::text,actor_id AS "responsable",creado_en AS fecha FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 ORDER BY creado_en,comando_id LIMIT 1000',[principal.empresaId])).rows};},
  accountLoadChanges:async(before,after,command)=>{
   admin();if(after.revision===before.revision)return;
   const load=after.cargas[command.input?.cargaId],old=before.cargas[command.input?.cargaId];if(!load)return;
   for(const [pedidoId,p] of Object.entries(load.pedidos)){
    const previous=old?.pedidos[pedidoId];if(!previous)continue;
    const delta=orderBalance(p).totalCentavos-orderBalance(previous).totalCentavos;
    const events=[];if(delta)events.push({tipo:delta>0?'entrega':'devolucion',centavos:delta});
    if(p.rendicion?.estado==='revisada'&&p.rendicion.centavos>0){
      const paid=(await query("SELECT 1 FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 AND pedido_id=$2 AND tipo='cobranza'",[principal.empresaId,pedidoId])).rows.length;
      if(!paid)events.push({tipo:'cobranza',centavos:-p.rendicion.centavos});
    }
    for(const event of events){if(!Number.isSafeInteger(event.centavos)||Math.abs(event.centavos)>9007199254740991)throw new ApiError(422,'Importe inválido');
     await query('INSERT INTO mayorista.cuenta_movimientos(empresa_id,comando_id,pedido_id,cliente_id,tipo,centavos,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[principal.empresaId,command.id,pedidoId,p.clienteId,event.tipo,event.centavos,principal.userId]);
    }
   }
  }
 };
}
