/** Transporte hacia las RPC SIGO compartidas. Recibe la sesión SIGO del host, nunca una clave de servicio. */
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function createSharedCommerce({empresaId,rpc,sourceMode}={}){
 const gate=()=>{if(sourceMode!=='sigo'||!uuid(empresaId)||typeof rpc!=='function')throw new Error('Integración comercial compartida no habilitada');};
 const invoke=async(name,args)=>{gate();const response=await rpc(name,args);
  if(!response||!['confirmado','requiere_autorizacion','requiere_revision','aprobado','rechazado'].includes(response.estado)||response.comandoId!==args.p_comando_id||response.empresaId!==undefined&&response.empresaId!==empresaId)throw new Error('Respuesta compartida inválida');
  if(response.estado==='confirmado'&&(response.empresaId!==empresaId||name==='registrar_entrega_mayorista_sigo'&&!uuid(response.ventaId)||name==='registrar_cobro_mayorista_sigo'&&!uuid(response.movimientoId)))throw new Error('Comprobante compartido inválido');
  return response;
 };
 return {
  read:async()=>{gate();const result=await rpc('leer_comercio_mayorista_sigo',{p_empresa_id:empresaId});if(result?.empresaId!==empresaId||!Array.isArray(result.operaciones))throw new Error('Estado comercial compartido inválido');return result;},
  creditNote:async({devolucionId})=>{gate();if(!uuid(devolucionId))throw Error('Devolución inválida');const result=await rpc('emitir_nota_credito_mayorista_sigo',{empresaId,devolucionId});if(result?.ok!==true||result.ambiente!=='homologacion'||result.devolucionId!==devolucionId||!/^\d{14}$/.test(result.comprobante?.cae??''))throw Error('Nota de crédito no confirmada');return result;},
  invoice:async({id,ventaId,puntoVenta,tipoCbte,condicionIvaReceptorId})=>{gate();if(!uuid(id)||!uuid(ventaId)||!Number.isInteger(puntoVenta)||puntoVenta<1||![1,6,11].includes(tipoCbte))throw new Error('Solicitud fiscal inválida');const result=await rpc('facturar_entrega_mayorista_sigo',{empresaId,comandoId:id,puntoVenta,tipoCbte,condicionIvaReceptorId});if(result?.ok!==true||result.ambiente!=='homologacion'||result.comprobante?.venta_id!==ventaId||!/^\d{14}$/.test(result.comprobante?.cae??''))throw new Error('Comprobante fiscal no confirmado');return result;},
  delivery:async(load,pedidoId,medioPago)=>{
   gate();const p=load?.pedidos?.[pedidoId],event=load?.historial?.find(h=>h.tipo==='entregar'&&h.input?.pedidoId===pedidoId);
   if(!p?.entrega||!uuid(pedidoId)||!uuid(p.clienteId)||!uuid(event?.id)||!['efectivo','transferencia','cuenta_corriente'].includes(medioPago))throw new Error('Entrega o condición de pago inválida');
   const lineas=event.input.lineas.filter(l=>l.entregado>0).map(l=>{const original=p.lineas.find(x=>x.productoId===l.productoId);if(!uuid(l.productoId)||!original||!Number.isSafeInteger(l.entregado)||!Number.isFinite(original.precioUnitario))throw new Error('Detalle de entrega inválido');return {productoId:l.productoId,cantidad:l.entregado,precioUnitario:original.precioUnitario};});
   if(!lineas.length)throw new Error('La entrega rechazada no genera venta');
   return invoke('registrar_entrega_mayorista_sigo',{p_empresa_id:empresaId,p_comando_id:event.id,p_datos:{pedidoId,clienteId:p.clienteId,...(p.vendedorId?{vendedorId:p.vendedorId}:{}),...(p.rutaId?{rutaId:p.rutaId}:{}),medioPago,lineas}});
  },
  authorize:(commandId,approve,motive)=>{if(!uuid(commandId)||typeof approve!=='boolean'||typeof motive!=='string'||!motive.trim())throw new Error('Autorización inválida');return invoke('autorizar_credito_mayorista_sigo',{p_empresa_id:empresaId,p_comando_id:commandId,p_aprobar:approve,p_motivo:motive});},
  collection:({id,clienteId,pedidoId=null,centavos,medio,comprobante})=>{if(!uuid(id)||!uuid(clienteId)||pedidoId!==null&&!uuid(pedidoId)||!Number.isSafeInteger(centavos)||centavos<1||!['efectivo','transferencia'].includes(medio)||!comprobante?.trim())throw new Error('Cobranza inválida');return invoke('registrar_cobro_mayorista_sigo',{p_empresa_id:empresaId,p_comando_id:id,p_cliente_id:clienteId,p_pedido_id:pedidoId,p_centavos:centavos,p_medio:medio,p_comprobante:comprobante});}
 };
}
