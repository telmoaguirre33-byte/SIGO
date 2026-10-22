// Server-only receipt writer. Never imported from src, never exposed in responses.
// Activation is intentionally opt-in and requires the separately reviewed DB hardening.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function almacenamientoFiscalSeguro(sesion, rest) {
  if (process.env.ARCA_FISCAL_SERVER_WRITE_ENABLED !== 'true') return false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('ARCA_SECURE_STORAGE_REQUIRED'), { code: 'ARCA_SECURE_STORAGE_REQUIRED' });
  let seguro = false;
  try { seguro = await rest(sesion, 'rpc/arca_escritura_fiscal_segura', { method: 'POST', body: '{}' }); } catch { /* Deployment incomplete: fail closed. */ }
  if (seguro !== true) throw Object.assign(new Error('ARCA_SECURE_STORAGE_REQUIRED'), { code: 'ARCA_SECURE_STORAGE_REQUIRED' });
  return true;
}
export async function snapshotConfiable(sesion, rest) {
  // Read-only recovery needs no privileged key; DB proves only the server can write.
  try { return await rest(sesion, 'rpc/arca_escritura_fiscal_segura', { method: 'POST', body: '{}' }) === true; }
  catch { return false; }
}
export async function guardarComprobante(sesion, rest, seguro, empresaId, ventaId, id, datos) {
  if (!UUID.test(empresaId) || !UUID.test(ventaId) || (id && !UUID.test(id))) throw new Error('ARCA_RECEIPT_IDENTITY_MISMATCH');
  if ((datos.empresa_id && datos.empresa_id !== empresaId) || (datos.venta_id && datos.venta_id !== ventaId)) throw new Error('ARCA_RECEIPT_IDENTITY_MISMATCH');
  const path = id ? `arca_comprobantes?id=eq.${id}&empresa_id=eq.${empresaId}&venta_id=eq.${ventaId}` : 'arca_comprobantes';
  const body = { ...datos }; if (!seguro) delete body.impresion_snapshot;
  const init = { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) };
  let rows;
  if (seguro) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('ARCA_SECURE_STORAGE_REQUIRED');
    const response = await fetch(`${sesion.url}/rest/v1/${path}`, { ...init, headers: { ...init.headers, apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
    rows = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(`REST_${response.status}`), { status: response.status });
  } else rows = await rest(sesion, path, init);
  if (!Array.isArray(rows) || rows.length !== 1 || (rows[0].empresa_id && rows[0].empresa_id !== empresaId) || (rows[0].venta_id && rows[0].venta_id !== ventaId)) throw new Error('ARCA_RECEIPT_PERSISTENCE_FAILED');
  return rows[0];
}
