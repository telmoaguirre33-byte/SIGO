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

const serverRequired = [
  ['itemsRaw.length > MAX_INVOICE_ITEMS', 'server invoice line limit'],
  ['TOO_MANY_INVOICE_ITEMS', 'explicit oversized-invoice rejection'],
  ['new Set([item.codigo_barras, item.codigo]', 'server ambiguity guard for barcode and supplier code'],
  ['AMBIGUOUS_INVOICE_CODES', 'server ambiguous identity rejection'],
  ['fechaIsoCalendarioValida', 'server real calendar date validation'],
  ['confianza < 0.5', 'server low-confidence line warning'],
  ['El total de la factura difiere de la suma de las líneas leídas', 'server invoice total reconciliation warning'],
];

for (const [needle, label] of serverRequired) {
  if (!server.includes(needle)) {
    throw new Error(`Missing server ${label}: ${needle}`);
  }
}

if (server.includes('raw.items.slice(0, MAX_INVOICE_ITEMS)')) {
  throw new Error('Server must not silently truncate invoice lines because that can create partial stock entries');
}

console.log('Invoice AI server/client reconciliation guard OK');
