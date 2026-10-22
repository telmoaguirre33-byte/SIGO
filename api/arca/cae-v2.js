import { crearPresupuestoFiscal, fetchFiscal, esTimeoutFiscal } from "./lib/request-budget.js";
import { almacenamientoFiscalSeguro, guardarComprobante } from "./lib/receipt-store.js";
import { leerItemsImpresion, validarImpresionEmisor, camposSnapshotEmisor, coincideComprobanteOriginal } from "./lib/print-config.js";
import {
  WSAA,
  WSFE,
  escapeXml,
  decodeXml,
  extraer,
  extraerErroresWsfe,
  leerTicketWsaa,
  descargarSecreto,
  autenticarWsaa,
  guardarTicketWsaa,
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
  const { response, payload } = await fetchFiscal(sesion, "database", `${sesion.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sesion.anonKey,
      Authorization: sesion.auth,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`REST_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function permiso(sesion, empresaId, nombre) {
  const { response, payload } = await fetchFiscal(sesion, "permission", `${sesion.url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: nombre }),
  });
  return response.ok && payload === true;
}

async function sesionUsuario(req, empresaId, presupuesto = null) {
  const { url, anonKey } = env();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const sesion = { url, anonKey, auth, presupuesto };
  const { response: user } = await fetchFiscal(sesion, "authentication", `${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!user.ok) return null;
  for (const nombre of ["invoices.issue", "sales.read", "products.read"]) {
    if (!(await permiso(sesion, empresaId, nombre))) return null;
  }
  return sesion;
}

function authXml(ticket, cuit) {
  return `<ar:Auth><ar:Token>${escapeXml(ticket.token)}</ar:Token><ar:Sign>${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>${escapeXml(cuit)}</ar:Cuit></ar:Auth>`;
}

function crearTraWsaa() {
  const now = Date.now();
  const uniqueId = Math.floor(now / 1000) >>> 0;
  const generationTime = new Date(now - 5 * 60_000).toISOString();
  const expirationTime = new Date(now + 10 * 60_000).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
}

async function soapBridge(sesion, ambiente, action, innerXml) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:${action}>${innerXml}</ar:${action}></soapenv:Body></soapenv:Envelope>`;
  try {
    const { response, payload } = await fetchFiscal(sesion, action, BRIDGE_URL, {
      method: "POST",
      headers: { Authorization: sesion.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ambiente, action, soap }),
    }, 16_000, action === "FECAESolicitar" ? 2_500 : 0);
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
  const rawNumero = extraer(body, "CbteNro");
  const numero = Number(rawNumero);
  if (!/^\d+$/.test(rawNumero) || !Number.isSafeInteger(numero) || numero < 0) throw new Error("WSFE_LAST_NUMBER_INVALID");
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
    const recuperable = errors.every((item) => Number(item.code) === 602);
    if (recuperable) return null;
    throw wsfeError(errors);
  }
  const result = extraer(body, "ResultGet");
  const campo = (tag) => extraer(result, tag);
  const cae = campo("CodAutorizacion");
  const identidad = [["PtoVta", puntoVenta], ["CbteTipo", tipoCbte], ["CbteDesde", numeroCbte], ["CbteHasta", numeroCbte]];
  if (!result || !/^[1-9]\d{13}$/.test(cae) || campo("Resultado") !== "A" || campo("EmisionTipo") !== "CAE"
    || identidad.some(([tag, valor]) => !/^\d+$/.test(campo(tag)) || Number(campo(tag)) !== Number(valor))) {
    throw new Error("ARCA_RECEIPT_IDENTITY_MISMATCH");
  }
  const numero = (tag, positivo = false) => {
    const raw = campo(tag), value = Number(raw);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) || !Number.isFinite(value) || value < 0 || (positivo && value === 0)) throw new Error("ARCA_RECEIPT_PROTOCOL_INVALID");
    return value;
  };
  const fecha = (tag) => {
    const value = fechaSql(campo(tag));
    const parsed = value ? new Date(`${value}T12:00:00Z`) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("ARCA_RECEIPT_PROTOCOL_INVALID");
    return value;
  };
  const receptorDocTipo = numero("DocTipo", true), receptorDocumento = campo("DocNro"), moneda = campo("MonId");
  if (!Number.isSafeInteger(receptorDocTipo) || !/^\d+$/.test(receptorDocumento) || !/^[A-Z0-9]{3}$/.test(moneda)) throw new Error("ARCA_RECEIPT_PROTOCOL_INVALID");
  const cotizacion = numero("MonCotiz", true);
  if (moneda === "PES" && cotizacion !== 1) throw new Error("ARCA_RECEIPT_PROTOCOL_INVALID");
  return {
    cae, caeVencimiento: fecha("FchVto"), resultado: "A", fecha: fecha("CbteFch"),
    receptorDocTipo, receptorDocumento, total: numero("ImpTotal", true), neto: numero("ImpNeto"), iva: numero("ImpIVA"),
    moneda, cotizacion, condicionIvaReceptorId: Number(campo("CondicionIVAReceptorId")) || null,
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
    `<ar:CbteDesde>${request.numeroCbte}</ar:CbteDesde><ar:CbteHasta>${request.numeroCbte}</ar:CbteHasta><ar:CbteFch>${request.fecha || fechaArca()}</ar:CbteFch>`,
    `<ar:ImpTotal>${f.impTotal.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${f.impNeto.toFixed(2)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${f.impIva.toFixed(2)}</ar:ImpIVA>`,
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1.00</ar:MonCotiz><ar:CondicionIVAReceptorId>${request.receptor.condicionIvaReceptorId}</ar:CondicionIVAReceptorId>`,
    f.ivaXml,
    "</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>",
  ].join("");

  const { body, errors } = await soapBridge(sesion, ambiente, "FECAESolicitar", `${authXml(ticket, cuit)}${detail}`);
  if (errors.length) throw wsfeError(errors);
  const responseDetail = extraer(body, "FECAEDetResponse");
  const resultado = extraer(responseDetail, "Resultado") || extraer(extraer(body, "FeCabResp"), "Resultado");
  const cae = extraer(responseDetail, "CAE");
  const observacionesXml = extraer(responseDetail, "Observaciones");
  const observaciones = (observacionesXml.match(/<(?:[A-Za-z0-9_]+:)?Obs(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Obs>/gi) || []).map((block) => ({
    code: extraer(block, "Code"),
    message: decodeXml(extraer(block, "Msg")).slice(0, 300),
  }));
  const cabecera = extraer(body, "FeCabResp");
  const respuestaIdentificada = Boolean(responseDetail)
    && Number(extraer(cabecera, "PtoVta")) === request.puntoVenta && Number(extraer(cabecera, "CbteTipo")) === request.tipoCbte
    && Number(extraer(responseDetail, "CbteDesde")) === request.numeroCbte && Number(extraer(responseDetail, "CbteHasta")) === request.numeroCbte
    && Number(extraer(responseDetail, "DocTipo")) === request.receptor.docTipo && extraer(responseDetail, "DocNro") === String(request.receptor.docNro)
    && extraer(responseDetail, "CbteFch") === request.fecha;
  if (resultado === "A" && !respuestaIdentificada) throw new Error("ARCA_RECEIPT_IDENTITY_MISMATCH");
  if (resultado !== "A" || !/^[1-9]\d{13}$/.test(cae)) {
    const error = new Error(observaciones[0]?.message || "ARCA no autorizó el comprobante");
    error.code = "WSFE_CAE_REJECTED";
    error.wsfeErrors = observaciones;
    error.rechazoDefinitivo = resultado === "R" && !cae && respuestaIdentificada;
    throw error;
  }
  const caeVencimiento = fechaSql(extraer(responseDetail, "CAEFchVto"));
  const vencimiento = caeVencimiento ? new Date(`${caeVencimiento}T12:00:00Z`) : null;
  if (!vencimiento || !Number.isFinite(vencimiento.getTime()) || vencimiento.toISOString().slice(0, 10) !== caeVencimiento) throw new Error("ARCA_RECEIPT_PROTOCOL_INVALID");
  return { cae, caeVencimiento, resultado, observaciones };
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

  const flujoCaja = req.body?.flujoCaja === true;
  const empresaId = String(req.body?.empresaId || "").trim();
  const ventaId = String(req.body?.ventaId || "").trim();
  const puntoVenta = entero(req.body?.puntoVenta, 1, 99999);
  const tipoCbte = entero(req.body?.tipoCbte, 1, 999);
  const condicionIvaReceptorId = entero(req.body?.condicionIvaReceptorId, 1, 99);
  const receptorCuit = digits(req.body?.receptorCuit);
  const receptorRazonSocial = String(req.body?.receptorRazonSocial || "").trim().slice(0, 160);
  if (!UUID.test(empresaId) || !UUID.test(ventaId) || !puntoVenta || !tipoCbte || !TIPOS_FACTURA.has(tipoCbte)) {
    return json(res, 400, { error: "ARCA_CAE_INPUT_INVALID" });
  }

  const presupuesto = crearPresupuestoFiscal();
  let sesion;
  let reservaIntentada = false;
  let reserva = null;
  let escrituraSegura = false;
  let ticketEmision = null;
  let configEmision = null;
  let stage = "authentication";
  try {
    sesion = await sesionUsuario(req, empresaId, presupuesto);
    if (!sesion) return json(res, 403, { error: "ARCA_ISSUE_FORBIDDEN" });
    stage = "config";
    const config = first(await rest(sesion, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=empresa_id,ambiente,cuit_emisor,razon_social,certificado_ref,certificado_vence,wsaa_service,wsfe_version,activo,ultima_prueba_ok`));
    if (!config?.activo || config.ultima_prueba_ok !== true) return json(res, 409, { error: "ARCA_AUTH_NOT_VALIDATED" });
    if (!WSFE[config.ambiente]) return json(res, 409, { error: "ARCA_ENVIRONMENT_INVALID" });
    configEmision = config;
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

    const items = await leerItemsImpresion(sesion, rest, empresaId, ventaId);
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

    let receptor = { docTipo: 99, docNro: "0", condicionIvaReceptorId, razonSocial: "Consumidor Final" };
    if (venta.cliente_id) {
      if (!(await permiso(sesion, empresaId, "clients.read"))) return json(res, 403, { error: "ARCA_CLIENT_READ_FORBIDDEN" });
      const cliente = first(await rest(sesion, `clientes_sigo?id=eq.${encodeURIComponent(venta.cliente_id)}&empresa_id=eq.${encodeURIComponent(empresaId)}&activo=is.true&select=nombre,documento,arca_doc_tipo,condicion_iva_receptor_id`));
      const docTipo = entero(cliente?.arca_doc_tipo, 1, 999);
      const docNro = digits(cliente?.documento);
      const condicion = entero(cliente?.condicion_iva_receptor_id, 1, 99);
      if (!docTipo || !docNro || !condicion) return json(res, 409, { error: "ARCA_CLIENT_FISCAL_DATA_REQUIRED" });
      receptor = { docTipo, docNro, condicionIvaReceptorId: condicion, razonSocial: String(cliente?.nombre || "").trim() };
    } else if (!condicionIvaReceptorId) {
      return json(res, 409, { error: "ARCA_CONSUMER_IVA_CONDITION_REQUIRED" });
    } else if ([1, 6].includes(condicionIvaReceptorId)) {
      if (!/^\d{11}$/.test(receptorCuit)) return json(res, 409, { error: "ARCA_RECEPTOR_CUIT_REQUIRED" });
      if (receptorRazonSocial.length < 2) return json(res, 409, { error: "ARCA_RECEPTOR_RAZON_SOCIAL_REQUIRED" });
      receptor = { docTipo: 80, docNro: receptorCuit, condicionIvaReceptorId, razonSocial: receptorRazonSocial };
    }
    if (tipoCbte === 1 && (receptor.docTipo !== 80 || receptor.docNro.length !== 11 || receptor.condicionIvaReceptorId !== 1)) return json(res, 409, { error: "ARCA_INVOICE_A_CLIENT_REQUIRED" });

    let fiscal;
    try {
      fiscal = detalleFiscal(tipoCbte, total, items, productMap);
    } catch (error) {
      return json(res, 409, { error: error.message });
    }

    escrituraSegura = await almacenamientoFiscalSeguro(sesion, rest);
    if (flujoCaja && !escrituraSegura) return json(res, 409, { error: "ARCA_SECURE_STORAGE_REQUIRED" });
    // Only this additive fiscal column is optional. Older databases keep working;
    // they recover canonical fiscal fields via FECompConsultar without issuing again.
    let snapshotSupported = false;
    try {
      await rest(sesion, "arca_comprobantes?select=impresion_snapshot&limit=0");
      snapshotSupported = escrituraSegura;
    } catch (error) { if (error?.status !== 400) throw error; }
    if (flujoCaja && !snapshotSupported) return json(res, 409, { error: "ARCA_PRINT_SCHEMA_REQUIRED" });
    // Only admin-approved server metadata can populate the fiscal header.
    let printData = null;
    try { printData = first(await rest(sesion, `arca_impresion_config?empresa_id=eq.${empresaId}&punto_venta=eq.${puntoVenta}&cuit_emisor=eq.${encodeURIComponent(config.cuit_emisor)}&select=*`)); }
    catch (error) { if (esTimeoutFiscal(error)) throw error; if (flujoCaja) return json(res, 409, { error: "ARCA_PRINT_SCHEMA_REQUIRED" }); }
    const { campos, faltantes } = validarImpresionEmisor(printData || {});
    if (flujoCaja && !config.razon_social?.trim()) faltantes.push("razón social autorizada del emisor");
    if (flujoCaja && faltantes.length) return json(res, 409, { error: "ARCA_PRINT_EMITTER_DATA_REQUIRED", faltantes });
    if (flujoCaja && ((tipoCbte === 11 && campos.condicion_iva === "IVA RESPONSABLE INSCRITO") || ([1, 6].includes(tipoCbte) && campos.condicion_iva !== "IVA RESPONSABLE INSCRITO"))) return json(res, 409, { error: "ARCA_PRINT_TIPO_INCOMPATIBLE" });
    const printableIds = [...new Set(items.map((item) => String(item.producto_id || "")).filter((id) => UUID.test(id)))];
    const printableProducts = printableIds.length
      ? await rest(sesion, `productos?empresa_id=eq.${encodeURIComponent(empresaId)}&id=in.(${printableIds.join(",")})&select=id,nombre`) : [];
    const printableNames = new Map(printableProducts.map((item) => [String(item.id), String(item.nombre)]));
    const fechaComprobante = fechaArca();
    const printSnapshot = {
      version: 1, empresaId, ventaId, ambiente: config.ambiente,
      punto_venta: puntoVenta, tipo_cbte: tipoCbte, ventaNumero: Number(venta.numero),
      fecha: fechaSql(fechaComprobante), total, moneda: "PES", cotizacion: 1,
      emisorCuit: config.cuit_emisor, emisorRazonSocial: config.razon_social || "Emisor CUIT " + config.cuit_emisor,
      ...(faltantes.length ? {} : camposSnapshotEmisor(campos)),
      receptorDocTipo: receptor.docTipo, receptorDocumento: String(receptor.docNro),
      condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      receptorRazonSocial: receptor.razonSocial || (receptor.docTipo === 99 ? "Consumidor Final" : "Documento fiscal"),
      neto: fiscal.impNeto, iva: fiscal.impIva,
      items: items.map((item) => ({ nombre: printableNames.get(String(item.producto_id)) || "Artículo", cantidad: Number(item.cantidad), unidad: item.unidad_medida || null, precio_unitario: Number(item.precio_unitario), subtotal: Number(item.subtotal) })),
    };

    stage = "reserva";
    const requestId = `sigo:${empresaId}:${ventaId}:${puntoVenta}:${tipoCbte}`;
    reserva = first(await rest(sesion, `arca_comprobantes?empresa_id=eq.${encodeURIComponent(empresaId)}&venta_id=eq.${encodeURIComponent(ventaId)}&select=*`));
    if (reserva?.resultado === "rechazado_definitivo" && !reserva.cae) return json(res, 409, { error: "ARCA_CAE_REJECTED_FINAL" });
    if (reserva?.cae) return json(res, 200, { ok: true, alreadyIssued: true, ambiente: config.ambiente, comprobante: reserva });
    if (reserva && (Number(reserva.punto_venta) !== puntoVenta || Number(reserva.tipo_cbte) !== tipoCbte || reserva.request_id !== requestId)) return json(res, 409, { error: "ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY" });
    if (reserva && !reserva.impresion_snapshot) return json(res, 409, { error: "ARCA_LEGACY_RECEIPT_IDENTITY_REQUIRED", retryable: false, consultaRequerida: true });

    let ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);
    if (!ticket) {
      stage = "wsaa_refresh";
      const puedeRenovar = await permiso(sesion, empresaId, "arca.configure");
      if (!puedeRenovar) {
        return json(res, 409, {
          error: "ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN",
          message: "La autorización fiscal venció y este perfil no puede renovar credenciales fiscales. Un administrador debe abrir ARCA una vez para renovarla.",
        });
      }
      if (!WSAA[config.ambiente]) return json(res, 409, { error: "ARCA_ENVIRONMENT_INVALID" });
      const [certificatePem, privateKeyPem] = await Promise.all([
        descargarSecreto(sesion, empresaId, "certificate.pem"),
        descargarSecreto(sesion, empresaId, "private-key.pem"),
      ]);
      ticket = await autenticarWsaa(WSAA[config.ambiente], crearTraWsaa(), certificatePem, privateKeyPem, presupuesto);
      await guardarTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor, ticket);
    }

    ticketEmision = ticket;
    stage = "conciliacion";
    if (reserva) {
      const originalSnapshot = reserva.impresion_snapshot;
      if (!originalSnapshot) return json(res, 409, { error: "ARCA_LEGACY_RECEIPT_IDENTITY_REQUIRED", retryable: false, consultaRequerida: true });
      if (originalSnapshot.empresaId !== empresaId || originalSnapshot.ventaId !== ventaId
        || originalSnapshot.emisorCuit !== config.cuit_emisor || originalSnapshot.ambiente !== config.ambiente
        || originalSnapshot.numero_cbte !== Number(reserva.numero_cbte) || originalSnapshot.punto_venta !== puntoVenta || originalSnapshot.tipo_cbte !== tipoCbte) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
      const recovered = await consultarComprobante(sesion, config.ambiente, ticket, config.cuit_emisor, reserva.punto_venta, reserva.tipo_cbte, Number(reserva.numero_cbte));
      if (recovered) {
        if (!coincideComprobanteOriginal(originalSnapshot, recovered)) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
        const persisted = await guardarComprobante(sesion, rest, escrituraSegura, empresaId, ventaId, reserva.id, { cae: recovered.cae, cae_vencimiento: recovered.caeVencimiento, resultado: recovered.resultado, observaciones: [], emitido_at: new Date().toISOString(), ...(snapshotSupported && reserva.impresion_snapshot ? { impresion_snapshot: { ...reserva.impresion_snapshot, ...recovered, cae_vencimiento: recovered.caeVencimiento } } : {}) });
        return json(res, 200, { ok: true, reconciled: true, ambiente: config.ambiente, comprobante: persisted });
      }
      // A reservation may still be in flight or its transport outcome uncertain.
      // Never send FECAESolicitar a second time just because consultation is empty.
      return json(res, 409, { error: "ARCA_RECEIPT_PENDING", retryable: false });
    } else {
      presupuesto.require(10_000, "before_reservation");
      const ultimo = await ultimoAutorizado(sesion, config.ambiente, ticket, config.cuit_emisor, puntoVenta, tipoCbte);
      const numeroCbte = ultimo + 1;
      try {
        presupuesto.require(10_000, "before_reservation");
        reservaIntentada = true;
        reserva = await guardarComprobante(sesion, rest, escrituraSegura, empresaId, ventaId, null, { empresa_id: empresaId, venta_id: ventaId, punto_venta: puntoVenta, tipo_cbte: tipoCbte, numero_cbte: numeroCbte, resultado: "reservado", observaciones: [], request_id: requestId, ...(snapshotSupported ? { impresion_snapshot: { ...printSnapshot, numero_cbte: numeroCbte } } : {}) });
      } catch (error) {
        if (error?.status === 409) return json(res, 409, { error: "ARCA_NUMBER_RESERVATION_CONFLICT", retryable: true });
        throw error;
      }
    }

    presupuesto.require(8_500, "before_emission");
    stage = "emision";
    const issued = await solicitarCae(sesion, config.ambiente, ticket, config.cuit_emisor, {
      puntoVenta,
      tipoCbte,
      numeroCbte: Number(reserva.numero_cbte),
      fecha: fechaComprobante,
      receptor,
      fiscal,
    });
    const printable = { ...(reserva.impresion_snapshot || printSnapshot), numero_cbte: Number(reserva.numero_cbte), cae: issued.cae, cae_vencimiento: issued.caeVencimiento };
    stage = "persistencia";
    const comprobante = await guardarComprobante(sesion, rest, escrituraSegura, empresaId, ventaId, reserva.id, { cae: issued.cae, cae_vencimiento: issued.caeVencimiento, resultado: issued.resultado, observaciones: issued.observaciones, emitido_at: new Date().toISOString(), ...(snapshotSupported ? { impresion_snapshot: printable } : {}) });
    return json(res, 200, { ok: true, alreadyIssued: false, ambiente: config.ambiente, ventaNumero: venta.numero, comprobante, comprobanteImprimible: printable });
  } catch (error) {
    const observations = safeErrors(error);
    if (reserva && escrituraSegura && stage === "emision" && error?.rechazoDefinitivo === true && ticketEmision && configEmision) {
      try {
        const consultado = await consultarComprobante(sesion, configEmision.ambiente, ticketEmision, configEmision.cuit_emisor, puntoVenta, tipoCbte, Number(reserva.numero_cbte));
        const ultimo = await ultimoAutorizado(sesion, configEmision.ambiente, ticketEmision, configEmision.cuit_emisor, puntoVenta, tipoCbte);
        if (!consultado && ultimo === Number(reserva.numero_cbte) - 1) {
          await guardarComprobante(sesion, rest, true, empresaId, ventaId, reserva.id, {
            resultado: "rechazado_definitivo", numero_cbte: null, observaciones: observations,
            intentos_emision: [...(reserva.intentos_emision || []), { numero_intentado: Number(reserva.numero_cbte), fecha: new Date().toISOString(), resultado: "R", observaciones: observations, consulta_sin_cae: true, ultimo_autorizado: ultimo }],
          });
          return json(res, 422, { error: "ARCA_CAE_REJECTED_FINAL", retryable: false });
        }
      } catch { /* Uncertain reconciliation never releases the reservation. */ }
    }
    if (reserva && observations.length) {
      try {
        await guardarComprobante(sesion, rest, escrituraSegura, empresaId, ventaId, reserva.id, { resultado: "pendiente_revision", observaciones: observations });
      } catch {}
    }
    if (error?.code === "ARCA_SECURE_STORAGE_REQUIRED") return json(res, 409, { error: "ARCA_SECURE_STORAGE_REQUIRED" });
    const safe = errorSeguro(error, stage);
    console.error("SIGO ARCA CAE V2", safe.code, stage, { elapsedMs: presupuesto.elapsed(), operation: error?.budgetStage || null });
    return json(res, safe.status, { error: safe.code, stage, retryable: false, consultaRequerida: Boolean(reserva || reservaIntentada), observaciones: observations });
  }
}


// Shared read-only recovery uses the same authenticated transport, never FECAESolicitar.
export { json, UUID, rest, first, permiso, sesionUsuario, consultarComprobante };
