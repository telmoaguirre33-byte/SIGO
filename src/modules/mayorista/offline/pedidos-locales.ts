/**
 * SIGO Mayorista - motor local de pedidos (fase 1).
 * Aislado: no importa ni modifica Caja, Ventas, Compras o Stock.
 * Los pedidos son borradores locales; NO constituyen ventas ni reservas de stock.
 */
export type EstadoPedido = "pendiente" | "sincronizando" | "sincronizado" | "error";
export type LineaPedido = { productoId: string; cantidad: number; precioUnitario: number };
export type PedidoLocal = {
  id: string;
  empresaId: string;
  vendedorId: string;
  clienteId: string;
  creadoEn: string;
  actualizadoEn: string;
  lineas: LineaPedido[];
  estado: EstadoPedido;
  intentos: number;
  error?: string;
  confirmadoEn?: string;
};
export type ResultadoEnvio = { id: string; empresaId: string; vendedorId: string; confirmadoEn: string };
export function verificarResultadoEnvio(pedido: PedidoLocal, acuse: ResultadoEnvio): void {
  if (!acuse || acuse.id !== pedido.id || acuse.empresaId !== pedido.empresaId ||
      acuse.vendedorId !== pedido.vendedorId || !Number.isFinite(Date.parse(acuse.confirmadoEn)))
    throw new Error("Acuse inválido: pedido, empresa, vendedor o fecha no coinciden");
}
export type EnviarPedido = (pedido: Readonly<PedidoLocal>) => Promise<ResultadoEnvio>;
const PREFIX = "sigo-mayorista-pedidos-v1";
const clave = (empresaId: string, vendedorId: string) =>
  [PREFIX, encodeURIComponent(empresaId), encodeURIComponent(vendedorId)].join(":");

function validarLineas(lineas: LineaPedido[]) {
  if (!lineas.length || lineas.some(l => !l.productoId || !Number.isFinite(l.cantidad) ||
    l.cantidad <= 0 || !Number.isFinite(l.precioUnitario) || l.precioUnitario < 0)) {
    throw new Error("Pedido inválido: revisá productos, cantidades y precios");
  }
}

export class ColaPedidosLocal {
  private readonly storageKey: string;
  private readonly empresaId: string;
  private readonly vendedorId: string;
  private sincronizacionActiva = false;
  constructor(empresaId: string, vendedorId: string) {
    if (!empresaId || !vendedorId) throw new Error("Empresa y vendedor son obligatorios");
    this.empresaId = empresaId;
    this.vendedorId = vendedorId;
    this.storageKey = clave(empresaId, vendedorId);
    if (typeof localStorage === "undefined") throw new Error("Almacenamiento local no disponible");
  }
  listar(): PedidoLocal[] {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Datos locales dañados");
    return parsed as PedidoLocal[];
  }
  private guardar(pedidos: PedidoLocal[]) {
    // Si se agota el almacenamiento, la excepción se propaga; nunca se informa guardado exitoso.
    localStorage.setItem(this.storageKey, JSON.stringify(pedidos));
  }
  crear(clienteId: string, lineas: LineaPedido[]): PedidoLocal {
    if (!clienteId) throw new Error("Seleccioná un cliente");
    validarLineas(lineas);
    const ahora = new Date().toISOString();
    const pedido: PedidoLocal = {
      id: crypto.randomUUID(), empresaId: this.empresaId, vendedorId: this.vendedorId,
      clienteId, creadoEn: ahora, actualizadoEn: ahora,
      lineas: lineas.map(l => ({ ...l })), estado: "pendiente", intentos: 0
    };
    this.guardar([...this.listar(), pedido]);
    return pedido;
  }
  private reemplazar(pedido: PedidoLocal) {
    const pedidos = this.listar();
    const index = pedidos.findIndex(p => p.id === pedido.id);
    if (index < 0) throw new Error("Pedido local no encontrado");
    pedidos[index] = pedido;
    this.guardar(pedidos);
  }
  async sincronizar(enviar: EnviarPedido): Promise<{ enviados: number; fallidos: number }> {
    if (this.sincronizacionActiva) return { enviados: 0, fallidos: 0 };
    this.sincronizacionActiva = true;
    let enviados = 0, fallidos = 0;
    try {
      // Un envío que quedó en 'sincronizando' se reintenta con el MISMO id.
      // El servidor DEBE imponer unicidad (empresaId,id) y devolver el mismo acuse.
      for (const pedido of this.listar().filter(p => p.estado !== "sincronizado")) {
        const actual = { ...pedido, estado: "sincronizando" as const,
          intentos: pedido.intentos + 1, actualizadoEn: new Date().toISOString(), error: undefined };
        this.reemplazar(actual);
        try {
          const acuse = await enviar(actual);
          verificarResultadoEnvio(actual, acuse);
          this.reemplazar({ ...actual, estado: "sincronizado", confirmadoEn: acuse.confirmadoEn,
            actualizadoEn: new Date().toISOString() });
          enviados++;
        } catch (error) {
          this.reemplazar({ ...actual, estado: "error",
            error: error instanceof Error ? error.message : "Error de sincronización",
            actualizadoEn: new Date().toISOString() });
          fallidos++;
        }
      }
      return { enviados, fallidos };
    } finally {
      this.sincronizacionActiva = false;
    }
  }
}

