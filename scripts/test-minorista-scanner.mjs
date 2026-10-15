import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";

// Ejecuta los handlers originales TSX con hooks/DOM simulados. No conecta a Supabase.
const require = createRequire(import.meta.url);
let transpile;
try {
  const ts = require("typescript");
  transpile = (source, file) => ts.transpileModule(source, { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
} catch {
  const { babelTransform } = require("/opt/codex/cua_node/lib/node_modules/playwright/lib/transform/babelBundle.js");
  transpile = (source, file) => babelTransform(source, file, false, [], []).code;
}

const EANS = ["7790413400018", "7793198500065"];
const products = EANS.map((codigo_barras, i) => ({ id: `product-${i}`, empresa_id: "tenant-A",
  codigo_barras, codigo_interno: null, nombre: ["PINTURA TELA BLANCO", "COMPAS PIZZINI"][i],
  precio_venta: 100, stock_actual: 100 }));

function scannerHarness(options = {}) {
  const slots = [];
  const pendingEffects = [];
  const listeners = new Map();
  const calls = [], found = [], queries = [];
  let cursor = 0, scheduled = false, tree, input, now = 1000;
  const document = { activeElement: null };
  const window = { setTimeout: (fn) => queueMicrotask(fn),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  let props = { empresaId: "tenant-A", action: "consultar", onProduct: (p) => found.push(p),
    onQueryChange: (q) => queries.push(q), ...options.props };
  const hooks = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; schedule(); }]; },
    useMemo(fn, deps) { const i = cursor++; const prev = slots[i];
      if (!prev || deps.some((d, n) => !Object.is(d, prev.deps[n]))) slots[i] = { value: fn(), deps };
      return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i];
      if (!prev || !deps || deps.some((d, n) => !Object.is(d, prev.deps[n]))) {
        slots[i] = { deps }; pendingEffects.push(() => { prev?.cleanup?.(); slots[i].cleanup = fn(); });
      } },
  };
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; render(); }); } }
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const supabase = { rpc: async (name, params) => {
    calls.push({ name, ...params });
    if (options.lookup) return options.lookup(params);
    return { data: products.filter((p) => p.empresa_id === params.p_empresa_id && p.codigo_barras === params.p_codigo), error: null };
  } };
  const sandbox = { window, document, navigator: {}, console: { error() {}, debug() {}, warn() {} },
    Date: class extends Date { static now() { return now; } } };
  const context = vm.createContext(sandbox);
  const modules = new Map();
  function load(file) {
    const full = path.resolve(file);
    if (modules.has(full)) return modules.get(full);
    const exports = {};
    const req = (id) => {
      if (id === "react") return hooks;
      if (id.includes("jsx-runtime")) return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (id === "./supabase") return { supabase };
      if (id === "./barcode") return load("src/barcode.ts");
      throw new Error(`Unexpected test import ${id}`);
    };
    vm.runInContext(`(function(require,exports){${transpile(fs.readFileSync(full, "utf8"), full)}\n})`, context)(req, exports);
    modules.set(full, exports);
    return exports;
  }
  const Scanner = load(process.env.SCANNER_SOURCE ?? "src/BarcodeScanner.tsx").default;
  function nodes(node, type) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((n) => nodes(n, type));
    return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
  }
  function render() {
    cursor = 0;
    tree = Scanner(props);
    const node = nodes(tree, "input")[0];
    input ??= { tagName: "INPUT", value: "", focus() { document.activeElement = input; } };
    input.value = node.props.value;
    input.props = node.props;
    node.props.ref.current = input;
    while (pendingEffects.length) pendingEffects.shift()();
  }
  function key(key, global = false) {
    const event = { key, currentTarget: input, preventDefault() {}, stopPropagation() {} };
    if (global) listeners.get("keydown")?.(event);
    else input.props.onKeyDown(event);
  }
  function type(raw, gap = 10, global = false) {
    for (const character of raw) {
      now += gap;
      key(character, global);
      if (!global) { input.value += character; input.props.onChange({ target: input }); render(); }
    }
  }
  render();
  return { calls, found, queries, key, type, load, input, document,
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); },
    update(next) { props = { ...props, ...next }; render(); },
    blur() { document.activeElement = null; },
    errors() { return nodes(tree, "p").filter((n) => n.props.role === "alert").map((n) => n.props.children); },
  };
}

for (const [i, ean] of EANS.entries()) {
  for (const suffix of ["Enter", "Tab"]) {
    test(`${products[i].nombre}: EAN completo con pausa y ${suffix}`, async () => {
      const h = scannerHarness(); await h.settle();
      h.type(ean.slice(0, 7)); h.type(ean[7], 110); h.type(ean.slice(8)); h.key(suffix);
      await h.settle();
      assert.equal(h.calls[0].p_codigo, ean);
      assert.equal(h.found[0]?.nombre, products[i].nombre);
      assert.equal(h.input.value, ""); assert.equal(h.document.activeElement, h.input);
    });
  }
}

test("manual: valor DOM reciente, ceros iniciales y caracteres de transporte", async () => {
  const h = scannerHarness({ lookup: async ({ p_codigo }) => ({ data: [{ ...products[0], codigo_barras: p_codigo }], error: null }) });
  await h.settle();
  h.input.value = " \u200b000012340009\r\n\t\ufeff "; // Sin render de React previo a Enter.
  h.key("Enter"); await h.settle();
  assert.equal(h.calls[0].p_codigo, "000012340009");
  assert.equal(h.found.length, 1); assert.equal(h.input.value, "");
});

test("respuesta tardía no borra la siguiente lectura; consecutivas/repetidas mantienen orden", async () => {
  const pending = [];
  const h = scannerHarness({ lookup: (params) => new Promise((resolve) => pending.push({ params, resolve })) });
  await h.settle(); h.type(EANS[0]); h.key("Enter"); await h.settle();
  h.type(EANS[1].slice(0, 8));
  pending.shift().resolve({ data: [products[0]], error: null }); await h.settle();
  assert.equal(h.input.value, EANS[1].slice(0, 8), "La primera respuesta borró el prefijo de la segunda lectura");
  h.type(EANS[1].slice(8)); h.key("Tab"); await h.settle();
  h.type(EANS[1]); h.key("Enter"); await h.settle();
  pending.shift().resolve({ data: [products[1]], error: null }); await h.settle();
  pending.shift().resolve({ data: [products[1]], error: null }); await h.settle();
  assert.deepEqual(h.calls.map((c) => c.p_codigo), [EANS[0], EANS[1], EANS[1]]);
  assert.deepEqual(h.found.map((p) => p.id), [products[0].id, products[1].id, products[1].id]);
  assert.equal(h.input.value, ""); assert.equal(h.document.activeElement, h.input);
});

test("lectura sin foco conserva el EAN completo pese a pausas", async () => {
  const h = scannerHarness(); await h.settle(); h.blur();
  h.type(EANS[0], 110, true); h.key("Enter", true); await h.settle();
  assert.equal(h.calls[0]?.p_codigo, EANS[0]); assert.equal(h.found.length, 1);
});

test("no encontrado/error liberan campo y foco sin inventar producto", async () => {
  for (const lookup of [async () => ({ data: [], error: null }), async () => ({ data: null, error: { message: "Network error" } })]) {
    const h = scannerHarness({ lookup }); await h.settle(); h.type(EANS[0]); h.key("Enter"); await h.settle();
    assert.equal(h.found.length, 0); assert.equal(h.errors().length, 1);
    assert.equal(h.input.value, ""); assert.equal(h.document.activeElement, h.input);
  }
});

test("nombres manuales conservan filtro; EAN no se intercepta como nombre", async () => {
  const manual = [];
  const h = scannerHarness({ props: { onManualQuery: (query) => { manual.push(query); return true; } } });
  await h.settle(); h.type("PINTURA TELA"); h.key("Enter"); await h.settle();
  assert.deepEqual(manual, ["PINTURA TELA"]); assert.equal(h.calls.length, 0);
  h.type(EANS[0]); h.key("Tab"); await h.settle();
  assert.equal(h.calls[0].p_codigo, EANS[0]); assert.equal(h.found.length, 1);
});

test("cambio de empresa invalida respuesta y cola de la empresa anterior", async () => {
  const pending = [];
  const h = scannerHarness({ lookup: (params) => new Promise((resolve) => pending.push({ params, resolve })) });
  await h.settle(); h.type(EANS[0]); h.key("Enter"); await h.settle();
  h.type(EANS[1]); h.key("Enter"); await h.settle();
  h.update({ empresaId: "tenant-B" }); await h.settle();
  pending.shift().resolve({ data: [products[0]], error: null }); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.found.length, 0);
});

test("lector global y cola usan los callbacks vigentes", async () => {
  const h = scannerHarness(); await h.settle();
  const latest = [];
  h.update({ onProduct: (product) => latest.push(product) });
  h.blur(); h.type(EANS[1], 10, true); h.key("Tab", true); await h.settle();
  assert.equal(h.found.length, 0); assert.equal(latest[0]?.id, products[1].id);
});
