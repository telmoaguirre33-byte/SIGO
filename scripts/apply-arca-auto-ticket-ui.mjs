import fs from "node:fs";

const path = "src/ArcaCaeEmission.tsx";
let source = fs.readFileSync(path, "utf8");

// La renovación automática vive dentro de cae-v2 para evitar una doble llamada larga
// que podía exceder el tiempo máximo de la función. Si quedó una versión anterior
// apuntando a cae-auto, la devolvemos al endpoint directo.
source = source.replace('fetch("/api/arca/cae-auto", {', 'fetch("/api/arca/cae-v2", {');

if (!source.includes('fetch("/api/arca/cae-v2", {')) {
  throw new Error("ARCA_AUTO_TICKET_UI_TARGET_NOT_FOUND");
}

source = source.replace(
  'ARCA_TICKET_REFRESH_REQUIRED: "El Ticket de Acceso venció o no está disponible. Volvé a autenticar WSAA; SIGO no solicitará un segundo ticket mientras exista uno vigente.",',
  'ARCA_TICKET_REFRESH_REQUIRED: "La autorización fiscal venció. SIGO intentará renovarla automáticamente al emitir.",\n  ARCA_TICKET_AUTO_REFRESH_FAILED: "SIGO no pudo renovar automáticamente la autorización fiscal. Reintentá una vez; si continúa, revisaremos ARCA sin regenerar certificados.",\n  ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN: "La autorización fiscal venció. Ingresá con un perfil administrador para renovarla una vez; después los vendedores podrán seguir emitiendo mientras el ticket esté vigente.",',
);

if (!source.includes("ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN")) {
  source = source.replace(
    'ARCA_TICKET_AUTO_REFRESH_FAILED: "SIGO no pudo renovar automáticamente la autorización fiscal. Reintentá una vez; si continúa, revisaremos ARCA sin regenerar certificados.",',
    'ARCA_TICKET_AUTO_REFRESH_FAILED: "SIGO no pudo renovar automáticamente la autorización fiscal. Reintentá una vez; si continúa, revisaremos ARCA sin regenerar certificados.",\n  ARCA_TICKET_AUTO_REFRESH_REQUIRES_ADMIN: "La autorización fiscal venció. Ingresá con un perfil administrador para renovarla una vez; después los vendedores podrán seguir emitiendo mientras el ticket esté vigente.",',
  );
}

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_AUTO_TICKET_UI_OK");
