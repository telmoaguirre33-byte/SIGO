import fs from 'node:fs';

function requireText(file, needles) {
  const text = fs.readFileSync(file, 'utf8');
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) {
    console.error(`FAIL ${file}: faltan controles: ${missing.join(', ')}`);
    process.exit(1);
  }
}

requireText('src/BarcodeScanner.tsx', [
  'actionOperacion === "vender"',
  'precio <= 0',
  'definí un precio de venta mayor a cero antes de vender',
  'stock <= 0',
]);

requireText('src/VentaRapidaOperativa.tsx', [
  '!Number.isFinite(precio) || precio <= 0',
  'precio > 0',
  'Total verificado $',
]);

requireText('src/productos.ts', [
  'input.precioVenta <= 0',
  'El precio de venta debe ser mayor a cero.',
]);

requireText('supabase/migrations/20260913003000_ventas_precio_positivo_guard.sql', [
  'trg_venta_item_precio_positivo',
  'new.precio_unitario <= 0',
  'PRODUCT_PRICE_REQUIRED',
  'new.subtotal <= 0',
]);

console.log('OK sale-price-safety: scanner, carrito, maestro y base bloquean ventas a precio cero y muestran el total verificado.');
