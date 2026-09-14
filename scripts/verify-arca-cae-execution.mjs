import fs from "node:fs";

const api = fs.readFileSync("api/arca/cae.js", "utf8");
const ui = fs.readFileSync("src/ArcaCaeEmission.tsx", "utf8");
const apiV2 = fs.readFileSync("api/arca/cae-v2.js", "utf8");
const uiPatchV2 = fs.readFileSync("scripts/apply-arca-cae-v2-ui.mjs", "utf8");

for (const token of [
  '"FECompUltimoAutorizado"',
  '"FECompConsultar"',
  '"FECAESolicitar"',
  'SOAPAction: `http://ar.gov.afip.dif.FEV1/${action}`',
  'ARCA_PRODUCTION_CONFIRMATION_REQUIRED',
  'EMITIR_CAE_PRODUCCION',
  'SOLICITAR_CAE_HOMOLOGACION',
  'arca_comprobantes',
  'request_id: requestId',
  'ARCA_NUMBER_RESERVATION_CONFLICT',
  'alreadyIssued: true',
  'reconciled: true',
  'cae_vencimiento',
  'resultado: "R"',
  'ARCA_PRODUCT_PRICE_TAX_MODE_UNSUPPORTED',
  'ARCA_INVOICE_A_CLIENT_REQUIRED',
  'ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY',
  'CondicionIVAReceptorId',
  'leerTicketWsaa',
  'ARCA_TICKET_REFRESH_REQUIRED',
]) {
  if (!api.includes(token)) throw new Error(`ARCA CAE execution safeguard missing: ${token}`);
}

for (const token of [
  '"FECompUltimoAutorizado"',
  '"FECompConsultar"',
  '"FECAESolicitar"',
  'ARCA_PRODUCTION_CONFIRMATION_REQUIRED',
  'EMITIR_CAE_PRODUCCION',
  'SOLICITAR_CAE_HOMOLOGACION',
  'request_id: requestId',
  'alreadyIssued: true',
  'reconciled: true',
  'leerTicketWsaa',
  'ARCA_TICKET_REFRESH_REQUIRED',
  'ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY',
  'ARCA_PRODUCT_FISCAL_DATA_REQUIRED',
  'ARCA_INVOICE_A_CLIENT_REQUIRED',
  'ARCA_CAE_TRANSPORT_FAILED',
  'resultado: "R"',
  'Cache-Control',
]) {
  if (!apiV2.includes(token)) throw new Error(`ARCA CAE v2 safeguard missing: ${token}`);
}

for (const token of ['fetch("/api/arca/cae-v2"', 'SIGO_ARCA_CAE_V2_UI_OK']) {
  if (!uiPatchV2.includes(token)) throw new Error(`ARCA CAE v2 UI activation missing: ${token}`);
}

for (const forbidden of [
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLAVE_FISCAL',
  'token: ticket.token',
  'sign: ticket.sign',
  'console.log(body)',
  'console.log(ticket)',
  'private-key.pem',
  'certificate.pem',
]) {
  if (api.includes(forbidden)) throw new Error(`ARCA CAE unsafe behavior found: ${forbidden}`);
  if (apiV2.includes(forbidden)) throw new Error(`ARCA CAE v2 unsafe behavior found: ${forbidden}`);
}

for (const token of [
  '/api/arca/cae-v2',
  'habilitado',
  'Emitir CAE real',
  'Probar CAE en homologación',
  'window.confirm',
  'EMITIR_CAE_PRODUCCION',
  'SOLICITAR_CAE_HOMOLOGACION',
  'Bloqueado hasta validar WSAA + WSFEv1',
]) {
  if (!ui.includes(token)) throw new Error(`ARCA CAE UI safeguard missing: ${token}`);
}

console.log("SIGO_ARCA_CAE_EXECUTION_GUARDS_OK");
