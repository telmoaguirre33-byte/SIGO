import fs from "node:fs";

const path = "src/ArcaCaeEmission.tsx";
let source = fs.readFileSync(path, "utf8");

const from = 'fetch("/api/arca/cae-v2", {';
const to = 'fetch("/api/arca/cae-auto", {';

if (!source.includes(from) && !source.includes(to)) {
  throw new Error("ARCA_AUTO_TICKET_UI_TARGET_NOT_FOUND");
}
if (source.includes(from)) source = source.replace(from, to);

source = source.replace(
  'ARCA_TICKET_REFRESH_REQUIRED: "El Ticket de Acceso venció o no está disponible. Volvé a autenticar WSAA; SIGO no solicitará un segundo ticket mientras exista uno vigente.",',
  'ARCA_TICKET_REFRESH_REQUIRED: "La autorización fiscal venció. SIGO intentará renovarla automáticamente al emitir.",\n  ARCA_TICKET_AUTO_REFRESH_FAILED: "SIGO no pudo renovar automáticamente la autorización fiscal. Reintentá una vez; si continúa, revisaremos ARCA sin regenerar certificados.",',
);

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_AUTO_TICKET_UI_OK");
