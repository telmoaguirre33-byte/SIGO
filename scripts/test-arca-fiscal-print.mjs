// Offline synthetic QA only: no ARCA requests, no physical printer, no credentials.
// Run: node scripts/test-arca-fiscal-print.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatReader, DecodeHintType, BarcodeFormat } = require("@zxing/library");
const root = process.cwd();
const artifacts = process.env.FISCAL_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "sigo-fiscal-qa-"));
await fs.mkdir(artifacts, { recursive: true });
const entry = path.join(root, "src/ticketFiscal.ts");
const compiled = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
const module = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(module, module.exports, require);
const { urlQrFiscal, construirTicketFiscalHtml, calcularAltoPaginaTermica } = module.exports;
const bundle = await build({ entryPoints: [entry], bundle: true, platform: "browser", format: "iife", globalName: "Fiscal", write: false });

const base = {
  punto_venta: 10, tipo_cbte: 1, numero_cbte: 94, cae: "70417054367476", cae_vencimiento: "2026-11-01",
  ventaNumero: 123, total: 12100, fecha: "2026-10-22", ambiente: "homologacion",
  receptorDocTipo: 80, receptorDocumento: "20000000001", condicionIvaReceptorId: 1,
  receptorRazonSocial: "Receptor sintético QA", emisorCuit: "30000000007", emisorRazonSocial: "EMISOR SINTÉTICO QA",
  moneda: "PES", cotizacion: 1, neto: 10000, iva: 2100,
  items: [{ nombre: "Producto sintético <QA> & prueba", cantidad: 2, precio_unitario: 6050, subtotal: 12100 }],
};
function decodedPayload(ticket) {
  const url = new URL(urlQrFiscal(ticket));
  assert.equal(url.origin + url.pathname, "https://www.arca.gob.ar/fe/qr/");
  return JSON.parse(Buffer.from(url.searchParams.get("p"), "base64").toString("utf8"));
}
assert.deepEqual(decodedPayload(base), {
  ver: 1, fecha: base.fecha, cuit: 30000000007, ptoVta: 10, tipoCmp: 1, nroCmp: 94,
  importe: 12100, moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: 20000000001, tipoCodAut: "E", codAut: 70417054367476,
});
assert.equal(decodedPayload({ ...base, moneda: "DOL", cotizacion: 1250.123456 }).ctz, 1250.123456);
const cf = decodedPayload({ ...base, tipo_cbte: 6, receptorDocTipo: 99, receptorDocumento: "0" });
assert.ok(!("nroDocRec" in cf) && !("tipoDocRec" in cf));
const invalid = [
  { cae: "" }, { cae: "7041705436747" }, { cae: "00000000000000" }, { emisorCuit: "" },
  { fecha: "2026-02-30" }, { fecha: "2026-13-01" }, { fecha: "2026-10-22T00:00:00Z" },
  { punto_venta: 0 }, { punto_venta: 99999 }, { punto_venta: 100000 }, { tipo_cbte: 2 }, { numero_cbte: 0 }, { numero_cbte: 1e8 },
  { total: NaN }, { total: Infinity }, { total: -1 }, { total: 1.234 }, { total: 1.23001 },
  { moneda: "ARS-INVALID" }, { moneda: "DOL", cotizacion: undefined }, { cotizacion: 0 }, { cotizacion: 2 },
  { receptorDocTipo: 80, receptorDocumento: "" }, { receptorDocumento: "123e4" },
  { receptorDocumento: "9007199254740993" }, { receptorDocTipo: 99, receptorDocumento: "20000000001" },
];
for (const patch of invalid) assert.throws(() => urlQrFiscal({ ...base, ...patch }), undefined, JSON.stringify(patch));
await assert.rejects(() => construirTicketFiscalHtml({ ...base, items: [] }));
await assert.rejects(() => construirTicketFiscalHtml({ ...base, items: [{ ...base.items[0], subtotal: NaN }] }));
const safeHtml = await construirTicketFiscalHtml(base);
assert.ok(safeHtml.includes("&lt;QA&gt; &amp; prueba"));
assert.ok(safeHtml.includes("HOMOLOGACIÓN · SIN VALIDEZ FISCAL"));
assert.ok(!/<script\b|\bonload\s*=|58mm auto|setTimeout/.test(safeHtml));
assert.equal(calcularAltoPaginaTermica(1), 60);
assert.equal(calcularAltoPaginaTermica(96), 60);
assert.equal(calcularAltoPaginaTermica(96 * 100 / 25.4), 108);
assert.equal(calcularAltoPaginaTermica(96 * 492 / 25.4), 500);
for (const height of [0, -1, NaN, Infinity, 96 * 493 / 25.4]) assert.throws(() => calcularAltoPaginaTermica(height));
const withIssuer = await construirTicketFiscalHtml({ ...base, emisorDomicilio: "Domicilio QA <sintético>", emisorCondicionIva: "IVA RESPONSABLE INSCRIPTO", emisorIngresosBrutos: "No contribuyente QA", emisorInicioActividades: "01/01/2020" });
assert.ok(withIssuer.includes("Domicilio QA &lt;sintético&gt;") && withIssuer.includes("IIBB: No contribuyente QA") && withIssuer.includes("INICIO DE ACTIVIDADES: 01/01/2020"));

function decodePng(bytes, binary = false) {
  const png = PNG.sync.read(bytes);
  const luminance = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < luminance.length; i++) {
    const n = Math.round((png.data[i * 4] + png.data[i * 4 + 1] * 2 + png.data[i * 4 + 2]) / 4);
    luminance[i] = binary ? (n < 128 ? 0 : 255) : n;
  }
  const reader = new MultiFormatReader();
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true]]);
  reader.setHints(hints);
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, png.width, png.height)))).getText();
}

// Quantity/unit is historical display only; do not recalculate authoritative subtotals.
const weighted = await construirTicketFiscalHtml({ ...base, items: [{ nombre: "Queso", cantidad: .75, unidad: "kg", precio_unitario: 12000, subtotal: 9000 }] });
assert.match(weighted, /0,750 kg/); assert.match(weighted, /9\.000,00/);
const unknownUnit = await construirTicketFiscalHtml({ ...base, items: [{ nombre: "Histórico", cantidad: .75, unidad: null, precio_unitario: 12000, subtotal: 8999.99 }] });
assert.doesNotMatch(unknownUnit, /0,75 kg/); assert.match(unknownUnit, /8\.999,99/);

// Independent SVG raster/decoder test also runs without a browser or network.
const sharp = require("sharp");
const qrSvg = safeHtml.match(/<svg\b[^]*?<\/svg>/)?.[0];
assert.ok(qrSvg);
const qrPixels = html => Math.round(Number(html.match(/\.qr svg \{ width: ([0-9.]+)mm/)[1]) / 25.4 * 203);
const qr203dpi = await sharp(Buffer.from(qrSvg)).resize(qrPixels(safeHtml), qrPixels(safeHtml), { kernel: "nearest" }).png().toBuffer();
assert.equal(decodePng(qr203dpi), urlQrFiscal(base));
assert.equal(decodePng(qr203dpi, true), urlQrFiscal(base));
const qrCases = [
  base,
  { ...base, tipo_cbte: 6, receptorDocTipo: 99, receptorDocumento: "0" },
  { ...base, tipo_cbte: 11, receptorDocTipo: 96, receptorDocumento: "12345678" },
  { ...base, moneda: "DOL", cotizacion: 1250.123456 },
  { ...base, punto_venta: 99998, numero_cbte: 99999999, total: 9999999999999.99 },
];
for (const ticket of qrCases) {
  const html = await construirTicketFiscalHtml(ticket);
  const svg = html.match(/<svg\b[^]*?<\/svg>/)[0];
  const png = await sharp(Buffer.from(svg)).resize(qrPixels(html), qrPixels(html)).png().toBuffer();
  assert.equal(decodePng(png, true), urlQrFiscal(ticket));
  const raster = PNG.sync.read(png);
  // Verify the generated symbol retains a white perimeter, not a cropped code.
  for (let i = 0; i < raster.width; i++) {
    for (const index of [i, (raster.height - 1) * raster.width + i, i * raster.width, i * raster.width + raster.width - 1]) {
      assert.equal(raster.data[index * 4], 255, "QR quiet-zone perimeter must stay white");
    }
  }
}
await fs.writeFile(path.join(artifacts, "qr-synthetic-203dpi.png"), qr203dpi);
await fs.writeFile(path.join(artifacts, "ticket-synthetic.html"), safeHtml);
if (process.argv.includes("--fixture")) {
  const fixtureBundle = await build({ stdin: { resolveDir: root, sourcefile: "synthetic-fiscal-qa.ts", contents: `
import { imprimirTicketFiscal } from "./src/ticketFiscal";
const base = ${JSON.stringify(base)};
const output = document.querySelector("pre");
const links = document.querySelector("nav");
document.querySelector("button").addEventListener("click", async () => {
  output.textContent = "Ejecutando pruebas sintéticas sin impresora…";
  const results = [];
  const originalAppend = document.body.appendChild.bind(document.body);
  let calls = 0, closes = 0;
  document.body.appendChild = function(node) {
    const r = originalAppend(node);
    if (node instanceof HTMLIFrameElement) node.contentWindow.print = () => { calls++; };
    return r;
  };
  try {
    for (const count of [1, 8, 25, 100]) {
      const c = { ...base, items: Array.from({length:count},(_,i) => ({nombre:'ITEM-'+String(i+1).padStart(3,'0')+' Producto de descripción extensa y presentación prueba',cantidad:2.125,precio_unitario:1000.5,subtotal:2126.06})) };
      try { await imprimirTicketFiscal(c, "58", () => closes++); }
      catch(e) {
        if (!String(e).includes('supera los 50 cm')) throw e;
        if (document.querySelector('iframe')) throw new Error('Quedó iframe tras rechazar largo');
        results.push({count,rejectedBeforePrint:true,reason:String(e),printCalls:calls,closeCalls:closes});
        continue;
      }
      const frame = document.querySelector("iframe");
      const d = frame.contentDocument;
      const t = d.querySelector(".ticket"); const b = t.getBoundingClientRect();
      const overflow = [...t.querySelectorAll("*")].filter(e => {const r=e.getBoundingClientRect();return r.width && (r.right>b.right+1||r.left<b.left-1)}).map(e=>e.tagName);
      const rule = [...d.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.type === CSSRule.PAGE_RULE).at(-1).cssText;
      const html = '<!doctype html>'+d.documentElement.outerHTML;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html],{type:'text/html'}));a.target='_blank';a.textContent='Abrir ticket '+count+' ítems (PDF manual)';a.style.display='block';links.appendChild(a);
      frame.contentWindow.dispatchEvent(new Event('afterprint'));
      results.push({count,widthMm:b.width*25.4/96,heightMm:b.height*25.4/96,pageRule:rule,overflow,printCalls:calls,closeCalls:closes,remainingFrames:document.querySelectorAll('iframe').length});
      if (overflow.length||calls!==results.filter(r=>!r.rejectedBeforePrint).length||closes!==calls||document.querySelector('iframe')) throw new Error('Falló layout o ciclo impresión');
    }
    output.textContent=JSON.stringify({status:'DOM_PASS',physicalPrinterValidated:false,cases:results},null,2);
  } catch(e) {output.textContent=JSON.stringify({status:'FAIL',error:String(e),results},null,2);}
  finally {document.body.appendChild=originalAppend;}
});
` }, bundle: true, platform: "browser", format: "iife", write: false });
  const fixture = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SIGO QA sintética 58 mm</title></head><body><h1>QA sintética 58 mm</h1><p>Sin conexión ARCA. Impresión reemplazada por contador, ningún trabajo físico.</p><button>Ejecutar QA local</button><pre>Esperando ejecución</pre><nav></nav><script>' + fixtureBundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
  await fs.writeFile(path.join(artifacts, "qa-browser.html"), fixture);
}
console.log(JSON.stringify({ status: "UNIT_PASS", invalidQrCasesRejected: invalid.length, svgQrDecoded203dpi: true, qrRasterCases: qrCases.length, artifacts }));
if (process.argv.includes("--unit")) process.exit(0);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 203 / 96 });
// Block every network request. Synthetic fiscal data never leaves this local QA run.
await context.route("**/*", route => route.abort());
const page = await context.newPage();
const summary = [];
try {
  for (const count of [1, 8, 25, 100]) {
    const ticket = { ...base, items: Array.from({ length: count }, (_, i) => ({
      nombre: `ITEM-${String(i + 1).padStart(3, "0")} Producto de prueba con descripción y presentación extensa`,
      cantidad: 2.125, precio_unitario: 1000.5, subtotal: 2126.06,
    })) };
    await page.setContent("<html><body></body></html>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    // Stub the *actual iframe* print method before helper execution. Never call native print.
    await page.evaluate(() => {
      window.__prints = 0; window.__closed = 0; window.open = () => null;
      const append = document.body.appendChild.bind(document.body);
      document.body.appendChild = function(node) {
        const result = append(node);
        if (node instanceof HTMLIFrameElement) {
          node.contentWindow.print = () => { window.__prints++; };
        }
        return result;
      };
    });
    const rejection = await page.evaluate(async ticket => {
      try { await Fiscal.imprimirTicketFiscal(ticket, "58", () => window.__closed++); return null; }
      catch(e) { return String(e); }
    }, ticket);
    if (rejection) {
      assert.match(rejection, /supera los 50 cm/);
      assert.ok(count >= 25, "Short receipts should not hit the long-ticket safety limit");
      assert.equal(await page.evaluate(() => window.__prints), 0);
      assert.equal(await page.evaluate(() => document.querySelectorAll("iframe").length), 0);
      summary.push({ items: count, rejectedBeforePrint: true, reason: "THERMAL_LENGTH_OVER_500_MM", preservedForA4: true });
      continue;
    }
    const frame = page.frames().find(frame => frame !== page.mainFrame());
    assert.ok(frame, "print frame must be present until afterprint");
    const metrics = await frame.evaluate(() => {
      const main = document.querySelector(".ticket");
      const box = main.getBoundingClientRect();
      const overflow = [...main.querySelectorAll("*")].filter(el => {
        const b = el.getBoundingClientRect(); return b.width && (b.right > box.right + 1 || b.left < box.left - 1);
      }).map(el => el.tagName + "." + el.className);
      const pageRule = [...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.type === CSSRule.PAGE_RULE).at(-1).cssText;
      return { widthMm: box.width * 25.4 / 96, heightMm: box.height * 25.4 / 96, overflow, pageRule, html: document.documentElement.outerHTML };
    });
    assert.ok(Math.abs(metrics.widthMm - 48) < 0.1);
    assert.deepEqual(metrics.overflow, [], "Nothing may escape the 48 mm content column");
    assert.match(metrics.pageRule, /size: 58mm \d+mm/);
    assert.equal(await page.evaluate(() => window.__prints), 1);
    // Dispatch from the parent context: the listener intentionally removes the iframe.
    await page.evaluate(() => document.querySelector("iframe").contentWindow.dispatchEvent(new Event("afterprint")));
    assert.equal(await page.evaluate(() => document.querySelectorAll("iframe").length), 0);
    assert.equal(await page.evaluate(() => window.__closed), 1);
    assert.equal(await page.evaluate(() => window.__prints), 1);

    const stem = path.join(artifacts, `ticket-58mm-${count}-items`);
    await fs.writeFile(stem + ".html", "<!doctype html>" + metrics.html);
    await page.setContent(metrics.html);
    const qrPng = await page.locator(".qr svg").screenshot();
    assert.equal(decodePng(qrPng), urlQrFiscal(ticket), "SVG QR decodes at 203 dpi");
    assert.equal(decodePng(qrPng, true), urlQrFiscal(ticket), "Monochrome QR decodes at 203 dpi");
    await fs.writeFile(stem + "-qr.png", qrPng);
    await page.pdf({ path: stem + ".pdf", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    const pdf = JSON.parse(execFileSync("python", ["-c", `
import fitz,json,sys
doc=fitz.open(sys.argv[1]); out=[]
for i,p in enumerate(doc):
 text=p.get_text(); spans=[s for b in p.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
 out.append({'widthMm':p.rect.width*25.4/72,'heightMm':p.rect.height*25.4/72,'text':text,'rightMm':max((s['bbox'][2]*25.4/72 for s in spans),default=0)})
 if 'CAE:' in text:
  p.get_pixmap(matrix=fitz.Matrix(203/72,203/72),alpha=False).save(sys.argv[2])
print(json.dumps(out))
`, stem + ".pdf", stem + "-pdf-203dpi.png"], { encoding: "utf8" }));
    for (const p of pdf) {
      assert.ok(Math.abs(p.widthMm - 58) < 0.5, "PDF width must be 58 mm");
      assert.ok(p.heightMm >= 59.5 && p.heightMm <= 500.5, "PDF has finite bounded height");
      assert.ok(p.text.trim().length > 10, "No blank PDF pages");
      assert.ok(p.rightMm <= 51.5, "PDF text stays inside useful 48 mm plus 3 mm margin");
    }
    const allText = pdf.map(p => p.text).join("\n");
    for (let i = 1; i <= count; i++) assert.ok(allText.includes(`ITEM-${String(i).padStart(3, "0")}`), `Missing item ${i}`);
    assert.ok(allText.includes("70417054367476") && allText.includes("SIN VALIDEZ FISCAL"));
    assert.equal(decodePng(await fs.readFile(stem + "-pdf-203dpi.png"), true), urlQrFiscal(ticket), "QR decodes from actual PDF raster at 203 dpi");
    if (metrics.heightMm + 8 <= 500) assert.equal(pdf.length, 1, "Short receipt must be exactly one finite page");
    summary.push({ items: count, pages: pdf.length, widthMm: pdf[0].widthMm, pageHeightMm: pdf[0].heightMm, qrDecoded203dpi: true });
  }
  // Empty detail is rejected before a frame or a print job can be created.
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const empty = await page.evaluate(async ticket => {
    try { await Fiscal.imprimirTicketFiscal({ ...ticket, items: [] }); return false; }
    catch { return document.querySelectorAll("iframe").length === 0; }
  }, base);
  assert.equal(empty, true);
} finally { await browser.close(); }
await fs.writeFile(path.join(artifacts, "summary.json"), JSON.stringify({ syntheticOnly: true, physicalPrinterValidated: false, cases: summary }, null, 2));
console.log(JSON.stringify({ status: "PASS", invalidQrCasesRejected: invalid.length, cases: summary, artifacts, physicalPrinterValidated: false }, null, 2));
