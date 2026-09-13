import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260914001000_arca_storage_certificado_privado.sql", "utf8");
const api = fs.readFileSync("api/arca/certificate.js", "utf8");
const ui = fs.readFileSync("src/ArcaCertificateUpload.tsx", "utf8");
const facturacion = fs.readFileSync("src/ArcaFacturacion.tsx", "utf8");

for (const token of [
  "arca-secrets",
  "public = false",
  "file_size_limit",
  "sigo_arca_secret_select",
  "sigo_arca_secret_insert",
  "sigo_arca_secret_update",
  "sigo_arca_secret_delete",
  "tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')",
  "es_owner_empresa(public.sigo_arca_storage_empresa_id(name))",
]) {
  if (!migration.includes(token)) throw new Error(`ARCA private storage safeguard missing: ${token}`);
}

for (const token of [
  "X509Certificate",
  "createPrivateKey",
  "sign(\"sha256\"",
  "verify(\"sha256\"",
  '"arca.configure"',
  "storage/v1/object",
  "private-key.pem",
  "certificate.pem",
  "certificado_fingerprint",
  "certificado_vence",
  "CERTIFICADO_CLAVE_NO_COINCIDEN",
  "activo: false",
  "ultima_prueba_ok: false",
]) {
  if (!api.includes(token)) throw new Error(`ARCA certificate API safeguard missing: ${token}`);
}

for (const forbidden of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "process.env.ARCA_PRIVATE_KEY",
  "process.env.CLAVE_FISCAL",
  "clave fiscal:",
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA certificate API must not use forbidden secret source: ${forbidden}`);
}

for (const token of [
  "/api/arca/certificate",
  "data.session?.access_token",
  "Clave privada",
  "Contraseña de la clave privada",
  "no se almacena",
  "No ingreses tu clave fiscal",
]) {
  if (!ui.includes(token)) throw new Error(`ARCA certificate UI safeguard missing: ${token}`);
}

if (!facturacion.includes("<ArcaCertificateUpload") || !facturacion.includes('import ArcaCertificateUpload from "./ArcaCertificateUpload"')) {
  throw new Error("ARCA certificate uploader must remain integrated in the production configuration page");
}

console.log("SIGO_ARCA_CERTIFICATE_PRIVATE_STORAGE_OK");
