import fs from 'node:fs';

const client = fs.readFileSync('src/facturaIA.ts', 'utf8');
const server = fs.readFileSync('api/compras/analizar-factura.js', 'utf8');

const clientRequired = [
  ['MAX_INVOICE_ITEMS = 300', 'client invoice line limit'],
  ['normalizarCodigoProveedor', 'supplier product code normalization'],
  ['new Set([item.codigo_barras, item.codigo]', 'barcode and supplier-code ambiguity guard'],
  ['fechaIsoCalendarioValida', 'real calendar date validation'],
  ['confianza < 0.5', 'low-confidence line warning'],
  ['El total de la factura difiere de la suma de las líneas leídas', 'invoice total reconciliation warning'],
  ['MIN_GENERAL_CONFIDENCE_AUTO = 0.35', 'minimum general confidence for automatic preparation'],
  ['MIN_LINE_CONFIDENCE_AUTO = 0.30', 'minimum per-line confidence for automatic preparation'],
  ['No pude identificar con seguridad al proveedor', 'supplier identity must be known before automatic stock preparation'],
  ['No pude leer el número de comprobante', 'document number must be known before automatic stock preparation'],
  ['toleranciaCritica = Math.max(10, calculado * 0.15)', 'critical line arithmetic mismatch guard'],
  ['diferencia crítica entre cantidad × costo y total leído', 'critical line mismatch user-facing block'],
];

for (const [needle, label] of clientRequired) {
  if (!client.includes(needle)) {
    throw new Error(`Missing client ${label}: ${needle}`);
  }
}

if (!client.includes('items.length > MAX_INVOICE_ITEMS')) {
  throw new Error('Invoice AI client must reject responses beyond the safe line limit instead of partially applying them');
}

if (!client.includes('validarCodigosNoAmbiguos(validos)')) {
  throw new Error('Invoice AI client must block ambiguous product identities before purchase preparation');
}

if (!client.includes('confianzaGeneral < MIN_GENERAL_CONFIDENCE_AUTO')) {
  throw new Error('Invoice AI client must block very-low-confidence invoices before purchase preparation');
}

if (!client.includes('item.confianza < MIN_LINE_CONFIDENCE_AUTO')) {
  throw new Error('Invoice AI client must block very-low-confidence lines before purchase preparation');
}

const serverRequired = [
  ['itemsRaw.length > MAX_INVOICE_ITEMS', 'server invoice line limit'],
  ['TOO_MANY_INVOICE_ITEMS', 'explicit oversized-invoice rejection'],
  ['new Set([item.codigo_barras, item.codigo]', 'server ambiguity guard for barcode and supplier code'],
  ['AMBIGUOUS_INVOICE_CODES', 'server ambiguous identity rejection'],
  ['fechaIsoCalendarioValida', 'server real calendar date validation'],
  ['confianza < 0.5', 'server low-confidence line warning'],
  ['El total de la factura difiere de la suma de las líneas leídas', 'server invoice total reconciliation warning'],
  ['MIN_GENERAL_CONFIDENCE_AUTO = 0.35', 'server minimum general confidence'],
  ['MIN_LINE_CONFIDENCE_AUTO = 0.30', 'server minimum line confidence'],
  ['SUPPLIER_IDENTITY_MISSING', 'server supplier identity block'],
  ['DOCUMENT_NUMBER_MISSING', 'server document identity block'],
  ['LOW_INVOICE_CONFIDENCE', 'server low-confidence invoice block'],
  ['LOW_LINE_CONFIDENCE', 'server low-confidence line block'],
  ['INVOICE_LINE_TOTAL_MISMATCH', 'server critical line arithmetic block'],
  ['toleranciaCritica = Math.max(10, calculado * 0.15)', 'server critical line mismatch threshold'],
];

for (const [needle, label] of serverRequired) {
  if (!server.includes(needle)) {
    throw new Error(`Missing server ${label}: ${needle}`);
  }
}

if (server.includes('raw.items.slice(0, MAX_INVOICE_ITEMS)')) {
  throw new Error('Server must not silently truncate invoice lines because that can create partial stock entries');
}

const reviewCodes = [
  'SUPPLIER_IDENTITY_MISSING',
  'DOCUMENT_NUMBER_MISSING',
  'LOW_INVOICE_CONFIDENCE',
  'LOW_LINE_CONFIDENCE',
  'INVOICE_LINE_TOTAL_MISMATCH',
];
for (const code of reviewCodes) {
  const handler = `error?.message === "${code}"`;
  if (!server.includes(handler)) {
    throw new Error(`Server must map ${code} to a controlled AI_REVIEW_REQUIRED response`);
  }
}

console.log('Invoice AI server/client reconciliation guard OK');
