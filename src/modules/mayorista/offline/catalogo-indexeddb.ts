/**
 * Catálogo offline del vendedor — contratos aislados de Mayorista.
 * Datos de referencia únicamente. Nunca se actualiza stock de SIGO desde aquí.
 */
export type RegistroOffline = { id: string; actualizadoEn: string };
export type ClienteRuta = RegistroOffline & {
  nombre: string; direccion?: string; rutaId?: string; latitud?: number; longitud?: number;
  habilitado: boolean;
};
export type ProductoMayorista = RegistroOffline & {
  codigo: string; nombre: string; unidadBase: string; activo: boolean;
};
export type PrecioMayorista = RegistroOffline & {
  productoId: string; listaId: string; presentacion: string; unidadesBase: number;
  precio: number; moneda: "ARS";
};
export type SnapshotCatalogo = {
  empresaId: string; vendedorId: string; version: string; descargadoEn: string;
  clientes: ClienteRuta[]; productos: ProductoMayorista[]; precios: PrecioMayorista[];
};
const DB = "sigo-mayorista-catalogo-v1";
const STORE = "snapshots";
function clave(empresaId: string, vendedorId: string) { return JSON.stringify([empresaId, vendedorId]); }
function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB no disponible")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir catálogo"));
    req.onblocked = () => reject(new Error("Cerrar otras pestañas para actualizar el catálogo"));
  });
}
export async function guardarCatalogo(snapshot: SnapshotCatalogo): Promise<void> {
  if (!snapshot.empresaId || !snapshot.vendedorId || !snapshot.version ||
      !Array.isArray(snapshot.clientes) || !Array.isArray(snapshot.productos) ||
      !Array.isArray(snapshot.precios)) throw new Error("Catálogo inválido");
  const db = await abrir();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot, clave(snapshot.empresaId, snapshot.vendedorId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar catálogo"));
      tx.onabort = () => reject(tx.error ?? new Error("Guardado cancelado"));
    });
  } finally { db.close(); }
}
export async function leerCatalogo(empresaId: string, vendedorId: string): Promise<SnapshotCatalogo | null> {
  const db = await abrir();
  try {
    const snapshot = await new Promise<SnapshotCatalogo | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.get(clave(empresaId, vendedorId));
      req.onsuccess = () => {
        if (req.result) { resolve(req.result as SnapshotCatalogo); return; }
        const legacy = store.get(empresaId + "::" + vendedorId);
        legacy.onsuccess = () => resolve((legacy.result as SnapshotCatalogo | undefined) ?? null);
        legacy.onerror = () => reject(legacy.error);
      };
      req.onerror = () => reject(req.error ?? new Error("No se pudo leer catálogo"));
    });
    if (snapshot && (snapshot.empresaId !== empresaId || snapshot.vendedorId !== vendedorId)) throw new Error("Catálogo de otra empresa/vendedor");
    return snapshot;
  } finally { db.close(); }
}
export function antiguedadCatalogoHoras(snapshot: SnapshotCatalogo, ahora = Date.now()): number {
  const ms = Date.parse(snapshot.descargadoEn);
  return Number.isFinite(ms) && ms <= ahora + 300_000 ? Math.max(0, (ahora - ms) / 3_600_000) : Infinity;
}

