import type { Intento } from './correccionUnidadInicial.ts';
export interface AlmacenSesion { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
/** SessionStorage sólo: sin tokens. Un registro vencido/corrupto nunca se elimina automáticamente. */
export function crearPersistenciaCorreccionUnidadInicial(storage: AlmacenSesion, contexto: {
  usuarioId: string; empresaId: string; productoId: string;
}, now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000) {
  if (Object.values(contexto).some(v => typeof v !== 'string' || !v) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw Error('Contexto de recuperación inválido');
  const key = 'sigo:correccion-unidad-inicial:v1:' + [contexto.usuarioId, contexto.empresaId, contexto.productoId].map(encodeURIComponent).join(':');
  const read = () => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (record.schema !== 1 || record.usuarioId !== contexto.usuarioId || record.empresaId !== contexto.empresaId || record.productoId !== contexto.productoId
      || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt) || record.expiresAt <= record.createdAt
      || !record.intento || record.intento.preview?.empresaId !== contexto.empresaId || record.intento.preview?.productoId !== contexto.productoId) throw Error('Registro pendiente inválido; no borrar');
    return record as { schema: 1; createdAt: number; expiresAt: number; intento: Intento };
  };
  return {
    key,
    leer() { const record = read(); return record ? { intento: record.intento, expirado: now() >= record.expiresAt } : null; },
    guardar(intento: Intento) {
      if (intento.preview.empresaId !== contexto.empresaId || intento.preview.productoId !== contexto.productoId) throw Error('Contexto diferente');
      const existing = read();
      if (existing) {
        if (JSON.stringify(existing.intento) !== JSON.stringify(intento)) throw Error('Ya existe otra solicitud pendiente');
        return; // No renueva TTL ni sobrescribe payload al reintentar.
      }
      const createdAt = now();
      const raw = JSON.stringify({ schema: 1, ...contexto, createdAt, expiresAt: createdAt + ttlMs, intento });
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('No se pudo verificar la persistencia');
    },
    resolver() { storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('No se pudo cerrar el registro'); },
  };
}
