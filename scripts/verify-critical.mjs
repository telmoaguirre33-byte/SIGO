import fs from 'node:fs';
import path from 'node:path';

// Los controles críticos validan contratos funcionales y de seguridad, no textos de UI.
// Así, cambios de copy (por ejemplo, "Prueba gratis 7 días") no rompen CI si el flujo seguro sigue intacto.
const checks = [
  {
    file: 'src/SigoAuthGate.tsx',
    required: ['signInWithPassword', 'signUp', 'resetPasswordForEmail', 'OWNER_ONBOARDING_MODE', 'registrarme', 'supabase.rpc("crear_empresa"', 'PENDING_EMPRESA_METADATA_KEY', 'register_member', 'registrarmeComoUsuario', 'PASSWORD_RECOVERY'],
    label: 'auth owner/staff/recovery with semantic company onboarding contract',
  },
  {
    file: 'src/SigoRoot.tsx',
    required: ['autoProvisionAttemptedRef', 'crearEmpresaSigo(nombrePendiente)', 'cargarMisEmpresas()', 'UsuariosOperativos', 'PortalCliente', 'workspace === "usuarios"', 'workspace === "portal"'],
    label: 'company provisioning and role workspaces',
  },
  {
    file: 'src/tenant.ts',
    required: ['mis_empresas_sigo', 'crear_empresa', 'cargarEmpresasPorMembresia', '"owner"', '"admin"', '"seller"', '"warehouse"', '"client"'],
    forbidden: ['"administrative"'],
    label: 'tenant loading and canonical roles',
  },
  {
    file: 'src/workspacePermissions.ts',
    required: ['owner:', 'admin:', 'seller:', 'warehouse:', 'client:', 'seller: ["operacion"]', 'warehouse: ["operacion"]', 'client: ["portal"]'],
    label: 'workspace permissions by role',
  },
  {
    file: 'src/permissions.ts',
    required: ['"superadmin"', '"owner"', '"admin"', '"seller"', '"warehouse"', '"client"', 'costs.read', 'margins.read', 'price_lists.read', '"users.manage"'],
    label: 'granular commercial permissions',
  },
  {
    file: 'src/BarcodeScanner.tsx',
    required: ['getUserMedia', 'BarcodeDetector', 'ScanSource = "manual" | "wedge" | "camera"', 'empresaActivaRef', '📷 Escanear con cámara', 'Pistola USB/Bluetooth'],
    label: 'manual/wedge/mobile-camera barcode scanner',
  },
  {
    file: 'src/barcode.ts',
    required: ['codigo_barras', 'codigo_interno', 'normalizarEmpresaId', 'TENANT_PRODUCT_MISMATCH'],
    label: 'barcode tenant isolation',
  },
  {
    file: 'src/productos.ts',
    required: ['validarNumeroNoNegativo', 'STOCK_RANGE_INVALID', 'guardar_producto_sigo', 'PRODUCT_HAS_STOCK', 'BARCODE_DUPLICATE_IN_COMPANY'],
    label: 'safe product lifecycle',
  },
  {
    file: 'src/SigoApp.tsx',
    required: ['can(empresa.rol, "products.write")', 'Precio de venta', 'El stock actual no se edita acá', 'Dar de baja', 'No se borrarán ventas, compras ni históricos'],
    label: 'product master does not overwrite operational stock/history',
  },
  {
    file: 'src/ventas.ts',
    required: ['confirmar_venta_sigo_v2', 'consolidarItemsVenta', 'MEDIOS_PAGO_VALIDOS', '"mercado_pago"', 'idempotencyKey', 'INSUFFICIENT_STOCK', 'p_empresa_id: empresaId'],
    label: 'transactional tenant sale and payment methods',
  },
  {
    file: 'src/VentaRapidaOperativa.tsx',
    required: ['value="mercado_pago"', 'Mercado Pago', 'BarcodeScanner', 'Confirmar venta'],
    label: 'quick sale with barcode and Mercado Pago',
  },
  {
    file: 'src/compras.ts',
    required: ['consolidarItemsCompra', 'validarCuitOpcional', 'idempotencyKey', 'confirmar_compra_sigo'],
    label: 'purchase/supplier validation',
  },
  {
    file: 'src/clientes.ts',
    required: ['validarEmail', 'validarLimiteCredito', 'registrar_cobro_cliente_sigo_v2'],
    label: 'customer credit and collections',
  },
  {
    file: 'src/informes.ts',
    required: ['listarComprasSigoCompletas', '.eq("estado", "confirmada")', 'saldosPositivos', 'cajaHoyPorMedio'],
    label: 'confirmed-only management reports',
  },
  {
    file: 'src/portalCliente.ts',
    required: ['portal_cliente_catalogo_sigo', 'PORTAL_FORBIDDEN', 'dias_cobertura'],
    label: 'isolated customer portal',
  },
  {
    file: 'scripts/transaction-rollback-probe.sql',
    required: ['SIGO_QA_PRODUCT_CREATE_OK', 'SIGO_QA_SCANNER_LOOKUP_OK', 'SIGO_QA_PURCHASE_COST_OK', 'SIGO_QA_PURCHASE_DUPLICATE_BLOCK_OK', 'SIGO_QA_OVERSALE_BLOCK_OK', 'SIGO_QA_TRANSACTION_PROBE_ROLLED_BACK', 'rollback;'],
    forbidden: ['commit;'],
    label: 'production transactional QA covers cost update, duplicate document, oversell and rollback',
  },
  {
    file: 'supabase/migrations/20260909191300_multiempresa_base.sql',
    required: ['create table if not exists public.empresas', 'create table if not exists public.empresa_usuarios', 'crear_empresa'],
    label: 'multiempresa base',
  },
  {
    file: 'supabase/migrations/20260910031300_permisos_denegados_granulares.sql',
    required: ['DENY gana siempre', 'costs.read', 'margins.read', 'price_lists.read'],
    label: 'deny-first granular permissions',
  },
  {
    file: 'supabase/migrations/20260912123000_compras_idempotencia_stock_segura.sql',
    required: ['IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_CONFLICT', 'DUPLICATE_PRODUCT_ITEM', 'STOCK_WRITE_REQUIRED', 'p_empresa_id'],
    forbidden: ['delete from public.compras_sigo', 'truncate'],
    label: 'purchase idempotency and stock protection',
  },
  {
    file: 'supabase/migrations/20260912122500_ventas_idempotencia_cliente_segura.sql',
    required: ['IDEMPOTENCY_CONFLICT', 'CLIENTS_READ_FORBIDDEN', 'SALE_ITEM_INVALID', 'p_empresa_id'],
    forbidden: ['delete from public.ventas_sigo', 'truncate'],
    label: 'sale idempotency and client authorization',
  },
  {
    file: 'supabase/migrations/20260912231600_stock_import_verify.sql',
    required: ['SIGO Administración', '983', '417', '1400', 'SIGO_STOCK_IMPORT_FINAL_TENANT_SPLIT_DETECTED'],
    label: 'single-tenant 1400-row initial stock verification',
  },
  {
    file: 'supabase/migrations/20260912235500_productos_alta_costos_cero.sql',
    required: ['coalesce(p_costo_actual, 0)', 'costo_actual', 'guardar_producto_sigo'],
    label: 'product creation coalesces missing current cost to zero',
  },
  {
    file: 'supabase/migrations/20260913012500_operational_readiness_stock_cost_guard.sql',
    required: ['SIGO_READINESS_STOCK_COST_OK', 'libreria=983', 'computacion=417', 'total=1400', 'costo_actual set default 0', 'costo_actual set not null'],
    forbidden: ['update public.productos', 'delete from public.productos', 'truncate'],
    label: 'production readiness stock and non-null cost invariant',
  },
];

let failed = false;
for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    console.error(`FAIL ${check.label}: missing ${check.file}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(check.file, 'utf8');
  const missing = check.required.filter((token) => !content.includes(token));
  const forbidden = (check.forbidden ?? []).filter((token) => content.includes(token));
  if (missing.length || forbidden.length) {
    if (missing.length) console.error(`FAIL ${check.label}: missing ${missing.join(', ')}`);
    if (forbidden.length) console.error(`FAIL ${check.label}: forbidden ${forbidden.join(', ')}`);
    failed = true;
  } else {
    console.log(`PASS ${check.label}`);
  }
}

const projectRoots = ['src', 'supabase', 'docs', 'scripts', '.github'];
const textExtensions = new Set(['.ts', '.tsx', '.css', '.sql', '.md', '.mjs', '.yml', '.yaml']);
for (const root of projectRoots) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!textExtensions.has(path.extname(entry.name))) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      if (/\bSOVI\b/i.test(content)) {
        console.error(`FAIL project boundary: foreign-project reference found in ${fullPath}`);
        failed = true;
      }
    }
  }
}
if (!failed) console.log('PASS project boundary: no foreign-project contamination in SIGO code/docs/migrations/scripts/workflows');

if (failed) process.exit(1);
console.log('SIGO_CRITICAL_FLOW_STATIC_CHECKS_OK');
