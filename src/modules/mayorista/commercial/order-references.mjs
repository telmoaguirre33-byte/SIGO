/** Valida sólo las referencias del pedido. La cotización compartida comprueba
 * producto activo, presentación, lista, oferta y visibilidad con la sesión SQL. */
export async function validateSharedOrder({query,principal,quote},order){
 const assigned=(await query('SELECT cliente_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2 AND vendedor_id=$3 AND habilitado',[principal.empresaId,order.clienteId,order.vendedorId])).rows;
 if(!assigned.length)return ['cliente no asignado'];
 const prices=await quote(order.clienteId,order.lineas);
 return order.lineas.flatMap((line,index)=>{
  const price=prices[index];
  return !price||price.productoId!==line.productoId||Number(price.cantidad)!==line.cantidad||!Number.isFinite(Number(price.precioUnitario))||Math.abs(Number(price.precioUnitario)-line.precioUnitario)>0.000001?['precio cambiado']:[];
 });
}
