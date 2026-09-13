import fs from 'node:fs';

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function requireText(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const products = read('src/productos.ts');
const migration = read('supabase/migrations/20260913194000_producto_guardado_readback.sql');
const smoke = read('scripts/production-operational-smoke.sql');
const workflow = read('.github/workflows/production-operational-smoke.yml');

for (const [needle, label] of [
  ['verificar_producto_guardado_sigo', 'post-save product readback RPC'],
  ['await verificarProductoGuardadoSigo(input, productoId)', 'product save waits for DB readback'],
  ['producto.costo_actual == null', 'current cost readback validation'],
  ['producto.stock_actual == null', 'stock readback validation'],
  ['input.costoActual == null && Number(producto.costo_actual) !== 0', 'new product zero-cost invariant'],
  ['Fallback temporal seguro durante una ventana de despliegue web/DB: sólo lectura.', 'read-only deployment fallback'],
]) requireText(products, needle, label);

for (const [needle, label] of [
  ["tiene_permiso_empresa(p_empresa_id, 'products.write')", 'tenant product permission'],
  ['PRODUCT_SAVE_CURRENT_COST_INVALID', 'DB current-cost invariant'],
  ['PRODUCT_SAVE_STOCK_INVALID', 'DB stock invariant'],
  ['PRODUCT_SAVE_PRICE_INVALID', 'DB price invariant'],
  ['PRODUCT_SAVE_NOT_VISIBLE', 'DB tenant readback invariant'],
  ['No modifica productos, stock ni históricos.', 'non-mutating migration declaration'],
]) requireText(migration, needle, label);

const forbiddenMigration = [
  'update public.productos',
  'delete from public.productos',
  'truncate public.productos',
  'insert into public.productos',
];
for (const needle of forbiddenMigration) {
  if (migration.toLowerCase().includes(needle)) throw new Error(`Readback migration must stay non-mutating: ${needle}`);
}

for (const [needle, label] of [
  ['SIGO_PROD_SMOKE_LOTS_FAILED', '15-lot production assertion'],
  ['v_libreria_source <> 983', '983 Libreria assertion'],
  ['v_computacion_source <> 417', '417 Computacion assertion'],
  ['v_cost_null <> 0', 'null current-cost production assertion'],
  ['v_stock_null <> 0', 'null stock production assertion'],
  ['SIGO_PROD_SMOKE_SCANNER_AMBIGUITY', 'scanner identity production assertion'],
  ['SIGO_PROD_SMOKE_PURCHASE_TOTAL_MISMATCH', 'purchase monetary integrity assertion'],
  ['SIGO_PROD_SMOKE_SALE_TOTAL_MISMATCH', 'sale monetary integrity assertion'],
  ['SIGO_PROD_SMOKE_CASH_MISMATCH', 'cash monetary integrity assertion'],
  ['SIGO_SMOKE_TEST_PRODUCT', 'real scanner-safe product evidence'],
]) requireText(smoke, needle, label);

const forbiddenSmoke = [
  /\binsert\s+into\b/i,
  /\bupdate\s+public\./i,
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b/i,
  /\bdrop\s+(table|function|trigger|index)\b/i,
];
for (const pattern of forbiddenSmoke) {
  if (pattern.test(smoke)) throw new Error(`Production smoke must remain read-only: ${pattern}`);
}

for (const [needle, label] of [
  ['Run production operational smoke', 'production smoke workflow step'],
  ['psql "$SIGO_SMOKE_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/production-operational-smoke.sql', 'psql production execution'],
  ['Verify migrations are current', 'migration state gate'],
  ['SIGO_PRODUCTION_OPERATIONAL_SMOKE_COMPLETED', 'workflow completion marker'],
]) requireText(workflow, needle, label);

console.log('SIGO_PRODUCT_READBACK_AND_PRODUCTION_SMOKE_OK');