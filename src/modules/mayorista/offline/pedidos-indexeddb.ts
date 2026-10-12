/**
 * IndexedDB aislado de SIGO Mayorista.
 * No escribe en Supabase ni en las tablas existentes de SIGO.
 * Almacenamiento transaccional de pedidos por empresa/vendedor.
 */
import type { PedidoLocal, LineaPedido, EnviarPedido } from "./pedidos-locales";
import { verificarResultadoEnvio } from "./pedidos-locales";

const DB_NAME = "sigo-mayorista-offline-v1";
const STORE = "pedidos";
const VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Error de almacenamiento"));
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Transacción fallida"));
    tx.onabort = () => reject(tx.error ?? new Error("Transacción cancelada"));
  });
}
function abrirDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB no disponible"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("porVendedor", ["empresaId", "vendedorId"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    req.onblocked = () => reject(new Error("Cerrá otras pestañas para actualizar almacenamiento"));
  });
}
async function operar<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrirDB();
  try {
    const tx = db.transaction(STORE, mode);
    const done = transactionDone(tx);
    const [result] = await Promise.all([request(fn(tx.objectStore(STORE))), done]);
    return result;
  } finally { db.close(); }
}

export class PedidosIndexedDB {
  private enProceso = false;
  constructor(readonly empresaId: string, readonly vendedorId: string) {
    if (!empresaId || !vendedorId) throw new Error("Empresa y vendedor obligatorios");
  }
  async listar(): Promise<PedidoLocal[]> {
    return operar("readonly", store => store.index("porVendedor").getAll([this.empresaId, this.vendedorId]));
  }
  async crear(clienteId: string, lineas: LineaPedido[], id: string = crypto.randomUUID()): Promise<PedidoLocal> {
    if (!clienteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !Array.isArray(lineas) || !lineas.length || lineas.some(l =>
      !l?.productoId || !Number.isSafeInteger(l.cantidad) || l.cantidad <= 0 ||
      !Number.isFinite(l.precioUnitario) || l.precioUnitario < 0
    )) throw new Error("Pedido inválido");
    const now = new Date().toISOString();
    const pedido: PedidoLocal = {
      id, empresaId: this.empresaId, vendedorId: this.vendedorId,
      clienteId, creadoEn: now, actualizadoEn: now,
      lineas: lineas.map(l => ({productoId: l.productoId, cantidad: l.cantidad, precioUnitario: l.precioUnitario})), estado: "pendiente", intentos: 0
    };
    try { await operar("readwrite", store => store.add(pedido)); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== "ConstraintError") throw error;
      const existente = await operar<PedidoLocal | undefined>("readonly", store => store.get(id));
      if (!existente || existente.empresaId !== this.empresaId || existente.vendedorId !== this.vendedorId ||
          existente.clienteId !== clienteId || JSON.stringify(existente.lineas.map(l => ({productoId: l.productoId, cantidad: l.cantidad, precioUnitario: l.precioUnitario}))) !== JSON.stringify(pedido.lineas))
        throw new Error("Conflicto de identificador de pedido");
      return existente;
    }
    return pedido;
  }
  private async actualizar(pedido: PedidoLocal): Promise<void> {
    const db = await abrirDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.get(pedido.id);
        req.onsuccess = () => {
          const actual = req.result as PedidoLocal | undefined;
          if (!actual || actual.empresaId !== this.empresaId || actual.vendedorId !== this.vendedorId ||
              pedido.empresaId !== this.empresaId || pedido.vendedorId !== this.vendedorId) { tx.abort(); return; }
          store.put(pedido);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("Pedido fuera de esta empresa/vendedor"));
        tx.onerror = () => reject(tx.error ?? new Error("Error al actualizar pedido"));
      });
    } finally { db.close(); }
  }

  async sincronizar(enviar: EnviarPedido): Promise<{ enviados: number; fallidos: number }> {
    if (this.enProceso) return { enviados: 0, fallidos: 0 };
    if (typeof navigator === "undefined" || !navigator.locks) throw new Error("Este navegador no admite sincronización segura entre pestañas");
    return navigator.locks.request(JSON.stringify([DB_NAME, this.empresaId, this.vendedorId]), {ifAvailable: true}, async lock => {
    if (!lock) return { enviados: 0, fallidos: 0 };
    this.enProceso = true;
    let enviados = 0, fallidos = 0;
    try {
      const pendientes = (await this.listar()).filter(p => p.estado !== "sincronizado");
      for (const p of pendientes) {
        const now = new Date().toISOString();
        const actual: PedidoLocal = {...p, estado: "sincronizando", intentos: p.intentos + 1, actualizadoEn: now, error: undefined};
        await this.actualizar(actual);
        try {
          // Reintentar con el mismo UUID; la API futura DEBE implementar idempotencia.
          const acuse = await enviar(actual);
          verificarResultadoEnvio(actual, acuse);
          await this.actualizar({...actual, estado: "sincronizado", confirmadoEn: acuse.confirmadoEn, actualizadoEn: new Date().toISOString()});
          enviados++;
        } catch (error) {
          await this.actualizar({...actual, estado: "error", error: error instanceof Error ? error.message : "Error de envío", actualizadoEn: new Date().toISOString()});
          fallidos++;
        }
      }
      return { enviados, fallidos };
    } finally { this.enProceso = false; }
    });
  }
}

