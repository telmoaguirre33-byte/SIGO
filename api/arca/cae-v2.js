import {
  WSFE,
  escapeXml,
  decodeXml,
  extraer,
  extraerErroresWsfe,
  leerTicketWsaa,
} from "./wsaa.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIPOS_FACTURA = new Set([1, 6, 11]);
const BRIDGE_URL = process.env.ARCA_BRIDGE_URL || "https://sigo-arca-bridge-production.up.railway.app/wsfe";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function env() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

function entero(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function first(value) {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function dinero(value) {
  return Number(Number(value).toFixed(2));
}

function fechaArca(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function fechaSql(value) {
  const clean = digits(value);
  return /^\d{8}$/.test(clean) ? `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}` : null;
}

async function rest(sesion, path, init = {}) {
  const response = await fetch(`${sesion.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sesion.anonKey,
      Authorization: sesion.auth,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
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
  const { url, anonKey } = env();
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

function authXml(ticket, cuit) {
  return `<ar:Auth><ar:Token>${escapeXml(ticket.token)}</ar:Token><ar:Sign>${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>${escapeXml(cuit)}</ar:Cuit></ar:Auth>`;
}

async function soapBridge(sesion, ambiente, action, innerXml) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:${action}>${innerXml}</ar:${action}></soapenv:Body></soapenv:Envelope>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: sesion.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ambiente, action, soap }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload.body !== "string") {
      const error = new Error(payload?.error || `ARCA_BRIDGE_${response.status}`);
      error.code = "WSFE_BRIDGE_FAILED";
      throw error;
    }
    const body = payload.body;
    const fault = decodeXml(extraer(body, "faultstring"));
    const errors = extraerErroresWsfe(body);
    if (!payload.ok || fault) {
      const error = new Error(fault || errors[0]?.message || `WSFE_HTTP_${payload.status || 0}`);
      error.code = "WSFE_REJECTED";
      error.wsfeErrors = errors;
      throw error;
    }
    return { body, errors };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("WSFE_BRIDGE_TIMEOUT");
      timeoutError.code = "WSFE_BRIDGE_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function wsfeError(errors, fallback = "WSFE rechazó la solicitud") {
  const error = new Error(errors[0]?.message || fallback);
  error.code = "WSFE_REJECTED";
  error.wsfeErrors = errors;
  return error;
}

async function ultimoAutorizado(sesion, ambiente, ticket, cuit, puntoVenta, tipoCbte) {
  const { body, errors } = await soapBridge(
    sesion,
    ambiente,
    "FECompUltimoAutorizado",
    `${authXml(ticket, cuit)}<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${tipoCbte}</ar:CbteTipo>`,
  );
  if (errors.length) throw wsfeError(errors);
  const numero = Number(extraer(body, "CbteNro"));
  if (!Number.isInteger(numero) || numero < 0) throw new Error("WSFE_LAST_NUMBER_INVALID");
  return numero;
}

async function consultarComprobante(sesion, ambiente, ticket, cuit, puntoVenta, tipoCbte, numeroCbte) {
  const { body, errors } = await soapBridge(
    sesion,
    ambiente,
    "FECompConsultar",
    `${authXml(ticket, cuit)}<ar:FeCompConsReq><ar:CbteTipo>${tipoCbte}</ar:CbteTipo><ar:CbteNro>${numeroCbte}</ar:CbteNro><ar:PtoVta>${puntoVenta}</ar:PtoVta></ar:FeCompConsReq>`,
  );
  if (errors.length) {
    const recuperable = errors.every((item) => [601, 602].includes(Number(item.code)));
    if (recuperable) return null;
    throw wsfeError(errors);
  }
  const result = extraer(body, "ResultGet");
  const cae = digits(extraer(result, "CodAutorizacion"));
  if (!result || !/^\d{14}$/.test(cae)) return null;
  return {
    cae,
    caeVencimiento: fechaSql(extraer(result, "FchVto")),
    resultado: extraer(result, "Resultado") || "A",
  };
}

function detalleFiscal(tipoCbte, total, items, productMap) {
  if (tipoCbte === 11) return { impTotal: total, impNeto: total, impIva: 0, ivaXml: "" };

  const grupos = new Map();
  for (const item of items) {
    const producto = productMap.get(String(item.producto_id));
    if (!producto || producto.precio_incluye_iva !== true) throw new Error("ARCA_PRODUCT_PRICE_TAX_MODE_UNSUPPORTED");
    const id = entero(producto.iva_alicuota_id, 1, 99);
    const tasa = Number(producto.iva_tasa);
    const bruto = Number(item.subtotal);
    if (!id || !Number.isFinite(tasa) || tasa < 0 || !Number.isFinite(bruto) || bruto <= 0) throw new Error("ARCA_PRODUCT_FISCAL_DATA_REQUIRED");
    const base = bruto / (1 + tasa / 100);
    const current = grupos.get(id) || { id, base: 0, importe: 0 };
    current.base += base;
    current.importe += bruto - base;
    grupos.set(id, current);
  }
  const alicuotas = [...grupos.values()].map((row) => ({ id: row.id, base: dinero(row.base), importe: dinero(row.importe) }));
  const impNeto = dinero(alicuotas.reduce((sum, row) => sum + row.base, 0));
  const impIva = dinero(total - impNeto);
  if (alicuotas.length > 0) {
    const agrupado = dinero(alicuotas.reduce((sum, row) => sum + row.importe, 0));
    alicuotas[alicuotas.length - 1].importe = dinero(alicuotas[alicuotas.length - 1].importe + impIva - agrupado);
  }
  if (Math.abs(dinero(impNeto + impIva) - total) > 0.01) throw new Error("ARCA_FISCAL_TOTAL_MISMATCH");
  const ivaXml = `<ar:Iva>${alicuotas.map((row) => `<ar:AlicIva><ar:Id>${row.id}</ar:Id><ar:BaseImp>${row.base.toFixed(2)}</ar:BaseImp><ar:Importe>${row.importe.toFixed(2)}</ar:Importe></ar:AlicIva>`).join("")}</ar:Iva>`;
  return { impTotal: total, impNeto, impIva, ivaXml };
}

async function solicitarCae(sesion, ambiente, ticket, cuit, request) {
  const f = request.fiscal;
  const detail = [
    "<ar:FeCAEReq><ar:FeCabReq>",
    `<ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.puntoVenta}</ar:PtoVta><ar:CbteTipo>${request.tipoCbte}</ar:CbteTipo>`,
    "</ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>",
    `<ar:Concepto>1</ar:Concepto><ar:DocTipo>${request.receptor.docTipo}</ar:DocTipo><ar:DocNro>${request.receptor.docNro}</ar:DocNro>`,
    `<ar:CbteDesde>${request.numeroCbte}</ar:CbteDesde><ar:CbteHasta>${request.numeroCbte}</ar:CbteHasta><ar:CbteFch>${fechaArca()}</ar:CbteFch>`,
    `<ar:ImpTotal>${f.impTotal.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${f.impNeto.toFixed(2)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${f.impIva.toFixed(2)}</ar:ImpIVA>`,
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1.00</ar:MonCotiz><ar:CondicionIVAReceptorId>${request.receptor.condicionIvaReceptorId}</ar:CondicionIVAReceptorId>`,
    f.ivaXml,
    "</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>",
  ].join("");

  const { body, errors } = await soapBridge(sesion, ambiente, "FECAESolicitar", `${authXml(ticket, cuit)}${detail}`);
  if (errors.length) throw wsfeError(errors);
  const responseDetail = extraer(body, "FECAEDetResponse");
  const resultado = extraer(responseDetail, "Resultado") || extraer(extraer(body, "FeCabResp"), "Resultado");
  const cae = digits(extraer(responseDetail, "CAE"));
  const observacionesXml = extraer(responseDetail, "Observaciones");
  const observaciones = (observacionesXml.match(/<(?:[A-Za-z0-9_]+:)?Obs(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Obs>/gi) || []).map((block) => ({
    code: extraer(block, "Code"),
    message: decodeXml(extraer(block, "Msg")).slice(0, 300),
  }));
  if (resultado !== "A" || !/^\d{14}$/.test(cae)) {
    const error = new Error(observaciones[0]?.message || "ARCA no autorizó el comprobante");
    error.code = "WSFE_CAE_REJECTED";
    error.wsfeErrors = observaciones;
    throw error;
  }
  return { cae, caeVencimiento: fechaSql(extraer(responseDetail, "CAEFchVto")), resultado, observaciones };
}

function safeErrors(error) {
  const rows = Array.isArray(error?.wsfeErrors) ? error.wsfeErrors : [];
  return rows.slice(0, 10).map((item) => ({
    code: String(item?.code || "WSFE"),
    message: String(item?.message || "Solicitud rechazada").replace(/[\r\n]+/g, " ").slice(0, 300),
  }));
}

function errorSeguro(error, stage) {
  const raw = String(error?.message || error || "");
  if (error?.code === "WSFE_REJECTED" || error?.code === "WSFE_CAE_REJECTED") return { status: 422, code: "ARCA_CAE_REJECTED" };
  if (error?.code === "WSFE_BRIDGE_TIMEOUT" || /timeout|abort/i.test(raw)) return { status: 504, code: "ARCA_TIMEOUT" };
  if (error?.code === "WSFE_BRIDGE_FAILED") return { status: 502, code: "ARCA_CAE_TRANSPORT_FAILED" };
  if (/REST_401|REST_403/i.test(raw)) return { status: 403, code: "ARCA_BACKEND_PERMISSION_FAILED" };
  if (/REST_400/i.test(raw)) return { status: 409, code: "ARCA_CAE_SCHEMA_OR_DATA_INVALID" };
  if (/WSFE_LAST_NUMBER_INVALID/i.test(raw)) return { status: 502, code: "ARCA_LAST_NUMBER_INVALID" };
  return { status: 502, code: "ARCA_CAE_FAILED", stage };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const empresaId = String(req.body?.empresaId || "").trim();
  const ventaId = String(req.body?.ventaId || "").trim();
  const puntoVenta = entero(req.body?.puntoVenta, 1, 99999);
  const tipoCbte = entero(req.body?.tipoCbte, 1, 999);
  const condicionIvaReceptorId = entero(req.body?.condicionIvaReceptorId, 1, 99);
  if (!UUID.test(empresaId) || !UUID.test(ventaId) || !puntoVenta || !tipoCbte || !TIPOS_FACTURA.has(tipoCbte)) {
    return json(res, 400, { error: "ARCA_CAE_INPUT_INVALID" });
  }

  const sesion = await sesionUsuario(req, empresaId);
  if (!sesion) return json(res, 403, { error: "ARCA_ISSUE_FORBIDDEN" });

  let reserva = null;
  let stage = "config";
  try {
    const config = first(await rest(sesion, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=empresa_id,ambiente,cuit_emisor,certificado_ref,certificado_vence,wsaa_service,wsfe_version,activo,ultima_prueba_ok`));
    if (!config?.activo || config.ultima_prueba_ok !== true) return json(res, 409, { error: "ARCA_AUTH_NOT_VALIDATED" });
    if (!WSFE[config.ambiente]) return json(res, 409, { error: "ARCA_ENVIRONMENT_INVALID" });
    const expected = config.ambiente === "produccion" ? "EMITIR_CAE_PRODUCCION" : "SOLICITAR_CAE_HOMOLOGACION";
    if (String(req.body?.confirmacion || "") !== expected) return json(res, 409, { error: config.ambiente === "produccion" ? "ARCA_PRODUCTION_CONFIRMATION_REQUIRED" : "ARCA_HOMOLOGATION_CONFIRMATION_REQUIRED" });
    if (!/^\d{11}$/.test(String(config.cuit_emisor || "")) || config.wsaa_service !== "wsfe" || config.wsfe_version !== "WSFEv1") return json(res, 409, { error: "ARCA_CONFIG_INVALID" });
    if (!config.certificado_ref || !config.certificado_vence || Date.parse(config.certificado_vence) <= Date.now()) return json(res, 409, { error: "ARCA_CERTIFICATE_INVALID" });

    stage = "venta";
    const [pv, venta] = await Promise.all([
      rest(sesion, `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${encodeURIComponent(config.ambiente)}&numero=eq.${puntoVenta}&activo=is.true&select=id`).then(first),
      rest(sesion, `ventas_sigo?id=eq.${encodeURIComponent(ventaId)}&empresa_id=eq.${encodeURIComponent(empresaId)}&select=id,numero,estado,total,cliente_id,anulada_at`).then(first),
    ]);
    if (!pv) return json(res, 409, { error: "ARCA_PUNTO_VENTA_NOT_ACTIVE" });
    if (!venta) return json(res, 404, { error: "ARCA_SALE_NOT_FOUND" });
    if (venta.estado !== "confirmada" || venta.anulada_at) return json(res, 409, { error: "ARCA_SALE_NOT_CONFIRMED" });
    const total = dinero(venta.total);
    if (!Number.isFinite(total) || total <= 0) return json(res, 409, { error: "ARCA_SALE_TOTAL_INVALID" });

    const items = await rest(sesion, `venta_items_sigo?venta_id=eq.${encodeURIComponent(ventaId)}&empresa_id=eq.${encodeURIComponent(empresaId)}&select=producto_id,subtotal`);
    if (!Array.isArray(items) || items.length === 0) return json(res, 409, { error: "ARCA_SALE_ITEMS_REQUIRED" });
    const itemTotal = dinero(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
    if (Math.abs(itemTotal - total) > 0.01) return json(res, 409, { error: "ARCA_SALE_TOTAL_MISMATCH" });

    let productMap = new Map();
    if (tipoCbte !== 11) {
      const productIds = [...new Set(items.map((item) => String(item.producto_id || "")).filter((id) => UUID.test(id)))];
      if (productIds.length === 0) return json(res, 409, { error: "ARCA_PRODUCT_FISCAL_DATA_REQUIRED" });
      const products = await rest(sesion, `productos?empresa_id=eq.${encodeURIComponent(empresaId)}&id=in.(${productIds.join(",")})&select=id,nombre,iva_alicuota_id,iva_tasa,precio_incluye_iva`);
      productMap = new Map((Array.isArray(products) ? products : []).map((product) => [String(product.id), product]));
      if (productMap.size !== productIds.length) return json(res, 409, { error: "ARCA_PRODUCT_FISCAL_DATA_REQUIRED" });
    }

    let receptor = { docTipo: 99, docNro: "0", condicionIvaReceptorId };
    if (venta.cliente_id) {
      if (!(await permiso(sesion, empresaId, "clients.read"))) return json(res, 403, { error: "ARCA_CLIENT_READ_FORBIDDEN" });
      const cliente = first(await rest(sesion, `clientes_sigo?id=eq.${encodeURIComponent(venta.cliente_id)}&empresa_id=eq.${encodeURIComponent(empresaId)}&activo=is.true&select=documento,arca_doc_tipo,condicion_iva_receptor_id`));
      const docTipo = entero(cliente?.arca_doc_tipo, 1, 999);
      const docNro = digits(cliente?.documento);
      const condicion = entero(cliente?.condicion_iva_receptor_id, 1, 99);
      if (!docTipo || !docNro || !condicion) return json(res, 409, { error: "ARCA_CLIENT_FISCAL_DATA_REQUIRED" });
      receptor = { docTipo, docNro, condicionIvaReceptorId: condicion };
    } else if (!condicionIvaReceptorId) {
      return json(res, 409, { error: "ARCA_CONSUMER_IVA_CONDITION_REQUIRED" });
    }
    if (tipoCbte === 1 && (!venta.cliente_id || receptor.docTipo !== 80 || receptor.docNro.length !== 11 || receptor.condicionIvaReceptorId !== 1)) return json(res, 409, { error: "ARCA_INVOICE_A_CLIENT_REQUIRED" });

    let fiscal;
    try {
      fiscal = detalleFiscal(tipoCbte, total, items, productMap);
    } catch (error) {
      return json(res, 409, { error: error.message });
    }

    stage = "reserva";
    const requestId = `sigo:${empresaId}:${ventaId}:${puntoVenta}:${tipoCbte}`;
    reserva = first(await rest(sesion, `arca_comprobantes?empresa_id=eq.${encodeURIComponent(empresaId)}&venta_id=eq.${encodeURIComponent(ventaId)}&select=id,venta_id,punto_venta,tipo_cbte,numero_cbte,cae,cae_vencimiento,resultado,request_id`));
    if (reserva?.cae) return json(res, 200, { ok: true, alreadyIssued: true, ambiente: config.ambiente, comprobante: reserva });
    if (reserva && (Number(reserva.punto_venta) !== puntoVenta || Number(reserva.tipo_cbte) !== tipoCbte || reserva.request_id !== requestId)) return json(res, 409, { error: "ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY" });

    const ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);
    if (!ticket) return json(res, 409, { error: "ARCA_TICKET_REFRESH_REQUIRED" });

    stage = "conciliacion";
    if (reserva) {
      const recovered = await consultarComprobante(sesion, config.ambiente, ticket, config.cuit_emisor, reserva.punto_venta, reserva.tipo_cbte, Number(reserva.numero_cbte));
      if (recovered) {
        const persisted = first(await rest(sesion, `arca_comprobantes?id=eq.${encodeURIComponent(reserva.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ cae: recovered.cae, cae_vencimiento: recovered.caeVencimiento, resultado: recovered.resultado, observaciones: [], emitido_at: new Date().toISOString() }),
        }));
        return json(res, 200, { ok: true, reconciled: true, ambiente: config.ambiente, comprobante: persisted });
      }
    } else {
      const ultimo = await ultimoAutorizado(sesion, config.ambiente, ticket, config.cuit_emisor, puntoVenta, tipoCbte);
      const numeroCbte = ultimo + 1;
      try {
        reserva = first(await rest(sesion, "arca_comprobantes", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ empresa_id: empresaId, venta_id: ventaId, punto_venta: puntoVenta, tipo_cbte: tipoCbte, numero_cbte: numeroCbte, resultado: "reservado", observaciones: [], request_id: requestId }),
        }));
      } catch (error) {
        if (error?.status === 409) return json(res, 409, { error: "ARCA_NUMBER_RESERVATION_CONFLICT", retryable: true });
        throw error;
      }
    }

    stage = "emision";
    const issued = await solicitarCae(sesion, config.ambiente, ticket, config.cuit_emisor, {
      puntoVenta,
      tipoCbte,
      numeroCbte: Number(reserva.numero_cbte),
      receptor,
      fiscal,
    });
    const comprobante = first(await rest(sesion, `arca_comprobantes?id=eq.${encodeURIComponent(reserva.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ cae: issued.cae, cae_vencimiento: issued.caeVencimiento, resultado: issued.resultado, observaciones: issued.observaciones, emitido_at: new Date().toISOString() }),
    }));
    return json(res, 200, { ok: true, alreadyIssued: false, ambiente: config.ambiente, ventaNumero: venta.numero, comprobante });
  } catch (error) {
    const observations = safeErrors(error);
    if (reserva && observations.length) {
      try {
        await rest(sesion, `arca_comprobantes?id=eq.${encodeURIComponent(reserva.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ resultado: "R", observaciones: observations }),
        });
      } catch {}
    }
    const safe = errorSeguro(error, stage);
    console.error("SIGO ARCA CAE V2", safe.code, stage);
    return json(res, safe.status, { error: safe.code, stage, retryable: Boolean(reserva), observaciones: observations });
  }
}
