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
