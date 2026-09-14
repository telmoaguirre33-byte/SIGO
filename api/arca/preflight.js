const PREFLIGHT_TIMEOUT_MS = 8_000;
const AUTH_REAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const AUTH_REAL_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

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
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
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
  if (config?.ultima_prueba_ok !== true) {
    return { ok: false, estado: "NO_VALIDADA", antiguedadMinutos: null };
  }
  if (!config?.ultima_prueba_at) {
    return { ok: false, estado: "SIN_FECHA", antiguedadMinutos: null };
  }
  const pruebaMs = Date.parse(config.ultima_prueba_at);
  if (!Number.isFinite(pruebaMs)) {
    return { ok: false, estado: "FECHA_INVALIDA", antiguedadMinutos: null };
  }
  const edadMs = Date.now() - pruebaMs;
  if (edadMs < -AUTH_REAL_FUTURE_TOLERANCE_MS) {
    return { ok: false, estado: "FECHA_FUTURA", antiguedadMinutos: null };
  }
  if (edadMs > AUTH_REAL_MAX_AGE_MS) {
    return { ok: false, estado: "VENCIDA", antiguedadMinutos: Math.floor(edadMs / 60_000) };
  }
  return { ok: true, estado: "VIGENTE", antiguedadMinutos: Math.max(0, Math.floor(edadMs / 60_000)) };
}

async function rpcPermitido(url, anonKey, auth, empresaId, permiso) {
  const response = await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: permiso }),
  });
  if (!response.ok) return false;
  return (await response.json().catch(() => false)) === true;
}

async function validarUsuario(req, empresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: auth },
  });
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

async function probarEndpoint(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "SIGO-ARCA-Preflight/1.1" },
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
        "User-Agent": "SIGO-ARCA-Preflight/1.1",
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

function certificadoEstado(config) {
  if (!config?.certificado_ref) return { ok: false, estado: "FALTA_REFERENCIA" };
  const ref = String(config.certificado_ref).toLowerCase();
  if (["clave fiscal", "password", "contrasena", "contraseña", "private key", "BEGIN PRIVATE KEY"].some((token) => ref.includes(token.toLowerCase()))) {
    return { ok: false, estado: "REFERENCIA_INSEGURA" };
  }
  if (!config.certificado_vence) return { ok: false, estado: "FALTA_VENCIMIENTO" };
  const venceMs = Date.parse(config.certificado_vence);
  if (!Number.isFinite(venceMs)) return { ok: false, estado: "VENCIMIENTO_INVALIDO" };
  const ahora = Date.now();
  if (venceMs <= ahora) return { ok: false, estado: "VENCIDO", vence: config.certificado_vence };
  const dias = Math.floor((venceMs - ahora) / 86_400_000);
  return { ok: true, estado: dias <= 30 ? "VENCE_PRONTO" : "VIGENTE", vence: config.certificado_vence, diasRestantes: dias };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const empresaId = String(req.body?.empresaId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(empresaId)) {
    return json(res, 400, { error: "EMPRESA_INVALIDA" });
  }

  let sesion;
  try {
    sesion = await validarUsuario(req, empresaId);
  } catch {
    sesion = null;
  }
  if (!sesion) return json(res, 403, { error: "FORBIDDEN" });

  try {
    const selectConfig = "empresa_id,ambiente,cuit_emisor,certificado_ref,certificado_vence,wsaa_service,wsfe_version,activo,ultima_prueba_ok,ultima_prueba_at,ultimo_error";
    const configs = await leerFilas(
      sesion.url,
      sesion.anonKey,
      sesion.auth,
      `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=${encodeURIComponent(selectConfig)}`,
    );
    const config = Array.isArray(configs) ? configs[0] ?? null : null;
    if (!config) return json(res, 200, { ok: false, etapa: "CONFIGURACION", checks: { configuracion: false } });

    const ambienteValido = config.ambiente === "homologacion" || config.ambiente === "produccion";
    const ambiente = ambienteValido ? config.ambiente : "homologacion";
    const puntos = await leerFilas(
      sesion.url,
      sesion.anonKey,
      sesion.auth,
      `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(empresaId)}&ambiente=eq.${ambiente}&activo=is.true&select=numero,nombre,ambiente,activo&order=numero.asc`,
    );

    const configuracionActiva = config.activo === true;
    const certificado = certificadoEstado(config);
    const autenticacionReal = autenticacionRealEstado(config);
    const cuitOk = cuitArgentinoValido(config.cuit_emisor);
    const servicioOk = config.wsaa_service === "wsfe" && config.wsfe_version === "WSFEv1";
    const pv = puntosVentaValidos(puntos);
    const puntoVentaOk = pv.ok;
    const endpoints = ARCA_ENDPOINTS[ambiente];
    const [wsaa, wsfe] = await Promise.all([probarEndpoint(endpoints.wsaa), probarWsfe(endpoints.wsfe)]);
    const redOk = wsaa.reachable && wsfe.reachable;
    const preparacionOk = Boolean(ambienteValido && cuitOk && servicioOk && puntoVentaOk && certificado.ok && redOk);
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
        certificadoVence: certificado.vence ?? null,
        certificadoDiasRestantes: certificado.diasRestantes ?? null,
        puntoVenta: puntoVentaOk,
        puntosVentaActivos: pv.numeros,
        wsaaReachable: wsaa.reachable,
        wsfeReachable: wsfe.reachable,
      },
      endpoints: {
        wsaa: endpoints.wsaa,
        wsfe: endpoints.wsfe,
      },
      autenticacionRealValidada: autenticacionReal.ok,
      autenticacionRealEstado: autenticacionReal.estado,
      autenticacionRealAntiguedadMinutos: autenticacionReal.antiguedadMinutos,
      emisionHabilitable,
      ultimaPruebaAt: config.ultima_prueba_at ?? null,
      ultimoErrorSeguro: config.ultimo_error ? String(config.ultimo_error).slice(0, 500) : null,
      nota: "Esta prevalidación no firma TRA, no usa la clave fiscal y no habilita CAE por sí sola. Una autenticación WSAA previa sólo se considera vigente durante 12 horas; después SIGO exige validarla otra vez antes de habilitar emisión.",
    });
  } catch (error) {
    console.error("SIGO ARCA preflight error", error);
    return json(res, 502, { error: "ARCA_PREFLIGHT_UNAVAILABLE" });
  }
}
