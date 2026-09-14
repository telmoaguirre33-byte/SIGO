import fs from "node:fs";

const api = fs.readFileSync("api/arca/transfer.js", "utf8");
const launcher = fs.readFileSync("src/ArcaLauncher.tsx", "utf8");
const ui = fs.readFileSync("src/ArcaFacturacion.tsx", "utf8");
const preflight = fs.readFileSync("src/ArcaPreflight.tsx", "utf8");

for (const token of [
  'p_permiso: "arca.configure"',
  'permitido(sesion, origenEmpresaId)',
  'permitido(sesion, destinoEmpresaId)',
  'descargarSecreto(sesion, origenEmpresaId, "certificate.pem")',
  'descargarSecreto(sesion, origenEmpresaId, "private-key.pem")',
  'validarPar(origen, certificadoPem, clavePrivadaPem)',
  'cuitCertificado !== String(config.cuit_emisor',
  'activo: false',
  'ultima_prueba_ok: false',
  'ARCA_TARGET_ALREADY_CONFIGURED',
  'x-upsert": "true"',
  'storage://${BUCKET}/${empresaId}/${fileName}',
]) {
  if (!api.includes(token)) throw new Error(`ARCA tenant transfer safeguard missing: ${token}`);
}

for (const forbidden of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLAVE_FISCAL",
  "certificadoPem:",
  "clavePrivadaPem:",
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA tenant transfer exposes forbidden material: ${forbidden}`);
}

for (const token of [
  "Empresa que va a facturar",
  "productosPorEmpresa",
  "productosCount",
  "empresas={empresas}",
]) {
  if (!launcher.includes(token)) throw new Error(`ARCA tenant selector missing: ${token}`);
}

for (const token of [
  "/api/arca/transfer",
  "origenEmpresaId",
  "destinoEmpresaId: empresaId",
  "Encontramos una configuración ARCA ya cargada en otra empresa",
  "No vuelvas a buscar ni subir los archivos",
  "configuración de origen se conservará",
]) {
  if (!ui.includes(token)) throw new Error(`ARCA reuse UI missing: ${token}`);
}

for (const token of [
  "autoTransferOrigenId",
  "item.cuit_emisor === config.cuit_emisor",
  "item.ambiente === config.ambiente",
  "coincidentes.length === 1",
]) {
  if (!ui.includes(token)) throw new Error(`ARCA automatic safe match missing: ${token}`);
}

for (const token of [
  'fetch("/api/arca/transfer"',
  "origenEmpresaId: autoTransferOrigenId",
  "destinoEmpresaId: empresaId",
  "Certificado vinculado. Enviando autenticación real a ARCA",
  "await onConfigLinked?.()",
]) {
  if (!preflight.includes(token)) throw new Error(`ARCA automatic reuse before WSAA missing: ${token}`);
}

console.log("SIGO_ARCA_TENANT_TRANSFER_GUARDS_OK");
