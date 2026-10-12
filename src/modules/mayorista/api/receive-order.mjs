import {createHash} from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ApiError extends Error {constructor(status,message) {super(message);this.status=status;}}
export function normalizeOrder(body) {
  if (!UUID.test(body?.pedidoId) || !UUID.test(body?.empresaId) || !UUID.test(body?.vendedorId) || !UUID.test(body?.clienteId) ||
      !Number.isFinite(Date.parse(body?.creadoEn)) || !Array.isArray(body?.lineas) || !body.lineas.length || body.lineas.length > 200)
    throw new ApiError(422,'Pedido inválido');
  const lineas = body.lineas.map(l => {
    if (!UUID.test(l?.productoId) || !Number.isSafeInteger(l?.cantidad) || l.cantidad <= 0 || l.cantidad > 1000000 ||
        !Number.isFinite(l?.precioUnitario) || l.precioUnitario < 0 || l.precioUnitario > 1000000000) throw new ApiError(422,'Renglón inválido');
    return {productoId:l.productoId.toLowerCase(),cantidad:l.cantidad,precioUnitario:l.precioUnitario};
  });
  return {pedidoId:body.pedidoId.toLowerCase(),empresaId:body.empresaId.toLowerCase(),vendedorId:body.vendedorId.toLowerCase(),clienteId:body.clienteId.toLowerCase(),creadoEn:new Date(body.creadoEn).toISOString(),lineas};
}
/** No se monta en ningún endpoint ni se conecta a SIGO. Disabled por defecto.
 * auth.verify debe comprobar firma, audiencia, emisor, sesión y revocación en servidor.
 * repository.withPrincipal debe operar con JWT del usuario/RLS, nunca service_role.
 * tx.insertOnce impone UNIQUE(empresa_id,pedido_id) y devuelve la fila ganadora.
 * La validación de referencias y la inserción deben compartir una transacción. */
export function createOrderReceiver({enabled=false,auth,repository,now=Date.now}={}) {
  return async ({token,body}) => {
    if (!enabled || !auth?.verify || !repository?.withPrincipal) throw new ApiError(503,'Recepción Mayorista desactivada');
    const principal = await auth.verify(token);
    if (!principal?.userId || !principal?.sessionId || principal.revoked || principal.anonymous ||
        !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now()) throw new ApiError(401,'Sesión inválida');
    const order = normalizeOrder(body);
    if (principal.empresaId !== order.empresaId || principal.vendedorId !== order.vendedorId || !principal.permissions?.includes('pedidos:crear'))
      throw new ApiError(403,'Pedido fuera del vendedor/empresa autorizados');
    const hash = createHash('sha256').update(JSON.stringify(order)).digest('hex');
    return repository.withPrincipal(principal,async tx => {
      // Recuperar acuse antes de validar precios actuales: un reintento no invalida un pedido ya recibido.
      const existing = await tx.find(order.empresaId,order.pedidoId);
      if (existing) return acknowledge(existing,hash,order);
      const issues = await tx.validateReferences(order);
      if (!Array.isArray(issues)) throw new ApiError(503,'Validación de catálogo no disponible');
      if (issues.length) throw new ApiError(409,'Pedido requiere revisión de clientes/productos/precios');
      const row = await tx.insertOnce({...order,hash,recibidoEn:new Date(now()).toISOString(),estado:'recibido'});
      return acknowledge(row,hash,order);
    });
  };
}
function acknowledge(row,hash,order) {
  if (!row || row.empresaId !== order.empresaId || row.pedidoId !== order.pedidoId || row.hash !== hash) throw new ApiError(409,'UUID reutilizado con contenido diferente');
  if (!Number.isFinite(Date.parse(row.recibidoEn)) || row.estado !== 'recibido') throw new ApiError(503,'Acuse almacenado inválido');
  return {pedidoId:row.pedidoId,empresaId:row.empresaId,vendedorId:row.vendedorId,recibidoEn:row.recibidoEn,estado:row.estado};
}
