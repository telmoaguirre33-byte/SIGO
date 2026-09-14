import { X509Certificate, createPrivateKey, randomBytes, sign, verify } from "node:crypto";

const PREFLIGHT_TIMEOUT_MS = 8_000;
const AUTH_REAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const AUTH_REAL_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const BUCKET = "arca-secrets";

const ARCA_ENDPOINTS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

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

function cuitArgentinoValido(value) {
  const cuit = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, index) => total + Number(cuit[index]) * peso, 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return esperado === Number(cuit[10]);
}

function puntosVentaValidos(puntos) {
  if (!Array.isArray(puntos) || puntos.length === 0) return { ok: false, numeros: [] };
  const numeros = puntos.map((item) => Number(item?.numero));
  const validos = numeros.every((numero) => Number.isInteger(numero) && numero >= 1 && numero <= 99999);
  const unicos = new Set(numeros).size === numeros.length;
  return { ok: validos && unicos, numeros: validos && unicos ? numeros : [] };
}

function autenticacionRealEstado(config) {
  if (config?.ultima_prueba_ok !== true) return { ok: false, estado: "NO_VALIDADA", antiguedadMinutos: null };
  if (!config?.ultima_prueba_at) return { ok: false, estado: "SIN_FECHA", antiguedadMinutos: null };
  const pruebaMs = Date.parse(config.ultima_prueba_at);
  if (!Number.isFinite(pruebaMs)) return { ok: false, estado: "FECHA_INVALIDA", antiguedadMinutos: null };
  const edadMs = Date.now() - pruebaMs;
  if (edadMs < -AUTH_REAL_FUTURE_TOLERANCE_MS) return { ok: false, estado: "FECHA_FUTURA", antiguedadMinutos: null };
  if (edadMs > AUTH_REAL_MAX_AGE_MS) return { ok: false, estado: "VENCIDA", antiguedadMinutos: Math.floor(edadMs / 60_000) };
  return { ok: true, estado: "VIGENTE", antiguedadMinutos: Math.max(0, Math.floor(edadMs / 60_000)) };
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
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!userResponse.ok) return null;
  if (!(await rpcPermitido(url, anonKey, auth, empresaId, "arca.configure"))) return null;
  return { url, anonKey, auth };
}

async function leerFilas(url, anonKey, auth, path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: auth, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`POSTGREST_${response.status}`);
  return response.json();
}

async function leerSecreto(sesion, empresaId, fileName) {
  const response = await fetch(
    `${sesion.url}/storage/v1/object/authenticated/${BUCKET}/${encodeURIComponent(empresaId)}/${encodeURIComponent(fileName)}`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth } },
  );
  if (!response.ok) return { ok: false, status: response.status, value: "" };
  const value = await response.text();
  if (!value || value.length > 300_000) return { ok: false, status: response.status, value: "" };
  return { ok: true, status: response.status, value };
}

function cuitCertificado(subject) {
  const texto = String(subject || "");
  const match = texto.match(/(?:^|[\n,\/])\s*(?:serialNumber|2\.5\.4\.5)\s*=\s*(?:CUIT\s*)?([0-9]{11})(?=$|[\n,\/])/i);
  return match?.[1] || "";
}

async function materialCriptograficoEstado(sesion, empresaId, config) {
  const [certFile, keyFile] = await Promise.all([
    leerSecreto(sesion, empresaId, "certificate.pem"),
    leerSecreto(sesion, empresaId, "private-key.pem"),
  ]);
  if (!certFile.ok) return { ok: false, estado: "CERTIFICADO_PRIVADO_NO_DISPONIBLE" };
  if (!keyFile.ok) return { ok: false, estado: "CLAVE_PRIVADA_NO_DISPONIBLE" };
  if (/BEGIN ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/i.test(keyFile.value)) {
    return { ok: false, estado: "CLAVE_PRIVADA_CIFRADA" };
  }

  let cert;
  try {
    cert = new X509Certificate(certFile.value);
  } catch {
    return { ok: false, estado: "CERTIFICADO_NO_LEGIBLE" };
  }

  let key;
  try {
    key = createPrivateKey({ key: keyFile.value, format: "pem" });
  } catch {
    return { ok: false, estado: "CLAVE_PRIVADA_NO_LEGIBLE" };
  }

  const vigenteDesde = Date.parse(cert.validFrom);
  const vence = Date.parse(cert.validTo);
  const ahora = Date.now();
  if (!Number.isFinite(vigenteDesde) || !Number.isFinite(vence)) return { ok: false, estado: "CERTIFICADO_VIGENCIA_INVALIDA" };
  if (vigenteDesde > ahora) return { ok: false, estado: "CERTIFICADO_AUN_NO_VIGENTE" };
  if (vence <= ahora) return { ok: false, estado: "CERTIFICADO_VENCIDO" };

  const cuit = cuitCertificado(cert.subject);
  if (!cuit) return { ok: false, estado: "CERTIFICADO_SIN_CUIT" };
  if (cuit !== String(config.cuit_emisor || "")) return { ok: false, estado: "CERTIFICADO_CUIT_NO_COINCIDE" };

  try {
    const challenge = randomBytes(48);
    const firma = sign("sha256", challenge, key);
    if (!verify("sha256", challenge, cert.publicKey, firma)) return { ok: false, estado: "CERTIFICADO_CLAVE_NO_COINCIDEN" };
  } catch {
    return { ok: false, estado: "CERTIFICADO_CLAVE_NO_COINCIDEN" };
  }

  return { ok: true, estado: "VIGENTE_Y_PAR_VALIDO" };
}

async function probarEndpoint(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "SIGO-ARCA-Preflight/1.2" },
    });
    return { reachable: true, status: response.status };
  } catch (error) {
    return { reachable: false, status: null, reason: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK" };
  } finally {
    clearTimeout(timeout);
  }
}

async function probarWsfe(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "http://ar.gov.afip.dif.FEV1/FEDummy",
        "User-Agent": "SIGO-ARCA-Preflight/1.2",
      },
      body: soap,
    });
    const body = await response.text().catch(() => "");
    const dummyRespondio = /<(?:[A-Za-z0-9_]+:)?FEDummyResult\b/i.test(body) || /<(?:[A-Za-z0-9_]+:)?AppServer\b/i.test(body);
    return { reachable: response.ok && dummyRespondio, status: response.status, method: "FEDummy" };
  } catch (error) {
    return { reachable: false, status: null, reason: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK", method: "FEDummy" };
  } finally {
    clearTimeout(timeout);
  }
}

function certificadoMetadataEstado(config) {
  if (!config?.certificado_ref) return { ok: false, estado: "FALTA_REFERENCIA" };
  if (!config.certificado_vence) return { ok: false, estado: "FALTA_VENCIMIENTO" };
  const venceMs = Date.parse(config.certificado_vence);
  if (!Number.isFinite(venceMs)) return { ok: false, estado: "VENCIMIENTO_INVALIDO" };
  if (venceMs <= Date.now()) return { ok: false, estado: "VENCIDO", vence: config.certificado_vence };
  return { ok: true, estado: "VIGENTE", vence: config.certificado_vence, diasRestantes: Math.floor((venceMs - Date.now()) / 86_400_000) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const empresaId = String(req.body?.empresaId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(empresaId)) return json(res, 400, { error: "EMPRESA_INVALIDA" });

  let sesion;
  try { sesion = await validarUsuario(req, empresaId); } catch { sesion = null; }
  if (!sesion) return json(res, 403, { error: "FORBIDDEN" });

  try {
    const selectConfig = "empresa_id,ambiente,cuit_emisor,certificado_ref,certificado_vence,wsaa_service,wsfe_version,activo,ultima_prueba_ok,ultima_prueba_at,ultimo_error";
    const configs = await leerFilas(sesion.url, sesion.anonKey, sesion.auth, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=${encodeURIComponent(selectConfig)}`);
    const config = Array.isArray(configs) ? configs[0] ?? null : null;
    if (!config) return json(res, 200, { ok: false, etapa: "CONFIGURACION", checks: { configuracion: false } });

    const ambienteValido = config.ambiente === "homologacion" || config.ambiente === "produccion";
    const ambiente = ambienteValido ? config.ambiente : "homologacion";
    const puntos = await leerFilas(sesion.url, sesion.anonKey, sesion.auth, `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${ambiente}&activo=is.true&select=numero,nombre,ambiente,activo&order=numero.asc`);

    const metadata = certificadoMetadataEstado(config);
    const material = metadata.ok ? await materialCriptograficoEstado(sesion, empresaId, config) : { ok: false, estado: metadata.estado };
    const certificado = material.ok ? { ...metadata, estado: material.estado } : { ...metadata, ok: false, estado: material.estado };
    const autenticacionReal = autenticacionRealEstado(config);
    const cuitOk = cuitArgentinoValido(config.cuit_emisor);
    const servicioOk = config.wsaa_service === "wsfe" && config.wsfe_version === "WSFEv1";
    const pv = puntosVentaValidos(puntos);
    const puntoVentaOk = pv.ok;
    const endpoints = ARCA_ENDPOINTS[ambiente];
    const [wsaa, wsfe] = await Promise.all([probarEndpoint(endpoints.wsaa), probarWsfe(endpoints.wsfe)]);
    const redOk = wsaa.reachable && wsfe.reachable;
    const preparacionOk = Boolean(ambienteValido && cuitOk && servicioOk && puntoVentaOk && certificado.ok && redOk);
    const configuracionActiva = config.activo === true;
    const emisionHabilitable = Boolean(preparacionOk && configuracionActiva && autenticacionReal.ok);

    return json(res, 200, {
      ok: preparacionOk,
      etapa: emisionHabilitable ? "WSAA_VALIDADO" : preparacionOk ? "LISTO_PARA_WSAA" : "PREPARACION_INCOMPLETA",
      ambiente,
      checks: {
        configuracion: true,
        configuracionActiva,
        ambienteValido,
        cuit: cuitOk,
        servicio: servicioOk,
        certificado: certificado.ok,
        certificadoEstado: certificado.estado,
        certificadoVence: metadata.vence ?? null,
        certificadoDiasRestantes: metadata.diasRestantes ?? null,
        materialCriptografico: material.ok,
        puntoVenta: puntoVentaOk,
        puntosVentaActivos: pv.numeros,
        wsaaReachable: wsaa.reachable,
        wsfeReachable: wsfe.reachable,
      },
      endpoints,
      autenticacionRealValidada: autenticacionReal.ok,
      autenticacionRealEstado: autenticacionReal.estado,
      autenticacionRealAntiguedadMinutos: autenticacionReal.antiguedadMinutos,
      emisionHabilitable,
      ultimaPruebaAt: config.ultima_prueba_at ?? null,
      ultimoErrorSeguro: config.ultimo_error ? String(config.ultimo_error).slice(0, 500) : null,
      nota: "SIGO verificó también los archivos privados reales del certificado y la clave sin exponerlos. Esta prevalidación no firma TRA, no usa la clave fiscal y no habilita CAE por sí sola.",
    });
  } catch (error) {
    console.error("SIGO ARCA preflight error", error instanceof Error ? error.message : "UNKNOWN");
    return json(res, 502, { error: "ARCA_PREFLIGHT_UNAVAILABLE" });
  }
}
