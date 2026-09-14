import forge from "node-forge";

const BUCKET = "arca-secrets";
const SERVICE = "wsfe";
const WSAA = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

function json(res, status, body) {
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
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha1,
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
        "User-Agent": "SIGO-WSAA/1.0",
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
    if (!token || !sign || !expirationTime) throw new Error("WSAA_RESPONSE_INVALID");
    return { token, sign, expirationTime, generationTime };
  } finally {
    clearTimeout(timeout);
  }
}

function errorSeguro(error) {
  const raw = error instanceof Error ? error.message : String(error || "UNKNOWN");
  if (/cms\.cert\.untrusted|certificate|certificado/i.test(raw)) return { code: "WSAA_CERTIFICATE_REJECTED", message: "ARCA rechazó el certificado para este ambiente. Verificá si corresponde a homologación o producción y que esté asociado al servicio WSFE." };
  if (/service|servicio|auth|authorized|autoriz/i.test(raw)) return { code: "WSAA_SERVICE_NOT_AUTHORIZED", message: "ARCA no autorizó el certificado para WSFE. Asociá el alias del certificado al servicio de Facturación Electrónica/WSFE en ARCA." };
  if (/timeout|abort/i.test(raw)) return { code: "WSAA_TIMEOUT", message: "WSAA no respondió a tiempo. Reintentá en unos minutos." };
  return { code: "WSAA_LOGIN_FAILED", message: raw.slice(0, 240) };
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
    if (!WSAA[config.ambiente]) return json(res, 409, { error: "ARCA_AMBIENTE_INVALIDO" });
    if (config.wsaa_service !== SERVICE || config.wsfe_version !== "WSFEv1") return json(res, 409, { error: "ARCA_SERVICIO_INVALIDO" });
    if (!config.certificado_ref) return json(res, 409, { error: "ARCA_CERTIFICADO_REQUIRED" });
    if (!config.certificado_vence || Date.parse(config.certificado_vence) <= Date.now()) return json(res, 409, { error: "ARCA_CERTIFICADO_VENCIDO" });

    const [certificatePem, privateKeyPem] = await Promise.all([
      descargarSecreto(sesion, empresaId, "certificate.pem"),
      descargarSecreto(sesion, empresaId, "private-key.pem"),
    ]);

    const tra = crearTra();
    const cms = firmarTra(tra.xml, certificatePem, privateKeyPem);
    const ticket = await loginCms(WSAA[config.ambiente], cms);

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
      nota: "Autenticación WSAA real aprobada. Token y Sign no se exponen al navegador ni se guardan en arca_config.",
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
      // No ocultar el error original de WSAA si falla el registro de estado.
    }
    console.error("SIGO WSAA login", safe.code);
    return json(res, 502, { error: safe.code, message: safe.message });
  }
}
