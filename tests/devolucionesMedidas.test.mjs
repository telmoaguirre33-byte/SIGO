import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

let sequence = 0;
async function moduloConMock(mock) {
  const key = `__devoluciones_test_${++sequence}`;
  globalThis[key] = mock;
  const source = (await readFile(new URL("../src/devoluciones.ts", import.meta.url), "utf8"))
    .replace('import { supabase } from "./supabase";', `const supabase = globalThis[${JSON.stringify(key)}];`)
    .replace('from "./ventaPorMedidas"', `from ${JSON.stringify(new URL("../src/ventaPorMedidas.ts", import.meta.url).href)}`);
  const result = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString("base64")}`);
  delete globalThis[key];
  return result;
}
function tablas(filas, rpc = async () => ({ data: "devolucion", error: null }), llamadas = []) {
  return { rpc, from(tabla) {
    let rango, select, unica = false;
    const chain = {
      select(value) { select = value; return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
      range(a, b) { rango = [a, b]; return chain; }, single() { unica = true; return chain; },
      then(resolve, reject) {
        llamadas.push({ tabla, select, rango });
        return Promise.resolve().then(() => {
          const datos = filas[tabla];
          if (datos instanceof Error) throw datos;
          return { data: unica && Array.isArray(datos) ? datos[0] : rango ? datos.slice(rango[0], rango[1] + 1) : datos, error: null };
        }).then(resolve, reject);
      },
    };
    return chain;
  } };
}
const original = { id: "item", producto_id: "producto", cantidad: 0.75, precio_unitario: 1.99, subtotal: 1.49, unidad_medida: "kg", productos: { nombre: "Queso" } };
const base = { ventaItemId: "item", productoId: "producto", producto: "Queso", codigo: null, cantidadVendida: 0.75, cantidadDevuelta: 0, cantidadDisponible: 0.75, precioUnitario: 1.99, unidadMedida: "kg", subtotalOriginal: 1.49, subtotalDevuelto: 0, subtotalDisponible: 1.49 };

test("snapshots y centavos originales: .250 devuelve .50 y remanente .500 devuelve .99", async () => {
  const llamadas = [];
  const api = await moduloConMock(tablas({ venta_items_sigo: [original], devolucion_items_sigo: [{ venta_item_id: "item", cantidad: 0.25, subtotal: 0.5 }] }, undefined, llamadas));
  assert.equal(api.estimarImporteDevolucion(base, 0.25), 0.5);
  const [item] = await api.cargarItemsDevolviblesSigo("empresa", "venta");
  assert.equal(item.cantidadDisponible, 0.5);
  assert.equal(item.subtotalDisponible, 0.99);
  assert.equal(item.unidadMedida, "kg");
  assert.equal(api.estimarImporteDevolucion(item, 0.5), 0.99);
  assert.match(llamadas[0].select, /subtotal,unidad_medida/);
  assert.match(llamadas[1].select, /cantidad,subtotal/);
  assert.equal(llamadas.some((x) => x.tabla === "productos"), false);
});

test("prorrateo acumulado devuelve todos los centavos sin usar precio actual ni producto cantidad", async () => {
  const { estimarImporteDevolucion } = await moduloConMock({});
  let item = { ...base, precioUnitario: 10000 };
  const importes = [];
  for (let i = 0; i < 3; i++) {
    const importe = estimarImporteDevolucion(item, 0.25);
    importes.push(importe);
    item = { ...item, cantidadDevuelta: (i + 1) * 0.25, subtotalDevuelto: Math.round((item.subtotalDevuelto + importe) * 100) / 100 };
  }
  assert.deepEqual(importes, [0.5, 0.49, 0.5]);
  assert.equal(item.subtotalDevuelto, 1.49);
});

test("importe cero legítimo conserva cantidad devolvible y remanente sin negativos", async () => {
  const { estimarImporteDevolucion } = await moduloConMock({});
  const adelantado = { ...base, cantidadVendida: 0.003, cantidadDevuelta: 0.001, subtotalOriginal: 0.01, subtotalDevuelto: 0.01 };
  assert.equal(estimarImporteDevolucion(adelantado, 0.001), 0);
  assert.equal(estimarImporteDevolucion(adelantado, 0.002), 0);
});

test("precisión usa snapshot; histórico NULL conserva milésimas sin inventar unidad", async () => {
  const api = await moduloConMock(tablas({ venta_items_sigo: [{ ...original, unidad_medida: null }], devolucion_items_sigo: [] }));
  const [historico] = await api.cargarItemsDevolviblesSigo("empresa", "venta");
  assert.equal(historico.unidadMedida, null);
  assert.equal(api.estimarImporteDevolucion(historico, 0.001), 0);
  assert.throws(() => api.estimarImporteDevolucion({ ...base, unidadMedida: "unidad", cantidadVendida: 2 }, 0.5), /precisión/);
  assert.throws(() => api.estimarImporteDevolucion(base, 0.0001), /precisión/);
  assert.throws(() => api.estimarImporteDevolucion(base, 0.751), /supera/);
});

test("historial inválido no se redondea ni se interpreta como cero", async () => {
  for (const cambios of [{ subtotal: null }, { cantidad: NaN }, { subtotal: -1 }, { cantidad: 0 }, { unidad_medida: "palet" }]) {
    const api = await moduloConMock(tablas({ venta_items_sigo: [{ ...original, ...cambios }], devolucion_items_sigo: [] }));
    await assert.rejects(api.cargarItemsDevolviblesSigo("empresa", "venta"), /revisión/);
  }
  const api = await moduloConMock(tablas({ venta_items_sigo: [original], devolucion_items_sigo: [{ venta_item_id: "item", cantidad: 0.75, subtotal: 1 }] }));
  await assert.rejects(api.cargarItemsDevolviblesSigo("empresa", "venta"), /revisión/);
});

test("sumas de devoluciones se paginan y conservan milésimas exactas", async () => {
  const filas = Array.from({ length: 1001 }, () => ({ venta_item_id: "item", cantidad: 0.001, subtotal: 0.01 }));
  const llamadas = [];
  const api = await moduloConMock(tablas({ venta_items_sigo: [{ ...original, cantidad: 2, subtotal: 20 }], devolucion_items_sigo: filas }, undefined, llamadas));
  const [item] = await api.cargarItemsDevolviblesSigo("empresa", "venta");
  assert.equal(item.cantidadDevuelta, 1.001);
  assert.equal(item.cantidadDisponible, 0.999);
  assert.equal(item.subtotalDevuelto, 10.01);
  assert.equal(item.subtotalDisponible, 9.99);
  assert.equal(llamadas.filter((x) => x.tabla === "devolucion_items_sigo").length, 2);
});

test("resultado muestra total persistido, y lectura fallida nunca reenvía escritura", async () => {
  let writes = 0;
  const api = await moduloConMock(tablas({ devoluciones_sigo: { id: "devolucion", total: 0.99 } }, async () => { writes++; return { data: "devolucion", error: null }; }));
  const resultado = await api.registrarDevolucionSigo({ empresaId: "empresa", ventaId: "venta", motivo: "Prueba", items: [{ ventaItemId: "item", cantidad: 0.5 }] });
  assert.deepEqual(resultado, { id: "devolucion", total: 0.99 });
  const sinLectura = await moduloConMock(tablas({ devoluciones_sigo: new Error("network") }, async () => { writes++; return { data: "devolucion", error: null }; }));
  assert.deepEqual(await sinLectura.anularVentaSigo({ empresaId: "empresa", ventaId: "venta", motivo: "Prueba" }), { id: "devolucion", total: null });
  assert.equal(writes, 2);
});

test("errores legacy e idempotencia se explican en español", async () => {
  for (const [codigo, texto] of [["RETURN_LEGACY_RETRY_REQUIRES_REVIEW", /antigua/], ["RETURN_HISTORY_REQUIRES_MANUAL_REVIEW", /historial/], ["IDEMPOTENCY_CONFLICT", /otra solicitud/], ["RETURN_UNIT_INVALID", /unidad histórica/]]) {
    const api = await moduloConMock({ rpc: async () => ({ error: { message: codigo } }) });
    await assert.rejects(api.anularVentaSigo({ empresaId: "empresa", ventaId: "venta", motivo: "Prueba" }), texto);
  }
});

test("DOM devolución: step snapshot, importe estimado/persistido y devolución legítima de cero", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const { build } = await import("esbuild");
  const { default: React, act } = await import("react");
  const require = createRequire(import.meta.url);
  const { JSDOM } = await import(process.env.SIGO_DOM_NODE_MODULES
    ? pathToFileURL(join(process.env.SIGO_DOM_NODE_MODULES, "jsdom/lib/api.js")).href : "jsdom");
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const filas = { ventas_sigo: [{ id: "venta", numero: 1, total: 1.49, medio_pago: "efectivo", cliente_id: null, created_at: "2026-10-22T00:00:00Z" }], venta_items_sigo: [original], devolucion_items_sigo: [], devoluciones_sigo: [] };
  let escrituras = 0;
  globalThis.__devoluciones_dom = tablas(filas, async () => {
    escrituras++;
    filas.devoluciones_sigo = [{ id: "devolucion", venta_id: "venta", tipo: "parcial", total: 0.49, motivo: "Prueba", created_at: "2026-10-22T00:00:00Z" }];
    return { data: "devolucion", error: null };
  });
  const output = await build({ entryPoints: [new URL("../src/DevolucionesOperativas.tsx", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", plugins: [{ name: "test-services", setup(build) {
    build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    build.onLoad({ filter: /\/devoluciones\.ts$/ }, async (args) => ({ contents: (await readFile(args.path, "utf8")).replace('import { supabase } from "./supabase";', 'const supabase = globalThis.__devoluciones_dom;'), loader: "ts", resolveDir: dirname(args.path) }));
  } }] });
  const { default: Devoluciones } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  async function elegir(key) {
    await act(async () => root.render(React.createElement(Devoluciones, { empresaId: "empresa", key })));
    await act(async () => document.querySelector(".sigo-return-sale-row").click());
  }
  async function ingresar(input, valor) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, valor);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  const devolver = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Devolver");
  try {
    await elegir("original");
    let input = document.querySelector(".sigo-return-qty");
    assert.equal(input.step, "0.001");
    assert.match(input.getAttribute("aria-label"), /kg/);
    await ingresar(input, "0.25");
    await ingresar(document.querySelector(".sigo-return-compact-reason input"), "Prueba");
    assert.match(document.querySelector(".sigo-return-compact-total").textContent, /Importe estimado.*0,50/);
    window.confirm = () => true;
    await act(async () => { const boton = devolver(); boton.click(); boton.click(); });
    assert.match(document.querySelector('[role="status"]').textContent, /Importe registrado:.*0,49/);
    assert.equal(escrituras, 1);

    filas.venta_items_sigo = [{ ...original, cantidad: 0.003, subtotal: 0.01 }];
    filas.devolucion_items_sigo = [{ venta_item_id: "item", cantidad: 0.001, subtotal: 0.01 }];
    await elegir("cero");
    await ingresar(document.querySelector(".sigo-return-qty"), "0.001");
    assert.match(document.querySelector(".sigo-return-compact-total").textContent, /0,00/);
    assert.equal(devolver().disabled, false);

    filas.venta_items_sigo = [{ ...original, unidad_medida: null }];
    filas.devolucion_items_sigo = [];
    await elegir("historico");
    assert.equal(document.querySelector(".sigo-return-qty").step, "0.001");
    assert.match(document.querySelector(".sigo-return-compact-item").textContent, /sin unidad histórica/);

    filas.venta_items_sigo = [{ ...original, unidad_medida: "unidad", cantidad: 2, subtotal: 2 }];
    await elegir("unidad");
    input = document.querySelector(".sigo-return-qty");
    assert.equal(input.step, "1");
    await ingresar(input, "0.5");
    assert.equal(devolver().disabled, true);
    assert.match(document.body.textContent, /precisión/);
  } finally {
    await act(async () => root.unmount());
    delete globalThis.__devoluciones_dom;
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("retry después de fallo conserva key, incluso al cambiar a anulación; éxito abre un intento nuevo", async () => {
  const keys = [];
  let rechazo = true;
  const api = await moduloConMock(tablas({ devoluciones_sigo: { id: "devolucion", total: 0.5 } }, async (_rpc, params) => {
    keys.push(params.p_idempotency_key);
    if (rechazo) return { data: null, error: { message: "network" } };
    return { data: "devolucion", error: null };
  }));
  const parcial = { empresaId: "empresa", ventaId: "venta", motivo: "Prueba", items: [{ ventaItemId: "item", cantidad: 0.25 }] };
  await assert.rejects(api.registrarDevolucionSigo(parcial), /network/);
  await assert.rejects(api.registrarDevolucionSigo(parcial), /network/);
  await assert.rejects(api.anularVentaSigo(parcial), /network/);
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[0], keys[2]);
  rechazo = false;
  await api.registrarDevolucionSigo(parcial);
  assert.equal(keys[3], keys[0]);
  await api.registrarDevolucionSigo(parcial);
  assert.notEqual(keys[4], keys[0]);
});

test("recarga de módulo conserva intento en sessionStorage y no lo comparte con otra empresa", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const guardado = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key) => guardado.get(key) ?? null,
    setItem: (key, value) => guardado.set(key, value),
    removeItem: (key) => guardado.delete(key),
  } } });
  const keys = [];
  const mock = { rpc: async (_rpc, params) => { keys.push(params.p_idempotency_key); return { error: { message: "network" } }; } };
  const input = { empresaId: "empresa", ventaId: "venta", motivo: "Prueba" };
  try {
    const antes = await moduloConMock(mock);
    await assert.rejects(antes.anularVentaSigo(input), /network/);
    const despues = await moduloConMock(mock);
    await assert.rejects(despues.anularVentaSigo(input), /network/);
    await assert.rejects(despues.anularVentaSigo({ ...input, empresaId: "otra" }), /network/);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[0], keys[2]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});
