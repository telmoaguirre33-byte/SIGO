import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const costGuard = read('supabase/migrations/20260913053500_productos_costos_no_nulos_write_guard.sql');
const purchaseGuard = read('supabase/migrations/20260913054000_compras_max_300_items_guard.sql');
const readiness = read('supabase/migrations/20260913012500_operational_readiness_stock_cost_guard.sql');
const products = read('src/productos.ts');

requireText(costGuard, 'new.costo_actual := coalesce(new.costo_actual, 0)', 'current-cost write normalization');
requireText(costGuard, 'new.costo_ultima_compra := coalesce(new.costo_ultima_compra, 0)', 'last-cost write normalization');
requireText(costGuard, 'before insert or update of costo_actual, costo_ultima_compra', 'future-write-only trigger');
if (/\bupdate\s+public\.productos\b/i.test(costGuard) || /\bdelete\s+from\s+public\.productos\b/i.test(costGuard)) {
  throw new Error('Cost guard must not rewrite or delete existing products');
}

requireText(purchaseGuard, 'v_items >= 300', 'database purchase-line ceiling');
requireText(purchaseGuard, "raise exception 'TOO_MANY_ITEMS'", 'purchase-line rejection');
requireText(purchaseGuard, 'before insert on public.compra_items_sigo', 'purchase-item trigger');
if (/\bupdate\s+public\.compra_items_sigo\b/i.test(purchaseGuard) || /\bdelete\s+from\s+public\.compra_items_sigo\b/i.test(purchaseGuard)) {
  throw new Error('Purchase limit guard must not rewrite or delete purchase history');
}

requireText(readiness, 'v_libreria_source <> 983', '983 Libreria readiness check');
requireText(readiness, 'v_computacion_source <> 417', '417 Computacion readiness check');
requireText(readiness, 'v_libreria_source + v_computacion_source <> 1400', '1,400 total readiness check');
requireText(readiness, "lower('SIGO Administración')", 'single SIGO Administracion tenant check');
requireText(readiness, 'v_costos_null_tenant <> 0', 'tenant null-cost check');
requireText(readiness, 'alter column costo_actual set not null', 'final cost constraint');

requireText(products, 'const esNuevo = !input.productoId', 'new-product branch');
requireText(products, 'p_costo_actual: input.costoActual ?? (esNuevo ? 0 : null)', 'new-product current-cost default');
requireText(products, 'p_costo_ultima_compra: input.costoUltimaCompra ?? (esNuevo ? 0 : null)', 'new-product last-cost default');

console.log('Operational data guards OK: 1,400 readiness + non-null costs + max 300 purchase lines');
