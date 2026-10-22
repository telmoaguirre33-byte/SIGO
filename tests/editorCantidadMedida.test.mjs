import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let next = 0;
async function montar(props) {
  let cursor = 0;
  const hooks = [];
  const api = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useEffect() {},
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter((x) => x !== null && x !== false) }; },
  };
  const key = `__editor_test_${++next}`;
  globalThis[key] = api;
  let source = await readFile(new URL("../src/EditorCantidadMedida.tsx", import.meta.url), "utf8");
  source = source.replace('import { useEffect, useRef, useState } from "react";', `const React = globalThis[${JSON.stringify(key)}]; const { useEffect, useRef, useState } = React;`)
    .replace('from "./ventaPorMedidas"', `from ${JSON.stringify(new URL("../src/ventaPorMedidas.ts", import.meta.url).href)}`);
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { default: Editor } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  delete globalThis[key];
  return () => { cursor = 0; return Editor(props); };
}
function nodos(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => nodos(child, predicate))];
}
function texto(node) { return node && typeof node === "object" ? node.children.map(texto).join("") : String(node ?? ""); }
function input(tree) { return nodos(tree, (n) => n.type === "input")[0]; }
function submit(tree) { return nodos(tree, (n) => n.props.type === "submit")[0]; }
function boton(tree, label) { return nodos(tree, (n) => n.type === "button" && texto(n) === label)[0]; }
const base = { nombre: "Queso", unidad: "kg", precio: 12000, stockDisponible: 2, onConfirmar() {}, onCancelar() {} };

test("kg inicia vacío en gramos con autofocus y no agrega 1kg por accidente", async () => {
  const render = await montar(base);
  const tree = render();
  assert.equal(input(tree).props.value, "");
  assert.equal(input(tree).props.autoFocus, true);
  assert.equal(input(tree).props.inputMode, "numeric");
  assert.equal(submit(tree).props.disabled, true);
  assert.equal(boton(tree, "Gramos (g)").props["aria-pressed"], true);
});

test("750g previsualiza 0,75kg y $9000; Enter agrega sólo una vez", async () => {
  const recibidas = [];
  const render = await montar({ ...base, onConfirmar: (cantidad) => recibidas.push(cantidad) });
  input(render()).props.onChange({ target: { value: "750" } });
  const tree = render();
  assert.match(texto(tree), /0,75 kg/);
  assert.match(texto(tree), /9\.000/);
  assert.equal(submit(tree).props.disabled, false);
  tree.props.onSubmit({ preventDefault() {} });
  tree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(recibidas, [0.75]);
});

test("toggle g/kg conserva peso, presets y Escape funcionan", async () => {
  let canceladas = 0;
  const render = await montar({ ...base, onCancelar: () => canceladas++ });
  input(render()).props.onChange({ target: { value: "750" } });
  boton(render(), "Kilos (kg)").props.onClick();
  assert.equal(input(render()).props.value, "0.75");
  assert.equal(input(render()).props.inputMode, "decimal");
  boton(render(), "500 g").props.onClick();
  assert.equal(input(render()).props.value, "0.5");
  boton(render(), "Gramos (g)").props.onClick();
  assert.equal(input(render()).props.value, "500");
  let prevented = false, stopped = false;
  render().props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(canceladas, 1);
  assert.equal(prevented && stopped, true);
});

test("stock insuficiente y precisión inválida nunca habilitan Enter", async () => {
  const render = await montar({ ...base, stockDisponible: 0.5 });
  input(render()).props.onChange({ target: { value: "750" } });
  assert.equal(submit(render()).props.disabled, true);
  assert.match(texto(render()), /supera el stock/);
  input(render()).props.onChange({ target: { value: "0,5" } });
  assert.equal(submit(render()).props.disabled, true);
  assert.match(texto(render()), /hasta 0 decimales/);
});

test("edición conserva cantidad y otras unidades no muestran gramos", async () => {
  const kg = await montar({ ...base, cantidadInicial: 0.75, reemplazar: true });
  assert.equal(input(kg()).props.value, "750");
  assert.equal(texto(submit(kg())), "Actualizar · Enter");
  const metros = await montar({ ...base, unidad: "m", cantidadInicial: 1.25 });
  assert.equal(input(metros()).props.value, "1.25");
  assert.equal(boton(metros(), "Gramos (g)"), undefined);
});

test("stock legado10,5unidad permite vender1 y no oculta la fracción", async () => {
  const render = await montar({ ...base, unidad: "unidad", stockDisponible: 10.5 });
  input(render()).props.onChange({ target: { value: "1" } });
  assert.equal(submit(render()).props.disabled, false);
  assert.match(texto(render()), /10,5 unidad/);
  input(render()).props.onChange({ target: { value: "0,5" } });
  assert.equal(submit(render()).props.disabled, true);
});
