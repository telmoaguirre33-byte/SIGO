import fs from "node:fs";

const BRIDGE = "https://sigo-arca-bridge-production.up.railway.app/wsfe";

function load(path) {
  return fs.readFileSync(path, "utf8");
}

function save(path, value) {
  fs.writeFileSync(path, value, "utf8");
}

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`ARCA bridge patch missing token: ${label}`);
  return text.replace(from, to);
}

function patchWsaa() {
  const path = "api/arca/wsaa.js";
  let s = load(path);
  s = replaceOnce(
    s,
    `const WSFE = {\n  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",\n  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",\n};`,
    `const WSFE = {\n  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",\n  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",\n};\nconst ARCA_BRIDGE_URL = process.env.ARCA_BRIDGE_URL || "${BRIDGE}";`,
    "wsaa bridge constant",
  );

  s = replaceOnce(
    s,
    `async function validarWsfe(endpoint, ticket, cuit, puntosConfigurados) {`,
    `async function postSoapWsfeBridge(authHeader, ambiente, action, soap, timeoutMs = 20_000) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), timeoutMs);\n  try {\n    const response = await fetch(ARCA_BRIDGE_URL, {\n      method: "POST",\n      signal: controller.signal,\n      headers: { Authorization: authHeader, "Content-Type": "application/json" },\n      body: JSON.stringify({ ambiente, action, soap }),\n    });\n    const payload = await response.json().catch(() => null);\n    if (!response.ok || !payload || typeof payload.body !== "string") {\n      const err = new Error(payload?.error || \`ARCA_BRIDGE_HTTP_\${response.status}\`);\n      err.code = "WSFE_BRIDGE_FAILED";\n      throw err;\n    }\n    return { ok: payload.ok === true, status: Number(payload.status || 0), body: payload.body };\n  } catch (cause) {\n    if (cause?.code === "WSFE_BRIDGE_FAILED") throw cause;\n    const err = new Error(cause?.name === "AbortError" ? "WSFE_BRIDGE_TIMEOUT" : "WSFE_BRIDGE_FAILED");\n    err.code = cause?.name === "AbortError" ? "WSFE_NETWORK_TIMEOUT" : "WSFE_BRIDGE_FAILED";\n    err.cause = cause;\n    throw err;\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n\nasync function validarWsfe(endpoint, ticket, cuit, puntosConfigurados, authHeader = "", ambiente = "") {`,
    "wsaa bridge helper",
  );

  s = replaceOnce(
    s,
    `  const response = await postSoapWsfeIpv4(\n    endpoint,\n    "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta",\n    soap,\n  );`,
    `  let response;\n  if (authHeader && ambiente) {\n    try {\n      response = await postSoapWsfeBridge(authHeader, ambiente, "FEParamGetPtosVenta", soap);\n    } catch (bridgeError) {\n      try {\n        response = await postSoapWsfeIpv4(endpoint, "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta", soap);\n      } catch {\n        throw bridgeError;\n      }\n    }\n  } else {\n    response = await postSoapWsfeIpv4(endpoint, "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta", soap);\n  }`,
    "wsaa bridge transport",
  );

  s = replaceOnce(
    s,
    `  if (stage === "WSFE_NETWORK_FAILED") return { code: "WSFE_NETWORK_FAILED", message: "WSAA pudo avanzar, pero SIGO no logró conectar con WSFEv1 por el transporte estándar ni por IPv4 nativo." };`,
    `  if (stage === "WSFE_BRIDGE_FAILED") return { code: "WSFE_BRIDGE_FAILED", message: "WSAA avanzó correctamente, pero el canal fiscal alternativo no pudo completar WSFEv1." };\n  if (stage === "WSFE_NETWORK_FAILED") return { code: "WSFE_NETWORK_FAILED", message: "WSAA pudo avanzar, pero SIGO no logró conectar con WSFEv1 por el transporte estándar ni por IPv4 nativo." };`,
    "wsaa bridge error",
  );

  s = replaceOnce(
    s,
    `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados);`,
    `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados, sesion.auth, config.ambiente);`,
    "wsaa handler bridge",
  );
  save(path, s);
}

function patchPreflight() {
  const path = "api/arca/preflight.js";
  let s = load(path);
  s = replaceOnce(
    s,
    `const BUCKET = "arca-secrets";`,
    `const BUCKET = "arca-secrets";\nconst ARCA_BRIDGE_URL = process.env.ARCA_BRIDGE_URL || "${BRIDGE}";`,
    "preflight bridge constant",
  );

  s = replaceOnce(s, `function probarWsfe(endpoint) {`, `function probarWsfeDirect(endpoint) {`, "preflight rename direct");

  s = replaceOnce(
    s,
    `function certificadoMetadataEstado(config) {`,
    `async function probarWsfeBridge(authHeader, ambiente) {\n  const soap = \`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>\`;\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);\n  try {\n    const response = await fetch(ARCA_BRIDGE_URL, {\n      method: "POST",\n      signal: controller.signal,\n      headers: { Authorization: authHeader, "Content-Type": "application/json" },\n      body: JSON.stringify({ ambiente, action: "FEDummy", soap }),\n    });\n    const payload = await response.json().catch(() => null);\n    const body = String(payload?.body || "");\n    const dummyRespondio = /<(?:[A-Za-z0-9_]+:)?FEDummyResult\\b/i.test(body) || /<(?:[A-Za-z0-9_]+:)?AppServer\\b/i.test(body);\n    return { reachable: response.ok && payload?.ok === true && dummyRespondio, status: Number(payload?.status || response.status), method: "FEDummy", transport: "railway-bridge" };\n  } catch (error) {\n    return { reachable: false, status: null, reason: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK", method: "FEDummy", transport: "railway-bridge" };\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n\nasync function probarWsfe(endpoint, authHeader = "", ambiente = "") {\n  if (authHeader && ambiente) {\n    const bridge = await probarWsfeBridge(authHeader, ambiente);\n    if (bridge.reachable) return bridge;\n  }\n  return probarWsfeDirect(endpoint);\n}\n\nfunction certificadoMetadataEstado(config) {`,
    "preflight bridge wrapper",
  );

  s = replaceOnce(
    s,
    `    const [wsaa, wsfe] = await Promise.all([probarEndpoint(endpoints.wsaa), probarWsfe(endpoints.wsfe)]);`,
    `    const [wsaa, wsfe] = await Promise.all([probarEndpoint(endpoints.wsaa), probarWsfe(endpoints.wsfe, sesion.auth, ambiente)]);`,
    "preflight handler bridge",
  );
  save(path, s);
}

function patchCae() {
  const path = "api/arca/cae.js";
  let s = load(path);
  s = replaceOnce(
    s,
    `const TIPOS_FACTURA = new Set([1, 6, 11]);`,
    `const TIPOS_FACTURA = new Set([1, 6, 11]);\nconst ARCA_BRIDGE_URL = process.env.ARCA_BRIDGE_URL || "${BRIDGE}";`,
    "cae bridge constant",
  );

  const oldSoap = `async function soapWsfe(endpoint, action, innerXml) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 20_000);\n  try {\n    const response = await fetch(endpoint, {\n      method: "POST",\n      signal: controller.signal,\n      headers: {\n        "Content-Type": "text/xml;charset=UTF-8",\n        SOAPAction: \`http://ar.gov.afip.dif.FEV1/\${action}\`,\n        "User-Agent": "SIGO-WSFEv1-CAE/1.0",\n      },\n      body: \`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:\${action}>\${innerXml}</ar:\${action}></soapenv:Body></soapenv:Envelope>\`,\n    });\n    const body = await response.text();\n    const fault = decodeXml(extraer(body, "faultstring"));\n    const errors = extraerErroresWsfe(body);\n    if (!response.ok || fault) {\n      const error = new Error(fault || \`HTTP_\${response.status}\`);\n      error.code = "WSFE_REJECTED";\n      throw error;\n    }\n    return { body, errors };\n  } finally {\n    clearTimeout(timeout);\n  }\n}`;

  const newSoap = `async function soapWsfe(endpoint, action, innerXml, transport = null) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 20_000);\n  const soap = \`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:\${action}>\${innerXml}</ar:\${action}></soapenv:Body></soapenv:Envelope>\`;\n  const bridgeActivo = Boolean(transport?.authHeader && transport?.ambiente);\n  try {\n    const response = await fetch(bridgeActivo ? ARCA_BRIDGE_URL : endpoint, {\n      method: "POST",\n      signal: controller.signal,\n      headers: bridgeActivo\n        ? { Authorization: transport.authHeader, "Content-Type": "application/json" }\n        : { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: \`http://ar.gov.afip.dif.FEV1/\${action}\`, "User-Agent": "SIGO-WSFEv1-CAE/1.0" },\n      body: bridgeActivo ? JSON.stringify({ ambiente: transport.ambiente, action, soap }) : soap,\n    });\n    let body;\n    if (bridgeActivo) {\n      const payload = await response.json().catch(() => null);\n      if (!response.ok || !payload || typeof payload.body !== "string") {\n        const error = new Error(payload?.error || \`ARCA_BRIDGE_HTTP_\${response.status}\`);\n        error.code = "WSFE_BRIDGE_FAILED";\n        throw error;\n      }\n      body = payload.body;\n    } else {\n      body = await response.text();\n    }\n    const fault = decodeXml(extraer(body, "faultstring"));\n    const errors = extraerErroresWsfe(body);\n    if (!response.ok || fault) {\n      const error = new Error(fault || \`HTTP_\${response.status}\`);\n      error.code = "WSFE_REJECTED";\n      throw error;\n    }\n    return { body, errors };\n  } finally {\n    clearTimeout(timeout);\n  }\n}`;
  s = replaceOnce(s, oldSoap, newSoap, "cae soap transport");

  s = replaceOnce(s, `async function ultimoAutorizado(endpoint, ticket, cuit, puntoVenta, tipoCbte) {`, `async function ultimoAutorizado(endpoint, ticket, cuit, puntoVenta, tipoCbte, transport = null) {`, "cae last signature");
  s = replaceOnce(s, `    \`${'${authXml(ticket, cuit)}'}<ar:PtoVta>${'${puntoVenta}'}</ar:PtoVta><ar:CbteTipo>${'${tipoCbte}'}</ar:CbteTipo>\`,\n  );`, `    \`${'${authXml(ticket, cuit)}'}<ar:PtoVta>${'${puntoVenta}'}</ar:PtoVta><ar:CbteTipo>${'${tipoCbte}'}</ar:CbteTipo>\`,\n    transport,\n  );`, "cae last transport");

  s = replaceOnce(s, `async function consultarComprobante(endpoint, ticket, cuit, puntoVenta, tipoCbte, numeroCbte) {`, `async function consultarComprobante(endpoint, ticket, cuit, puntoVenta, tipoCbte, numeroCbte, transport = null) {`, "cae consult signature");
  s = replaceOnce(s, `    \`${'${authXml(ticket, cuit)}'}<ar:FeCompConsReq><ar:CbteTipo>${'${tipoCbte}'}</ar:CbteTipo><ar:CbteNro>${'${numeroCbte}'}</ar:CbteNro><ar:PtoVta>${'${puntoVenta}'}</ar:PtoVta></ar:FeCompConsReq>\`,\n  );`, `    \`${'${authXml(ticket, cuit)}'}<ar:FeCompConsReq><ar:CbteTipo>${'${tipoCbte}'}</ar:CbteTipo><ar:CbteNro>${'${numeroCbte}'}</ar:CbteNro><ar:PtoVta>${'${puntoVenta}'}</ar:PtoVta></ar:FeCompConsReq>\`,\n    transport,\n  );`, "cae consult transport");

  s = replaceOnce(s, `async function solicitarCae(endpoint, ticket, cuit, request) {`, `async function solicitarCae(endpoint, ticket, cuit, request, transport = null) {`, "cae issue signature");
  s = replaceOnce(s, `  const { body, errors } = await soapWsfe(endpoint, "FECAESolicitar", \`${'${authXml(ticket, cuit)}'}${'${detail}'}\`);`, `  const { body, errors } = await soapWsfe(endpoint, "FECAESolicitar", \`${'${authXml(ticket, cuit)}'}${'${detail}'}\`, transport);`, "cae issue transport");

  s = replaceOnce(
    s,
    `    const ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);\n    if (!ticket) return json(res, 409, { error: "ARCA_TICKET_REFRESH_REQUIRED" });`,
    `    const ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);\n    if (!ticket) return json(res, 409, { error: "ARCA_TICKET_REFRESH_REQUIRED" });\n    const transport = { authHeader: sesion.auth, ambiente: config.ambiente };`,
    "cae handler transport const",
  );

  s = replaceOnce(s, `      const recovered = await consultarComprobante(WSFE[config.ambiente], ticket, config.cuit_emisor, reserva.punto_venta, reserva.tipo_cbte, Number(reserva.numero_cbte));`, `      const recovered = await consultarComprobante(WSFE[config.ambiente], ticket, config.cuit_emisor, reserva.punto_venta, reserva.tipo_cbte, Number(reserva.numero_cbte), transport);`, "cae handler reconcile");
  s = replaceOnce(s, `      const ultimo = await ultimoAutorizado(WSFE[config.ambiente], ticket, config.cuit_emisor, puntoVenta, tipoCbte);`, `      const ultimo = await ultimoAutorizado(WSFE[config.ambiente], ticket, config.cuit_emisor, puntoVenta, tipoCbte, transport);`, "cae handler last");
  s = replaceOnce(
    s,
    `    const issued = await solicitarCae(WSFE[config.ambiente], ticket, config.cuit_emisor, {\n      puntoVenta,\n      tipoCbte,\n      numeroCbte: Number(reserva.numero_cbte),\n      receptor,\n      fiscal,\n    });`,
    `    const issued = await solicitarCae(WSFE[config.ambiente], ticket, config.cuit_emisor, {\n      puntoVenta,\n      tipoCbte,\n      numeroCbte: Number(reserva.numero_cbte),\n      receptor,\n      fiscal,\n    }, transport);`,
    "cae handler issue",
  );
  save(path, s);
}

patchWsaa();
patchPreflight();
patchCae();
console.log("SIGO_ARCA_BRIDGE_PATCH_OK");
