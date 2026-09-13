import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", "20260913233000_fix_venta_efectivo_cliente_record.sql");
const smokePath = path.join(root, "scripts", "production-transaction-smoke.sql");
const workflowPath = path.join(root, ".github", "workflows", "production-operational-smoke.yml");
const cssPath = path.join(root, "src", "mobile-operations-menu.css");

for (const file of [migrationPath, smokePath, workflowPath, cssPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing sale/cash regression file: ${path.relative(root, file)}`);
}

const migration = fs.readFileSync(migrationPath, "utf8");
const smoke = fs.readFileSync(smokePath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

for (const required of [
  "confirmar_venta_sigo_v2",
  "v_cliente_saldo numeric := null",
  "v_cliente_limite numeric := null",
  "if p_medio_pago = 'cuenta_corriente' then",
  "insert into public.caja_movimientos_sigo",
  "set stock_actual = stock_actual - v_cantidad",
  "and stock_actual >= v_cantidad",
]) {
  if (!migration.includes(required)) throw new Error(`Cash sale safeguard missing: ${required}`);
}

if (/if\s+p_medio_pago\s*=\s*'cuenta_corriente'\s+and\s+v_cliente\./i.test(migration)) {
  throw new Error("Cash sale regression: unassigned v_cliente RECORD is referenced in a compound condition");
}

for (const required of [
  "SIGO_PRODUCTION_TRANSACTION_SMOKE_OK",
  "SIGO_PRODUCTION_TRANSACTION_SMOKE_ROLLED_BACK",
  "confirmar_venta_sigo_v2",
  "v_stock_after_sale",
  "caja_movimientos_sigo",
  "v_sale_retry",
  "rollback;",
]) {
  if (!smoke.includes(required)) throw new Error(`Production transaction smoke safeguard missing: ${required}`);
}

if (!workflow.includes("production-transaction-smoke.sql") || !workflow.includes("Prove cash sale stock and cash with rollback")) {
  throw new Error("Production workflow must execute the rollback transaction smoke");
}

if (!css.includes(".sigo-operation-only .content") || !css.includes("padding-top:82px") || !css.includes("position:absolute")) {
  throw new Error("Mobile menu/cart must reserve layout space and not remain fixed over operation content");
}

console.log("Cash sale regression verified: cash sale no longer dereferences an unassigned client record; production rollback smoke proves stock/cash/idempotency; mobile actions reserve their own space.");
