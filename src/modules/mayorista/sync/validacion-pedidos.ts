/**
 * Verificaciones puras del pedido Mayorista, previas al envío.
 * No accede a SIGO, Supabase ni endpoints de ventas.
 */
import type { PedidoLocal } from "../offline/pedidos-locales";
import type { SnapshotCatalogo } from "../offline/catalogo-indexeddb";

export type RevisionPedido = {
  valido: boolean;
  advertencias: string[];
  errores: string[];
};
export function revisarPedido(pedido: PedidoLocal, catalogo: SnapshotCatalogo | null,
  maxHorasCatalogo = 24): RevisionPedido {
  const errores: string[] = [];
  const advertencias: string[] = [];
  if (!pedido.id || !pedido.empresaId || !pedido.vendedorId || !pedido.clienteId)
    errores.push("Faltan identificadores obligatorios");
  if (!pedido.lineas.length) errores.push("El pedido está vacío");
  for (const l of pedido.lineas) {
    if (!l.productoId || !Number.isSafeInteger(l.cantidad) || l.cantidad <= 0 ||
        !Number.isFinite(l.precioUnitario) || l.precioUnitario < 0)
      errores.push("Renglón con cantidad o precio inválido");
  }
  if (!catalogo) advertencias.push("No hay catálogo local para comprobar clientes y productos");
  else {
    if (catalogo.empresaId !== pedido.empresaId || catalogo.vendedorId !== pedido.vendedorId)
      errores.push("El catálogo pertenece a otra empresa o vendedor");
    const cliente = catalogo.clientes.find(c => c.id === pedido.clienteId);
    if (!cliente?.habilitado) errores.push("Cliente no habilitado en catálogo local");
    for (const linea of pedido.lineas) {
      if (!catalogo.productos.some(p => p.id === linea.productoId && p.activo))
        errores.push("Producto no habilitado: " + linea.productoId);
    }
    const edad = (Date.now() - Date.parse(catalogo.descargadoEn)) / 3_600_000;
    if (!Number.isFinite(edad) || edad < -5 / 60 || edad > maxHorasCatalogo)
      advertencias.push("Catálogo desactualizado; los precios y el stock deberán revisarse al sincronizar");
  }
  return { valido: errores.length === 0, errores, advertencias };
}

