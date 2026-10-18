import {createHash} from 'node:crypto';import {ApiError} from '../api/receive-order.mjs';import {administrative} from '../security/company-roles.mjs';import {canonical} from '../cargas/model.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createCollectionsTransaction({query,principal}){
 const admin=()=>{if(!administrative(principal))throw new ApiError(403,'Sin permisos de cobranza');};const E=principal.empresaId;
 const ledger=`SELECT cliente_id,centavos FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 UNION ALL SELECT cliente_id,CASE WHEN tipo='cobro' THEN -centavos ELSE centavos END FROM mayorista.cobros_directos WHERE empresa_id=$1`;
 return {
  collectionsAccounts:async()=>{admin();return {empresaId:E,cuentas:(await query(`SELECT cliente_id AS "clienteId",sum(centavos)::text AS "saldoCentavos" FROM (${ledger}) s GROUP BY cliente_id ORDER BY cliente_id`,[E])).rows,movimientos:(await query(`SELECT pedido_id AS "pedidoId",cliente_id AS "clienteId",comando_id AS "comandoId",tipo,centavos::text,actor_id AS "responsable",creado_en AS fecha FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 UNION ALL SELECT null,cliente_id,comando_id,tipo,CASE WHEN tipo='cobro' THEN -centavos ELSE centavos END::text,actor_id,creado_en FROM mayorista.cobros_directos WHERE empresa_id=$1 ORDER BY fecha DESC LIMIT 1000`,[E])).rows};},
  collectionCommand:async command=>{
   admin();if(command?.empresaId!==E)throw new ApiError(403,'Empresa ajena');const i=command.input;
   if(!uuid.test(command.id)||!['cobro','reembolso'].includes(command.tipo)||!uuid.test(i?.clienteId)||!Number.isSafeInteger(i.centavos)||i.centavos<1||typeof i.comprobante!=='string'||!i.comprobante.trim()||i.comprobante.length>160)throw new ApiError(422,'Cobranza inválida');
   const hash=createHash('sha256').update(JSON.stringify(canonical({tipo:command.tipo,input:i}))).digest('hex');const previous=(await query('SELECT huella,respuesta FROM mayorista.cobros_directos WHERE empresa_id=$1 AND comando_id=$2',[E,command.id])).rows[0];if(previous){if(previous.huella!==hash)throw new ApiError(409,'UUID de cobranza reutilizado');return previous.respuesta;}
   const customer=(await query('SELECT cliente_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2',[E,i.clienteId])).rows[0];if(!customer)throw new ApiError(404,'Cliente no disponible');
   if((await query('SELECT comando_id FROM mayorista.cobros_directos WHERE empresa_id=$1 AND tipo=$2 AND comprobante=$3',[E,command.tipo,i.comprobante.trim()])).rows.length)throw new ApiError(409,'Comprobante ya utilizado');
   const saldo=BigInt((await query(`SELECT coalesce(sum(centavos),0)::text AS saldo FROM (${ledger}) s WHERE cliente_id=$2`,[E,i.clienteId])).rows[0].saldo),amount=BigInt(i.centavos);
   if(command.tipo==='cobro'&&(saldo<=0n||amount>saldo)||command.tipo==='reembolso'&&(saldo>=0n||amount> -saldo))throw new ApiError(409,'Importe superior al saldo disponible');
   const result={id:command.id,empresaId:E,clienteId:i.clienteId,tipo:command.tipo,saldoCentavos:(saldo+(command.tipo==='cobro'?-amount:amount)).toString()};
   await query('INSERT INTO mayorista.cobros_directos(empresa_id,comando_id,cliente_id,tipo,centavos,comprobante,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[E,command.id,i.clienteId,command.tipo,i.centavos,i.comprobante.trim(),hash,principal.userId,JSON.stringify(result)]);return result;
  }
 };
}
