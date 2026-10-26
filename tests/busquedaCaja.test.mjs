import assert from "node:assert/strict";
import test from "node:test";
import { buscarProductosCaja, crearIndiceBusquedaCaja, normalizarBusquedaCaja } from "../src/busquedaCaja.ts";

const empresa = "empresa-prueba";
const producto = (id, cambios = {}) => ({ id, empresa_id: empresa, nombre: `Producto ${id}`, codigo_interno: `INT-${id}`, codigo_barras: null, marca: null, categoria: null, stock_actual: 10, precio_venta: 100, ...cambios });

test("recupera los 40 bolígrafos, con o sin tildes, después de 5.001 artículos", () => {
  const otros = Array.from({ length: 5001 }, (_, i) => producto(`otro-${i}`));
  const boligrafos = Array.from({ length: 40 }, (_, i) => producto(`bol-${i}`, { nombre: `${i % 2 ? "BOLÍGRAFO" : "Boligrafo"} modelo ${i}` }));
  const indice = crearIndiceBusquedaCaja([...otros, ...boligrafos], empresa);
  for (const consulta of ["bolígrafo", "boligrafo", "  BOLÍGRAFO  ", "boli\u0301grafo"]) {
    assert.deepEqual(buscarProductosCaja(indice, consulta).map((p) => p.id), boligrafos.map((p) => p.id));
  }
});

test("busca todos los términos en cualquier orden entre nombre, marca y categoría", () => {
  const exacto = producto("azul", { nombre: "Bolígrafo roller azul 0.7", marca: "Fáber", categoria: "Escritura" });
  const indice = crearIndiceBusquedaCaja([exacto, producto("negro", { nombre: "Bolígrafo roller negro 0.7", marca: "Fáber" })], empresa);
  assert.deepEqual(buscarProductosCaja(indice, "FABER  azul   boligrafo"), [exacto]);
  assert.deepEqual(buscarProductosCaja(indice, "escritura 0.7"), [exacto]);
  assert.deepEqual(buscarProductosCaja(indice, "faber verde"), []);
});

test("prioriza el código exacto y conserva ceros, códigos alfanuméricos y coincidencias parciales", () => {
  const parcial = producto("parcial", { nombre: "Repuesto 00123456", codigo_interno: "X00123456" });
  const ean = producto("ean", { codigo_barras: "00123456" });
  const interno = producto("interno", { codigo_interno: "AB-007" });
  const indice = crearIndiceBusquedaCaja([parcial, ean, interno], empresa);
  assert.deepEqual(buscarProductosCaja(indice, "00123456"), [ean, parcial]);
  assert.deepEqual(buscarProductosCaja(indice, "ab-007"), [interno]);
  assert.equal(ean.codigo_barras, "00123456");
});

test("no mezcla empresas aunque el catálogo contenga filas de otra empresa", () => {
  const propio = producto("propio", { nombre: "Bolígrafo azul" });
  const ajeno = producto("ajeno", { nombre: "Bolígrafo azul", empresa_id: "otra-empresa" });
  assert.deepEqual(buscarProductosCaja(crearIndiceBusquedaCaja([ajeno, propio], empresa), "boligrafo"), [propio]);
  assert.deepEqual(buscarProductosCaja(crearIndiceBusquedaCaja([ajeno, propio], "otra-empresa"), "boligrafo"), [ajeno]);
});

test("el nombre completo tiene prioridad sobre términos parciales de otro producto", () => {
  const kilo = producto("kg", { nombre: "Sintético kg" });
  const gramo = producto("g", { nombre: "Sintético g" });
  const frase = producto("frase", { nombre: "Bolígrafo azul fino" });
  const separado = producto("separado", { nombre: "Bolígrafo fino azul" });
  const indice = crearIndiceBusquedaCaja([kilo, gramo, separado, frase], empresa);
  assert.deepEqual(buscarProductosCaja(indice, "sintetico g"), [gramo, kilo]);
  assert.deepEqual(buscarProductosCaja(indice, "boligrafo azul"), [frase, separado]);
});

test("no oculta por nombre repetido, por falta de stock ni por precio pendiente", () => {
  const productos = [producto("a", { nombre: "Bolígrafo azul", stock_actual: 0 }), producto("b", { nombre: "Bolígrafo azul", precio_venta: 0 })];
  assert.deepEqual(buscarProductosCaja(crearIndiceBusquedaCaja(productos, empresa), "boligrafo"), productos);
});

test("consultas vacías no despliegan el catálogo y cambiar la consulta devuelve nuevos resultados", () => {
  const azul = producto("azul", { nombre: "Bolígrafo azul" });
  const rojo = producto("rojo", { nombre: "Bolígrafo rojo" });
  const indice = crearIndiceBusquedaCaja([azul, rojo], empresa);
  assert.deepEqual(buscarProductosCaja(indice, "  \t\n "), []);
  assert.deepEqual(buscarProductosCaja(indice, "azul"), [azul]);
  assert.deepEqual(buscarProductosCaja(indice, "rojo"), [rojo]);
  assert.equal(normalizarBusquedaCaja(null), "");
});
