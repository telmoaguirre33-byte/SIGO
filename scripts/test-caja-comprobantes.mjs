import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const require = createRequire(import.meta.url);
let transpile;
try { const ts = require("typescript"); transpile = (s, f) => ts.transpileModule(s, { fileName: f, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; }
catch { const b = require("/opt/codex/cua_node/lib/node_modules/playwright/lib/transform/babelBundle"); transpile = (s, f) => b.babelTransform(s, f, false, [], []).code; }
const modules = new Map();
const opened = [], shared = [];
const navigator = {};
const window = { open: (...args) => opened.push(args), setTimeout() {} };
const document = { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  const source = fs.readFileSync(file, "utf8").replace('await import("qrcode")', 'await Promise.resolve(require("qrcode"))');
  const req = (id) => {
    if (id === "./supabase") return { supabase: {} };
    if (id === "./comprobanteCaja") return load("src/comprobanteCaja.ts");
    if (id === "qrcode") { try { return { default: require("qrcode") }; } catch { return { default: { create: () => ({ modules: { size: 3, get: () => true } }) } }; } }
    throw new Error(`Unexpected test import ${id}`);
  };
  vm.runInNewContext(transpile(source, file), { exports, require: req, File, Blob, URL, Date, btoa, window, document, navigator, console });
  return exports;
}
const { validarDocumento } = load("src/comprobanteCaja.ts");
const { crearPdfComprobante, compartirPdfWhatsApp, urlQrFiscal } = load("src/comprobantePdf.ts");
const base = () => ({ venta: { id: "sale-1", empresa_id: "tenant-1", numero: 123, estado: "confirmada", total: 250, created_at: "2026-10-15T12:30:00Z", cliente_id: null, anulada_at: null },
  comercio: "COMERCIO QA", direccion: "Calle QA 123", items: [{ nombre: "PINTURA TELA BLANCO", cantidad: 2, precio_unitario: 100, subtotal: 200 },
    { nombre: "COMPAS PIZZINI", cantidad: 1, precio_unitario: 50, subtotal: 50 }], fiscal: null, qr: null });
const fiscal = () => ({ ...base(), fiscal: { id: "invoice-1", empresa_id: "tenant-1", venta_id: "sale-1", resultado: "A", punto_venta: 1, tipo_cbte: 11, numero_cbte: 42, cae: "12345678901234", cae_vencimiento: "2026-10-25" },
  cuit: "20123456789", ambiente: "produccion", qr: { ver: 1, fecha: "2026-10-15", cuit: 20123456789, ptoVta: 1, tipoCmp: 11, nroCmp: 42, importe: 250, moneda: "PES", ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 12345678901234 } });
fs.mkdirSync("test-results", { recursive: true });
async function inspect(doc, format, name) {
  const file = await crearPdfComprobante(doc, format);
  assert.equal(file.type, "application/pdf"); assert.ok(file.name.endsWith(".pdf"));
  const filePath = path.resolve(`test-results/${name}-${format}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));
  assert.equal(fs.readFileSync(filePath, "utf8").slice(0, 8), "%PDF-1.4");
  const text = spawnSync("pdftotext", ["-layout", filePath, "-"], { encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  return { file, text: text.stdout };
}

for (const format of ["58", "80", "a4"]) test(`PDF comercial ${format}: detalle completo y total persistido`, async () => {
  const { text } = await inspect(base(), format, "commercial");
  for (const value of ["COMERCIO QA", "PINTURA TELA BLANCO", "COMPAS PIZZINI", "250,00", "NO FISCAL"]) assert.ok(text.includes(value), value);
  assert.ok(text.includes("100,00")); assert.ok(!text.includes("Total $ 0"));
});
test("PDF fiscal: CAE, vencimiento, numeración y QR original; reimpresión no emite", async () => {
  const { text } = await inspect(fiscal(), "a4", "fiscal");
  for (const value of ["Factura C", "0001-00000042", "12345678901234", "2026-10-25", "250,00"]) assert.ok(text.includes(value), value);
  const qr = JSON.parse(atob(new URL(urlQrFiscal(fiscal())).searchParams.get("p")));
  assert.equal(qr.importe, 250); assert.equal(qr.codAut, 12345678901234); assert.equal(qr.fecha, "2026-10-15");
});
test("QR del PDF fiscal se decodifica desde la página rasterizada y coincide con ARCA", { skip: !process.env.CI }, async () => {
  const { PNG } = require("pngjs");
  const { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, MultiFormatReader, DecodeHintType, BarcodeFormat } = require("@zxing/library");
  await inspect(fiscal(), "a4", "qr-decode");
  const result = spawnSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "2200", "-png", "test-results/qr-decode-a4.pdf", "test-results/qr-decode"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const image = PNG.sync.read(fs.readFileSync("test-results/qr-decode.png"));
  const raw = fs.readFileSync("test-results/qr-decode-a4.pdf", "utf8");
  const rects = [...raw.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)].map(m => m.slice(1).map(Number));
  assert.ok(rects.length > 100, "El PDF debe contener la matriz QR real");
  const scaleX = image.width / 595.28, scaleY = image.height / 841.89;
  const x = Math.floor(Math.min(...rects.map(r => r[0])) * scaleX) - 18;
  const y = Math.floor((841.89 - Math.max(...rects.map(r => r[1] + r[3]))) * scaleY) - 18;
  const width = Math.ceil((Math.max(...rects.map(r => r[0] + r[2])) - Math.min(...rects.map(r => r[0]))) * scaleX) + 36;
  const height = Math.ceil((Math.max(...rects.map(r => r[1] + r[3])) - Math.min(...rects.map(r => r[1]))) * scaleY) + 36;
  const cropped = new PNG({ width, height }); PNG.bitblt(image, cropped, x, y, width, height, 0, 0);
  fs.writeFileSync("test-results/qr-crop.png", PNG.sync.write(cropped));
  const pixels = new Uint8ClampedArray(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (cropped.data[i * 4] + 2 * cropped.data[i * 4 + 1] + cropped.data[i * 4 + 2]) / 4;
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)));
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true], [DecodeHintType.PURE_BARCODE, true]]);
  try { assert.equal(new MultiFormatReader().decode(bitmap, hints).getText(), urlQrFiscal(fiscal())); }
  catch (error) { console.log("QR_DIAGNOSTIC_PNG:" + PNG.sync.write(cropped).toString("base64")); throw error; }
});
test("PDF multipágina conserva todas las líneas sin perder el total", async () => {
  const doc = base(); doc.items = Array.from({ length: 160 }, (_, i) => ({ nombre: `ARTÍCULO ${i + 1}`, cantidad: 1, precio_unitario: 2, subtotal: 2 })); doc.venta.total = 320;
  const { text } = await inspect(doc, "a4", "multipage");
  assert.ok(text.includes("ARTÍCULO 160")); assert.ok(text.includes("320,00"));
});
test("no genera PDF vacío, anulado, de otra identidad fiscal o con total incoherente", async () => {
  for (const change of [d => d.items = [], d => d.venta.total = 0, d => d.venta.total = 251, d => d.venta.anulada_at = "2026-10-15"] ) {
    const doc = base(); change(doc); assert.throws(() => validarDocumento(doc)); await assert.rejects(() => crearPdfComprobante(doc));
  }
  const doc = fiscal(); doc.fiscal.venta_id = "other-sale"; assert.throws(() => validarDocumento(doc));
});
test("WhatsApp escritorio descarga PDF y prepara mensaje con 250,00 en ventana reutilizable", async () => {
  const doc = base(), file = await crearPdfComprobante(doc);
  assert.equal(await compartirPdfWhatsApp(file, doc), "descargado");
  assert.equal(opened.at(-1)[1], "sigo-whatsapp");
  assert.ok(new URL(opened.at(-1)[0]).searchParams.get("text").includes("250,00"));
});
test("WhatsApp compatible comparte archivo PDF; cancelar no abre ni envía mensaje", async () => {
  const doc = fiscal(), file = await crearPdfComprobante(doc);
  navigator.canShare = () => true;
  navigator.share = async (options) => shared.push(options);
  assert.equal(await compartirPdfWhatsApp(file, doc), "compartido");
  assert.equal(shared[0].files[0].type, "application/pdf"); assert.ok(shared[0].text.includes("250,00"));
  const previous = opened.length;
  navigator.share = async () => { const e = new Error("Cancelled"); e.name = "AbortError"; throw e; };
  assert.equal(await compartirPdfWhatsApp(file, doc), "cancelado"); assert.equal(opened.length, previous);
});
