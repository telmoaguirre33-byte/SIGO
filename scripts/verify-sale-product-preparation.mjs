import fs from "node:fs";

const scanner = fs.readFileSync("src/BarcodeScanner.tsx", "utf8");
const sale = fs.readFileSync("src/VentaRapidaOperativa.tsx", "utf8");
const app = fs.readFileSync("src/SigoApp.tsx", "utf8");
const searchPatch = fs.readFileSync("scripts/apply-sale-search-ux.mjs", "utf8");

for (const token of [
  'onBlockedProduct?: (product: BarcodeProduct, reason: "precio" | "stock")',
  'onBlockedProduct?.(producto, "precio")',
  'onBlockedProduct?.(producto, "stock")',
]) {
  if (!scanner.includes(token)) throw new Error(`Scanner blocked-product handoff missing: ${token}`);
}

for (const token of [
  "listarProductosSigo(empresaId)",
  "isLegacyDuplicateProduct(producto)",
  "guardarProductoSigo({",
  "precioVenta: precio",
  "stockActual: null",
  "Guardar precio y agregar",
  "Ingresalo desde Compras; SIGO no inventará stock desde Caja",
  "Buscar producto",
  'placeholder="Escribí nombre, marca, categoría o código"',
  "onBlockedProduct={marcarProductoBloqueado}",
]) {
  if (!sale.includes(token)) throw new Error(`Sale preparation flow missing: ${token}`);
}

for (const token of ["normalizarBusqueda", "puntajeBusquedaProducto", "tokens.every", ".slice(0, 20)", "SIGO_SALE_SEARCH_UX_OK"]) {
  if (!searchPatch.includes(token)) throw new Error(`Sale search UX guard missing: ${token}`);
}

if (!app.includes("puedeEditarProductos={puedeEditarProductos}")) {
  throw new Error("Sale preparation must remain limited to product editors");
}

console.log("SIGO_SALE_PRODUCT_PREPARATION_OK");
