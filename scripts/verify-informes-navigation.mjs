import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { patchInformesNavigation } from "./apply-informes-navigation.mjs";

const appBefore = fs.readFileSync("src/SigoApp.tsx", "utf8");
const rootBefore = fs.readFileSync("src/SigoRoot.tsx", "utf8");
const patched = patchInformesNavigation(appBefore, rootBefore);
assert.deepEqual(patchInformesNavigation(patched.app, patched.root), patched, "patch must be idempotent");
assert.throws(() => patchInformesNavigation("unexpected source", rootBefore), /TARGET_NOT_FOUND/);

const reportRender = '<InformesOperativos key={empresaActiva.empresa_id} empresaId={empresaActiva.empresa_id} />';
assert.equal(patched.root.split(reportRender).length, 2, "keep one existing reports screen");
assert.ok(patched.root.includes('onAbrirInformes={workspacePermitido(empresaActiva.rol, "informes") ? () => abrirWorkspace("informes") : undefined}'));
const purchasesRender = '<SigoApp key={`compras-${empresaActiva.empresa_id}`} empresa={empresaActiva} initialSection="Compras" purchasesOnly />';
assert.ok(patched.root.includes(purchasesRender), "purchase workspace must remain unchanged");

const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX };
const compiledApp = ts.transpileModule(patched.app, { compilerOptions, fileName: "SigoApp.tsx" }).outputText;
let stateWrites = [];
const jsx = (type, props) => ({ type, props: props ?? {} });
// Execute the real menu handlers with all network/data dependencies isolated.
const mockRequire = (id) => {
  if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
  if (id === "react") return {
    useState: (initial) => [initial, (value) => stateWrites.push(value)],
    useEffect: () => {}, useMemo: (fn) => fn(),
  };
  if (id === "./permissions") return { can: () => true };
  return { __esModule: true, default: () => null };
};
const module = { exports: {} };
new Function("require", "exports", "module", compiledApp)(mockRequire, module.exports, module);
const SigoApp = module.exports.default;
const empresa = { empresa_id: "navigation-test", empresa_nombre: "Navigation test", rol: "owner" };
function allButtons(node) {
  if (Array.isArray(node)) return node.flatMap(allButtons);
  if (!node || typeof node !== "object") return [];
  return [...(node.type === "button" ? [node] : []), ...allButtons(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  return typeof node === "object" ? text(node.props?.children) : String(node);
}
const menuButton = (tree, label) => allButtons(tree).find((button) => {
  const children = button.props.children;
  return Array.isArray(children) && text(children[1]) === label;
});
let reportCalls = 0;
const tree = SigoApp({ empresa, onAbrirInformes: () => { reportCalls += 1; } });
const informes = menuButton(tree, "Informes");
assert.ok(informes, "authorized user sees reports shortcut");
informes.props.onClick();
assert.equal(reportCalls, 1, "reports calls shared parent navigation once");
assert.deepEqual(stateWrites, [], "reports must not select the pending local section");
for (const [label, section] of [["Productos", "Productos"], ["Compras / Proveedores", "Compras"]]) {
  const button = menuButton(tree, label);
  assert.ok(button, `${label} remains available`);
  button.props.onClick();
  assert.equal(stateWrites.at(-1), section, `${label} keeps its original destination`);
}
assert.equal(reportCalls, 1, "other menu items do not open reports");
assert.equal(menuButton(SigoApp({ empresa }), "Informes"), undefined, "no reports shortcut without permission callback");
assert.equal(menuButton(SigoApp({ empresa, purchasesOnly: true, initialSection: "Compras", onAbrirInformes: () => {} }), "Informes"), undefined, "purchase-only view has no new navigation");

// Exercise the existing parent permission guard rather than replacing it.
const ast = ts.createSourceFile("SigoRoot.tsx", patched.root, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let navigationFunction;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "abrirWorkspace") navigationFunction = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(navigationFunction);
const compiledNavigation = ts.transpileModule(navigationFunction, { compilerOptions }).outputText;
for (const [tenant, allowed, expected] of [[empresa, true, [false, "informes"]], [empresa, false, []], [null, true, []]]) {
  const writes = [];
  const navigate = new Function("empresaActiva", "workspacePermitido", "setMatrixMode", "setWorkspace", `${compiledNavigation}; return abrirWorkspace;`)(
    tenant, () => allowed, (value) => writes.push(value), (value) => writes.push(value),
  );
  navigate("informes");
  assert.deepEqual(writes, expected, "retain tenant and role guards");
}
console.log("SIGO_INFORMES_NAVIGATION_TESTS_OK: shared destination, permissions, idempotency and untouched purchase navigation; no database calls");
