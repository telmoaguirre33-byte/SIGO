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

// The production workflow is now a read-only preflight, never an application path.
for (const required of [
  "permissions:\n  contents: read", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}", "SUPABASE_POOLER_URL: ${{ secrets.SUPABASE_POOLER_URL }}",
  "SIGO_DB_URL_SOURCE=configured", "SIGO_DB_URL_SOURCE=configured-pooler", "SIGO_DB_URL_SOURCE=direct",
  "SIGO_DB_URL_SOURCE=auto-pooler:", "pooler.supabase.com", "postgres.${SUPABASE_PROJECT_REF}",
  "PGOPTIONS: -c default_transaction_read_only=on", "BEGIN READ ONLY;", "ROLLBACK;",
  "FROM supabase_migrations.schema_migrations", "psql -X --no-password -A -t -q -v ON_ERROR_STOP=1",
  "node scripts/check-production-migrations.mjs", "sigo-db-lint.json",
  '"level"[[:space:]]*:[[:space:]]*"error"', "Production database lint completed without error-level findings",
  "if: ${{ always() && steps.connection.outcome == 'success' }}",
]) {
  if (!workflow.includes(required)) throw new Error(`Production read-only safeguard missing: ${required}`);
}
for (const forbidden of [
  /supabase\s+(?:db\s+(?:push|reset|pull)|migration\s+(?:repair|up|down)|config\s+push|link)\b/,
  /--include-all/, /SUPABASE_ACCESS_TOKEN/, /curl\b/, /continue-on-error\s*:\s*true/,
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER|CREATE|DROP)\s+supabase_migrations/i,
]) {
  if (forbidden.test(workflow)) throw new Error(`Production preflight must not mutate or hide failure: ${forbidden}`);
}
// Preserve configured/pooler/direct precedence, credential masking and bounded
// read-only Supabase-owned pooler discovery. A Management token is not needed.
for (const secret of ['SUPABASE_DB_URL', 'SUPABASE_POOLER_URL']) {
  if (!workflow.includes(`echo "::add-mask::$${secret}"`)) throw new Error(`${secret} must be masked`);
  if (!workflow.includes(`if [ -n "\${${secret}:-}" ]; then`)) throw new Error(`${secret} precedence missing`);
}
if (!workflow.includes('for pooler_generation in aws-0 aws-1; do') || !workflow.includes('timeout 7s psql')) {
  throw new Error("Supabase pooler discovery must stay bounded and read-only");
}
if (workflow.includes('echo "$candidate"') || workflow.includes('printf \'%s\\n\' "$candidate"')) {
  throw new Error("Connection candidates must never be printed to logs");
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

console.log("Production readiness verified: 1400-row single-tenant certification, null-cost guard, read-only history preflight, pooler fallbacks and error-level DB lint gating are protected by CI. No production application is authorized.");
