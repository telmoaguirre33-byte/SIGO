import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "supabase-production.yml");
const readinessPath = path.join(root, "supabase", "migrations", "20260913012500_operational_readiness_stock_cost_guard.sql");
const tenantLintFixPath = path.join(root, "supabase", "migrations", "20260913183000_tenant_diagnostico_lint_fix.sql");

for (const file of [workflowPath, readinessPath, tenantLintFixPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing production readiness file: ${path.relative(root, file)}`);
}

const workflow = fs.readFileSync(workflowPath, "utf8");
const readiness = fs.readFileSync(readinessPath, "utf8");
const tenantLintFix = fs.readFileSync(tenantLintFixPath, "utf8");

for (const required of [
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}",
  "SUPABASE_POOLER_URL: ${{ secrets.SUPABASE_POOLER_URL }}",
  "SIGO_DB_URL",
  "SIGO_DB_URL_SOURCE=configured",
  "SIGO_DB_URL_SOURCE=configured-pooler",
  "SIGO_DB_URL_SOURCE=direct",
  "SIGO_DB_URL_SOURCE=auto-pooler:",
  "SIGO_DB_MODE=direct",
  "pooler.supabase.com",
  "postgres.${SUPABASE_PROJECT_REF}",
  "supabase migration list --db-url",
  "supabase db push --db-url",
  "supabase migration repair --db-url",
  "Database migrations can continue independently",
  "sigo-db-lint.json",
  '"level"[[:space:]]*:[[:space:]]*"error"',
  "Production database lint completed without error-level findings",
]) {
  if (!workflow.includes(required)) throw new Error(`Production database fallback safeguard missing: ${required}`);
}

// Un token de Management vencido no puede volver a bloquear migraciones de negocio.
if (/for key in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF/.test(workflow)) {
  throw new Error("SUPABASE_ACCESS_TOKEN must not be mandatory for production database migrations");
}

// El URL directo de Supabase puede requerir IPv6. CI alojado debe preferir un
// pooler configurado y, como último recurso seguro, probar únicamente endpoints
// oficiales *.pooler.supabase.com con credenciales enmascaradas.
if (!workflow.includes('echo "::add-mask::$SUPABASE_DB_URL"')) {
  throw new Error("Configured SUPABASE_DB_URL must be masked before use");
}
if (!workflow.includes('echo "::add-mask::$SUPABASE_POOLER_URL"')) {
  throw new Error("Configured SUPABASE_POOLER_URL must be masked before use");
}
if (!workflow.includes('if [ -n "${SUPABASE_DB_URL:-}" ]; then')) {
  throw new Error("Configured SUPABASE_DB_URL must take precedence over direct IPv6 fallback");
}
if (!workflow.includes('if [ -n "${SUPABASE_POOLER_URL:-}" ]; then')) {
  throw new Error("Configured SUPABASE_POOLER_URL must take precedence over direct IPv6 fallback");
}
if (!workflow.includes('for pooler_generation in aws-0 aws-1; do')) {
  throw new Error("Automatic pooler discovery must cover supported Supabase pooler generations");
}
if (!workflow.includes('timeout 7s supabase migration list --db-url "$candidate"')) {
  throw new Error("Automatic pooler discovery must be bounded and read-only before migration apply");
}
if (workflow.includes('echo "$candidate"') || workflow.includes('printf \'%s\\n\' "$candidate"')) {
  throw new Error("Pooler connection candidates must never be printed to logs");
}

for (const required of [
  "v_main_tenant_count <> 1",
  "v_libreria_source <> 983",
  "v_computacion_source <> 417",
  "v_libreria_source + v_computacion_source <> 1400",
  "v_empresas_importadas <> 1",
  "v_productos_tenant < 1400",
  "p.empresa_id = v_empresa_id",
  "SIGO_READINESS_NULL_CURRENT_COST_TENANT",
  "SIGO_READINESS_NULL_CURRENT_COST_GLOBAL",
  "SIGO_READINESS_STOCK_COST_OK",
  "alter column costo_actual set default 0",
  "alter column costo_actual set not null",
]) {
  if (!readiness.includes(required)) throw new Error(`Operational readiness certification safeguard missing: ${required}`);
}

for (const required of [
  "create or replace function public.sigo_tenant_diagnostico()",
  "select unnest(array[",
  "to_regclass(format('public.%I', v_table))",
  "select count(*) from public.%I where empresa_id is null",
]) {
  if (!tenantLintFix.includes(required)) throw new Error(`Tenant diagnostic lint fix missing: ${required}`);
}

for (const destructive of [
  /delete\s+from\s+public\.productos/i,
  /truncate\s+(table\s+)?public\.productos/i,
  /update\s+public\.productos\s+set\s+(stock_actual|costo_actual|precio_venta)/i,
]) {
  if (destructive.test(readiness)) throw new Error(`Destructive readiness migration pattern detected: ${destructive}`);
}

if (/\b(delete|truncate|drop\s+table|update\s+public\.)\b/i.test(tenantLintFix)) {
  throw new Error("Tenant diagnostic lint fix must remain non-destructive and read-only");
}

console.log("Production readiness verified: 1400-row single-tenant certification, null-cost guard, pooler fallbacks and error-level DB lint gating are protected by CI.");
