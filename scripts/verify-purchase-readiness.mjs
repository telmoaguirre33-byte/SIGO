import fs from 'node:fs';

const compras = fs.readFileSync('src/compras.ts', 'utf8');

const required = [
  'MAX_COMPRA_ITEMS = 300',
  'MAX_CANTIDAD_ITEM',
  'MAX_COSTO_UNITARIO',
  'fechaIsoValida',
  'normalizarDocumento',
  '.limit(200)',
  'precio_venta',
  'Definí precio antes de vender',
  'preparación para venta conciliados correctamente',
  'verificarProductosCompraAntesDeConfirmar',
  'leerCatalogoActivoCompra',
  'PAGINA_PRODUCTOS_PREFLIGHT',
  'MAX_PRODUCTOS_PREFLIGHT',
  '.eq("activo", true)',
  '.range(desde, desde + PAGINA_PRODUCTOS_PREFLIGHT - 1)',
  'Código de barras ambiguo',
  'Código interno ambiguo',
  'LEGACY-DUP pendiente',
  'producto.stock_actual == null',
  'producto.costo_actual == null',
  'stockAntesValor == null',
];

for (const token of required) {
  if (!compras.includes(token)) {
    throw new Error(`Purchase readiness regression: missing ${token}`);
  }
}

if (!compras.includes('normalizarDocumento(compra.numero_comprobante) === documentoNormalizado')) {
  throw new Error('Purchase readiness regression: duplicate-document preflight must normalize stored numbers');
}

if (!compras.includes('cantidad > MAX_CANTIDAD_ITEM') || !compras.includes('costo > MAX_COSTO_UNITARIO')) {
  throw new Error('Purchase readiness regression: operational numeric limits must be enforced client-side');
}

if (!compras.includes('sinPrecioVenta.push')) {
  throw new Error('Purchase readiness regression: post-receipt reconciliation must surface products without sale price');
}

const preflightCall = compras.indexOf('await verificarProductosCompraAntesDeConfirmar(empresaId, items)');
const rpcCall = compras.indexOf('supabase.rpc("confirmar_compra_sigo"');
if (preflightCall < 0 || rpcCall < 0 || preflightCall > rpcCall) {
  throw new Error('Purchase readiness regression: catalog/identity preflight must run before the stock-writing RPC');
}

const preflightBlockStart = compras.indexOf('async function verificarProductosCompraAntesDeConfirmar');
const confirmStart = compras.indexOf('export async function confirmarCompraSigo');
const preflightBlock = compras.slice(preflightBlockStart, confirmStart);
if (/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(preflightBlock)) {
  throw new Error('Purchase readiness regression: product preflight must remain read-only');
}

if (compras.includes('Number(producto.stock_actual ?? 0)') || compras.includes('Number(producto.costo_actual ?? producto.costo_ultima_compra ?? 0)')) {
  throw new Error('Purchase readiness regression: post-purchase reconciliation must not hide NULL stock/cost as zero');
}

console.log('Purchase operational readiness: OK');
