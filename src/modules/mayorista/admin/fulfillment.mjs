// Flujo comercial independiente. No reserva, descuenta ni devuelve stock SIGO.
const nextStates={recibido:['preparacion','cancelado'],preparacion:['despachado','cancelado'],despachado:['entregado'],entregado:[],cancelado:[]};
const note=value=>{if(typeof value!=='string'||value.trim().length<3||value.length>500)throw new Error('Indicá un comprobante o motivo (3 a 500 caracteres)');return value.trim();};
export function createFulfillment(order){
  if(!order?.empresaId||!order.pedidoId&&!order.id||!Array.isArray(order.lineas)||!order.lineas.length||!['recibido','sincronizado'].includes(order.estado))throw new Error('Solo se preparan pedidos recibidos');
  return {empresaId:order.empresaId,pedidoId:order.pedidoId??order.id,estado:'recibido',version:0,lineas:structuredClone(order.lineas),devoluciones:[],cobranzas:[],eventos:[]};
}
export function applyFulfillment(state,command,actor){
  if(!actor||actor.empresaId!==state.empresaId||actor.rol!=='administrador'||!actor.userId)throw new Error('Sin permisos administrativos en esta empresa');
  if(command.empresaId!==state.empresaId||command.pedidoId!==state.pedidoId||!command.id)throw new Error('Comando fuera del pedido/empresa');
  const content=JSON.stringify({tipo:command.tipo,estado:command.estado??null,linea:command.linea??null,cantidad:command.cantidad??null,centavos:command.centavos??null,nota:command.nota??null});
  const previous=state.eventos.find(e=>e.id===command.id);
  if(previous){if(previous.content!==content)throw new Error('Identificador reutilizado con contenido diferente');return state;}
  if(command.version!==state.version)throw new Error('Edición concurrente: actualizá el pedido');
  const next=structuredClone(state),reason=note(command.nota);
  if(command.tipo==='estado'){
    if(!nextStates[state.estado]?.includes(command.estado))throw new Error('Transición comercial inválida');next.estado=command.estado;
  }else if(command.tipo==='devolucion'){
    if(state.estado!=='entregado'||!Number.isSafeInteger(command.linea)||!state.lineas[command.linea]||!Number.isSafeInteger(command.cantidad)||command.cantidad<1)throw new Error('Devolución inválida');
    const returned=state.devoluciones.filter(d=>d.linea===command.linea).reduce((sum,d)=>sum+d.cantidad,0);
    if(returned+command.cantidad>state.lineas[command.linea].cantidad)throw new Error('No se puede devolver más de lo entregado');
    next.devoluciones.push({id:command.id,linea:command.linea,cantidad:command.cantidad,nota:reason});
  }else if(command.tipo==='cobranza'){
    if(state.estado!=='entregado'||!Number.isSafeInteger(command.centavos)||command.centavos<=0)throw new Error('Cobranza inválida');
    const balance=fulfillmentBalance(state);if(command.centavos>balance.saldoCentavos)throw new Error('Cobranza superior al saldo');
    next.cobranzas.push({id:command.id,centavos:command.centavos,nota:reason});
  }else throw new Error('Operación comercial inválida');
  // Una devolución posterior a la cobranza puede generar saldo a favor; nunca mueve Caja.
  next.version++;next.eventos.push({id:command.id,content,actor:actor.userId,nota:reason,version:next.version});return next;
}
export function fulfillmentBalance(state){
  const totalCentavos=state.lineas.reduce((sum,l)=>sum+Math.round(l.precioUnitario*l.cantidad*100),0);
  const devolucionCentavos=state.lineas.reduce((sum,l,index)=>{const returned=state.devoluciones.filter(d=>d.linea===index).reduce((n,d)=>n+d.cantidad,0);return sum+Math.round(Math.round(l.precioUnitario*l.cantidad*100)*returned/l.cantidad);},0);
  const cobradoCentavos=state.cobranzas.reduce((sum,c)=>sum+c.centavos,0);
  if(![totalCentavos,devolucionCentavos,cobradoCentavos].every(Number.isSafeInteger))throw new Error('Importe fuera del rango permitido');
  return {totalCentavos,devolucionCentavos,cobradoCentavos,saldoCentavos:totalCentavos-devolucionCentavos-cobradoCentavos};
}
