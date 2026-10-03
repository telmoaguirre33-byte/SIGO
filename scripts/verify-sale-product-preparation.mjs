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
  'onBlockedProduct={marcarProductoBloqueado}',
  'onQueryChange={(q)=>{setBusquedaProducto(q);setSugerenciaActiva(0)}}',
  'onManualQuery={(q)=>{setBusquedaProducto(q);setSugerenciaActiva(0);return true}}',
  'No encontré productos. Probá con nombre, marca, código interno o EAN.',
  'definí un precio de venta mayor a cero antes de vender',
  'sin stock disponible',
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
