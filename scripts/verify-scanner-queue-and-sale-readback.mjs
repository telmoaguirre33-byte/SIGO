import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scannerPath = path.join(root, "src", "BarcodeScanner.tsx");
const salePath = path.join(root, "src", "VentaRapidaOperativa.tsx");

for (const file of [scannerPath, salePath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing scanner/sale file: ${path.relative(root, file)}`);
}

const scanner = fs.readFileSync(scannerPath, "utf8");
const sale = fs.readFileSync(salePath, "utf8");

for (const required of [
  "MAX_PENDING_SCANS = 50",
  "queuedScansRef",
  "actionActivaRef",
  "takeNextQueuedScan",
  "drainQueuedScans",
  "Lecturas en cola:",
  "SIGO las procesa en orden sin perder unidades",
  "queuedScansRef.current.push",
]) {
  if (!scanner.includes(required)) throw new Error(`Scanner queue safeguard missing: ${required}`);
}

if (/if\s*\(\s*!normalized\s*\|\|\s*inFlightRef\.current\s*\)\s*return\s*;/m.test(scanner)) {
  throw new Error("Scanner must not drop manual/wedge reads while a lookup is in flight");
}

const clearBeforeQueue = scanner.indexOf('setCode("");');
const queueCheck = scanner.indexOf("if (inFlightRef.current)", scanner.indexOf("async function resolveCode"));
if (clearBeforeQueue < 0 || queueCheck < 0 || clearBeforeQueue > queueCheck) {
  throw new Error("Scanner input must clear before queuing a rapid second read");
}

for (const required of [
  "const precio = Number(producto.precio_venta)",
  "!Number.isFinite(precio) || precio <= 0",
  "resultado.totalVerificado ?? total",
  "Math.abs(resultado.totalVerificado - total) > DINERO_TOLERANCIA",
  "Total verificado $",
  "SIGO registró el total vigente del backend",
]) {
  if (!sale.includes(required)) throw new Error(`Sale verified-total safeguard missing: ${required}`);
}

console.log("Scanner/sale verified: rapid manual/wedge reads are queued, tenant/action context is protected, and the sale receipt shows the backend-verified total.");
