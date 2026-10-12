// Datos exclusivamente ficticios de la demostración; no es una frontera de autorización.
const DB = 'sigo-mayorista-demo-aux-v1';
const scopeKey = scope => JSON.stringify([scope.empresaId, scope.vendedorId]);
async function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('drafts');
      const visits = req.result.createObjectStore('visits', {keyPath: 'id'});
      visits.createIndex('scope', ['empresaId', 'vendedorId']);
      req.result.createObjectStore('receipts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Cerrá otras pestañas para actualizar los datos locales'));
  });
}
async function transaction(store, mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result;
      try { action(tx.objectStore(store), value => {result = value;}, tx); }
      catch (error) {tx.abort(); reject(error);}
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Conflicto de datos: recargá antes de continuar'));
      tx.onerror = () => reject(tx.error ?? new Error('No se guardaron los datos'));
    });
  } finally {db.close();}
}
export const newDraft = () => ({id: crypto.randomUUID(), clienteId: '', lineas: [], revision: 0});
export async function loadDraft(scope) {
  return (await transaction('drafts', 'readonly', (s, done) => {const r = s.get(scopeKey(scope)); r.onsuccess = () => done(r.result);})) ?? newDraft();
}
export async function saveDraft(scope, draft) {
  return transaction('drafts', 'readwrite', (s, done, tx) => {
    const r = s.get(scopeKey(scope));
    r.onsuccess = () => {
      if ((r.result?.revision ?? 0) !== draft.revision) {tx.abort(); return;}
      const next = {...draft, revision: draft.revision + 1};
      s.put(next, scopeKey(scope)); done(next);
    };
  });
}
export async function resetDraft(scope, draft) {
  return saveDraft(scope, {...newDraft(), revision: draft.revision});
}
export async function registerVisit(scope, clienteId, resultado, nota, gps) {
  if (!clienteId || !['pedido', 'sin_pedido', 'ausente'].includes(resultado) || nota.length > 500) throw new Error('Visita inválida');
  const visita = {...scope, id: crypto.randomUUID(), clienteId, resultado, nota, gps, creadoEn: new Date().toISOString(), estado: 'local'};
  await transaction('visits', 'readwrite', s => s.add(visita));
  return visita;
}
export async function listVisits(scope) {
  return transaction('visits', 'readonly', (s, done) => {const r = s.index('scope').getAll([scope.empresaId, scope.vendedorId]); r.onsuccess = () => done(r.result);});
}
// Simulador idempotente local, visible como tal. Nunca se conecta a SIGO ni a Supabase.
export async function demoReceive(scope, pedido, catalogo) {
  if (!navigator.onLine) throw new Error('Sin conexión: pedido conservado para reintentar');
  if (pedido.empresaId !== scope.empresaId || pedido.vendedorId !== scope.vendedorId) throw new Error('Empresa/vendedor incorrectos');
  const {revisarPedido} = await import('./sync/validacion-pedidos.js');
  const revision = revisarPedido(pedido, catalogo);
  if (!revision.valido) throw new Error(revision.errores.join('. '));
  if (revision.advertencias.length) throw new Error(revision.advertencias.join('. '));
  for (const linea of pedido.lineas) {
    if (!catalogo.precios.some(p => p.productoId === linea.productoId && Math.abs(p.precio / p.unidadesBase - linea.precioUnitario) < 0.000001)) throw new Error('Precio cambiado: requiere revisión; pedido conservado');
  }
  const key = JSON.stringify([scope.empresaId, pedido.id]);
  const fingerprint = JSON.stringify([pedido.vendedorId, pedido.clienteId, pedido.lineas]);
  return transaction('receipts', 'readwrite', (s, done, tx) => {
    const r = s.get(key);
    r.onsuccess = () => {
      if (r.result && r.result.fingerprint !== fingerprint) {tx.abort(); return;}
      const receipt = r.result ?? {id: pedido.id, confirmadoEn: new Date().toISOString(), fingerprint};
      s.put(receipt, key); done(receipt);
    };
  });
}
