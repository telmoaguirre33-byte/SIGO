import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "src", "ingresosDiarios.ts");
const uiPath = path.join(root, "src", "IngresosDiariosOperativos.tsx");
const launcherPath = path.join(root, "src", "IngresosLauncher.tsx");

for (const file of [dataPath, uiPath, launcherPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing daily income report file: ${path.relative(root, file)}`);
}

const data = fs.readFileSync(dataPath, "utf8");
const ui = fs.readFileSync(uiPath, "utf8");
const launcher = fs.readFileSync(launcherPath, "utf8");

for (const required of [
  'from("ventas_sigo")',
  '.eq("empresa_id", empresaId)',
  '.eq("estado", "confirmada")',
  '.select("total,medio_pago,created_at")',
  'cantidadVentas',
  'cobrado',
  'aCobrar',
  'totalVentas',
]) {
  if (!data.includes(required)) throw new Error(`Daily income data safeguard missing: ${required}`);
}

for (const required of [
  'Ventas por día',
  'Hoy',
  'Ayer',
  '7 días',
  '30 días',
  '90 días',
  'Mes pasado',
  'Personalizado',
  'Cantidad de ventas',
  'A cobrar',
]) {
  if (!ui.includes(required)) throw new Error(`Daily income UI safeguard missing: ${required}`);
}

if (!launcher.includes('sigo-report-catalog') || !launcher.includes('IngresosDiariosOperativos')) {
  throw new Error("Daily income report must remain integrated into the SIGO reports catalog");
}

if (/delete\s+from|truncate\s+table|update\s+ventas_sigo/i.test(data)) {
  throw new Error("Daily income reporting must remain read-only");
}

console.log("Daily income report verified: tenant-scoped confirmed sales, quick date filters and day-by-day grid are protected by CI.");
