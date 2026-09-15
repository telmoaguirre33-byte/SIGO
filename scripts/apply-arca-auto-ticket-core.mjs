import fs from "node:fs";

const path = "api/arca/cae-v2.js";
let source = fs.readFileSync(path, "utf8");

source = source.replace(
`import {\n  WSFE,\n  escapeXml,\n  decodeXml,\n  extraer,\n  extraerErroresWsfe,\n  leerTicketWsaa,\n} from "./wsaa.js";`,
`import {\n  WSAA,\n  WSFE,\n  escapeXml,\n  decodeXml,\n  extraer,\n  extraerErroresWsfe,\n  leerTicketWsaa,\n  descargarSecreto,\n  autenticarWsaa,\n  guardarTicketWsaa,\n} from "./wsaa.js";`,
);

if (!source.includes("function crearTraWsaa()")) {
  const marker = `function authXml(ticket, cuit) {\n  return \`<ar:Auth><ar:Token>\${escapeXml(ticket.token)}</ar:Token><ar:Sign>\${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>\${escapeXml(cuit)}</ar:Cuit></ar:Auth>\`;\n}`;
  if (!source.includes(marker)) throw new Error("ARCA_AUTO_TICKET_CORE_AUTH_MARKER_NOT_FOUND");
  source = source.replace(marker, `${marker}\n\nfunction crearTraWsaa() {\n  const now = Date.now();\n  const uniqueId = Math.floor(now / 1000) >>> 0;\n  const generationTime = new Date(now - 5 * 60_000).toISOString();\n  const expirationTime = new Date(now + 10 * 60_000).toISOString();\n  return \`<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>\${uniqueId}</uniqueId><generationTime>\${generationTime}</generationTime><expirationTime>\${expirationTime}</expirationTime></header><service>wsfe</service></loginTicketRequest>\`;\n}`);
}

const oldTicket = `    const ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);\n    if (!ticket) return json(res, 409, { error: "ARCA_TICKET_REFRESH_REQUIRED" });`;
const newTicket = `    let ticket = await leerTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor);\n    if (!ticket) {\n      stage = "wsaa_refresh";\n      const puedeRenovar = await permiso(sesion, empresaId, "arca.configure");\n      if (!puedeRenovar) {\n        return json(res, 409, {\n          error: "ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN",\n          message: "La autorización fiscal venció y este perfil no puede renovar credenciales fiscales. Un administrador debe abrir ARCA una vez para renovarla.",\n        });\n      }\n      if (!WSAA[config.ambiente]) return json(res, 409, { error: "ARCA_ENVIRONMENT_INVALID" });\n      const [certificatePem, privateKeyPem] = await Promise.all([\n        descargarSecreto(sesion, empresaId, "certificate.pem"),\n        descargarSecreto(sesion, empresaId, "private-key.pem"),\n      ]);\n      ticket = await autenticarWsaa(WSAA[config.ambiente], crearTraWsaa(), certificatePem, privateKeyPem);\n      await guardarTicketWsaa(sesion, empresaId, config.ambiente, config.cuit_emisor, ticket);\n    }`;

if (source.includes(oldTicket)) source = source.replace(oldTicket, newTicket);
else if (!source.includes("ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN")) throw new Error("ARCA_AUTO_TICKET_CORE_TICKET_TARGET_NOT_FOUND");

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_AUTO_TICKET_CORE_OK");
