import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", "20260913205500_carrito_devoluciones_anulaciones.sql");
const apiPath = path.join(root, "src", "devoluciones.ts");
const uiPath = path.join(root, "src", "DevolucionesOperativas.tsx");
const cartPath = path.join(root, "src", "CarritoLauncher.tsx");
const returnsLauncherPath = path.join(root, "src", "DevolucionesLauncher.tsx");
const mainPath = path.join(root, "src", "main.tsx");

for (const file of [migrationPath, apiPath, uiPath, cartPath, returnsLauncherPath, mainPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing cart/return file: ${path.relative(root, file)}`);
}

const migration = fs.readFileSync(migrationPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const ui = fs.readFileSync(uiPath, "utf8");
const cart = fs.readFileSync(cartPath, "utf8");
const launcher = fs.readFileSync(returnsLauncherPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");

for (const required of [
  "create table if not exists public.devoluciones_sigo",
  "create table if not exists public.devolucion_items_sigo",
  "registrar_devolucion_sigo",
  "anular_venta_sigo",
  "for update",
  "stock_actual = coalesce(stock_actual, 0) +",
  "caja_movimientos_sigo",
  "'egreso'",
  "cliente_movimientos_sigo",
  "'haber'",
  "estado = 'anulada'",
  "motivo_anulacion",
  "idempotency_key",
  "sales.write",
]) {
  if (!migration.includes(required)) throw new Error(`Sale return safeguard missing: ${required}`);
}

if (/delete\s+from\s+public\.(ventas_sigo|venta_items_sigo)|truncate\s+(table\s+)?public\.(ventas_sigo|venta_items_sigo)/i.test(migration)) {
  throw new Error("Returns must never delete or truncate sale history");
}

for (const required of ["registrarDevolucionSigo", "anularVentaSigo", "listarVentasDevolviblesSigo", "cargarItemsDevolviblesSigo"]) {
  if (!api.includes(required)) throw new Error(`Returns API safeguard missing: ${required}`);
}

for (const required of ["Procesar devolución", "Anular venta completa", "Motivo *", "Historial reciente", "cantidadDisponible"]) {
  if (!ui.includes(required)) throw new Error(`Returns UI safeguard missing: ${required}`);
}

for (const required of ["Carrito", "VentaRapidaOperativa", "se descartará sin modificar stock ni caja"]) {
  if (!cart.includes(required)) throw new Error(`Cart safeguard missing: ${required}`);
}
if (!launcher.includes("Devoluciones") || !launcher.includes("DevolucionesOperativas")) {
  throw new Error("Returns must remain accessible from the SIGO navigation");
}
if (!main.includes("<CarritoLauncher />") || !main.includes("<DevolucionesLauncher />")) {
  throw new Error("Cart and returns launchers must remain mounted in production shell");
}

console.log("Sale cart/returns verified: cancel-before-confirm, auditable partial returns, full annulment, stock restoration and accounting reversal are protected by CI.");
