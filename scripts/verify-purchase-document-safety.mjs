import fs from 'node:fs';

const checks = [
  [
    'src/compras.ts',
    [
      'PURCHASE_DOCUMENT_DUPLICATE',
      'normalizarDocumento(compra.numero_comprobante) === documentoNormalizado',
      '.eq("proveedor_id", proveedorId)',
      'cuitArgentinoValido',
      'PAGINA_PROVEEDORES = 1000',
      'MAX_PROVEEDORES = 10000',
      'porCuit.length > 1',
      'porNombre.length > 1',
      'ya existe con otro CUIT',
      '.limit(200)',
      'evitar duplicar stock y costos',
    ],
  ],
  [
    'supabase/migrations/20260913002000_compras_documento_duplicado_guard.sql',
    [
      'pg_advisory_xact_lock',
      'PURCHASE_DOCUMENT_DUPLICATE',
      "c.estado = 'confirmada'",
      'p_proveedor_id',
      'v_numero is not null',
    ],
  ],
];

for (const [file, required] of checks) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of required) {
    if (!text.includes(token)) {
      throw new Error(`Purchase document safety regression: ${file} missing ${token}`);
    }
  }
  console.log(`PASS ${file}`);
}

const migration = fs.readFileSync('supabase/migrations/20260913002000_compras_documento_duplicado_guard.sql', 'utf8');
const retryPosition = migration.indexOf('where empresa_id = p_empresa_id and idempotency_key = v_key');
const duplicatePosition = migration.indexOf("raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%'");
if (retryPosition < 0 || duplicatePosition < 0 || retryPosition > duplicatePosition) {
  throw new Error('Purchase document safety regression: idempotent retry must be resolved before duplicate-document rejection');
}

console.log('SIGO_PURCHASE_DOCUMENT_SAFETY_OK');
