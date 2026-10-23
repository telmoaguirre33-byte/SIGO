import assert from "node:assert/strict";
import test from "node:test";
import { cantidadPorMedida, convertirMedida, subtotalMedida, consolidarCantidadMedida } from "../src/ventaPorMedidas.ts";

test("heladería: 1 kg y cuarto y kilo y medio", () => {
  assert.equal(cantidadPorMedida("1,250", "kg"), 1.25);
  assert.equal(cantidadPorMedida("1.500", "kg"), 1.5);
  assert.equal(subtotalMedida(1.25, 12000), 15000);
});
test("ferretería: clavos por peso y cables por metro", () => {
  assert.equal(cantidadPorMedida("0,300", "kg"), 0.3);
  assert.equal(cantidadPorMedida("2,5", "m"), 2.5);
  assert.equal(convertirMedida(300, "g", "kg"), 0.3);
  assert.equal(convertirMedida(250, "cm", "m"), 2.5);
});
test("conversiones y unidades incompatibles", () => {
  assert.equal(convertirMedida(1.5, "l", "ml"), 1500);
  assert.throws(() => convertirMedida(1, "kg", "l"), /UNIDADES_INCOMPATIBLES/);
});
test("cantidades inválidas", () => {
  for (const valor of ["", "0", "-1", "1,2345", "abc", "1e3"]) {
    assert.throws(() => cantidadPorMedida(valor, "kg"));
  }
  assert.throws(() => cantidadPorMedida("1,5", "unidad"));
});
test("redondeo monetario", () => {
  assert.equal(subtotalMedida(0.75, 12500), 9375);
  assert.equal(subtotalMedida(0.3, 123.45), 37.04);
});

test("consolidación de varias lecturas fraccionarias", () => {
  assert.equal(consolidarCantidadMedida([0.25, 0.5], "kg", 1), 0.75);
  assert.equal(consolidarCantidadMedida([0.1, 0.2], "kg", 0.3), 0.3);
  assert.throws(() => consolidarCantidadMedida([0.75, 0.5], "kg", 1), /STOCK_INSUFICIENTE/);
  assert.throws(() => consolidarCantidadMedida([0.25], "kg", Number.NaN), /STOCK_INVALIDO/);
});

test("unidades canónicas y desconocidas no se convierten en piezas", async () => {
  const { normalizarUnidadVenta } = await import("../src/ventaPorMedidas.ts");
  assert.equal(normalizarUnidadVenta(" KG "), "kg");
  for (const unidad of [null, undefined, "", "kilo", "__proto__", "constructor", 1]) assert.equal(normalizarUnidadVenta(unidad), null);
});

test("precisión de todas las unidades y pasos del carrito", async () => {
  const { UNIDADES_VENTA, pasoCantidadMedida } = await import("../src/ventaPorMedidas.ts");
  for (const [unidad, { decimales }] of Object.entries(UNIDADES_VENTA)) {
    const paso = 10 ** -decimales;
    assert.equal(pasoCantidadMedida(unidad), paso);
    assert.equal(cantidadPorMedida(paso, unidad), paso);
    assert.throws(() => cantidadPorMedida(paso / 10, unidad), /CANTIDAD_INVALIDA/);
    assert.equal(consolidarCantidadMedida([paso, paso], unidad, 2 * paso), 2 * paso);
  }
});

test("stock exacto no redondea hacia arriba ni acumula ruido decimal", async () => {
  const { stockRestanteMedida } = await import("../src/ventaPorMedidas.ts");
  assert.equal(stockRestanteMedida(0.3, [0.1], "kg"), 0.2);
  assert.equal(stockRestanteMedida(0.3, [0.1, 0.2], "kg"), 0);
  assert.equal(consolidarCantidadMedida([0.1 + 0.2], "kg", 0.3), 0.3);
  assert.throws(() => consolidarCantidadMedida([0.001], "kg", 0.0009), /STOCK_INVALIDO/);
  assert.equal(consolidarCantidadMedida([1], "unidad", 1.5), 1);
  assert.throws(() => cantidadPorMedida(Number.MAX_SAFE_INTEGER, "kg"), /CANTIDAD_INVALIDA/);
});

test("ticket usa snapshot y no reinterpreta históricos sin unidad", async () => {
  const { formatoCantidadMedida } = await import("../src/ventaPorMedidas.ts");
  assert.equal(formatoCantidadMedida(0.75, "kg"), "0,75 kg");
  assert.equal(formatoCantidadMedida(0.75, null), "0,75");
  assert.equal(formatoCantidadMedida(3, "desconocida"), "3");
});

test("redondeo monetario en límites de medio centavo", () => {
  assert.equal(subtotalMedida(0.3, 123.45), 37.04);
  assert.equal(subtotalMedida(0.001, 5), 0.01);
  assert.equal(subtotalMedida(1, 1.005), 1.01);
  assert.throws(() => subtotalMedida(1e308, 1e308), /IMPORTE_INVALIDO/);
});

test("entrada explícita g/kg conserva única base kg sin adivinar unidades", async () => {
  const { cantidadManualMedida } = await import("../src/ventaPorMedidas.ts");
  assert.equal(cantidadManualMedida("750", "kg", "g"), 0.75);
  assert.equal(cantidadManualMedida("750", "kg", "kg"), 750);
  assert.equal(cantidadManualMedida("0,750", "kg", "kg"), 0.75);
  assert.equal(cantidadManualMedida("1", "kg", "g"), 0.001);
  assert.throws(() => cantidadManualMedida("0,5", "kg", "g"), /CANTIDAD_INVALIDA/);
  assert.throws(() => cantidadManualMedida("", "kg", "g"), /CANTIDAD_INVALIDA/);
  assert.throws(() => cantidadManualMedida("750", "l", "g"), /UNIDADES_INCOMPATIBLES/);
  assert.equal(subtotalMedida(cantidadManualMedida("750", "kg", "g"), 12000), 9000);
});

test("precisión por valor acepta ceros decimales no significativos", () => {
  assert.equal(cantidadPorMedida("0.7500", "kg"), 0.75);
  assert.equal(cantidadPorMedida("1,0", "unidad"), 1);
  assert.equal(cantidadPorMedida("1.2000", "cm"), 1.2);
  assert.throws(() => cantidadPorMedida("0.7504", "kg"), /CANTIDAD_INVALIDA/);
  assert.throws(() => cantidadPorMedida("1.5", "unidad"), /CANTIDAD_INVALIDA/);
});

test("stock legado fraccional no bloquea venta entera ni se redondea", async () => {
  const { stockRestanteMedida, formatoStockMedida } = await import("../src/ventaPorMedidas.ts");
  assert.equal(consolidarCantidadMedida([1], "unidad", 10.5), 1);
  assert.equal(stockRestanteMedida(10.5, [1], "unidad"), 9.5);
  assert.equal(formatoStockMedida(9.5, "unidad"), "9,5 unidad");
  assert.equal(consolidarCantidadMedida([2, 3], "g", 10.5), 5);
  assert.throws(() => consolidarCantidadMedida([0.5], "unidad", 10.5), /CANTIDAD_INVALIDA/);
  assert.throws(() => consolidarCantidadMedida([11], "unidad", 10.5), /STOCK_INSUFICIENTE/);
  assert.throws(() => consolidarCantidadMedida([1], "unidad", 10.5001), /STOCK_INVALIDO/);
});

test("microcantidades se cobran agrupadas, igual que SQL y no por sumas de subtotales cero", () => {
  const consolidada = consolidarCantidadMedida([0.001, 0.001, 0.001], "kg", 1);
  assert.equal(consolidada, 0.003);
  assert.equal(subtotalMedida(consolidada, 1.99), 0.01);
  assert.equal([0.001, 0.001, 0.001].reduce((total, cantidad) => total + subtotalMedida(cantidad, 1.99), 0), 0);
});

test("oferta y descuento global redondean precio por unidad antes del subtotal, igual SQL", async () => {
  const { precioUnitarioConDescuentosMedida } = await import("../src/ventaPorMedidas.ts");
  assert.equal(precioUnitarioConDescuentosMedida(123.45, 5, 10), 105.55);
  assert.equal(subtotalMedida(0.75, precioUnitarioConDescuentosMedida(123.45, 5, 10)), 79.16);
  assert.equal(precioUnitarioConDescuentosMedida(1.99, 10, 10), 1.61);
  assert.equal(subtotalMedida(0.003, precioUnitarioConDescuentosMedida(1.99)), 0.01);
});
