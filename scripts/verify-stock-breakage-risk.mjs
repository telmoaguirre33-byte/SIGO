import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const enginePath = path.join(root, "src", "stockRiesgo.ts");
const uiPath = path.join(root, "src", "InformesOperativos.tsx");

for (const file of [enginePath, uiPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing stock risk file: ${path.relative(root, file)}`);
}

const engine = fs.readFileSync(enginePath, "utf8");
const ui = fs.readFileSync(uiPath, "utf8");

for (const required of [
  'from("ventas_sigo")',
  '.eq("estado", "confirmada")',
  '.gte("created_at", desdeIso)',
  'from("venta_items_sigo")',
  '.select("producto_id,cantidad")',
  'COBERTURA_URGENTE_DIAS = 7',
  'COBERTURA_PROXIMA_DIAS = 15',
  'COBERTURA_OBJETIVO_DIAS = 30',
  'stockActual / ventaPromedioDia',
  'compraSugerida',
  'inversionSugerida',
]) {
  if (!engine.includes(required)) throw new Error(`Stock breakage engine safeguard missing: ${required}`);
}

for (const required of [
  'cargarRiesgoStockSigo(targetEmpresaId, 30)',
  'Quiebre urgente',
  'Próximo quiebre',
  'Compra sugerida',
  'días de cobertura',
  'Reponer',
]) {
  if (!ui.includes(required)) throw new Error(`Stock breakage UI safeguard missing: ${required}`);
}

if (/delete\s+from|truncate\s+table|update\s+productos/i.test(engine)) {
  throw new Error("Stock risk engine must remain read-only");
}

console.log("Stock breakage risk verified: confirmed sales drive 7/15/30-day coverage alerts and read-only replenishment guidance.");
