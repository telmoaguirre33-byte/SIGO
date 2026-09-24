// Regression of the actual TenantSwitcher lifecycle, with Supabase and React
// hooks simulated in memory. No credentials, network, purchases or stock writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = process.argv[2] ?? "src/TenantSwitcher.tsx";
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const company = (id = "a", rol = "owner") => ({ empresa_id: id, nombre: id, empresa_nombre: id, razon_social: null, rol });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness() {
  const slots = [], listeners = new Map();
  const state = {
    user: { id: "user-a", email: "test@example.invalid", user_metadata: {} },
    companies: [company()], authError: null, listError: null, pendingList: null, pendingAuth: null,
    value: null, workspace: "operacion", mode: "menu", draft: null,
    tenantState: "loading", changes: [], states: [], reads: 0, provisions: 0, signouts: 0,
    tree: null, warnings: [],
  };
  let cursor = 0, effects = [], scheduled = false, live = true, Component;
  const schedule = () => {
    if (!live || scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (live) render(); });
  };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      if (!slots[i].set) slots[i].set = next => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; schedule(); }
      };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; slots[i] ??= { current: value }; return slots[i]; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const onChange = empresa => {
    state.changes.push(empresa);
    state.value = empresa?.empresa_id ?? null;
    state.workspace = "operacion";
    state.mode = "menu";
    state.draft = null;
    schedule();
  };
  const onStateChange = next => {
    state.states.push(next);
    if (next === "loading" || next === "error" || next === "empty") {
      state.mode = "menu"; state.draft = null;
    }
    state.tenantState = next;
  };
  const document = {
    visibilityState: "visible",
    addEventListener(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    removeEventListener(name, cb) { listeners.get(name)?.delete(cb); },
  };
  const tenant = {
    cargarMisEmpresas: async () => {
      state.reads++;
      if (state.pendingList) return await state.pendingList;
      if (state.listError) throw state.listError;
      return state.companies.map(x => ({ ...x }));
    },
    crearEmpresaSigo: async () => { state.provisions++; state.companies = [company("new")]; return "new"; },
    guardarEmpresaActiva: () => {},
    leerEmpresaActivaGuardada: () => null,
    resolverEmpresaActiva: (list, preferred) => list.find(x => x.empresa_id === preferred) ?? list[0] ?? null,
  };
  const supabase = { auth: {
    getUser: async () => state.pendingAuth ? await state.pendingAuth : { data: { user: state.user }, error: state.authError },
    updateUser: async () => ({ error: null }),
    signOut: async () => { state.signouts++; state.user = null; },
  } };
  const exports = {};
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  vm.runInNewContext(compiled.outputText, {
    exports, require: name => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./tenant") return tenant;
      if (name === "./supabase") return { supabase };
      throw new Error(`Unexpected import: ${name}`);
    }, document, console: { error() {}, warn(...args) { state.warnings.push(args); } },
  });
  Component = exports.default;
  function render() {
    cursor = 0; effects = [];
    state.tree = Component({ value: state.value, onChange, onStateChange });
    for (const effect of effects) effect();
  }
  function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return null; }
    return predicate(node) ? node : find(node.props?.children, predicate);
  }
  render();
  return {
    state,
    async settle() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); },
    open() { state.workspace = "compras"; state.mode = "ia"; state.draft = { file: "factura.jpg", margen: 60, exception: 40, status: "analizando" }; state.states = []; state.changes = []; },
    visible(value) { document.visibilityState = value; for (const fn of [...listeners.get("visibilitychange") ?? []]) fn(); },
    refresh() { find(state.tree, n => n.props?.["aria-label"] === "Actualizar empresa").props.onClick(); },
    select(value) { find(state.tree, n => n.type === "select").props.onChange({ target: { value } }); },
    logout() { find(state.tree, n => n.props?.["aria-label"] === "Cerrar sesión").props.onClick(); },
    close() { live = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}
let passed = 0;
async function test(name, fn) {
  const h = harness();
  try { await h.settle(); await fn(h); console.log(`PASS ${name}`); passed++; }
  finally { h.close(); }
}
const stays = h => {
  assert.equal(h.state.workspace, "compras", "must not navigate away from purchases");
  assert.equal(h.state.mode, "ia", "must not unmount Compra IA");
  assert.equal(h.state.draft?.file, "factura.jpg", "must retain selected file / in-flight work");
  assert.equal(h.state.draft?.margen, 60);
  assert.equal(h.state.draft?.exception, 40);
  assert.equal(h.state.changes.length, 0, "unchanged context must not reset SigoRoot");
  assert.ok(!h.state.states.includes("loading"), "background refresh must not hide workspace");
};
await test("mobile camera/gallery return preserves screen, file and draft", async h => {
  h.open(); h.visible("hidden"); await h.settle(); h.visible("visible"); await h.settle(); stays(h);
});
await test("repeated mobile resume does not reset the invoice", async h => {
  h.open(); for (let i = 0; i < 6; i++) { h.visible("hidden"); h.visible("visible"); await h.settle(); } stays(h);
});
await test("desktop / manual refresh preserves screen", async h => {
  h.open(); h.refresh(); await h.settle(); stays(h);
});
await test("hidden state alone does not refetch", async h => {
  h.open(); const reads = h.state.reads; h.visible("hidden"); await h.settle(); assert.equal(h.state.reads, reads); stays(h);
});
await test("temporary network failure preserves work, retry recovers", async h => {
  h.open(); h.state.authError = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };
  h.visible("visible"); await h.settle(); stays(h);
  assert.match(JSON.stringify(h.state.tree), /Tu pantalla sigue abierta/);
  h.state.authError = null; h.refresh(); await h.settle(); stays(h);
});
await test("transient company query failure preserves work", async h => {
  h.open(); h.state.listError = { status: 503, message: "Service unavailable" };
  h.visible("visible"); await h.settle(); stays(h);
});
await test("HTTP 401 is not treated as transient network failure", async h => {
  h.open(); h.state.authError = { status: 401, name: "AuthApiError", message: "Failed to fetch" };
  h.visible("visible"); await h.settle(); assert.equal(h.state.value, null); assert.equal(h.state.tenantState, "error");
});
await test("HTTP 403 clears access rather than preserving cached permissions", async h => {
  h.open(); h.state.listError = { status: 403, message: "Forbidden" };
  h.visible("visible"); await h.settle(); assert.equal(h.state.value, null); assert.equal(h.state.tenantState, "error");
});
await test("real role change propagates", async h => {
  h.open(); h.state.companies = [company("a", "seller")]; h.visible("visible"); await h.settle();
  assert.equal(h.state.changes.at(-1)?.rol, "seller");
});
await test("revoked membership clears access and does not create another company", async h => {
  h.open(); h.state.companies = []; h.visible("visible"); await h.settle();
  assert.equal(h.state.value, null); assert.equal(h.state.provisions, 0); assert.equal(h.state.tenantState, "empty");
});
await test("real company switch works", async h => {
  h.state.companies = [company(), company("b")]; h.refresh(); await h.settle(); h.open();
  h.select("b"); await h.settle(); assert.equal(h.state.value, "b"); assert.equal(h.state.workspace, "operacion");
});
await test("stale refresh cannot overwrite a newly selected company", async h => {
  h.state.companies = [company(), company("b")]; h.refresh(); await h.settle();
  const old = deferred(); h.state.pendingList = old.promise; h.visible("visible"); await h.settle();
  h.state.pendingList = null; h.select("b"); await h.settle(); old.resolve([company()]); await h.settle();
  assert.equal(h.state.value, "b");
});
await test("different user is revalidated and cannot retain prior tenant", async h => {
  h.open(); h.state.user = { id: "user-b", email: "other@example.invalid", user_metadata: {} }; h.state.companies = [company("b")];
  h.visible("visible"); await h.settle(); assert.equal(h.state.value, "b"); assert.notEqual(h.state.mode, "ia");
});
await test("sign-out invalidates an in-flight refresh", async h => {
  h.open(); const old = deferred(); h.state.pendingAuth = old.promise; h.visible("visible"); await h.settle();
  h.logout(); await h.settle(); const changes = h.state.changes.length;
  old.resolve({ data: { user: { id: "user-a" } }, error: null }); await h.settle();
  assert.equal(h.state.signouts, 1); assert.equal(h.state.changes.length, changes);
});
console.log(`MOBILE_PURCHASE_RESUME_OK: ${passed} lifecycle regression tests. Physical Android picker is not emulated by this test.`);
