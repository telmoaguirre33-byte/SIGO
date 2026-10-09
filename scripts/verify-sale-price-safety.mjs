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
  'verificado.totalVerificado',
  'total vigente del backend',
  'descuentoPct,',
  'precioUnitarioVenta(item,ofertas,descuentoPct)',
  'No se puede cobrar hasta comprobar los precios de oferta',
]);

requireText('src/ventas.ts', [
  'p_descuento_pct: input.descuentoPct ?? 0',
  'SALE_DISCOUNT_INVALID',
]);

requireText('supabase/migrations/20261003020716_pos_manual_discount_atomic_v2.sql', [
  'drop function if exists public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid);',
  'p_descuento_pct numeric default 0',
  "v_request_fingerprint_legacy := md5(v_request_payload);",
  "v_precio_unitario := round(v_precio_unitario * (1 - p_descuento_pct / 100), 2);",
  'p_descuento_pct = 0 and v_existente_fingerprint = v_request_fingerprint_legacy',
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

console.log('OK sale-price-safety: scanner, carrito, maestro y base bloquean ventas a precio cero; caja confirma pronto y conserva la conciliación del total.');
