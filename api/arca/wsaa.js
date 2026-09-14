import forge from "node-forge";

const BUCKET = "arca-secrets";
const SERVICE = "wsfe";
const WSAA = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};
const WSFE = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
}

function empresaValida(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function extraer(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "i"));
  return m?.[1]?.trim() || "";
}

async function rpcPermitido(url, anonKey, auth, empresaId, permiso) {
  const response = await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: permiso }),
  });
  if (!response.ok) return false;
  return (await response.json().catch(() => false)) === true;
}

async function validarUsuario(req, empresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!userResponse.ok) return null;
  if (!(await rpcPermitido(url, anonKey, auth, empresaId, "arca.configure"))) return null;
  return { url, anonKey, auth };
}

async function leerConfig(sesion, empresaId) {
  const select = "empresa_id,ambiente,cuit_emisor,certificado_ref,certificado_vence,wsaa_service,wsfe_version";
  const response = await fetch(
    `${sesion.url}/rest/v1/arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=${encodeURIComponent(select)}`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth, Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("CONFIG_READ_FAILED");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function leerPuntosVenta(sesion, empresaId, ambiente) {
  const select = "numero,activo,ambiente";
  const response = await fetch(
    `${sesion.url}/rest/v1/arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${encodeURIComponent(ambiente)}&activo=is.true&select=${encodeURIComponent(select)}&order=numero.asc`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth, Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("PUNTOS_VENTA_READ_FAILED");
  const rows = await response.json();
  return Array.isArray(rows)
    ? rows.map((row) => Number(row?.numero)).filter((numero) => Number.isInteger(numero) && numero > 0)
    : [];
}

async function descargarSecreto(sesion, empresaId, fileName) {
  const response = await fetch(
    `${sesion.url}/storage/v1/object/authenticated/${BUCKET}/${encodeURIComponent(empresaId)}/${encodeURIComponent(fileName)}`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth } },
  );
  if (!response.ok) throw new Error(`SECRET_READ_FAILED:${fileName}:${response.status}`);
  const value = await response.text();
  if (!value || value.length > 300_000) throw new Error(`SECRET_INVALID:${fileName}`);
  return value;
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
    uniqueId,
    generationTime,
    expirationTime,
    xml: `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header><service>${SERVICE}</service></loginTicketRequest>`,
  };
}

function firmarTra(traXml, certificatePem, privateKeyPem) {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  if (cert.publicKey?.n && key?.n && cert.publicKey.n.compareTo(key.n) !== 0) {
    throw new Error("CERT_KEY_MISMATCH");
  }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der, 64);
}

function validarTicket(ticket) {
  const now = Date.now();
  const expirationMs = Date.parse(ticket?.expirationTime || "");
  const generationMs = ticket?.generationTime ? Date.parse(ticket.generationTime) : now;
  if (!ticket?.token || !ticket?.sign || !Number.isFinite(expirationMs)) throw new Error("WSAA_RESPONSE_INVALID");
  if (!Number.isFinite(generationMs) || generationMs > now + 5 * 60_000) throw new Error("WSAA_TICKET_TIME_INVALID");
  if (expirationMs <= now + 60_000 || expirationMs > now + 24 * 60 * 60_000) throw new Error("WSAA_TICKET_EXPIRATION_INVALID");
  return ticket;
}

async function loginCms(endpoint, cms) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${escapeXml(cms)}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "urn:LoginCms",
        "User-Agent": "SIGO-WSAA/1.2",
      },
      body: soap,
    });
    const body = await response.text();
    const fault = decodeXml(extraer(body, "faultstring"));
    if (!response.ok || fault) {
      const message = fault || `HTTP_${response.status}`;
      const err = new Error(message);
      err.code = "WSAA_REJECTED";
      throw err;
    }
    const encodedReturn = extraer(body, "loginCmsReturn");
    const ticketXml = decodeXml(encodedReturn);
    const token = extraer(ticketXml, "token");
    const sign = extraer(ticketXml, "sign");
    const expirationTime = extraer(ticketXml, "expirationTime");
    const generationTime = extraer(ticketXml, "generationTime");
    return validarTicket({ token, sign, expirationTime, generationTime });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePuntosVentaWsfe(body) {
  const bloques = String(body || "").match(/<(?:[A-Za-z0-9_]+:)?PtoVenta(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?PtoVenta>/gi) || [];
  return bloques
    .map((bloque) => ({
      numero: Number(extraer(bloque, "Nro")),
      emisionTipo: extraer(bloque, "EmisionTipo").toUpperCase(),
      bloqueado: extraer(bloque, "Bloqueado").toUpperCase(),
      fechaBaja: extraer(bloque, "FchBaja"),
    }))
    .filter((item) => Number.isInteger(item.numero) && item.numero > 0);
}

function extraerErroresWsfe(body) {
  const errorsXml = extraer(body, "Errors");
  if (!errorsXml) return [];
  const bloques = errorsXml.match(/<(?:[A-Za-z0-9_]+:)?Err(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Err>/gi) || [];
  return bloques.map((bloque) => ({
    code: extraer(bloque, "Code"),
    message: decodeXml(extraer(bloque, "Msg")),
  })).filter((item) => item.code && item.code !== "0");
}

async function validarWsfe(endpoint, ticket, cuit, puntosConfigurados) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:FEParamGetPtosVenta><ar:Auth><ar:Token>${escapeXml(ticket.token)}</ar:Token><ar:Sign>${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>${escapeXml(cuit)}</ar:Cuit></ar:Auth></ar:FEParamGetPtosVenta></soapenv:Body></soapenv:Envelope>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta",
        "User-Agent": "SIGO-WSFEv1-Probe/1.1",
      },
      body: soap,
    });
    const body = await response.text();
    const fault = decodeXml(extraer(body, "faultstring"));
    const errors = extraerErroresWsfe(body);
    if (!response.ok || fault || errors.length > 0) {
      const firstError = errors[0];
      const err = new Error(fault || firstError?.message || `HTTP_${response.status}`);
      err.code = "WSFE_REJECTED";
      err.wsfeCode = firstError?.code || null;
      throw err;
    }
    const puntosArca = parsePuntosVentaWsfe(body);
    const habilitados = puntosArca
      .filter((item) => item.bloqueado !== "S" && !item.fechaBaja && item.emisionTipo === "CAE")
      .map((item) => item.numero);
    const faltantes = puntosConfigurados.filter((numero) => !habilitados.includes(numero));
    if (faltantes.length > 0) throw new Error(`PUNTO_VENTA_NO_HABILITADO_CAE:${faltantes.join(",")}`);
    return { puntosArca: habilitados };
  } finally {
    clearTimeout(timeout);
  }
}

function errorSeguro(error) {
  const raw = error instanceof Error ? error.message : String(error || "UNKNOWN");
  const stage = error?.code;
  if (/CERT_KEY_MISMATCH/i.test(raw)) return { code: "ARCA_CERT_KEY_MISMATCH", message: "El certificado y la clave privada no forman el mismo par criptográfico. Volvé a cargar los archivos correctos." };
  if (/cms\.cert\.untrusted|certificate|certificado/i.test(raw)) return { code: "WSAA_CERTIFICATE_REJECTED", message: "ARCA rechazó el certificado para este ambiente. Verificá si corresponde a homologación o producción y que el certificado vigente esté asociado al alias SIGO y al servicio WSFE." };
  if (/cms\.sign\.invalid|cms\.bad|firma inv[aá]lida|algoritmo no soportado/i.test(raw)) return { code: "WSAA_SIGNATURE_REJECTED", message: "ARCA rechazó la firma CMS del TRA. SIGO usa CMS adjunto y SHA-256; verificá que certificado y clave privada correspondan al certificado vigente de producción." };
  if (/CEE.*TA.*valid|TA v[aá]lido|ya posee.*TA|already.*(?:ticket|TA)/i.test(raw)) return { code: "WSAA_TICKET_ALREADY_VALID", message: "ARCA informa que ya existe un Ticket de Acceso vigente para WSFE. En producción puede aplicar una retención breve antes de admitir otro LoginCms; esperá unos minutos y reintentá sin regenerar certificado ni relación." };
  if (/PUNTO_VENTA_NO_HABILITADO_CAE/i.test(raw)) return { code: "WSFE_PUNTO_VENTA_INVALIDO", message: "WSFEv1 respondió correctamente, pero al menos un punto de venta configurado en SIGO no está habilitado para emisión CAE en ARCA." };
  if (stage === "WSFE_REJECTED") return { code: "WSFE_AUTH_FAILED", message: "WSAA entregó credenciales, pero WSFEv1 rechazó la autenticación o la consulta de puntos de venta. Revisá el último intento sin volver a generar certificado ni relación." };
  if (/service|servicio|authorized|autoriz/i.test(raw)) return { code: "WSAA_SERVICE_NOT_AUTHORIZED", message: "ARCA no autorizó este certificado para WSFE. Verificá que la relación existente use el mismo alias/certificado vigente cargado en SIGO." };
  if (/timeout|abort/i.test(raw)) return { code: "ARCA_TIMEOUT", message: "ARCA no respondió a tiempo. Reintentá en unos minutos." };
  if (/WSAA_TICKET|WSAA_RESPONSE_INVALID/i.test(raw)) return { code: "WSAA_TICKET_INVALID", message: "WSAA respondió con un Ticket de Acceso incompleto o con vigencia inválida; SIGO no habilitó la emisión." };
  if (stage === "WSAA_REJECTED") return { code: "WSAA_REJECTED", message: "WSAA rechazó el LoginCms. SIGO conservó el estado seguro y no habilitó emisión; revisá certificado vigente, relación WSFE y sincronización horaria." };
  return { code: "ARCA_AUTH_FAILED", message: "No se pudo completar la autenticación fiscal. SIGO mantuvo bloqueada la emisión y registró el intento sin exponer credenciales." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const empresaId = String(req.body?.empresaId || "").trim();
  if (!empresaValida(empresaId)) return json(res, 400, { error: "EMPRESA_INVALIDA" });

  let sesion;
  try {
    sesion = await validarUsuario(req, empresaId);
  } catch {
    sesion = null;
  }
  if (!sesion) return json(res, 403, { error: "FORBIDDEN" });

  try {
    const config = await leerConfig(sesion, empresaId);
    if (!config) return json(res, 409, { error: "ARCA_CONFIG_REQUIRED" });
    if (!WSAA[config.ambiente] || !WSFE[config.ambiente]) return json(res, 409, { error: "ARCA_AMBIENTE_INVALIDO" });
    if (!/^\d{11}$/.test(String(config.cuit_emisor || ""))) return json(res, 409, { error: "ARCA_CUIT_INVALIDO" });
    if (config.wsaa_service !== SERVICE || config.wsfe_version !== "WSFEv1") return json(res, 409, { error: "ARCA_SERVICIO_INVALIDO" });
    if (!config.certificado_ref) return json(res, 409, { error: "ARCA_CERTIFICADO_REQUIRED" });
    if (!config.certificado_vence || Date.parse(config.certificado_vence) <= Date.now()) return json(res, 409, { error: "ARCA_CERTIFICADO_VENCIDO" });

    const puntosConfigurados = await leerPuntosVenta(sesion, empresaId, config.ambiente);
    if (puntosConfigurados.length === 0) return json(res, 409, { error: "ARCA_PUNTO_VENTA_REQUIRED" });

    const [certificatePem, privateKeyPem] = await Promise.all([
      descargarSecreto(sesion, empresaId, "certificate.pem"),
      descargarSecreto(sesion, empresaId, "private-key.pem"),
    ]);

    const tra = crearTra();
    const cms = firmarTra(tra.xml, certificatePem, privateKeyPem);
    const ticket = await loginCms(WSAA[config.ambiente], cms);
    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados);

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
      wsfeValidado: true,
      puntosVentaConfigurados: puntosConfigurados,
      puntosVentaArca: wsfe.puntosArca,
      nota: "Autenticación WSAA real y acceso autenticado a WSFEv1 aprobados. Token y Sign no se exponen al navegador ni se guardan en arca_config.",
    });
  } catch (error) {
    const safe = errorSeguro(error);
    try {
      await guardarEstado(sesion, empresaId, {
        activo: false,
        ultima_prueba_ok: false,
        ultima_prueba_at: new Date().toISOString(),
        ultimo_error: `${safe.code}: ${safe.message}`.slice(0, 500),
      });
    } catch {
      // No ocultar el error original de ARCA si falla el registro de estado.
    }
    console.error("SIGO ARCA auth", safe.code);
    return json(res, 502, {
      error: safe.code,
      message: safe.message,
      etapa: error?.code === "WSFE_REJECTED" ? "WSFE" : "WSAA",
    });
  }
}
