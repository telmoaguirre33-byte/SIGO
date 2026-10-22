import { json, UUID, rest, first, permiso, sesionUsuario } from './cae-v2.js';
import { validarImpresionEmisor } from './lib/print-config.js';
// Separate print-only metadata. Never writes ARCA configuration or credentials.
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const empresaId = String((req.method === 'GET' ? req.query : req.body)?.empresaId || '');
  const puntoVenta = Number((req.method === 'GET' ? req.query : req.body)?.puntoVenta);
  if (!Number.isInteger(puntoVenta) || puntoVenta < 1 || puntoVenta > 99998) return json(res, 400, { error: 'ARCA_PUNTO_VENTA_NOT_ACTIVE' });
  if (!UUID.test(empresaId)) return json(res, 400, { error: 'ARCA_CAE_INPUT_INVALID' });
  const sesion = await sesionUsuario(req, empresaId);
  if (!sesion) return json(res, 403, { error: 'ARCA_ISSUE_FORBIDDEN' });
  try {
    const [fiscal, puedeConfigurar] = await Promise.all([
      rest(sesion, `arca_config?empresa_id=eq.${empresaId}&select=cuit_emisor,razon_social,ambiente`).then(first), permiso(sesion, empresaId, 'arca.configure'),
    ]);
    if (!fiscal) return json(res, 409, { error: 'ARCA_CONFIG_INVALID' });
    const pv = first(await rest(sesion, `arca_puntos_venta?empresa_id=eq.${empresaId}&numero=eq.${puntoVenta}&ambiente=eq.${encodeURIComponent(fiscal.ambiente)}&activo=is.true&select=id`));
    if (!pv) return json(res, 409, { error: 'ARCA_PUNTO_VENTA_NOT_ACTIVE' });
    if (req.method === 'POST') {
      if (!puedeConfigurar) return json(res, 403, { error: 'ARCA_PRINT_CONFIG_FORBIDDEN' });
      const { campos, faltantes } = validarImpresionEmisor(req.body?.datos);
      if (faltantes.length) return json(res, 400, { error: 'ARCA_PRINT_EMITTER_DATA_REQUIRED', faltantes });
      const rows = await rest(sesion, 'arca_impresion_config?on_conflict=empresa_id,punto_venta', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ empresa_id: empresaId, punto_venta: puntoVenta, cuit_emisor: fiscal.cuit_emisor, ...campos, updated_at: new Date().toISOString() }) });
      return json(res, 200, { ok: true, config: first(rows), puedeConfigurar, identidad: fiscal });
    }
    const config = first(await rest(sesion, `arca_impresion_config?empresa_id=eq.${empresaId}&punto_venta=eq.${puntoVenta}&cuit_emisor=eq.${encodeURIComponent(fiscal.cuit_emisor)}&select=*`));
    return json(res, 200, { ok: true, config, puedeConfigurar, identidad: fiscal, faltantes: validarImpresionEmisor(config || {}).faltantes });
  } catch (error) {
    return json(res, error?.status === 400 || error?.status === 404 ? 409 : 502, { error: error?.status === 400 || error?.status === 404 ? 'ARCA_PRINT_SCHEMA_REQUIRED' : 'ARCA_PRINT_CONFIG_FAILED' });
  }
}
