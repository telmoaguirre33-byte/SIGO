import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import React, { act } from "react";
const require = createRequire(import.meta.url);
const { JSDOM } = await import(process.env.SIGO_DOM_NODE_MODULES
  ? pathToFileURL(join(process.env.SIGO_DOM_NODE_MODULES, "jsdom/lib/api.js")).href : "jsdom");

test("DOM: foco, 750g, doble Enter, Escape y bloqueo fiscal sólo durante edición", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const output = await build({ entryPoints: [new URL("../src/EditorCantidadMedida.tsx", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", plugins: [{ name: "same-react", setup(build) { build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true })); } }] });
  const { default: Editor } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  let confirmadas = [], canceladas = 0, fiscal = 0;
  const fiscalListener = () => fiscal++;
  window.addEventListener("keydown", fiscalListener);
  const props = { nombre: "Queso", unidad: "kg", precio: 12000, stockDisponible: 2, onConfirmar: (cantidad) => confirmadas.push(cantidad), onCancelar: () => canceladas++ };
  try {
    await act(async () => root.render(React.createElement(Editor, props)));
    let input = document.getElementById("sigo-cantidad-medida");
    assert.equal(document.activeElement, input);
    assert.equal(input.value, "");
    assert.equal(document.querySelector('button[type="submit"]').disabled, true);
    for (const key of ["F9", "F10", "F11", "F12"]) {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
    }
    assert.equal(fiscal, 0);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "750");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.match(document.body.textContent, /0,75 kg/);
    assert.match(document.body.textContent, /9\.000/);
    assert.equal(document.querySelector('button[type="submit"]').disabled, false);
    await act(async () => {
      const form = document.querySelector("form");
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(confirmadas, [0.75]);
    await act(async () => root.render(React.createElement(Editor, { ...props, key: "otra" })));
    input = document.getElementById("sigo-cantidad-medida");
    await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(canceladas, 1);
    assert.deepEqual(confirmadas, [0.75]);
    await act(async () => root.unmount());
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "F11", bubbles: true, cancelable: true }));
    assert.equal(fiscal, 1);
  } finally {
    window.removeEventListener("keydown", fiscalListener);
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
