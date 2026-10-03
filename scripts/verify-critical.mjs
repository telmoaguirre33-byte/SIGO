Warning: truncated output (original token count: 2041)
Total output lines: 173

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
    required: ['getUserMedia', 'BarcodeDetector', 'ScanSource = "manu…1141 tokens truncated…led = false;
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
