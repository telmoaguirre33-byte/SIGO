import fs from "node:fs";

const api = fs.readFileSync("api/arca/wsaa.js", "utf8");
const ui = fs.readFileSync("src/ArcaPreflight.tsx", "utf8");

for (const token of [
  'SERVICE = "wsfe"',
  'wsaahomo.afip.gov.ar/ws/services/LoginCms',
  'wsaa.afip.gov.ar/ws/services/LoginCms',
  'forge.pkcs7.createSignedData()',
  'digestAlgorithm: forge.pki.oids.sha1',
  'p7.sign({ detached: false })',
  'SOAPAction: "urn:LoginCms"',
  'loginCmsReturn',
  'storage/v1/object/authenticated',
  'certificate.pem',
  'private-key.pem',
  'ultima_prueba_ok: true',
  'activo: true',
  'Token y Sign no se exponen al navegador',
]) {
  if (!api.includes(token)) throw new Error(`ARCA WSAA real safeguard missing: ${token}`);
}

for (const forbidden of [
  'token: ticket.token',
  'sign: ticket.sign',
  'SUPABASE_SERVICE_ROLE_KEY',
  'process.env.CLAVE_FISCAL',
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA WSAA real must not expose forbidden secret: ${forbidden}`);
}

for (const token of [
  '/api/arca/wsaa',
  'Autenticar WSAA real',
  'Renovar autenticación WSAA',
  'WSAA validado correctamente',
  'puedeAutenticarWsaa',
]) {
  if (!ui.includes(token)) throw new Error(`ARCA WSAA UI safeguard missing: ${token}`);
}

console.log("SIGO_ARCA_WSAA_REAL_OK");
