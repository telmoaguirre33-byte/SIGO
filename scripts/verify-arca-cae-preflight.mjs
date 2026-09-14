import fs from "node:fs";

const api = fs.readFileSync("api/arca/cae-preflight.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260914003500_arca_cae_preflight_guards.sql", "utf8");
const policy = fs.readFileSync("supabase/migrations/20260914003600_arca_emision_read_policy.sql", "utf8");
const productFiscal = fs.readFileSync("supabase/migrations/20260914003700_productos_fiscal_wsfe.sql", "utf8");

for (const token of [
  '"invoices.issue"',
  '"sales.read"',
  '"products.read"',
  'ARCA_AUTH_NOT_VALIDATED',
  'ARCA_PUNTO_VENTA_NOT_ACTIVE',
  'ARCA_SALE_NOT_CONFIRMED',
  'ARCA_PRODUCT_FISCAL_DATA_REQUIRED',
  'ARCA_CLIENT_IVA_CONDITION_REQUIRED',
  'ARCA_CONSUMER_IVA_CONDITION_REQUIRED',
  'ARCA_SALE_TOTAL_MISMATCH',
  'alreadyIssued: true',
  'readyForWsfe: true',
  'Preflight fiscal aprobado',
]) {
  if (!api.includes(token)) throw new Error(`ARCA CAE preflight safeguard missing: ${token}`);
}

for (const forbidden of [
  'FECAESolicitar',
  'private-key.pem',
  'certificate.pem',
  'CLAVE_FISCAL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'update public.productos',
  'confirmar_venta_sigo',
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA CAE preflight must remain read-only / secret-free: ${forbidden}`);
}

for (const token of [
  'add column if not exists arca_doc_tipo integer',
  'add column if not exists condicion_iva_receptor_id integer',
  'add column if not exists venta_id uuid references public.ventas_sigo',
  'arca_comprobantes_empresa_venta_uidx',
  'arca_comprobantes_empresa_request_uidx',
  "cae ~ '^[0-9]{14}$'",
  'ARCA_SALE_TENANT_MISMATCH',
]) {
  if (!migration.includes(token)) throw new Error(`ARCA persistence guard missing: ${token}`);
}

for (const token of [
  "tiene_permiso_empresa(empresa_id, 'arca.configure')",
  "tiene_permiso_empresa(empresa_id, 'invoices.issue')",
]) {
  if (!policy.includes(token)) throw new Error(`ARCA issue read policy missing: ${token}`);
}

for (const token of [
  'add column if not exists iva_alicuota_id integer',
  'add column if not exists iva_tasa numeric(6,3)',
  'add column if not exists precio_incluye_iva boolean',
  'FEParamGetTiposIva',
  'no se completa automáticamente',
]) {
  if (!productFiscal.includes(token)) throw new Error(`ARCA product fiscal classification guard missing: ${token}`);
}

console.log("SIGO_ARCA_CAE_PREFLIGHT_GUARDS_OK");
