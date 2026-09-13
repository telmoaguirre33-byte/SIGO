import fs from 'node:fs';

const source = fs.readFileSync('src/facturaIA.ts', 'utf8');

const required = [
  ['MAX_INVOICE_ITEMS = 300', 'client invoice line limit'],
  ['normalizarCodigoProveedor', 'supplier product code normalization'],
  ['new Set([item.codigo_barras, item.codigo]', 'barcode and supplier-code ambiguity guard'],
  ['fechaIsoCalendarioValida', 'real calendar date validation'],
  ['confianza < 0.5', 'low-confidence line warning'],
  ['El total de la factura difiere de la suma de las líneas leídas', 'invoice total reconciliation warning'],
];

for (const [needle, label] of required) {
  if (!source.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

if (!source.includes('items.length > MAX_INVOICE_ITEMS')) {
  throw new Error('Invoice AI client must reject responses beyond the safe line limit instead of partially applying them');
}

if (!source.includes('validarCodigosNoAmbiguos(validos)')) {
  throw new Error('Invoice AI client must block ambiguous product identities before purchase preparation');
}

console.log('Invoice AI client reconciliation guard OK');
