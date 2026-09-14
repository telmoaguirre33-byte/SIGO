import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

const barcode = read('src/barcode.ts');
const scanner = read('src/BarcodeScanner.tsx');

for (const [needle, label] of [
  ['LEGACY_DUP_PRODUCT_PREFIX = "LEGACY-DUP-"', 'legacy duplicate identity prefix'],
  ['export function isLegacyDuplicateProduct', 'central legacy duplicate detector'],
  ['startsWith(LEGACY_DUP_PRODUCT_PREFIX)', 'legacy duplicate prefix comparison'],
]) {
  requireText(barcode, needle, label);
}

for (const [needle, label] of [
  ['ScanSource = "manual" | "wedge" | "camera"', 'three scanner input modes'],
  ['resolveCode(code, "manual")', 'manual lookup path'],
  ['resolveCode(buffered, "wedge")', 'USB/Bluetooth keyboard-wedge lookup path'],
  ['resolveCode(found, "camera")', 'mobile camera lookup path'],
  ['(actionOperacion === "vender" || actionOperacion === "ingresar") && isLegacyDuplicateProduct(producto)', 'operational LEGACY-DUP block'],
  ['identidad de código pendiente de revisión física', 'operator-visible physical-review warning'],
  ['SIGO bloqueó ${operacion}', 'explicit blocked-operation message'],
  ['actionActivaRef.current === actionOperacion', 'captured action context guard'],
]) {
  requireText(scanner, needle, label);
}

console.log('Barcode legacy safety guard OK: manual, USB/Bluetooth wedge and camera share a single tenant/action-safe lookup path, while unresolved LEGACY-DUP identities are blocked from sales and stock entry');
