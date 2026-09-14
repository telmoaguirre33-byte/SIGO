function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function entero(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

async function rest(sesion, path) {
  const response = await fetch(`${sesion.url}/rest/v1/${path}`, {
    headers: { apikey: sesion.anonKey, Authorization: sesion.auth, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`REST_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function permiso(sesion, empresaId, nombre) {
  const response = await fetch(`${sesion.url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: nombre }),
  });
  return response.ok && (await response.json().catch(() => false)) === true;
}

async function sesionUsuario(req, empresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!user.ok) return null;
  const sesion = { url, anonKey, auth };
  for (const nombre of ["invoices.issue", "sales.read", "products.read"]) {
    if (!(await permiso(sesion, empresaId, nombre))) return null;
  }
  return sesion;
}

function first(payload) {
  return Array.isArray(payload) ? payload[0] ?? null : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const empresaId = String(req.body?.empresaId || "").trim();
  const ventaId = String(req.body?.ventaId || "").trim();
  const puntoVenta = entero(req.body?.puntoVenta, 1, 99999);
  const tipoCbte = entero(req.body?.tipoCbte, 1, 999);
  const condicionIvaConsumidorFinal = entero(req.body?.condicionIvaReceptorId, 1, 99);

  if (!uuid(empresaId) || !uuid(ventaId)) return json(res, 400, { error: "ARCA_PREFLIGHT_INPUT_INVALID" });
  if (!puntoVenta) return json(res, 400, { error: "ARCA_PUNTO_VENTA_REQUIRED" });
  if (!tipoCbte) return json(res, 400, { error: "ARCA_TIPO_COMPROBANTE_REQUIRED" });

  const sesion = await sesionUsuario(req, empresaId);
  if (!sesion) return json(res, 403, { error: "ARCA_ISSUE_FORBIDDEN" });

  try {
    const config = first(await rest(
      sesion,
      `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=empresa_id,ambiente,cuit_emisor,certificado_vence,wsaa_service,wsfe_version,activo,ultima_prueba_ok,ultima_prueba_at`,
    ));
    if (!config) return json(res, 409, { error: "ARCA_CONFIG_REQUIRED" });
    if (!config.activo || config.ultima_prueba_ok !== true) return json(res, 409, { error: "ARCA_AUTH_NOT_VALIDATED" });
    if (config.wsaa_service !== "wsfe" || config.wsfe_version !== "WSFEv1") return json(res, 409, { error: "ARCA_SERVICE_INVALID" });
    if (!/^\d{11}$/.test(String(config.cuit_emisor || ""))) return json(res, 409, { error: "ARCA_CUIT_INVALID" });
    if (!config.certificado_vence || Date.parse(config.certificado_vence) <= Date.now()) return json(res, 409, { error: "ARCA_CERTIFICATE_EXPIRED" });

    const pv = first(await rest(
      sesion,
      `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${encodeURIComponent(config.ambiente)}&numero=eq.${puntoVenta}&activo=is.true&select=id,numero,ambiente,activo`,
    ));
    if (!pv) return json(res, 409, { error: "ARCA_PUNTO_VENTA_NOT_ACTIVE" });

    const venta = first(await rest(
      sesion,
      `ventas_sigo?id=eq.${encodeURIComponent(ventaId)}&empresa_id=eq.${encodeURIComponent(empresaId)}&select=id,empresa_id,numero,estado,total,cliente_id,created_at,anulada_at`,
    ));
    if (!venta) return json(res, 404, { error: "ARCA_SALE_NOT_FOUND" });
    if (venta.estado !== "confirmada" || venta.anulada_at) return json(res, 409, { error: "ARCA_SALE_NOT_CONFIRMED" });
    const total = Number(venta.total);
    if (!Number.isFinite(total) || total <= 0) return json(res, 409, { error: "ARCA_SALE_TOTAL_INVALID" });

    let comprobanteExistente;
    try {
      comprobanteExistente = first(await rest(
        sesion,
        `arca_comprobantes?empresa_id=eq.${encodeURIComponent(empresaId)}&venta_id=eq.${encodeURIComponent(ventaId)}&select=id,punto_venta,tipo_cbte,numero_cbte,cae,cae_vencimiento,resultado,request_id`,
      ));
    } catch (error) {
      if (error?.status === 400) return json(res, 409, { error: "ARCA_SCHEMA_PENDING" });
      throw error;
    }
    if (comprobanteExistente?.cae) {
      return json(res, 200, { ok: true, alreadyIssued: true, comprobante: comprobanteExistente });
    }
    if (comprobanteExistente) return json(res, 409, { error: "ARCA_EMISSION_ALREADY_RESERVED" });

    const items = await rest(
      sesion,
      `venta_items_sigo?venta_id=eq.${encodeURIComponent(ventaId)}&empresa_id=eq.${encodeURIComponent(empresaId)}&select=producto_id,cantidad,precio_unitario,subtotal`,
    );
    if (!Array.isArray(items) || items.length === 0) return json(res, 409, { error: "ARCA_SALE_ITEMS_REQUIRED" });

    const productIds = [...new Set(items.map((item) => String(item.producto_id || "")).filter(uuid))];
    if (productIds.length === 0) return json(res, 409, { error: "ARCA_PRODUCT_FISCAL_DATA_REQUIRED" });
    const products = await rest(
      sesion,
      `productos?empresa_id=eq.${encodeURIComponent(empresaId)}&id=in.(${productIds.join(",")})&select=id,nombre,iva_alicuota_id,iva_tasa,precio_incluye_iva`,
    );
    const productMap = new Map((Array.isArray(products) ? products : []).map((p) => [String(p.id), p]));
    const fiscalMissing = items
      .map((item) => productMap.get(String(item.producto_id)))
      .filter((p) => !p || !Number.isInteger(Number(p.iva_alicuota_id)) || p.iva_tasa == null || typeof p.precio_incluye_iva !== "boolean")
      .map((p) => p?.nombre || "Producto sin ficha fiscal");
    if (fiscalMissing.length) {
      return json(res, 409, { error: "ARCA_PRODUCT_FISCAL_DATA_REQUIRED", productos: [...new Set(fiscalMissing)].slice(0, 20) });
    }

    let receptor = { docTipo: 99, docNro: "0", condicionIvaReceptorId: condicionIvaConsumidorFinal };
    if (venta.cliente_id) {
      if (!(await permiso(sesion, empresaId, "clients.read"))) return json(res, 403, { error: "ARCA_CLIENT_READ_FORBIDDEN" });
      const cliente = first(await rest(
        sesion,
        `clientes_sigo?id=eq.${encodeURIComponent(venta.cliente_id)}&empresa_id=eq.${encodeURIComponent(empresaId)}&activo=is.true&select=id,documento,arca_doc_tipo,condicion_iva_receptor_id`,
      ));
      if (!cliente) return json(res, 409, { error: "ARCA_CLIENT_NOT_FOUND" });
      const docNro = digits(cliente.documento);
      const docTipo = entero(cliente.arca_doc_tipo, 1, 999);
      const condicionIva = entero(cliente.condicion_iva_receptor_id, 1, 99);
      if (!docNro || !docTipo) return json(res, 409, { error: "ARCA_CLIENT_DOCUMENT_REQUIRED" });
      if (!condicionIva) return json(res, 409, { error: "ARCA_CLIENT_IVA_CONDITION_REQUIRED" });
      receptor = { docTipo, docNro, condicionIvaReceptorId: condicionIva };
    } else if (!condicionIvaConsumidorFinal) {
      return json(res, 409, { error: "ARCA_CONSUMER_IVA_CONDITION_REQUIRED" });
    }

    const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    if (!Number.isFinite(subtotal) || Math.abs(subtotal - total) > 0.01) {
      return json(res, 409, { error: "ARCA_SALE_TOTAL_MISMATCH" });
    }

    const requestId = `sigo:${empresaId}:${ventaId}:${puntoVenta}:${tipoCbte}`;
    return json(res, 200, {
      ok: true,
      alreadyIssued: false,
      readyForWsfe: true,
      empresaId,
      ventaId,
      ventaNumero: venta.numero,
      ambiente: config.ambiente,
      cuitEmisor: config.cuit_emisor,
      puntoVenta,
      tipoCbte,
      receptor,
      total: Number(total.toFixed(2)),
      items: items.length,
      requestId,
      nota: "Preflight fiscal aprobado. No se solicitó CAE ni se modificó la venta, el stock o la caja.",
    });
  } catch (error) {
    console.error("ARCA CAE preflight error", error?.message || error);
    return json(res, 500, { error: "ARCA_PREFLIGHT_FAILED" });
  }
}
