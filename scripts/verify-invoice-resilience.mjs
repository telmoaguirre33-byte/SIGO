import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

// Isolated handler tests. Every network request is intercepted; no provider calls,
// credentials, tenant records, purchases or stock writes are used by this script.
const source = (await readFile(new URL('../api/compras/analizar-factura.js', import.meta.url), 'utf8'))
  .replace('export default async function handler', 'globalThis.handler = async function handler');
const image = 'data:image/jpeg;base64,/9j/2Q==';
const fixture = (count = 1) => ({
  proveedor: { razon_social: 'Proveedor sintético', cuit: null },
  fecha: '2026-10-19', tipo_comprobante: 'Factura A', numero_comprobante: 'SYNTH-0001',
  moneda: 'ARS', total: count * 20, confianza_general: 0.95,
  items: Array.from({ length: count }, (_, index) => ({
    descripcion: `Producto sintético ${index + 1}`, codigo: `SYNTH-${index + 1}`, codigo_barras: null,
    cantidad: 2, costo_unitario: 10, total_linea: 20, confianza: 0.95,
  })),
});
const output = (value, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }],
});

async function run({ body = {}, replies = [{ data: output(fixture()) }], auth = true, permission = true, abortClient = false } = {}) {
  let clock = 1000;
  let sequence = 0;
  const timers = new Map();
  const calls = [];
  const logs = [];
  const req = Object.assign(new EventEmitter(), {
    method: 'POST', headers: { authorization: 'Bearer synthetic-session' },
    body: { empresaId: 'synthetic-tenant', documentDataUrl: image, ...body },
  });
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(text) { this.body = JSON.parse(text); this.writableEnded = true; return this; },
  });
  const makeResponse = (data, status = 200, retryAfter) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (key) => key === 'retry-after' ? retryAfter : null },
    text: async () => JSON.stringify(data),
  });
  const expire = (signal) => {
    const timer = [...timers.values()].at(-1);
    assert.ok(timer, 'each network operation must have an active deadline');
    clock += timer.ms;
    timer.fn();
    assert.equal(signal.aborted, true);
    throw Object.assign(new Error('synthetic timeout'), { name: 'AbortError' });
  };
  const context = {
    process: { env: { SUPABASE_URL: 'https://synthetic.supabase.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', GEMINI_API_KEY: 'synthetic-key' } },
    Date: class extends Date { static now() { return clock; } },
    AbortController, Set, Map,
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.ok(options.signal, 'network and response body must share an abort signal');
      if (url.endsWith('/auth/v1/user')) return makeResponse({ id: 'synthetic-user' }, auth ? 200 : 401);
      if (url.endsWith('/rpc/tiene_permiso_empresa')) return makeResponse(permission);
      if (url.includes('/rest/v1/productos?')) {
        assert.equal(options.method || 'GET', 'GET', 'analysis never writes catalog or stock');
        return makeResponse([{ id: 'p1', nombre: 'Cuaderno sintético', categoria: 'Librería', stock_actual: 3 }]);
      }
      assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'), 'unexpected write/network request');
      const reply = replies.shift();
      assert.ok(reply, 'unexpected provider retry');
      if (abortClient) { req.emit('aborted'); assert.equal(options.signal.aborted, true); }
      if (reply.timeout || options.signal.aborted) return expire(options.signal);
      if (reply.network) throw new TypeError('synthetic network failure');
      clock += reply.ms || 0;
      const response = makeResponse(reply.data ?? {}, reply.status || 200, reply.retryAfter);
      if (reply.rawBody !== undefined) response.text = async () => reply.rawBody;
      if (reply.bodyTimeout) response.text = async () => expire(options.signal);
      return response;
    },
  };
  vm.runInNewContext(source, context, { filename: 'analizar-factura.js' });
  await context.handler(req, res);
  assert.equal(timers.size, 0, 'all deadlines are cleaned up');
  assert.equal(req.listenerCount('aborted'), 0, 'client listeners are cleaned up');
  assert.equal(res.listenerCount('close'), 0, 'response listeners are cleaned up');
  const provider = calls.filter(({ url }) => url.includes('generativelanguage'));
  assert.ok(provider.length <= (body.modo === 'inventario' ? 4 : 2), 'bounded provider attempts');
  assert.ok(clock - 1000 <= 45_000, 'whole pipeline stays within the 45s application budget');
  assert.ok(!JSON.stringify(logs).includes('synthetic-key'), 'logs must not expose provider credentials');
  assert.ok(!JSON.stringify(logs).includes('Producto sintético'), 'logs must not expose invoice contents');
  return { ...res, provider, calls, elapsed: clock - 1000 };
}

for (const count of [1, 7, 15, 30]) {
  const result = await run({ replies: [{ data: output(fixture(count)) }] });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.factura.items.length, count);
  assert.equal(result.body.factura.total, count * 20);
  assert.equal(result.provider.length, 1);
}

for (const [mime, type] of [['image/jpeg', 'imagen'], ['image/png', 'imagen'], ['image/webp', 'imagen'], ['application/pdf', 'pdf']]) {
  const result = await run({ body: { documentDataUrl: `data:${mime};base64,AAAA`, documentType: type } });
  assert.equal(result.statusCode, 200);
  const payload = JSON.parse(result.provider[0].options.body);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, mime);
}
assert.equal((await run({ body: { documentDataUrl: 'data:image/heic;base64,AAAA' } })).statusCode, 400);
const pdfBoundary = `data:application/pdf;base64,${'A'.repeat(4_000_000)}`;
assert.equal((await run({ body: { documentDataUrl: pdfBoundary, documentType: 'pdf' } })).statusCode, 200, '3 MB binary PDF fits the server envelope');
const oversized = await run({ body: { documentDataUrl: image + 'A'.repeat(4_100_000) } });
assert.equal(oversized.statusCode, 413);
assert.equal(oversized.calls.length, 0);

for (const [status, expected, attempts] of [[401, 503, 1], [403, 503, 1], [413, 413, 1], [429, 429, 1], [500, 503, 2], [502, 503, 2], [503, 503, 2], [504, 504, 1]]) {
  const result = await run({ replies: [{ status, retryAfter: '60' }, { status }] });
  assert.equal(result.statusCode, expected, `upstream HTTP ${status}`);
  assert.equal(result.provider.length, attempts, `bounded fallback for HTTP ${status}`);
  if (status === 429) assert.equal(result.headers['Retry-After'], '60');
}
const fallback = await run({ replies: [{ status: 503 }, { data: output(fixture()) }] });
assert.equal(fallback.statusCode, 200);
assert.equal(fallback.provider.length, 2);
assert.notEqual(fallback.provider[0].url, fallback.provider[1].url);
assert.equal(fallback.body.model, 'gemini-3.1-flash-lite-preview', 'report actual fallback model');

for (const reply of [{ timeout: true }, { bodyTimeout: true }, { network: true }]) {
  const result = await run({ replies: [reply] });
  assert.equal(result.statusCode, reply.network ? 502 : 504);
  assert.equal(result.provider.length, 1, 'uncertain/slow operations are never retried automatically');
  assert.ok(!JSON.stringify(result.body).includes('nítida'), 'timeouts must not blame image quality');
}
assert.equal((await run({ abortClient: true, replies: [{}] })).statusCode, 504);
assert.equal((await run({ auth: false })).provider.length, 0);
assert.equal((await run({ permission: false })).provider.length, 0);

for (const [value, finishReason] of [['{"items":[', 'STOP'], ['{"Producto sintético": true nope', 'STOP'], [fixture(), 'MAX_TOKENS'], [fixture(), 'SAFETY'], [{}, 'STOP']]) {
  const result = await run({ replies: [{ data: output(value, finishReason) }] });
  assert.notEqual(result.statusCode, 200, 'incomplete/malformed output never prepares a purchase');
  assert.equal(result.provider.length, 1);
}
const partial = fixture(7);
partial.items[3].cantidad = null;
const partialResult = await run({ replies: [{ data: output(partial) }] });
assert.equal(partialResult.statusCode, 422);
assert.equal(partialResult.body.error, 'AI_REVIEW_REQUIRED');
assert.equal(partialResult.body.factura, undefined, 'invalid lines must never silently disappear');
assert.equal((await run({ replies: [{ rawBody: '<html>provider outage</html>' }] })).statusCode, 502);
assert.equal((await run({ replies: [{ data: output(fixture(301)) }] })).statusCode, 422);

// The existing contract preserves the invoice total and warns on tax/discount
// reconciliation. It has no separate IVA/discount fields; this is not a claim
// that the live model can extract or allocate them correctly.
for (const total of [169.4, 100]) {
  const taxedOrDiscounted = fixture(7);
  taxedOrDiscounted.total = total;
  const result = await run({ replies: [{ data: output(taxedOrDiscounted) }] });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.factura.total, total);
  assert.equal(result.body.factura.items.length, 7);
  assert.ok(result.body.factura.advertencias.some((text) => text.includes('impuestos, descuentos')));
}

// Compatibility branch: malformed inventory output and a late second stage stay bounded.
const inventoryBody = { modo: 'inventario', imagenes: [image] };
assert.equal((await run({ body: inventoryBody, replies: [{ data: output({}) }] })).statusCode, 502);
assert.equal((await run({ body: { ...inventoryBody, imagenes: Array(11).fill(image) } })).statusCode, 400);
const inventory = await run({ body: inventoryBody, replies: [
  { data: output({ bloque: 'Librería', visuales: [{ descripcion: 'Cuaderno sintético', confianza: 0.95, foto: 1, x: 20, y: 30 }] }), ms: 17_000 },
  { status: 503, ms: 17_000 },
  { bodyTimeout: true },
] });
assert.equal(inventory.statusCode, 504);
assert.equal(inventory.elapsed, 45_000, 'second stage uses remaining request time');

// Repeating analysis remains read-only. Persisted purchase idempotency is tested separately.
const first = await run();
const second = await run();
assert.deepEqual(first.body.factura, second.body.factura);
for (const result of [first, second]) assert.ok(result.calls.every(({ url }) => !url.includes('/stock') && !url.includes('guardar_compra')));

console.log('Invoice resilience OK: synthetic 1/7/15/30 lines, JPG/PNG/WebP/PDF, upstream HTTP matrix, deadline/body timeout, cancellation, bounded fallback, partial JSON/line rejection and read-only repeated analysis.');
