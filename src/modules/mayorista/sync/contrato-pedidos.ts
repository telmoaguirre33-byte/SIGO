import type { PedidoLocal } from "../offline/pedidos-locales";

/**
 * Contrato de recepción idempotente. Implementación futura en API aislada de Mayorista.
 * Prohibido enviar pedidos a endpoints existentes de Caja/Ventas.
 */
export type PedidoRemoto = {
  pedidoId: string;
  empresaId: string;
  vendedorId: string;
  clienteId: string;
  creadoEn: string;
  lineas: { productoId: string; cantidad: number; precioUnitario: number }[];
};
export type AcuseRemoto = {
  pedidoId: string;
  empresaId: string;
  recibidoEn: string;
  estado: "recibido" | "requiere_revision";
};
export function construirSolicitud(pedido: PedidoLocal): PedidoRemoto {
  if (!pedido.id || !pedido.empresaId || !pedido.vendedorId || !pedido.clienteId ||
      !pedido.lineas.length) throw new Error("Pedido incompleto");
  return {
    pedidoId: pedido.id,
    empresaId: pedido.empresaId,
    vendedorId: pedido.vendedorId,
    clienteId: pedido.clienteId,
    creadoEn: pedido.creadoEn,
    lineas: pedido.lineas.map(l => ({...l}))
  };
}
export function verificarAcuse(pedido: PedidoLocal, acuse: AcuseRemoto): { id: string; confirmadoEn: string } {
  if (acuse.pedidoId !== pedido.id || acuse.empresaId !== pedido.empresaId ||
      !Number.isFinite(Date.parse(acuse.recibidoEn)) ||
      !["recibido", "requiere_revision"].includes(acuse.estado)) {
    throw new Error("El servidor no confirmó correctamente el pedido");
  }
  // 'requiere_revision' significa recibido, no aprobado para despacho ni facturación.
  return { id: pedido.id, confirmadoEn: acuse.recibidoEn };
}
