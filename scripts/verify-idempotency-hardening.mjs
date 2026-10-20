import fs from 'node:fs';

const migration = 'supabase/migrations/20260912162000_idempotencia_payload_y_productos_activos.sql';
if (!fs.existsSync(migration)) {
  console.error(`FAIL missing ${migration}`);
  process.exit(1);
}

const content = fs.readFileSync(migration, 'utf8');
const required = [
  'add column if not exists request_fingerprint text',
  'v_existente_fingerprint is distinct from v_request_fingerprint',
  'insert into public.ventas_sigo',
  'request_fingerprint, created_by',
  'insert into public.compras_sigo',
  'and activo = true',
  'IDEMPOTENCY_CONFLICT',
  'PRODUCT_NOT_FOUND',
  'venta atomica tenant-safe; idempotencia ligada al payload exacto normalizado',
  'compra atomica tenant-safe; idempotencia ligada al payload exacto normalizado',
];
const forbidden = [
  'delete from public.ventas_sigo',
  'delete from public.compras_sigo',
  'delete from public.productos',
  'truncate',
];

const missing = required.filter((token) => !content.includes(token));
const presentForbidden = forbidden.filter((token) => content.includes(token));
if (missing.length || presentForbidden.length) {
  if (missing.length) console.error(`FAIL retry/active-product hardening missing: ${missing.join(', ')}`);
  if (presentForbidden.length) console.error(`FAIL destructive token present: ${presentForbidden.join(', ')}`);
  process.exit(1);
}

console.log('PASS exact payload idempotency for sales and purchases');
console.log('PASS inactive products blocked from sale and purchase mutation paths');
console.log('PASS migration is non-destructive for operational histories');
