// Real POS/BarcodeScanner in Chromium; only service boundaries are synthetic.
// Run after npm run build. No authentication, production data, payments or printers.
// BUSQUEDA_CAJA_BASELINE=1 checks the reported production component without changing files.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = process.cwd();
const baseline = process.env.BUSQUEDA_CAJA_BASELINE === "1";
const artifacts = process.env.BUSQUEDA_CAJA_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "sigo-busqueda-caja-"));
await fs.mkdir(artifacts, { recursive: true });
if (!baseline) await fs.access("dist/index.html");
const origin = "https://sigo-busqueda-caja-qa.invalid/";
const E = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const penIds = Array.from({ length: 40 }, (_, i) => `pen-${String(i + 1).padStart(2, "0")}`);
const mocks = {
  "./supabase": `export const supabase={auth:{onAuthStateChange(cb){cb("INITIAL_SESSION",{user:{id:"synthetic-search-user"}});return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{if(name!=="buscar_producto_codigo_sigo")throw new Error("Unexpected RPC "+name);window.__qa.lookups.push(args);return {data:window.__qa.products(args.p_empresa_id).filter(p=>p.codigo_barras===args.p_codigo||p.codigo_interno===args.p_codigo),error:null}},from(){throw new Error("Unexpected database access")}};`,
  "./productos": `export const listarProductosSigo=async(e)=>{window.__qa.catalogCalls.push(e);return structuredClone(window.__qa.products(e));};export const listarUnidadesProductoSigo=async(e)=>Object.fromEntries(window.__qa.products(e).map(p=>[p.id,p.unidad_medida]));export const guardarProductoSigo=async()=>{throw new Error("Product writes prohibited")};`,
  "./clientes": "export const listarClientesSigo=async()=>[];",
  "./ofertasProductos": "export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;export const precioConOferta=(p,d)=>Math.round(p*(1-d/100)*100)/100;",
  "./ventas": "export class VentaRechazadaSinCambiosError extends Error{};export const listarVentasRecientesSigo=async()=>[];export const confirmarVentaSigo=async()=>{window.__qa.blocked.push('sale');throw new Error('Sales prohibited in search QA')};",
  "./ticketVenta": "export const imprimirTicketVenta=async()=>{window.__qa.blocked.push('print');throw new Error('Printing prohibited')};",
};

function fixture() {
  const E = "11111111-1111-4111-8111-111111111111";
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const product = (id, nombre, extra = {}) => ({ id, empresa_id: E, nombre, codigo_interno: id, codigo_barras: null, marca: null, categoria: null, descripcion: null, proveedor: null, costo_actual: 1, costo_ultima_compra: 1, precio_venta: 100, stock_actual: 100, stock_minimo: 0, stock_maximo: null, margen_ganancia: null, margen_porcentaje: null, activo: true, unidad_medida: "unidad", ...extra });
  const products = Array.from({ length: 4961 }, (_, i) => product(`catalog-${i}`, `Artículo catálogo ${String(i).padStart(4, "0")}`));
  const special = [
    product("peso-qa", "Queso para pesar", { unidad_medida: "kg", precio_venta: 12000 }),
    product("litro-qa", "Detergente por litro", { unidad_medida: "l", precio_venta: 1200 }),
    product("code-partial", "Referencia BIC-200 color", { codigo_interno: "BIC-2000" }),
    product("code-exact", "Zeta código exacto", { codigo_interno: "BIC-200" }),
    product("sin-stock", "Producto sin existencias", { stock_actual: 0 }),
    product("sin-precio", "Producto sin precio", { precio_venta: 0 }),
    product("same-name-a", "Cuaderno gemelo", { codigo_interno: "GEM-A" }),
    product("same-name-b", "Cuaderno gemelo", { codigo_interno: "GEM-B" }),
    product("same-code-a", "Código duplicado uno", { codigo_barras: "7799999999999" }),
    product("same-code-b", "Código duplicado dos", { codigo_barras: "7799999999999" }),
    product("legacy-qa", "Identidad pendiente", { codigo_interno: "LEGACY-DUP-QA" }),
    product("unidad-kg", "Sintetico kg", { unidad_medida: "kg", codigo_interno: "UNIT-KG" }),
    product("unidad-g", "Sintetico g", { unidad_medida: "g", codigo_interno: "UNIT-G", stock_actual: 1000 }),
  ];
  products.splice(0, special.length, ...special);
  for (let n = 1; n <= 40; n++) products.push(product(`pen-${String(n).padStart(2, "0")}`, `${n % 2 ? "Bolígrafo" : "BOLIGRAFO"} modelo ${String(n).padStart(2, "0")} ${n % 2 ? "Azul" : "Negro"}`, { codigo_interno: `BOL-${String(n).padStart(2, "0")}`, codigo_barras: String(7790000000000 + n), marca: "Filgo" }));
  const otherProducts = [product("other-pen-1", "Bolígrafo otra empresa uno", { empresa_id: OTHER }), product("other-pen-2", "Bolígrafo otra empresa dos", { empresa_id: OTHER })];
  const q = window.__qa = { catalogCalls: [], lookups: [], blocked: [], products: e => e === E ? products : e === OTHER ? otherProducts : [] };
  window.fetch = async (...args) => { q.blocked.push(["fetch", String(args[0])]); throw new Error("Network prohibited"); };
  window.open = window.print = () => { q.blocked.push("external"); throw new Error("External action prohibited"); };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { q.blocked.push("camera"); throw new Error("Camera prohibited"); };
  for (const name of ["sigo:arca:venta", "sigo:fiscal:caja"]) window.addEventListener(name, () => q.blocked.push(name));
}

const componentSource = baseline ? execFileSync("git", ["show", "ccc20745db2be40b37e3fc8b472a84a3da4e1107:src/VentaRapidaOperativa.tsx"], { encoding: "utf8" }) : await fs.readFile("src/VentaRapidaOperativa.tsx", "utf8");
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import POS from './src/VentaRapidaOperativa';(${fixture.toString()})();const r=createRoot(document.getElementById('root'));window.__qa.render=e=>r.render(<React.StrictMode><POS empresaId={e}/></React.StrictMode>);window.__qa.render('${E}');` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "synthetic-service-boundaries", setup(b) {
    b.onResolve({ filter: /^\.\// }, args => mocks[args.path] ? { path: args.path, namespace: "synthetic" } : null);
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: mocks[args.path], resolveDir: root }));
    if (baseline) b.onLoad({ filter: /\/src\/VentaRapidaOperativa\.tsx$/ }, () => ({ contents: componentSource, loader: "tsx", resolveDir: path.join(root, "src") }));
  } }],
});
const css = (await Promise.all(["index.css", "caja-ventas.css", "barcode-scanner.css"].map(f => fs.readFile(`src/${f}`, "utf8")))).join("\n");
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="root"></div></body></html>`;
const sources = { "src/VentaRapidaOperativa.tsx": createHash("sha256").update(componentSource).digest("hex") };
for (const file of ["src/BarcodeScanner.tsx", "src/barcode.ts", "src/index.css"]) sources[file] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
if (!baseline) for (const file of ["src/busquedaCaja.ts", "dist/index.html"]) sources[file] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
const cases = [], network = [], browserErrors = [];
let browser, failure;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
  for (const mobile of [false, true]) {
    const device = mobile ? "mobile" : "desktop";
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 950 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
    await context.route("**/*", route => {
      if (route.request().url() === origin && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      network.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", error => browserErrors.push(error.message));
    const input = () => page.locator(".barcode-entry-row input");
    const suggestions = () => page.locator("[data-pos-suggestion]");
    const counter = () => page.locator("[data-pos-search-count]");
    const rows = () => page.locator(".sigo-pos-cart tbody tr");
    const ids = () => suggestions().evaluateAll(els => els.map(el => el.dataset.productId));
    const activeId = () => page.locator('[data-pos-suggestion][aria-selected="true"]').getAttribute("data-product-id");
    const next = () => page.getByRole("button", { name: "Siguiente", exact: true });
    const previous = () => page.getByRole("button", { name: "Anterior", exact: true });
    const activate = async locator => mobile ? locator.tap() : locator.click();
    async function start() {
      await page.goto(origin);
      await page.evaluate(() => sessionStorage.clear());
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await input().waitFor();
      await page.waitForFunction(e => __qa.catalogCalls.includes(e), E);
      assert.equal(await page.evaluate(e => __qa.products(e).length, E), 5001);
    }
    async function query(text) { await input().fill(text); await suggestions().first().waitFor(); }
    async function waitForCount(text) { await page.waitForFunction(value => document.querySelector('[data-pos-search-count]')?.textContent.includes(value), text); }
    async function check(name, run) {
      try { await run(); assert.deepEqual(await page.evaluate(() => __qa.blocked), []); }
      catch (error) { await page.screenshot({ path: path.join(artifacts, `${device}-failure.png`), fullPage: true }).catch(() => {}); throw error; }
      cases.push(`${device}: ${name}`); console.log("PASS", cases.at(-1));
    }
    if (baseline) {
      await check("original component loses 28 of 40 matches and misses an unaccented exact name", async () => {
        await start(); await query("bol");
        assert.equal(await suggestions().count(), 12);
        await input().fill("boligrafo modelo 39");
        await page.waitForFunction(() => document.querySelectorAll('[data-pos-suggestion]').length === 0);
        await query("bolígrafo modelo 39"); assert.equal(await suggestions().count(), 1);
      });
      await context.close(); continue;
    }

    await check("all 40 accented and unaccented matches are reachable in two compact pages", async () => {
      await start();
      for (const text of ["boligrafo", "BOLÍGRAFO"]) {
        await query(text); await waitForCount("40 coincidencias");
        assert.equal(await suggestions().count(), 20);
        assert.equal(await previous().isDisabled(), true);
        const first = await ids();
        await activate(next()); await waitForCount("21");
        const second = await ids();
        assert.equal(await suggestions().count(), 20);
        assert.equal(await next().isDisabled(), true);
        assert.deepEqual([...new Set([...first, ...second])].sort(), penIds);
        await activate(previous()); await waitForCount("1–20");
        assert.deepEqual(await ids(), first);
      }
      const box = await page.locator(".sigo-pos-results").boundingBox();
      assert.ok(box.height <= 160, `Search list too tall: ${box.height}`);
      await page.screenshot({ path: path.join(artifacts, `${device}-40-results.png`), fullPage: true });
    });
    await check("touch/click selects product 40 beyond the original cutoff and clears search", async () => {
      await start(); await query("boligrafo"); await activate(next());
      await activate(page.locator('[data-pos-suggestion][data-product-id="pen-40"]'));
      await rows().first().waitFor();
      assert.match(await rows().innerText(), /modelo 40/);
      assert.equal(await input().inputValue(), "");
      assert.equal(await suggestions().count(), 0);
      assert.equal(await rows().count(), 1);
    });
    await check("arrows cross pages; PageUp/PageDown/Home/End reach all results and Enter preserves ID", async () => {
      await start(); await query("boligrafo");
      for (let i = 0; i < 19; i++) await input().press("ArrowDown");
      assert.equal(await activeId(), "pen-20");
      await input().press("ArrowDown"); assert.equal(await activeId(), "pen-21");
      await input().press("ArrowUp"); assert.equal(await activeId(), "pen-20");
      await input().press("Home"); assert.equal(await activeId(), "pen-01");
      await input().press("PageDown"); assert.equal(await activeId(), "pen-21");
      await input().press("PageUp"); assert.equal(await activeId(), "pen-01");
      await input().press("End"); assert.equal(await activeId(), "pen-40");
      await input().press("Enter"); await rows().first().waitFor();
      assert.match(await rows().innerText(), /modelo 40/);
    });
    await check("multiple reordered tokens and query changes reset stale selection", async () => {
      await start(); await query("boligrafo"); await input().press("End");
      await query("FILGO azul boligrafo"); await waitForCount("20 coincidencias");
      assert.deepEqual(await ids(), penIds.filter((_, i) => i % 2 === 0));
      assert.equal(await activeId(), "pen-01");
      await query("boligrafo modelo 39"); assert.deepEqual(await ids(), ["pen-39"]);
      await input().press("Escape");
      await page.waitForFunction(() => document.querySelector('.barcode-entry-row input')?.value === "");
      assert.equal(await suggestions().count(), 0);
      await query("boligrafo modelo 40"); await input().press("Enter");
      await rows().first().waitFor(); assert.match(await rows().innerText(), /modelo 40/);
    });
    await check("exact internal code wins over earlier textual and prefix matches", async () => {
      await start(); await query("BIC-200");
      assert.equal((await ids())[0], "code-exact");
      await input().press("Enter"); await rows().first().waitFor();
      assert.match(await rows().innerText(), /Zeta código exacto/);
    });
    await check("equal product names retain distinct IDs when selecting", async () => {
      await start(); await query("Cuaderno gemelo");
      assert.deepEqual(await ids(), ["same-name-a", "same-name-b"]);
      await input().press("ArrowDown"); await input().press("Enter");
      await rows().first().waitFor(); assert.match(await rows().innerText(), /GEM-B/);
    });
    await check("complete gram product name wins over earlier kilogram substring match", async () => {
      await start(); await query("Sintetico g");
      assert.deepEqual(await ids(), ["unidad-g", "unidad-kg"]);
      assert.equal(await activeId(), "unidad-g");
      await input().press("Enter");
      const form = page.getByRole("form", { name: "Cantidad de Sintetico g", exact: true });
      await form.waitFor();
      assert.match(await form.innerText(), /Precio por g:/);
      const quantity = page.locator("#sigo-cantidad-medida");
      await quantity.fill("750"); await quantity.press("Enter");
      await rows().first().waitFor();
      assert.match(await rows().innerText(), /UNIT-G/);
      assert.match(await rows().innerText(), /750 g/);
      assert.doesNotMatch(await rows().innerText(), /UNIT-KG/);
    });
    await check("large result sets stay bounded and last catalog record is searchable", async () => {
      await start(); await query("articulo catalogo");
      assert.equal(await suggestions().count(), 20);
      assert.match(await counter().innerText(), /4\.948 coincidencias/);
      await input().press("End");
      assert.equal(await activeId(), "catalog-4960");
      assert.ok(await suggestions().count() <= 20);
      await query("boligrafo modelo 40");
      assert.deepEqual(await ids(), ["pen-40"]);
    });
    await check("successive EAN scans keep one product identity and add two units", async () => {
      await start();
      for (let n = 1; n <= 2; n++) {
        await input().pressSequentially("7790000000040", { delay: 2 });
        await input().press("Enter");
        await page.waitForFunction(count => document.querySelector('.sigo-pos-cart tbody tr .sigo-pos-qty strong')?.textContent === `${count} unidad`, n);
        assert.equal(await input().inputValue(), "");
      }
      assert.equal(await rows().count(), 1);
      assert.match(await rows().innerText(), /modelo 40/);
      assert.match(await rows().innerText(), /2 unidad/);
    });
    await check("duplicate scanned EAN remains blocked instead of choosing one product", async () => {
      await start(); await input().pressSequentially("7799999999999", { delay: 2 }); await input().press("Enter");
      await page.getByText("El código está duplicado dentro de esta empresa. Revisá el maestro de productos.", { exact: true }).waitFor();
      assert.equal(await rows().count(), 0);
    });
    await check("stock, price and legacy identity checks remain enforced", async () => {
      for (const [text, message] of [["Producto sin existencias", /no tiene stock disponible/], ["Producto sin precio", /ingresá su precio de venta/], ["Identidad pendiente", /identidad de código pendiente/]]) {
        await start(); await query(text); await input().press("Enter");
        await page.getByRole("alert").filter({ hasText: message }).waitFor();
        assert.equal(await rows().count(), 0);
      }
    });
    await check("kilogram and litre results retain their quantity editors", async () => {
      await start();
      for (const [name, quantity, expected] of [["Queso para pesar", "750", "0,75 kg"], ["Detergente por litro", "1,25", "1,25 l"]]) {
        const before = await rows().count();
        await query(name); await input().press("Enter");
        const editor = page.locator("#sigo-cantidad-medida"); await editor.waitFor();
        assert.equal(await rows().count(), before);
        await editor.fill(quantity); await editor.press("Enter"); await editor.waitFor({ state: "hidden" });
        assert.equal(await rows().count(), before + 1);
        assert.ok((await rows().last().innerText()).includes(expected));
      }
    });
    await check("changing tenant drops prior results and selected ID", async () => {
      await start(); await query("boligrafo"); await input().press("End");
      await page.evaluate(e => __qa.render(e), OTHER);
      await page.waitForFunction(e => __qa.catalogCalls.includes(e), OTHER);
      await query("boligrafo"); await waitForCount("2 coincidencias");
      assert.deepEqual(await ids(), ["other-pen-1", "other-pen-2"]);
      await input().press("Enter"); await rows().first().waitFor();
      assert.match(await rows().innerText(), /otra empresa uno/);
      assert.doesNotMatch(await rows().innerText(), /modelo 40/);
    });
    await context.close();
  }
  assert.deepEqual(network, [], "Unexpected network requests");
  assert.deepEqual(browserErrors, [], "Browser JavaScript errors");
} catch (error) { failure = error; }
finally { await browser?.close(); }
const summary = { status: failure ? "FAIL" : "PASS", baseline, realBrowser: true, syntheticServices: true, catalogSize: 5001, expectedPenMatches: 40, cases, sources, network, browserErrors, error: failure?.stack ?? null, artifacts };
await fs.writeFile(path.join(artifacts, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (failure) throw failure;
