import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { crearCorreccionUnidadInicial } from '../src/correccionUnidadInicial.ts';

test('diálogo muestra seis valores sin inputs numéricos; confirmación habilita y resultado incierto impide cerrar', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/' });
  const prev = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  globalThis.__correccionReact = React;
  let source = await readFile(new URL('../src/DialogoCorreccionUnidadInicial.tsx', import.meta.url), 'utf8');
  source = source.replace("import { useEffect, useId, useRef, useSyncExternalStore } from 'react';", 'const React = globalThis.__correccionReact; const { useEffect, useId, useRef, useSyncExternalStore } = React;')
    .replace("'./correccionUnidadInicial'", JSON.stringify(new URL('../src/correccionUnidadInicial.ts', import.meta.url).href));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const { default: Dialog } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const scope = { empresaId: 'e', productoId: 'p' };
  let calls = 0; let closed = 0;
  const c = crearCorreccionUnidadInicial(scope, { alcanceActual: () => scope, uuid: () => '12345678-1234-4123-8123-123456789012',
    preview: async () => ({ ...scope, nombre: 'Yerba', unidad: 'unidad', unidadDestino: 'kg', revision: '0', elegible: true, snapshot: 's', valores: { stock_actual: 10, stock_minimo: 1, stock_maximo: 20, precio_venta: 500, costo_actual: 400, costo_ultima_compra: 400 } }),
    commit: async () => { calls++; throw Error('timeout'); },
  });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Dialog, { controller: c, onClose: () => closed++ })));
    assert.equal(document.querySelectorAll('dd').length, 0);
    await act(async () => { c.seleccionarDestino('kg'); await c.cargar(); });
    assert.equal(document.querySelectorAll('dd').length, 6);
    assert.equal(document.querySelectorAll('input').length, 1);
    assert.equal(document.querySelector('input').type, 'checkbox');
    const buttons = () => [...document.querySelectorAll('button')];
    assert.equal(buttons().find(b => b.textContent.includes('Corregir solamente')).disabled, true);
    assert.equal(calls, 0);
    await act(async () => document.querySelector('input').click());
    await act(async () => buttons().find(b => b.textContent.includes('Corregir solamente')).click());
    assert.equal(calls, 1); assert.equal(c.getState().fase, 'uncertain');
    assert.equal(buttons().find(b => b.textContent === 'Cerrar').disabled, true);
    assert.match(document.querySelector('[role="alert"]').textContent, /puede haberse aplicado/);
    await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
    assert.equal(closed, 0); assert.equal(calls, 1);
    assert.ok(buttons().some(b => b.textContent.includes('misma solicitud')));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = prev.window; globalThis.document = prev.document; globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act; delete globalThis.__correccionReact;
  }
});
