import fs from "node:fs";

const ventas = fs.readFileSync("src/ventas.ts", "utf8");

for (const required of [
  'detectarEstadoReintento',
  'capturarStockAntes',
  'verificarIntegridadStockVenta',
  'leerCabeceraVentaConfirmada',
  'venta_items_sigo',
  'producto_id,cantidad,precio_unitario,subtotal',
  'caja_movimientos_sigo',
  'venta_id,medio_pago,importe',
  'cliente_movimientos_sigo',
  'venta_id,importe',
  'casiIgualDinero',
  'totalDetalle',
  'subtotalCalculado',
  'movimientos.length !== 1',
  'medioPago !== venta.medio_pago',
  'estadoReintento !== "nueva"',
  'esperadoDespues = antes - item.cantidad',
  'combinarIntegridad(cabecera.integridad, integridadCaja, integridadStock)',
  'integridadCabecera',
  'integridadCaja',
  'integridadStock',
  'totalVerificado',
]) {
  if (!ventas.includes(required)) {
    throw new Error(`Missing sale operational reconciliation guard: ${required}`);
  }
}

if (!ventas.includes('confirmar_venta_sigo_v2')) {
  throw new Error("Sale confirmation must remain on the hardened transactional RPC");
}

if (!ventas.includes('listarProductosSigo')) {
  throw new Error("Sale confirmation must capture/verify tenant product stock around a new transaction");
}

const rpcIndex = ventas.indexOf('supabase.rpc("confirmar_venta_sigo_v2"');
const headerIndex = ventas.indexOf('leerCabeceraVentaConfirmada(empresaId, ventaId');
const cashIndex = ventas.indexOf('verificarIntegridadVentas(empresaId, [{ id: ventaId');
const stockIndex = ventas.indexOf('verificarIntegridadStockVenta(');
if (rpcIndex < 0 || headerIndex < rpcIndex || cashIndex < rpcIndex || stockIndex < 0) {
  throw new Error("Sale reconciliation must run after the single transactional RPC, never before or by replaying it");
}

if (/update\s+public\.productos/i.test(ventas) || /delete\s+from\s+public\.productos/i.test(ventas)) {
  throw new Error("Frontend sale reconciliation must never mutate product stock directly");
}

if (/\.from\(["']productos["']\)[\s\S]{0,220}\.(insert|update|upsert|delete)\s*\(/i.test(ventas)) {
  throw new Error("Frontend sale verification must remain read-only for products");
}

console.log("Sale operational reconciliation verified: header, detail math, cash/account amount, payment method and stock delta are checked without replaying the transaction.");
