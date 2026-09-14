import fs from "node:fs";

const api = fs.readFileSync("api/arca/wsaa.js", "utf8");
const ui = fs.readFileSync("src/ArcaPreflight.tsx", "utf8");

for (const token of [
  'SERVICE = "wsfe"',
  'wsaahomo.afip.gov.ar/ws/services/LoginCms',
  'wsaa.afip.gov.ar/ws/services/LoginCms',
  'wswhomo.afip.gov.ar/wsfev1/service.asmx',
  'servicios1.afip.gov.ar/wsfev1/service.asmx',
  'forge.pkcs7.createSignedData()',
  'digestAlgorithm: forge.pki.oids.sha256',
  'p7.sign({ detached: false })',
  'SOAPAction: "urn:LoginCms"',
  'loginCmsReturn',
  'validarTicket',
  'WSAA_TICKET_EXPIRATION_INVALID',
  'FEParamGetPtosVenta',
  'SOAPAction: "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta"',
  'extraerErroresWsfe',
  'item.emisionTipo === "CAE"',
  'PUNTO_VENTA_NO_HABILITADO_CAE',
  'WSAA_TICKET_ALREADY_VALID',
  'WSAA_SIGNATURE_REJECTED',
  'stage === "WSFE_REJECTED"',
  'wsfeValidado: true',
  'Cache-Control',
  'storage/v1/object/authenticated',
  'certificate.pem',
  'private-key.pem',
  'ultima_prueba_ok: true',
  'activo: true',
  'Token y Sign no se exponen al navegador',
]) {
  if (!api.includes(token)) throw new Error(`ARCA WSAA/WSFEv1 safeguard missing: ${token}`);
}

for (const forbidden of [
  'digestAlgorithm: forge.pki.oids.sha1',
  'token: ticket.token',
  'sign: ticket.sign',
  'SUPABASE_SERVICE_ROLE_KEY',
  'process.env.CLAVE_FISCAL',
  'message: raw.slice',
  'const errorCode = extraer(body, "Code")',
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

console.log("SIGO_ARCA_WSAA_WSFE_REAL_OK");
