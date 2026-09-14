import {
  WSAA,
  WSFE,
  escapeXml,
  decodeXml,
  extraer,
  descargarSecreto,
  autenticarWsaa,
  extraerErroresWsfe,
  leerTicketWsaa,
  guardarTicketWsaa,
} from "./wsaa.js";

const SERVICE = "wsfe";
const BRIDGE_URL = process.env.ARCA_BRIDGE_URL || "https://sigo-arca-bridge-production.up.railway.app/wsfe";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

function empresaValida(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

async function rpcPermitido(url, anonKey, auth, empresaId, permiso) {
  const response = await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: permiso }),
  });
  return response.ok && (await response.json().catch(() => false)) === true;
}

async function validarUsuario(req, empresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!user.ok) return null;
  if (!(await rpcPermitido(url, anonKey, auth, empresaId, "arca.configure"))) return null;
  return { url, anonKey, auth };
}

async function rows(sesion, path) {
  const response = await fetch(`${sesion.url}/rest/v1/${path}`, {
    headers: { apikey: sesion.anonKey, Authorization: sesion.auth, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`REST_READ_${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function leerConfig(sesion, empresaId) {
  const select = "empresa_id,ambiente,cuit_emisor,certificado_ref,certificado_vence,wsaa_service,wsfe_version";
  const list = await rows(sesion, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=${encodeURIComponent(select)}`);
  return list[0] || null;
}

async function leerPuntos(sesion, empresaId, ambiente) {
  const list = await rows(sesion, `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${encodeURIComponent(ambiente)}&activo=is.true&select=numero&order=numero.asc`);
  return list.map((x) => Number(x?.numero)).filter((x) => Number.isInteger(x) && x > 0);
}

async function guardarEstado(sesion, empresaId, values) {
  const response = await fetch(`${sesion.url}/rest/v1/arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}`, {
    method: "PATCH",
    headers: {
      apikey: sesion.anonKey,
      Authorization: sesion.auth,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`CONFIG_UPDATE_FAILED:${response.status}`);
}

function crearTra() {
  const now = Date.now();
  const uniqueId = Math.floor(now / 1000) >>> 0;
  const generationTime = new Date(now - 5 * 60_000).toISOString();
  const expirationTime = new Date(now + 10 * 60_000).toISOString();
  return {
    generationTime,
    xml: `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header><service>${SERVICE}</service></loginTicketRequest>`,
  };
}

function parsePuntosVenta(body) {
  const bloques = String(body || "").match(/<(?:[A-Za-z0-9_]+:)?PtoVenta(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?PtoVenta>/gi) || [];
  return bloques.map((bloque) => ({
    numero: Number(extraer(bloque, "Nro")),
    emisionTipo: extraer(bloque, "EmisionTipo").toUpperCase(),
    bloqueado: extraer(bloque, "Bloqueado").toUpperCase(),
    fechaBaja: extraer(bloque, "FchBaja"),
  })).filter((item) => Number.isInteger(item.numero) && item.numero > 0);
}

async function wsfePorBridge(sesion, ambiente, soap) {
  const response = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: { Authorization: sesion.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ambiente, action: "FEParamGetPtosVenta", soap }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.body !== "string") {
    throw new Error(payload?.error || `BRIDGE_${response.status}`);
  }
  return { ok: payload.ok === true, status: Number(payload.status || 0), body: payload.body };
}

async function wsfeDirecto(endpoint, soap) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta",
        "User-Agent": "SIGO-WSFEv1-Auth/2.0",
      },
      body: soap,
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function validarWsfe(sesion, ambiente, endpoint, ticket, cuit) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:FEParamGetPtosVenta><ar:Auth><ar:Token>${escapeXml(ticket.token)}</ar:Token><ar:Sign>${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>${escapeXml(cuit)}</ar:Cuit></ar:Auth></ar:FEParamGetPtosVenta></soapenv:Body></soapenv:Envelope>`;
  let response;
  try {
    response = await wsfePorBridge(sesion, ambiente, soap);
  } catch {
    response = await wsfeDirecto(endpoint, soap);
  }
  const fault = decodeXml(extraer(response.body, "faultstring"));
  const errors = extraerErroresWsfe(response.body);
  if (!response.ok || fault || errors.length) {
    throw new Error(fault || errors[0]?.message || `WSFE_HTTP_${response.status}`);
  }
  const puntos = parsePuntosVenta(response.body);
  const activos = puntos.filter((item) => item.bloqueado !== "S" && !item.fechaBaja);
  const cae = activos.filter((item) => item.emisionTipo === "CAE");
  const elegibles = (cae.length ? cae : activos).map((item) => item.numero);
  return [...new Set(elegibles)].sort((a, b) => a - b);
}

async function sincronizarPuntos(sesion, empresaId, ambiente, habilitados) {
  if (!habilitados.length) throw new Error("ARCA_SIN_PUNTOS_VENTA_ACTIVOS");
  const base = `${sesion.url}/rest/v1/arca_puntos_venta`;
  const headers = { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" };

  const disable = await fetch(`${base}?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${encodeURIComponent(ambiente)}&activo=is.true`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ activo: false, updated_at: new Date().toISOString() }),
  });
  if (!disable.ok) throw new Error(`PV_DISABLE_${disable.status}`);

  for (const numero of habilitados) {
    const upsert = await fetch(`${base}?on_conflict=empresa_id,ambiente,numero`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        empresa_id: empresaId,
        ambiente,
        numero,
        nombre: `ARCA ${String(numero).padStart(4, "0")}`,
        activo: true,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsert.ok) throw new Error(`PV_UPSERT_${upsert.status}_${numero}`);
  }
}

function mensajeSeguro(error) {
  const raw = String(error?.message || error || "");
  if (/ARCA_SIN_PUNTOS/i.test(raw)) return { code: "WSFE_SIN_PUNTOS_ACTIVOS", message: "ARCA respondió correctamente, pero no informó puntos de venta activos para este CUIT." };
  if (/PV_DISABLE|PV_UPSERT/i.test(raw)) return { code: "WSFE_PUNTO_VENTA_SYNC_FAILED", message: "ARCA respondió correctamente, pero SIGO no pudo sincronizar los puntos de venta de esta empresa." };
  if (/SECRET_/i.test(raw)) return { code: "ARCA_SECRET_READ_FAILED", message: "SIGO no pudo leer el certificado o la clave privada guardados para esta empresa." };
  if (/CERT|PRIVATE_KEY|cms\.|firma/i.test(raw)) return { code: "WSAA_CERTIFICATE_REJECTED", message: "ARCA rechazó el certificado o su firma para WSFE." };
  if (/WSFE|BRIDGE|HTTP|fetch|network|timeout|abort/i.test(raw)) return { code: "WSFE_AUTH_FAILED", message: "WSAA avanzó, pero no se pudo completar la validación autenticada con WSFEv1." };
  return { code: "ARCA_AUTH_FAILED", message: "No se pudo completar la autenticación fiscal." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const empresaId = String(req.body?.empresaId || "").trim();
  if (!empresaValida(empresaId)) return json(res, 400, { error: "EMPRESA_INVALIDA" });

  const sesion = await validarUsuario(req, empresaId).catch(() => null);
  if (!sesion) return json(res, 403, { error: "FORBIDDEN" });

  try {
    const config = await leerConfig(sesion, empresaId);
    if (!config) return json(res, 409, { error: "ARCA_CONFIG_REQUIRED" });
    if (!WSAA[config.ambiente] || !WSFE[config.ambiente]) return json(res, 409, { error: "ARCA_AMBIENTE_INVALIDO" });
    if (!/^\d{11}$/.test(String(config.cuit_emisor || ""))) return json(res, 409, { error: "ARCA_CUIT_INVALIDO" });
    if (config.wsaa_service !== SERVICE || config.wsfe_version !== "WSFEv1") return json(res, 409, { error: "ARCA_SERVICIO_INVALIDO" });
    if (!config.certificado_ref) return json(res, 409, { error: "ARCA_CERTIFICADO_REQUIRED" });
    if (!config.certificado_vence || Date.parse(config.certificado_vence) <= Date.now()) return json(res, 409, { error: "ARCA_CERTIFICADO_VENCIDO" });

    const puntosAntes = await leerPuntos(sesion, empresaId, config.ambiente);
    let ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);
    let ticketReutilizado = true;
    const tra = crearTra();
    if (!ticket) {
      const [certificatePem, privateKeyPem] = await Promise.all([
        descargarSecreto(sesion, empresaId, "certificate.pem"),
        descargarSecreto(sesion, empresaId, "private-key.pem"),
      ]);
      ticket = await autenticarWsaa(WSAA[config.ambiente], tra.xml, certificatePem, privateKeyPem);
      await guardarTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor, ticket);
      ticketReutilizado = false;
    }

    const puntosArca = await validarWsfe(sesion, config.ambiente, WSFE[config.ambiente], ticket, config.cuit_emisor);
    await sincronizarPuntos(sesion, empresaId, config.ambiente, puntosArca);

    await guardarEstado(sesion, empresaId, {
      activo: true,
      ultima_prueba_ok: true,
      ultima_prueba_at: new Date().toISOString(),
      ultimo_error: null,
    });

    return json(res, 200, {
      ok: true,
      ambiente: config.ambiente,
      servicio: SERVICE,
      generationTime: ticket.generationTime || tra.generationTime,
      expirationTime: ticket.expirationTime,
      ticketReutilizado,
      wsfeValidado: true,
      puntosVentaConfigurados: puntosArca,
      puntosVentaArca: puntosArca,
      puntosVentaPrevios: puntosAntes,
      nota: "WSAA y WSFEv1 validados. SIGO sincronizó los puntos de venta informados por ARCA.",
    });
  } catch (error) {
    const safe = mensajeSeguro(error);
    try {
      await guardarEstado(sesion, empresaId, {
        activo: false,
        ultima_prueba_ok: false,
        ultima_prueba_at: new Date().toISOString(),
        ultimo_error: `${safe.code}: ${safe.message}`.slice(0, 500),
      });
    } catch {}
    console.error("SIGO ARCA auth v2", safe.code);
    return json(res, 502, { error: safe.code, message: safe.message });
  }
}
