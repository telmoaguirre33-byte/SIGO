// Browser regression for the actual TS clients. Gemini/auth/catalogue responses are
// synthetic; this does not certify a live Gemini request or the complete React UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const encode = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (file) => stripTypeScriptTypes(fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'));
const imageModule = encode(transpile('iaImagenes.ts'));
const clientModule = (file) => encode(transpile(file)
  .replace(/import\s*\{\s*supabase\s*\}\s*from\s*["']\.\/supabase["'];?/, 'const supabase = globalThis.__aiSupabase;')
  .replace(/from\s*["']\.\/iaImagenes["']/, `from ${JSON.stringify(imageModule)}`));
const facturaModule = clientModule('facturaIA.ts');
const inventoryModule = clientModule('inventarioIA.ts');
const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.CHROMIUM_EXECUTABLE) launch.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await playwright.chromium.launch(launch);
let total = 0;
try {
  for (const [name, options] of [['Chromium', { viewport: { width: 1365, height: 900 } }], ['Android simulado (Pixel 7)', playwright.devices['Pixel 7']]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    try {
      await page.setContent('<input id="ai-file" type="file" accept="image/*" capture="environment">');
      const cameraFile = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 600;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = 'black'; ctx.font = '30px sans-serif';
        ctx.fillText('FOTO SINTÉTICA', 30, 50);
        return canvas.toDataURL('image/jpeg').split(',')[1];
      });
      await page.locator('#ai-file').setInputFiles({ name: 'synthetic-camera.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(cameraFile, 'base64') });
      const results = await page.evaluate(async ({ imageModule, facturaModule, inventoryModule }) => {
        const results = [];
        const equal = (actual, expected, label) => {
          if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        };
        const check = (value, label) => { if (!value) throw new Error(label); };
        const rejects = async (fn, pattern) => {
          try { await fn(); } catch (error) {
            if (!pattern.test(error.message)) throw new Error(`Unexpected error: ${error.message}; expected ${pattern}`);
            return error.message;
          }
          throw new Error(`Expected rejection matching ${pattern}`);
        };
        const test = async (label, fn) => {
          await fn();
          results.push(label);
        };
        const state = { token: 'synthetic-test-token', calls: [], reads: [], writes: 0, reply: null };
        globalThis.__aiSupabase = {
          auth: { getSession: async () => ({ data: { session: state.token ? { access_token: state.token } : null } }) },
          from(table) {
            if (!['productos', 'proveedores_sigo'].includes(table)) throw new Error(`Unexpected table: ${table}`);
            state.reads.push(table);
            const query = {
              select() { return query; }, eq() { return query; }, order() { return query; },
              range: async () => ({ data: [], error: null }),
            };
            return new Proxy(query, { get(target, key) {
              if (key in target) return target[key];
              state.writes++;
              throw new Error(`Unexpected database operation: ${String(key)}`);
            } });
          },
          rpc() { state.writes++; throw new Error('No RPC is allowed during analysis'); },
        };
        const nativeTimeout = window.setTimeout.bind(window);
        const timerDelays = [];
        let accelerateTimeout = false;
        window.setTimeout = (fn, ms, ...args) => {
          timerDelays.push(ms);
          return nativeTimeout(fn, accelerateTimeout && ms >= 20_000 ? 25 : ms, ...args);
        };
        const reset = () => { state.calls = []; state.reads = []; state.token = 'synthetic-test-token'; };
        const pending = (signal) => new Promise((_, reject) => {
          if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
        window.fetch = async (url, options) => {
          check(['/api/compras/analizar-factura', '/api/inventario/analizar'].includes(url), `Unexpected network request ${url}`);
          equal(options.method, 'POST', 'Request method');
          equal(options.headers.Authorization, 'Bearer synthetic-test-token', 'Synthetic bearer');
          state.calls.push({ url, body: JSON.parse(options.body), bytes: new TextEncoder().encode(options.body).byteLength });
          return await state.reply(url, options);
        };
        const images = await import(imageModule);
        const invoice = await import(facturaModule);
        const inventory = await import(inventoryModule);
        await test('Archivo seleccionado por input de cámara llega al preparador', async () => {
          const input = document.querySelector('#ai-file');
          equal(input.files.length, 1, 'File input receives uploaded synthetic image');
          const out = await images.prepararImagenIA(input.files[0]);
          check(out.startsWith('data:image/jpeg;base64,'), 'Selected camera image decoded and prepared');
        });
        const factura = (count) => ({
          proveedor: { razon_social: 'Proveedor sintético', cuit: null }, fecha: '2026-10-01',
          tipo_comprobante: 'Factura B', numero_comprobante: '0001-00000123', moneda: 'ARS',
          confianza_general: 0.99, total: count * 200, advertencias: [],
          items: Array.from({ length: count }, (_, i) => ({ descripcion: `Producto sintético ${i + 1}`, codigo: `SYN-${i + 1}`, codigo_barras: null, cantidad: 2, costo_unitario: 100, total_linea: 200, confianza: 0.99 })),
        });
        const successInvoice = (count) => { state.reply = async () => new Response(JSON.stringify({ factura: factura(count) }), { status: 200 }); };
        const hallazgo = (id = 'synthetic-product', estado = 'ok') => ({ id: 'synthetic-id', codigo: id, descripcion: 'Producto sintético', categoria: 'Prueba', estado, foto: 1, x: 0.3, y: 0.4, confianza: 0.99, catalogo_id: id, stock_actual: 10 });
        const inventoryResult = { bloque: 'Prueba sintética', hallazgos: [hallazgo()] };
        const successInventory = () => { state.reply = async () => new Response(JSON.stringify(inventoryResult), { status: 200 }); };
        const makeImage = async (mime = 'image/jpeg', count = 1, emptyMime = false, noise = false) => {
          const canvas = document.createElement('canvas');
          canvas.width = 2500; canvas.height = 3300;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (noise) {
            const pixels = ctx.createImageData(canvas.width, canvas.height);
            let seed = 12345;
            for (let i = 0; i < pixels.data.length; i += 4) {
              seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
              pixels.data[i] = seed & 255; pixels.data[i + 1] = (seed >>> 8) & 255; pixels.data[i + 2] = (seed >>> 16) & 255; pixels.data[i + 3] = 255;
            }
            ctx.putImageData(pixels, 0, 0);
          } else {
            ctx.fillStyle = 'black'; ctx.font = '40px sans-serif';
            ctx.fillText('FACTURA SINTÉTICA - NO VÁLIDA', 80, 100);
            for (let i = 0; i < count; i++) ctx.fillText(`SYN-${i + 1} Producto ${i + 1} | 2 x $100 = $200`, 80, 190 + i * 85);
          }
          const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.96));
          return new File([blob], `synthetic-${count}.${mime === 'image/png' ? 'png' : 'jpg'}`, { type: emptyMime ? '' : mime });
        };
        const binarySize = data => Math.floor((data.split(',')[1].length * 3) / 4);
        for (const mime of ['image/jpeg', 'image/png']) {
          for (const count of [1, 7, 15, 30]) {
            await test(`${mime}: ${count} líneas preparadas y enviadas a Compras`, async () => {
              reset(); successInvoice(count);
              const file = await makeImage(mime, count);
              const result = await invoice.analizarFacturaCompraSigo('synthetic-company', file);
              equal(result.items.length, count, 'All synthetic response lines preserved');
              equal(state.calls.length, 1, 'One analysis request');
              const sent = state.calls[0].body;
              equal(sent.documentType, 'imagen', 'Document type');
              check(sent.documentDataUrl.startsWith('data:image/jpeg;base64,'), 'Image converted to JPEG');
              check(binarySize(sent.documentDataUrl) <= 1_500_000, 'Image respects binary upload limit');
              check(state.calls[0].bytes < 4_300_000, 'JSON respects serverless payload limit');
              equal(state.reads.length, 2, 'Only catalogue reads');
              equal(state.writes, 0, 'Analysis must not write stock');
            });
          }
        }
        const androidFile = await makeImage('image/jpeg', 7, true);
        let prepared;
        await test('Android: MIME vacío se infiere por extensión JPG', async () => {
          prepared = await images.prepararImagenIA(androidFile);
          check(prepared.startsWith('data:image/jpeg;base64,'), 'Empty MIME JPEG accepted');
        });
        await test('Imagen grande ruidosa se comprime por debajo de 1,5 MB', async () => {
          const file = await makeImage('image/jpeg', 1, false, true);
          check(file.size > 1_500_000, 'Synthetic source must exceed the output budget');
          const out = await images.prepararImagenIA(file);
          check(binarySize(out) <= 1_500_000, 'Compressed noisy image limit');
        });
        await test('HEIC incompatible produce error específico de formato', async () => {
          const file = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])], 'synthetic.heic', { type: 'image/heic' });
          await rejects(() => images.prepararImagenIA(file), /HEIC\/HEIF/);
        });
        await test('Imagen vacía y archivo con formato no permitido', async () => {
          await rejects(() => images.prepararImagenIA(new File([], 'empty.jpg', { type: 'image/jpeg' })), /vacía/);
          await rejects(() => images.prepararImagenIA(new File(['fake'], 'fake.gif', { type: 'image/gif' })), /JPG, PNG/);
        });
        await test('PDF de 3 MB con MIME vacío se envía dentro del límite', async () => {
          reset(); successInvoice(1);
          await invoice.analizarFacturaCompraSigo('synthetic-company', new File(['%PDF-1.4\n', new Uint8Array(3_000_000 - 9)], 'synthetic.pdf', { type: '' }));
          equal(state.calls[0].body.documentType, 'pdf', 'PDF type');
          check(state.calls[0].body.documentDataUrl.startsWith('data:application/pdf;base64,'), 'PDF MIME inferred');
          check(state.calls[0].bytes < 4_300_000, '3MB PDF within request budget');
        });
        await test('PDF de 4 MB se rechaza antes de enviar', async () => {
          reset(); successInvoice(1);
          await rejects(() => invoice.analizarFacturaCompraSigo('synthetic-company', new File([new Uint8Array(4_000_000)], 'synthetic.pdf', { type: 'application/pdf' })), /supera 3 MB/);
          equal(state.calls.length, 0, 'Rejected PDF must not be sent');
        });
        for (const [status, invoiceMessage, inventoryMessage] of [
          [401, /sesión venció/, /sesión venció/], [403, /autorizar/, /permiso/], [413, /tamaño permitido/, /límite de envío/],
          [429, /límite de solicitudes/, /límite de solicitudes/], [500, /no está disponible/, /HTTP 500/],
          [502, /no está disponible/, /HTTP 502/], [503, /no está disponible/, /HTTP 503/], [504, /tiempo de respuesta/, /no respondió a tiempo/],
        ]) {
          await test(`Compras HTTP ${status} con HTML muestra error correcto`, async () => {
            reset(); state.reply = async () => new Response('<html>upstream error</html>', { status });
            const message = await rejects(() => invoice.analizarFacturaCompraSigo('synthetic-company', 'Factura sintética'), invoiceMessage);
            check(!/nítida/i.test(message), 'HTTP errors must not blame image sharpness');
            equal(state.calls.length, 1, 'No automatic retry');
          });
          await test(`Inventario HTTP ${status} con HTML muestra error correcto`, async () => {
            reset(); state.reply = async () => new Response('<html>upstream error</html>', { status });
            await rejects(() => inventory.analizarInventarioSigo('synthetic-company', [prepared]), inventoryMessage);
            equal(state.calls.length, 1, 'No automatic retry');
          });
        }
        for (const [label, fn] of [
          ['Compras', () => invoice.analizarFacturaCompraSigo('synthetic-company', 'Factura sintética')],
          ['Inventario', () => inventory.analizarInventarioSigo('synthetic-company', [prepared])],
        ]) {
          await test(`${label}: JSON truncado no se acepta`, async () => {
            reset(); state.reply = async () => new Response('{"factura":', { status: 200 });
            await rejects(fn, /incompleta|inválida/);
          });
          await test(`${label}: error de red no atribuido a calidad`, async () => {
            reset(); state.reply = async () => { throw new TypeError('Failed to fetch'); };
            await rejects(fn, /conectar|conexión/);
          });
          await test(`${label}: timeout durante fetch se cancela`, async () => {
            reset(); accelerateTimeout = true;
            state.reply = async (_, options) => pending(options.signal);
            try { await rejects(fn, /tiempo|no respondió/); } finally { accelerateTimeout = false; }
          });
          await test(`${label}: timeout cubre cuerpo de respuesta colgado`, async () => {
            reset(); accelerateTimeout = true;
            state.reply = async (_, options) => ({ ok: true, status: 200, text: () => pending(options.signal) });
            try { await rejects(fn, /tiempo|no respondió/); } finally { accelerateTimeout = false; }
          });
          await test(`${label}: sesión vencida no envía archivo`, async () => {
            reset(); state.token = null;
            await rejects(fn, /sesión venció/);
            equal(state.calls.length, 0, 'No request without session');
          });
        }
        await test('Inventario: 10 fotos se envían en 10 solicitudes acotadas', async () => {
          reset(); successInventory();
          const checkpoints = [];
          const result = await inventory.analizarInventarioSigo('synthetic-company', Array(10).fill(prepared), { onLote: lote => checkpoints.push(lote) });
          equal(state.calls.length, 10, 'One image per request');
          equal(checkpoints.length, 10, 'Each completed photo checkpointed');
          equal(result.hallazgos.length, 10, 'All photo findings retained');
          for (let i = 0; i < 10; i++) {
            equal(state.calls[i].body.imagenes.length, 1, 'Bounded image batch');
            equal(result.hallazgos[i].foto, i + 1, 'Marker refers to original photo');
          }
        });
        await test('Inventario: límite 1 a 10 fotos', async () => {
          reset(); successInventory();
          await rejects(() => inventory.analizarInventarioSigo('synthetic-company', []), /1 y 10/);
          await rejects(() => inventory.analizarInventarioSigo('synthetic-company', Array(11).fill(prepared)), /1 y 10/);
          equal(state.calls.length, 0, 'Invalid batch never sent');
        });
        await test('Inventario: reintento retoma sin reenviar lote ya completado', async () => {
          reset();
          const saved = [];
          state.reply = async () => state.calls.length === 2
            ? new Response('<html>unavailable</html>', { status: 503 })
            : new Response(JSON.stringify(inventoryResult), { status: 200 });
          await rejects(() => inventory.analizarInventarioSigo('synthetic-company', [prepared, prepared, prepared], { onLote: lote => saved.push(lote) }), /HTTP 503/);
          equal(saved.length, 1, 'First photo checkpoint survives failed second photo');
          reset(); successInventory();
          const result = await inventory.analizarInventarioSigo('synthetic-company', [prepared, prepared, prepared], { completados: saved });
          equal(state.calls.length, 2, 'Only remaining two photos requested');
          equal(result.hallazgos.length, 3, 'No missing or duplicated checkpoints');
          equal(new Set(result.hallazgos.map(h => h.id)).size, 3, 'Stable unique finding IDs');
        });
        await test('Inventario: cancelación conserva lote completado', async () => {
          reset(); successInventory();
          const controller = new AbortController(); const saved = [];
          await rejects(() => inventory.analizarInventarioSigo('synthetic-company', [prepared, prepared], {
            signal: controller.signal, onLote(lote) { saved.push(lote); controller.abort(); },
          }), /cancelado/);
          equal(saved.length, 1, 'First checkpoint retained on user cancellation');
          equal(state.calls.length, 1, 'Second photo not requested after cancellation');
        });
        await test('Inventario: consolidación no marca faltante un producto visto en otra foto', async () => {
          const out = inventory.consolidarInventario([
            { indice: 0, resultado: { bloque: 'A', hallazgos: [hallazgo('seen-later', 'no_visto'), hallazgo('missing', 'no_visto')] } },
            { indice: 1, resultado: { bloque: 'A', hallazgos: [hallazgo('seen-later'), hallazgo('missing', 'no_visto')] } },
          ]);
          equal(out.hallazgos.filter(h => h.estado === 'no_visto').length, 1, 'Missing product counted once');
          equal(out.hallazgos.find(h => h.estado === 'ok').foto, 2, 'Seen marker keeps original photo');
        });
        await test('Compras: reanalizar no genera movimientos de stock', async () => {
          reset(); successInvoice(7);
          await invoice.analizarFacturaCompraSigo('synthetic-company', 'Factura sintética');
          await invoice.analizarFacturaCompraSigo('synthetic-company', 'Factura sintética');
          equal(state.calls.length, 2, 'Explicit analyses can be retried');
          equal(state.writes, 0, 'Neither analysis writes purchases or stock');
        });
        check(timerDelays.includes(55_000), 'Invoice production timeout was exercised');
        check(timerDelays.includes(28_000), 'Inventory production timeout was exercised');
        equal(state.writes, 0, 'No database writes throughout browser regression');
        return { tests: results, userAgent: navigator.userAgent };
      }, { imageModule, facturaModule, inventoryModule });
      for (const label of results.tests) console.log(`PASS ${name}: ${label}`);
      console.log(`${name}: ${results.tests.length} passed (${results.userAgent})`);
      total += results.tests.length;
      assert.ok(results.tests.length >= 40);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(`AI browser regression: ${total} passed; all responses mocked; live Gemini/React UI not verified.`);
