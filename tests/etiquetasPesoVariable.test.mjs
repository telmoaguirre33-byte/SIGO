import assert from "node:assert/strict";
import test from "node:test";
import { decodificarEtiquetaVariable } from "../src/etiquetasPesoVariable.ts";

function ean13(doce) {
  const suma = [...doce].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return doce + String((10 - suma % 10) % 10);
}
test("etiqueta por peso: 1,250 kg con PLU", () => {
  const codigo = ean13("200000201250");
  const e = decodificarEtiquetaVariable(codigo, { prefijo: "20", longitudPlu: 5, tipo: "peso", divisor: 1000 });
  assert.equal(e.plu, "00002");
  assert.equal(e.cantidadOImporte, 1.25);
});
test("etiqueta por importe variable", () => {
  const codigo = ean13("200000201500");
  const e = decodificarEtiquetaVariable(codigo, { prefijo: "20", longitudPlu: 5, tipo: "importe", divisor: 100 });
  assert.equal(e.cantidadOImporte, 15);
});
test("código sin formato válido se rechaza", () => {
  const codigo = ean13("200000201250");
  assert.throws(() => decodificarEtiquetaVariable(codigo.slice(0,12)+"9", { prefijo: "20", longitudPlu: 5, tipo: "peso", divisor: 1000 }), /CHECKSUM/);
  assert.throws(() => decodificarEtiquetaVariable(codigo, { prefijo: "21", longitudPlu: 5, tipo: "peso", divisor: 1000 }), /FORMATO/);
});
