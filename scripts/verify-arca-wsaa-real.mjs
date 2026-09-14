import fs from "node:fs";

const api = fs.readFileSync("api/arca/wsaa.js", "utf8");
const ui = fs.readFileSync("src/ArcaPreflight.tsx", "utf8");
const preflight = fs.readFileSync("api/arca/preflight.js", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const railwayRoot = fs.readFileSync("railway.toml", "utf8");
const railwayBridge = fs.readFileSync("arca-bridge/railway.toml", "utf8");
const bridgeServer = fs.readFileSync("arca-bridge/server.mjs", "utf8");

for (const token of [
  'SERVICE = "wsfe"',
  'wsaahomo.afip.gov.ar/ws/services/LoginCms',
  'wsaa.afip.gov.ar/ws/services/LoginCms',
  'wswhomo.afip.gov.ar/wsfev1/service.asmx',
  'servicios1.afip.gov.ar/wsfev1/service.asmx',
  'forge.pkcs7.createSignedData()',
  'forge.pki.oids.sha1',
  'forge.pki.oids.sha256',
  'p7.sign({ detached: false })',
  'SOAPAction: soapAction',
  '["urn:LoginCms", ""]',
  'createPrivateKey',
  'X509Certificate',
  'type: "pkcs1"',
  'PRIVATE_KEY_NORMALIZATION_FAILED',
  'CERTIFICATE_NORMALIZATION_FAILED',
  'autenticarWsaa',
  'loginCmsReturn',
  'validarTicket',
  'WSAA_TICKET_EXPIRATION_INVALID',
  'FEParamGetPtosVenta',
  'postSoapWsfeIpv4(',
  '"http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta"',
  'family: 4',
  'agent: false',
  'extraerErroresWsfe',
  'item.emisionTipo === "CAE"',
  'PUNTO_VENTA_NO_HABILITADO_CAE',
  'WSAA_TICKET_ALREADY_VALID',
  'WSAA_SIGNATURE_REJECTED',
  'ARCA_SECRET_READ_FAILED',
  'WSAA_POST_NETWORK_FAILED',
  'WSAA_NETWORK_FAILED',
  'WSFE_NETWORK_FAILED',
  'stage === "WSFE_REJECTED"',
  'wsfeValidado: true',
  'Cache-Control',
  'storage/v1/object/authenticated',
  'certificate.pem',
  'private-key.pem',
  'ticket-wsfe-${ambiente}.json',
  'leerTicketWsaa',
  'guardarTicketWsaa',
  'ticketReutilizado',
  'WSAA_TICKET_SAVE_FAILED',
  'ultima_prueba_ok: true',
  'activo: true',
  'Token y Sign no se exponen al navegador',
]) {
  if (!api.includes(token)) throw new Error(`ARCA WSAA/WSFEv1 safeguard missing: ${token}`);
}

for (const forbidden of [
  'token: ticket.token',
  'sign: ticket.sign',
  'SUPABASE_SERVICE_ROLE_KEY',
  'process.env.CLAVE_FISCAL',
  'message: raw.slice',
  'const errorCode = extraer(body, "Code")',
  'forge.util.encode64(der, 64)',
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA auth must not expose or preserve unsafe/obsolete behavior: ${forbidden}`);
}

for (const token of [
  '/api/arca/wsaa',
  'Autenticar WSAA real',
  'Renovar autenticación WSAA',
  'WSAA + WSFEv1 validados correctamente',
  'PV ARCA:',
  'disabled={wsaaLoading || loading}',
  'podés autenticar WSAA directamente',
  'contrasta los puntos de venta',
]) {
  if (!ui.includes(token)) throw new Error(`ARCA WSAA/WSFEv1 UI safeguard missing: ${token}`);
}

if (/\{result\s*\?\s*\(\s*<button[\s\S]{0,500}Autenticar WSAA real/.test(ui)) {
  throw new Error("ARCA WSAA UI regression: authentication button must not depend on a fresh preflight result");
}

if (!api.includes('const errorsXml = extraer(body, "Errors")')) {
  throw new Error("ARCA WSFE regression: informational Events must not be interpreted as fiscal Errors");
}
if (!api.includes('err.code = "WSFE_REJECTED"')) {
  throw new Error("ARCA WSFE regression: authenticated WSFE failures must remain stage-identifiable");
}

for (const token of ['family: 4', 'agent: false', 'SOAPAction: "http://ar.gov.afip.dif.FEV1/FEDummy"']) {
  if (!preflight.includes(token)) throw new Error(`ARCA WSFE IPv4 preflight guard missing: ${token}`);
}

const arcaFunctions = vercel?.functions?.["api/arca/*.js"];
if (!Array.isArray(arcaFunctions?.regions) || arcaFunctions.regions.length !== 1 || arcaFunctions.regions[0] !== "gru1") {
  throw new Error("ARCA functions must remain pinned to Vercel Sao Paulo (gru1)");
}
if (arcaFunctions.maxDuration !== 30) throw new Error("ARCA functions require a 30-second execution window");

for (const [content, tokens, label] of [
  [railwayRoot, ['cd arca-bridge && npm ci --omit=dev', 'cd arca-bridge && npm start', 'healthcheckPath = "/health/wsfe"'], "root Railway config"],
  [railwayBridge, ['npm ci --omit=dev', 'startCommand = "npm start"', 'healthcheckPath = "/health/wsfe"'], "bridge Railway config"],
  [bridgeServer, ['server.listen(PORT, "0.0.0.0"', 'req.url === "/health"', 'req.url === "/health/wsfe"'], "Railway bridge server"],
]) {
  for (const token of tokens) {
    if (!content.includes(token)) throw new Error(`${label} guard missing: ${token}`);
  }
}

console.log("SIGO_ARCA_WSAA_WSFE_REAL_OK");
