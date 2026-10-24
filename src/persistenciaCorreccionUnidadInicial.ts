import { validarIntento, type Intento } from './correccionUnidadInicial.ts';
export interface AlmacenSesion { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
/** SessionStorage sólo: sin tokens. Un registro vencido/corrupto/v1 nunca se elimina automáticamente. */
export function crearPersistenciaCorreccionUnidadInicial(storage: AlmacenSesion, contexto: {
  usuarioId: string; empresaId: string; productoId: string;
}, now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000) {
  if (Object.values(contexto).some(v => typeof v !== 'string' || !v) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw Error('Contexto de recuperación inválido');
  const suffix = [contexto.usuarioId, contexto.empresaId, contexto.productoId].map(encodeURIComponent).join(':');
  const key = 'sigo:correccion-unidad-inicial:v2:' + suffix;
  const legacyKey = 'sigo:correccion-unidad-inicial:v1:' + suffix;
  const checkLegacy = () => { if (storage.getItem(legacyKey) !== null) throw Error('Hay una solicitud v1 pendiente. Requiere recuperación compatible; no borrar ni reinterpretar como v2.'); };
  const read = () => {
    checkLegacy();
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (!record || record.schema !== 2 || record.usuarioId !== contexto.usuarioId || record.empresaId !== contexto.empresaId || record.productoId !== contexto.productoId
      || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt) || record.expiresAt <= record.createdAt)
      throw Error('Registro pendiente inválido; no borrar');
    validarIntento(record.intento, contexto);
    return record as { schema: 2; createdAt: number; expiresAt: number; intento: Intento };
  };
  return {
    key, legacyKey,
    tienePendiente: () => storage.getItem(key) !== null || storage.getItem(legacyKey) !== null,
    leer() { const record = read(); return record ? { intento: record.intento, expirado: now() >= record.expiresAt } : null; },
    guardar(intento: Intento) {
      validarIntento(intento, contexto);
      const existing = read();
      if (existing) {
        if (JSON.stringify(existing.intento) !== JSON.stringify(intento)) throw Error('Ya existe otra solicitud pendiente');
        return; // No renueva TTL ni sobrescribe payload al reintentar.
      }
      const createdAt = now();
      if (!Number.isFinite(createdAt) || !Number.isFinite(createdAt + ttlMs)) throw Error('Fecha de recuperación inválida');
      const raw = JSON.stringify({ schema: 2, ...contexto, createdAt, expiresAt: createdAt + ttlMs, intento });
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('No se pudo verificar la persistencia');
    },
    resolver() { checkLegacy(); storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('No se pudo cerrar el registro'); },
  };
}
