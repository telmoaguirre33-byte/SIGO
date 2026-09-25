import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

execFileSync(process.execPath, ['scripts/apply-purchase-message-input.mjs'], { stdio: 'inherit' });
const apiSource = fs.readFileSync('api/compras/analizar-factura.js', 'utf8');
const clientSource = fs.readFileSync('src/facturaIA.ts', 'utf8');
const uiSource = fs.readFileSync('src/ComprasOperativas.tsx', 'utf8');
const compiled = ts.transpileModule(clientSource + '\nexport { validarFactura, prepararDocumento };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const clientExports = {};
vm.runInNewContext(compiled.outputText, {
  exports: clientExports,
  require(name) { if (name === './supabase') return { supabase: {} }; throw new Error(`Unexpected client import: ${name}`); },
  console,
}, { timeout: 3000 });

function server(fetchMock = async () => { throw new Error('Unexpected network request'); }, env = {}) {
  const context = {
    process: { env },
    fetch: fetchMock,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { info() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(apiSource.replace('export default async function handler', 'async function handler') +
    '\nglobalThis.subject = { normalizarFacturaIA, handler };', context, { timeout: 3000 });
  return context.subject;
}
const normalizar = server().normalizarFacturaIA;
const fixture = () => ({
  proveedor: { razon_social: null, cuit: null }, fecha: null,
  tipo_comprobante: 'Mensaje', numero_comprobante: null, moneda: 'ARS', total: 9000,
  confianza_general: 0.9,
  items: [{ descripcion: 'Mouse de prueba: 3 unidades, total de las 3 $9000', codigo: null,
    codigo_barras: null, cantidad: 3, costo_unitario: 3000, total_linea: 9000, confianza: 0.9 }],
});
let count = 0;
async function test(name, run) {
  await run(); count += 1;
  console.log(`PASS ${String(count).padStart(2, '0')} ${name}`);
}

await test('server retains readable products without supplier or document number', () => {
  const result = normalizar(fixture());
  assert.equal(result.items.length, 1); assert.equal(result.items[0].cantidad, 3);
  assert.equal(result.items[0].costo_unitario, 3000);
  assert.equal(result.proveedor.razon_social, null); assert.equal(result.proveedor.cuit, null);
  assert.equal(result.numero_comprobante, null); assert.equal(result.fecha, null);
  assert(result.advertencias.some((text) => text.includes('Proveedor no identificado')));
  assert(result.advertencias.some((text) => text.includes('Comprobante sin número')));
});
await test('client accepts the same review with missing fiscal metadata', () => {
  const result = clientExports.validarFactura(normalizar(fixture()));
  assert.equal(result.numero_comprobante, null); assert.equal(result.proveedor.razon_social, null);
  assert.equal(result.items[0].total_linea, 9000);
});
await test('existing invoice number and supplier are preserved exactly', () => {
  const doc = fixture(); doc.numero_comprobante = '0001-00001234';
  doc.proveedor.razon_social = 'Proveedor de prueba'; doc.tipo_comprobante = 'Factura';
  const result = clientExports.validarFactura(normalizar(doc));
  assert.equal(result.numero_comprobante, '0001-00001234');
  assert.equal(result.proveedor.razon_social, 'Proveedor de prueba');
  assert(!result.advertencias.some((text) => text.includes('Comprobante sin número')));
});
await test('blank document number is normalized to null, never fabricated', () => {
  const doc = fixture(); doc.numero_comprobante = '   ';
  assert.equal(clientExports.validarFactura(doc).numero_comprobante, null);
});
await test('invalid CUIT is not used as supplier identity', () => {
  const doc = fixture(); doc.proveedor.cuit = '123';
  const result = clientExports.validarFactura(normalizar(doc));
  assert.equal(result.proveedor.cuit, null); assert.equal(result.items.length, 1);
});
await test('empty and oversized product results remain blocked', () => {
  assert.throws(() => normalizar({ ...fixture(), items: [] }), /NO_VALID_INVOICE_ITEMS/);
  assert.throws(() => normalizar({ ...fixture(), items: Array(301).fill(fixture().items[0]) }), /TOO_MANY_INVOICE_ITEMS/);
});
await test('conflicting product codes remain blocked', () => {
  const doc = fixture(); doc.items = [
    { ...doc.items[0], codigo: 'ABC', descripcion: 'Producto A' },
    { ...doc.items[0], codigo: 'ABC', descripcion: 'Producto B' },
  ];
  assert.throws(() => normalizar(doc), /AMBIGUOUS_INVOICE_CODES/);
});
await test('existing confidence and currency safeguards are not removed', () => {
  assert.throws(() => normalizar({ ...fixture(), confianza_general: 0.1 }), /LOW_INVOICE_CONFIDENCE/);
  assert.throws(() => clientExports.validarFactura({ ...fixture(), moneda: 'USD' }), /USD/);
});
await test('pasted text requires no FileReader or camera APIs', async () => {
  const doc = await clientExports.prepararDocumento('  3 mouse, total de los tres $9000  ');
  assert.equal(doc.tipo, 'texto'); assert.equal(doc.texto, '3 mouse, total de los tres $9000');
  assert.equal(doc.dataUrl, ''); assert.equal(doc.nombre, 'mensaje.txt');
});
await test('client rejects empty or oversized text before any network call', async () => {
  await assert.rejects(clientExports.prepararDocumento('  '), /mensaje de compra/);
  await assert.rejects(clientExports.prepararDocumento('a'.repeat(30001)), /30.000/);
});

async function requestApi(body, { allowed = true, authorization = 'Bearer test-only', method = 'POST' } = {}) {
  const calls = []; let geminiBody;
  const mock = async (url, options = {}) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return { ok: allowed };
    if (url.endsWith('/rest/v1/rpc/tiene_permiso_empresa')) return { ok: true, json: async () => allowed };
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture()) }] } }] }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const { handler } = server(mock, { SUPABASE_URL: 'https://database.invalid', SUPABASE_ANON_KEY: 'test-only', GEMINI_API_KEY: 'test-only' });
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, setHeader() { return this; }, send(value) { this.body = JSON.parse(value); return this; } };
  await handler({ method, headers: { authorization }, body }, response);
  return { status: response.statusCode, body: response.body, calls, geminiBody };
}
await test('text request reaches Gemini as text and returns a review without a number', async () => {
  const text = '3 mouse, precio TOTAL de las 3 unidades: $9000';
  const r = await requestApi({ empresaId: 'test-company', documentType: 'texto', documentText: text });
  assert.equal(r.status, 200); assert.equal(r.body.factura.numero_comprobante, null);
  assert.equal(r.geminiBody.contents[0].parts.length, 2);
  assert(r.geminiBody.contents[0].parts[1].text.endsWith(text));
  assert.equal(r.geminiBody.contents[0].parts[1].inlineData, undefined);
});
await test('server rejects invalid text input and mixed document types', async () => {
  for (const input of [
    { documentType: 'texto', documentText: '' },
    { documentType: 'texto', documentText: 'a'.repeat(30001) },
    { documentType: 'texto', documentText: 'Compra', documentDataUrl: 'data:image/png;base64,AA==' },
    { documentType: 'html', documentDataUrl: 'data:image/png;base64,AA==' },
  ]) {
    const r = await requestApi({ empresaId: 'test-company', ...input });
    assert.equal(r.status, 400); assert.equal(r.calls.length, 0);
  }
});
await test('company and authorization safeguards are retained', async () => {
  const body = { empresaId: 'test-company', documentType: 'texto', documentText: 'Compra de prueba' };
  assert.equal((await requestApi({ ...body, empresaId: '' })).status, 400);
  const unauthorized = await requestApi(body, { authorization: '' });
  assert.equal(unauthorized.status, 403); assert.equal(unauthorized.calls.length, 0);
  const denied = await requestApi(body, { allowed: false });
  assert.equal(denied.status, 403); assert.equal(denied.geminiBody, undefined);
  assert.equal((await requestApi(body, { method: 'GET' })).status, 405);
});
await test('image and PDF transport still use inlineData', async () => {
  for (const [type, mime] of [['imagen', 'image/png'], ['pdf', 'application/pdf']]) {
    const r = await requestApi({ empresaId: 'test-company', documentType: type, documentDataUrl: `data:${mime};base64,AA==` });
    assert.equal(r.status, 200);
    assert.equal(r.geminiBody.contents[0].parts[1].inlineData.mimeType, mime);
    assert.equal(r.geminiBody.contents[0].parts[1].inlineData.data, 'AA==');
  }
});
await test('UI exposes text input and optional metadata editing', () => {
  const result = ts.transpileModule(uiSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal((result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  assert(uiSource.includes('Pegar mensaje de compra'));
  assert(uiSource.includes('void leerFactura(textoCompraIA)'));
  assert(uiSource.includes('Número de comprobante opcional'));
  assert(uiSource.includes('Proveedor del comprobante'));
  assert(uiSource.includes('setTextoCompraIA("");\n    borradorCargadoRef.current = false;'));
});
await test('a failed read cannot clear the previous reviewed draft before awaiting analysis', () => {
  const start = uiSource.indexOf('  async function leerFactura(');
  const end = uiSource.indexOf('  function aplicarFacturaAnalizada()', start);
  assert(start >= 0 && end > start);
  const fn = uiSource.slice(start, end);
  const awaitAt = fn.indexOf('await analizarFacturaCompraSigo');
  assert(awaitAt > 0);
  const before = fn.slice(0, awaitAt);
  assert(!before.includes('setFacturaIA(null)'));
  assert(!before.includes('setPreciosVentaFactura({})'));
  assert(!before.includes('setMargenesFactura({})'));
  assert(fn.indexOf('setPreciosVentaFactura({})') > awaitAt);
});
await test('build patch is idempotent', () => {
  const paths = ['api/compras/analizar-factura.js', 'src/facturaIA.ts', 'src/ComprasOperativas.tsx'];
  const before = paths.map((path) => fs.readFileSync(path, 'utf8'));
  execFileSync(process.execPath, ['scripts/apply-purchase-message-input.mjs']);
  paths.forEach((path, index) => assert.equal(fs.readFileSync(path, 'utf8'), before[index]));
});
console.log(`SIGO_PURCHASE_MESSAGE_TESTS_OK: ${count} tests`);
