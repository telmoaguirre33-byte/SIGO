import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

const readiness = read('src/operationalReadiness.ts');
const matriz = read('src/MatrizAdmin.tsx');

for (const [needle, label] of [
  ['SIGO_LIVE_READINESS_OK', 'success evidence code'],
  ['sigo_importaciones_stock', 'initial stock ledger'],
  ['productos', 'live catalog query'],
  ['LIBRERIA_PATTERN', 'Libreria import selector'],
  ['COMPUTACION_PATTERN', 'Computacion import selector'],
  ['LIBRERIA_LOTES_ESPERADOS = 10', '10 Libreria batches'],
  ['COMPUTACION_LOTES_ESPERADOS = 5', '5 Computacion batches'],
  ['TOTAL_LOTES_ESPERADOS', 'exact 15-batch total'],
  ['libreriaSource !== 983', '983 Libreria check'],
  ['computacionSource !== 417', '417 Computacion check'],
  ['totalSource !== 1400', '1,400 total check'],
  ['totalLotes !== TOTAL_LOTES_ESPERADOS', 'exact batch-count check'],
  ['lotesDuplicados !== 0', 'duplicate import-key block'],
  ['duplicate_batch_keys=', 'duplicate batch evidence'],
  ['inserted + skipped !== source', 'per-batch idempotency check'],
  ['verified !== source', 'per-batch verification check'],
  ['catalogoProductos < 1400', 'live catalog count check'],
  ['catalogoLeido !== catalogoProductos', 'full paged catalog check'],
  ['costosActualesNull !== 0', 'non-null current-cost check'],
  ['empresasImportadas !== 1', 'single import tenant check'],
  ['detectarIdentidadesDuplicadas', 'duplicate barcode/internal-code detector'],
  ['identidadesDuplicadas !== 0', 'ambiguous scanner identity block'],
  ['productosConIdentidadDuplicada', 'duplicate product exclusion set'],
  ['vendiblesScannerSeguros', 'scanner-safe sellable candidates'],
  ['LEGACY_DUP_PREFIX = "LEGACY-DUP-"', 'legacy collision marker'],
  ['legacyDupPendientes !== 0', 'physical barcode review block'],
  ['productosSinCodigo !== 0', 'missing product identity block'],
  ['stockNegativo !== 0', 'negative stock block'],
  ['stockNull !== 0', 'null stock block'],
  ['vendiblesConStock === 0', 'real sale candidate check'],
  ['vendiblesScannerSeguros === 0', 'scanner-safe candidate requirement'],
  ['buscarProductoPorCodigo', 'real tenant-aware scanner lookup'],
  ['matches.length === 1 && matches[0]?.id === productoPrueba.id', 'unique scanner lookup verification'],
  ['scannerLookupOk', 'scanner lookup result'],
  ['scanner_lookup=', 'scanner lookup evidence'],
  ['scanner_matches=', 'scanner match-count evidence'],
  ['scanner_safe_sellable=', 'scanner-safe sellable evidence'],
  ['productoPrueba', 'explicit real sale test candidate'],
  ['bloqueosIdentidad', 'actionable identity blocker detail'],
  ['test_product_id=', 'test product id evidence'],
  ['test_product_code=', 'test product evidence code'],
  ['test_product_stock=', 'test product stock evidence'],
  ['test_product_price=', 'test product price evidence'],
  ['identity_blockers=', 'identity blocker evidence'],
  ['null_stock=', 'null-stock evidence'],
  ['.is("costo_actual", null)', 'null current-cost query'],
  ['.range(desde, desde + PAGE_SIZE - 1)', 'catalog pagination beyond 1,000 rows'],
  ['head: true', 'read-only count query'],
]) {
  requireText(readiness, needle, label);
}

for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(']) {
  if (readiness.includes(forbidden)) {
    throw new Error(`Live readiness verifier must remain non-mutating; forbidden token: ${forbidden}`);
  }
}

for (const [needle, label] of [
  ['Preparación operativa · SIGO Administración', 'Matriz live readiness panel'],
  ['Validar ahora', 'manual live verification action'],
  ['Copiar evidencia', 'evidence copy action'],
  ['readiness.totalVerified', '1,400 evidence display'],
  ['readiness.costosActualesNull', 'null-cost evidence display'],
]) {
  requireText(matriz, needle, label);
}

console.log('Live operational readiness guard OK: read-only unique 983 + 417 = 1,400 verification, exactly 15 unique batches, full catalog pagination, safe scanner candidate exclusion, live tenant-aware barcode lookup, null-cost/stock blocks and actionable identity evidence');
