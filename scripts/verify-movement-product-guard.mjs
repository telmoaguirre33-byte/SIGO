import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260913162000_guard_movimientos_producto_operativo.sql', 'utf8');

const required = [
  'sigo_validar_producto_movimiento',
  'PRODUCT_IDENTITY_REVIEW_REQUIRED',
  'PRODUCT_STOCK_REQUIRED',
  'PRODUCT_COST_REQUIRED',
  'PRODUCT_PRICE_REQUIRED',
  'LEGACY-DUP-%',
  'trg_sigo_guard_venta_producto_operativo',
  'trg_sigo_guard_compra_producto_operativo',
  'before insert or update of producto_id, empresa_id',
  'public.venta_items_sigo',
  'public.compra_items_sigo',
];

for (const token of required) {
  if (!migration.includes(token)) {
    throw new Error(`Movement product guard missing required token: ${token}`);
  }
}

const forbidden = [
  /delete\s+from\s+public\.productos/i,
  /truncate\s+(table\s+)?public\.productos/i,
  /update\s+public\.productos\s+set/i,
  /drop\s+table\s+public\.productos/i,
];

for (const pattern of forbidden) {
  if (pattern.test(migration)) {
    throw new Error(`Movement product guard must remain non-destructive: ${pattern}`);
  }
}

const ventaTrigger = migration.indexOf('trg_sigo_guard_venta_producto_operativo');
const compraTrigger = migration.indexOf('trg_sigo_guard_compra_producto_operativo');
if (ventaTrigger < 0 || compraTrigger < 0 || ventaTrigger === compraTrigger) {
  throw new Error('Both sale and purchase movement triggers are required');
}

console.log('Movement product DB guard OK');
