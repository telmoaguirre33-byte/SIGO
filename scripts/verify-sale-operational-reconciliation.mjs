import fs from "node:fs";

const ventas = fs.readFileSync("src/ventas.ts", "utf8");

for (const required of [
  'detectarEstadoReintento',
  'capturarStockAntes',
  'verificarDetalleYStockVenta',
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
  'combinarIntegridad(cabecera.integridad, integridadCaja, comprobacionDetalleStock.integridadDetalle, comprobacionDetalleStock.integridadStock)',
  'integridadCabecera',
  'integridadCaja',
  'integridadDetalle',
  'integridadStock',
  'totalVerificado',
]) {
  if (!ventas.includes(required)) {
    throw new Error(`Missing sale operational reconciliation guard: ${required}`);
  }
}

if (ventas.indexOf('const estadoReintento: EstadoReintentoVenta = "desconocido"') < 0
  || ventas.indexOf('const stockAntes: SnapshotStockVenta | null = null') < 0
  || ventas.includes('await capturarStockAntes(empresaId, itemsConsolidados')) {
  throw new Error("The full product catalog cannot be a prerequisite of a payment RPC");
}

if (!ventas.includes('confirmar_venta_sigo_v2')) {
  throw new Error("Sale confirmation must remain on the hardened transactional RPC");
}

if (!ventas.includes('listarProductosSigo')) {
  throw new Error("Post-sale verification must keep optional tenant product stock checks");
}

const rpcIndex = ventas.indexOf('supabase.rpc("confirmar_venta_sigo_v2"');
const headerIndex = ventas.indexOf('leerCabeceraVentaConfirmada(empresaId, ventaId');
const cashIndex = ventas.indexOf('verificarIntegridadVentas(empresaId, [{ id: ventaId');
const stockIndex = ventas.indexOf('verificarDetalleYStockVenta(', rpcIndex);
if (rpcIndex < 0 || headerIndex < rpcIndex || cashIndex < rpcIndex || stockIndex < 0) {
  throw new Error("Sale reconciliation must run after the single transactional RPC, never before or by replaying it");
}

if (/update\s+public\.productos/i.test(ventas) || /delete\s+from\s+public\.productos/i.test(ventas)) {
  throw new Error("Frontend sale reconciliation must never mutate product stock directly");
}

if (/\.from\(["']productos["']\)[\s\S]{0,220}\.(insert|update|upsert|delete)\s*\(/i.test(ventas)) {
  throw new Error("Frontend sale verification must remain read-only for products");
}

console.log("Sale operational reconciliation verified: header, independent detail math, cash/account, payment method and optional stock delta are classified without replaying the transaction.");
