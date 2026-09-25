import fs from 'node:fs';

const checks = [
  ['src/ComprasOperativas.tsx', ['Leer comprobante de compra con IA', 'Tomar foto de comprobante', 'application/pdf', 'capture="environment"', 'GuardarCompraIA', 'guardarProductoSigo', 'analizarFacturaCompraSigo', 'Confirmar compra e ingresar stock', 'preciosVentaFactura', 'preciosFacturaPendientes', 'PRODUCTO NUEVO', 'SIGO no los creará sin precio']],
  ['src/facturaIA.ts', ['analizarFacturaCompraSigo', '/api/compras/analizar-factura', 'TIPOS_IMAGEN_PERMITIDOS', 'CLIENT_TIMEOUT_MS', 'AbortController', 'AI_TIMEOUT', 'moneda !== "ARS"', 'validarFactura', 'cuitArgentinoValido', 'gtinValido', 'validarCodigosNoAmbiguos', 'AI_REVIEW_REQUIRED']],
  ['api/compras/analizar-factura.js', ['GEMINI_API_KEY', 'purchases.write', 'generativelanguage.googleapis.com', 'inlineData', 'application/pdf', 'No inventes datos', 'normalizarFacturaIA', 'MAX_INVOICE_ITEMS', 'NO_VALID_INVOICE_ITEMS', 'GEMINI_TIMEOUT_MS', 'AbortController', 'AI_TIMEOUT', 'normalizarMoneda', 'cuitArgentinoValido', 'gtinValido', 'detectarCodigosConflictivos', 'AI_REVIEW_REQUIRED', 'advertencias']],
  ['supabase/migrations/20260913023000_compras_identidad_documental_guard.sql', ['normalizar_identificador_comercial_sigo', 'trg_guard_compra_documento_normalizado_sigo', 'PURCHASE_DOCUMENT_DUPLICATE', 'trg_guard_proveedor_cuit_sigo', 'SUPPLIER_CUIT_DUPLICATE']],
];

for (const [file, required] of checks) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of required) {
    if (!text.includes(token)) throw new Error(`Invoice AI regression: ${file} missing ${token}`);
  }
}

const compras = fs.readFileSync('src/ComprasOperativas.tsx', 'utf8');
const guardar = fs.readFileSync('src/GuardarCompraIA.tsx', 'utf8');
const construir = fs.readFileSync('src/guardarCompraIA.ts', 'utf8');
if (!construir.includes('precio_venta: precio')) throw new Error('Invoice AI regression: new products must persist the operator-defined sale price');
if (!compras.includes('preciosFacturaPendientes > 0')) throw new Error('Invoice AI regression: invoice review must show missing sale prices');
if (!guardar.includes('guardar_compra_ia_sigo') || !guardar.includes('verificarCompraSigo')) throw new Error('Invoice AI regression: purchase and stock must be saved via the atomic RPC and verified');

const api = fs.readFileSync('api/compras/analizar-factura.js', 'utf8');
const rejectsOversizedInvoice = api.includes('itemsRaw.length > MAX_INVOICE_ITEMS') && api.includes('TOO_MANY_INVOICE_ITEMS');
if (!rejectsOversizedInvoice) {
  throw new Error('Invoice AI regression: server must reject invoice responses beyond the safe line limit');
}
if (api.includes('itemsRaw.slice(0, MAX_INVOICE_ITEMS)') || api.includes('raw.items.slice(0, MAX_INVOICE_ITEMS)')) {
  throw new Error('Invoice AI regression: server must never silently truncate invoice lines before stock preparation');
}
if (!api.includes('cuitArgentinoValido(cuitLeido)')) throw new Error('Invoice AI regression: server must validate Argentine CUIT check digit');
if (!api.includes('Number.isFinite')) throw new Error('Invoice AI regression: server must reject non-finite numeric values');
if (!api.includes('signal: controller.signal')) throw new Error('Invoice AI regression: Gemini request must have a timeout signal');
if (api.includes('OPENAI_API_KEY') || api.includes('api.openai.com')) {
  throw new Error('Invoice AI regression: purchase document analyzer must use Gemini, not OpenAI');
}
if (!api.includes('responseMimeType: "application/json"') || !api.includes('responseSchema: FACTURA_RESPONSE_SCHEMA')) {
  throw new Error('Invoice AI regression: Gemini output must remain constrained to the invoice JSON contract');
}
if (!api.includes('Código de barras descartado por dígito verificador inválido')) {
  throw new Error('Invoice AI regression: invalid GTINs must not be auto-applied');
}
if (!api.includes('AMBIGUOUS_INVOICE_CODES')) {
  throw new Error('Invoice AI regression: conflicting barcode or supplier-code identities must block automatic stock preparation');
}

const client = fs.readFileSync('src/facturaIA.ts', 'utf8');
if (!client.includes('new Set(["image/jpeg", "image/png", "image/webp"])')) {
  throw new Error('Invoice AI regression: client must only accept supported invoice image types');
}
if (!client.includes('moneda && moneda !== "ARS"')) {
  throw new Error('Invoice AI regression: non-ARS invoices must not be silently applied as pesos');
}
if (!client.includes('cuitArgentinoValido(cuitLeido)')) {
  throw new Error('Invoice AI regression: client must revalidate CUIT before supplier matching');
}

console.log('AI purchase invoice flow: OK');
