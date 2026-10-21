import assert from "node:assert/strict";
import test from "node:test";
import { resolverEtiquetaVenta } from "../src/resolverEtiquetaVenta.ts";
function ean13(doce) {
  const suma = [...doce].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return doce + String((10 - suma % 10) % 10);
}
const formato = { prefijo: "20", longitudPlu: 5, tipo: "peso", divisor: 1000 };
const producto = { id: "p1", nombre: "Carne", precio_venta: 12000, stock_actual: 3 };
test("identifica PLU y peso sin inventar productos", () => {
  const resultado = resolverEtiquetaVenta(ean13("200000201250"), formato, new Map([["00002", producto]]));
  assert.equal(resultado.producto.id, "p1");
  assert.equal(resultado.cantidad, 1.25);
});
test("bloquea PLU no configurado y stock insuficiente", () => {
  assert.throws(() => resolverEtiquetaVenta(ean13("200000201250"), formato, new Map()), /PLU_DESCONOCIDO/);
  assert.throws(() => resolverEtiquetaVenta(ean13("200000201250"), formato, new Map([["00002", { ...producto, stock_actual: 1 }]])), /STOCK_INSUFICIENTE/);
});
test("importe no se convierte a kilos por división insegura", () => {
  assert.throws(() => resolverEtiquetaVenta(ean13("200000201250"), { ...formato, tipo: "importe" }, new Map([["00002", producto]])), /REQUIERE_SERVIDOR/);
});
