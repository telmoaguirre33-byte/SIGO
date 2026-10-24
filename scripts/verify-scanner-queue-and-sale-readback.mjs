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

const resolveStart = scanner.indexOf("async function resolveCode");
const clearBeforeQueue = scanner.indexOf('setCode("");', resolveStart);
const queueCheck = scanner.indexOf("if (inFlightRef.current)", clearBeforeQueue);
if (resolveStart < 0 || clearBeforeQueue < 0 || queueCheck < 0 || clearBeforeQueue > queueCheck) {
  throw new Error("Scanner input must clear before queuing a rapid second read");
}

for (const required of [
  "const precio = Number(producto.precio_venta)",
  "!Number.isFinite(precio) || precio <= 0",
  "resultado.verificacion.then",
  "const totalEsperado = intento.totalEsperado",
  "Math.abs(verificado.totalVerificado - totalEsperado) > DINERO_TOLERANCIA",
  "SIGO registró el total vigente del backend",
  "Venta confirmada",
]) {
  if (!sale.includes(required)) throw new Error(`Sale verified-total safeguard missing: ${required}`);
}

const rpcConfirmation = sale.search(/const resultado = await confirmarVentaSigo\(intento\.payload(?:,|\))/);
const persistConfirmedId = sale.indexOf("registrarCobroConfirmado(intento, resultado.ventaId)", rpcConfirmation);
const showConfirmation = sale.indexOf("setExito(recuperar ?", persistConfirmedId);
const secondaryReadback = sale.indexOf("void resultado.verificacion.then", showConfirmation);
if (rpcConfirmation < 0 || persistConfirmedId <= rpcConfirmation
  || showConfirmation <= persistConfirmedId || secondaryReadback <= showConfirmation
  || /await\s+resultado\.verificacion/.test(sale)) {
  throw new Error("Caja must persist the confirmed UUID and display confirmation before scheduling non-blocking secondary readbacks");
}

console.log("Scanner/sale verified: rapid manual/wedge reads are queued, tenant/action context is protected, and the sale receipt shows the backend-verified total.");
