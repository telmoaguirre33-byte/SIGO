// Synthetic browser QA. No authentication, fiscal service, payment, scale or printer.
// CI: node scripts/test-venta-medidas-browser.mjs (after playwright install chromium).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIGO_BROWSER_NODE_MODULES ? path.join(process.env.SIGO_BROWSER_NODE_MODULES, "playwright") : "playwright");
const root = process.cwd();
const origin = "https://sigo-medidas-qa.invalid/";
const artifacts = process.env.MEDIDAS_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "sigo-medidas-browser-"));
await fs.mkdir(artifacts, { recursive: true });
const mocks = {
  "./supabase": `export const supabase = { rpc: async (name, args) => {
    if (name !== 'buscar_producto_codigo_sigo') throw new Error('Unexpected synthetic RPC: '+name);
    if (args.p_empresa_id !== globalThis.__qa.empresaId) throw new Error('Unexpected tenant');
    return {data: globalThis.__qa.products.filter(p => p.codigo_barras === args.p_codigo || p.codigo_interno === args.p_codigo),error:null};
  }, from() { throw new Error('Unexpected database read'); } };`,
  "./clientes": "export const listarClientesSigo = async () => [];",
  "./productos": `export const listarProductosSigo = async () => structuredClone(globalThis.__qa.products);
    export const listarUnidadesProductoSigo = async () => Object.fromEntries(globalThis.__qa.products.map(p => [p.id,p.unidad_medida]));
    export const guardarProductoSigo = async () => {throw new Error('Product writes are prohibited in browser QA');};`,
  "./ofertasProductos": "export const listarOfertasProductos = async () => []; export const ofertaVigente = () => null; export const precioConOferta = (precio, descuento) => Math.round(precio*(1-descuento/100)*100)/100;",
  "./ventas": `export class VentaRechazadaSinCambiosError extends Error {} export const listarVentasRecientesSigo = async () => [];
    export const confirmarVentaSigo = async (input) => {
      globalThis.__qa.confirms.push(structuredClone(input));
      const total = input.items.reduce((sum, i) => sum + Math.round(i.cantidad*globalThis.__qa.products.find(p=>p.id===i.productoId).precio_venta*100),0)/100;
      await new Promise(resolve => setTimeout(resolve, 25));
      return {ventaId: '22222222-2222-4222-8222-222222222222', verificacion: Promise.resolve({totalVerificado:total,integridad:'ok'})};
    };`,
  "./ticketVenta": "export const imprimirTicketVenta = async (...args) => {globalThis.__qa.commonPrints.push(args);};",
};
const built = await build({ stdin: { resolveDir: root, sourcefile: "synthetic-manual-sale.tsx", loader: "tsx", contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import VentaRapidaOperativa from './src/VentaRapidaOperativa';
const empresaId = '11111111-1111-4111-8111-111111111111';
const product = (id,nombre,precio_venta,unidad_medida) => ({id,empresa_id:empresaId,nombre,precio_venta,unidad_medida,stock_actual:5,activo:true,codigo_interno:id,codigo_barras:id,descripcion:null,categoria:null,marca:null,proveedor:null,costo_actual:0,costo_ultima_compra:0,margen_ganancia:null,margen_porcentaje:null,stock_minimo:0,stock_maximo:null});
window.__qa = {empresaId,products:[product('peso-qa','Queso sintético',12000,'kg'),product('micro-qa','Micro sintético',1.99,'kg')],confirms:[],commonPrints:[],fiscalEvents:[],outsideKeys:[],blockedAccess:[]};
window.fetch = async (...args) => {window.__qa.blockedAccess.push(['fetch',String(args[0])]);throw new Error('Network prohibited');};
window.print = () => {window.__qa.blockedAccess.push(['print']);throw new Error('Physical printing prohibited');};
window.open = () => {window.__qa.blockedAccess.push(['open']);throw new Error('External navigation prohibited');};
if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {window.__qa.blockedAccess.push(['camera']);throw new Error('Camera prohibited');};
for (const eventName of ['sigo:arca:venta','sigo:fiscal:caja']) window.addEventListener(eventName,e=>window.__qa.fiscalEvents.push({eventName,detail:e.detail}));
window.addEventListener('keydown',e=>{if(['F9','F10','F11','F12'].includes(e.key))window.__qa.outsideKeys.push(e.key)});
createRoot(document.getElementById('root')).render(<VentaRapidaOperativa empresaId={empresaId} />);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-services", setup(b) {
  b.onResolve({ filter: /^\.\// }, args => mocks[args.path] ? { path: args.path, namespace: "synthetic" } : null);
  b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: root }));
} }] });
const css = (await Promise.all(["src/index.css", "src/caja-ventas.css", "src/barcode-scanner.css"].map(file => fs.readFile(path.join(root, file), "utf8")))).join("\n");
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="root"></div></body></html>`;
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ["--no-sandbox"] });
} catch (error) {
  const summary = { status: "BLOCKED", realBrowser: false, cases: [], artifacts, error: `Chromium did not start: ${error.message}` };
  await fs.writeFile(path.join(artifacts, "summary.json"), JSON.stringify(summary, null, 2));
  console.error(JSON.stringify(summary));
  throw error;
}
const context = await browser.newContext({ viewport: { width: 1100, height: 950 }, serviceWorkers: "block" });
const unexpectedNetwork = [];
await context.route("**/*", async route => {
  if (route.request().url() === origin && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
  unexpectedNetwork.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const browserErrors = [];
page.on("pageerror", error => browserErrors.push(error.message));
const results = [];
async function check(name, run) { await run(); results.push(name); console.log("PASS:", name); }
const rows = () => page.locator(".sigo-pos-cart tbody tr");
const quantity = () => page.locator("#sigo-cantidad-medida");
const search = () => page.locator(".barcode-entry-row input");
async function select(name) {
  await search().fill(name);
  await page.locator("[data-pos-suggestion]").first().waitFor();
  await search().press("Enter");
  await quantity().waitFor();
}
async function add(name, grams) {
  await select(name);
  await quantity().fill(String(grams));
  await quantity().press("Enter");
  await quantity().waitFor({ state: "hidden" });
}
async function state() { return page.evaluate(() => ({ confirms:window.__qa.confirms,commonPrints:window.__qa.commonPrints,fiscalEvents:window.__qa.fiscalEvents,outsideKeys:window.__qa.outsideKeys,blockedAccess:window.__qa.blockedAccess })); }
let failure;
try {
  await page.goto(origin);
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await search().waitFor();
  await check("seleccionar medible mantiene carrito vacío, cantidad vacía y foco automático", async () => {
    await select("Queso");
    assert.equal(await rows().count(), 0);
    assert.equal(await quantity().inputValue(), "");
    assert.equal(await quantity().evaluate(el => document.activeElement === el), true);
    await page.waitForTimeout(50); // Detect queued scanner focus stealing the amount editor.
    assert.equal(await quantity().evaluate(el => document.activeElement === el), true);
  });
  await check("F9/F10/F11/F12 quedan interceptados sólo mientras se ingresa cantidad", async () => {
    for (const key of ["F9","F10","F11","F12"]) await quantity().press(key);
    const s = await state();
    assert.equal(s.confirms.length+s.commonPrints.length+s.fiscalEvents.length+s.outsideKeys.length,0);
    assert.equal(await quantity().count(),1);
  });
  await check("750 gramos muestran .750 kg, precio/kg y subtotal 9000 antes de Enter", async () => {
    await quantity().fill("750");
    const editor = await page.locator(".sigo-medida-editor").innerText();
    assert.match(editor,/0,75 kg/);
    assert.match(editor,/Precio por kg:.*12\.000/);
    assert.match(editor,/Subtotal:.*9\.000/);
    assert.equal(await rows().count(),0);
    await page.screenshot({ path:path.join(artifacts,"peso-750g-desktop.png"),fullPage:true });
  });
  await check("Enter repetido agrega una sola fila de .750 kg", async () => {
    await quantity().press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(await rows().count(),1);
    assert.match(await rows().innerText(),/0,75 kg/);
    assert.match(await page.locator(".sigo-pos-total > strong").innerText(),/9\.000/);
  });
  await check("editar cantidad actualiza la misma fila sin duplicar", async () => {
    await page.getByRole("button",{name:"Editar cantidad de Queso sintético"}).click();
    assert.equal(await quantity().inputValue(),"750");
    await quantity().fill("500");
    await quantity().press("Enter");
    assert.equal(await rows().count(),1);
    assert.match(await rows().innerText(),/0,5 kg/);
    assert.match(await page.locator(".sigo-pos-total > strong").innerText(),/6\.000/);
  });
  await check("Escape cancela el agregado sin alterar la fila y devuelve foco al buscador", async () => {
    await select("Queso");
    await quantity().fill("250");
    await quantity().press("Escape");
    await quantity().waitFor({state:"hidden"});
    assert.equal(await rows().count(),1);
    assert.match(await rows().innerText(),/0,5 kg/);
    await page.waitForFunction(()=>document.activeElement === document.querySelector(".barcode-entry-row input"));
  });
  await check("F9 fuera del editor confirma la cantidad y no imprime ni emite fiscal", async () => {
    await page.keyboard.press("F9");
    await page.waitForFunction(()=>window.__qa.confirms.length===1);
    await rows().waitFor({state:"hidden"});
    const s=await state();
    assert.equal(s.confirms[0].items[0].cantidad,.5);
    assert.equal(s.commonPrints.length,0);
    assert.equal(s.fiscalEvents.length,0);
    assert.ok(s.outsideKeys.includes("F9"));
  });
  await check("F10 fuera del editor confirma e invoca sólo el ticket común mockeado", async () => {
    await add("Queso",250);
    await page.keyboard.press("F10");
    await page.waitForFunction(()=>window.__qa.confirms.length===2 && window.__qa.commonPrints.length===1);
    await rows().waitFor({state:"hidden"});
    const s=await state();
    assert.equal(s.confirms[1].items[0].cantidad,.25);
    assert.equal(s.fiscalEvents.length,0);
    assert.ok(s.outsideKeys.includes("F10"));
  });
  await check("tres entradas de 1g se consolidan en .003kg y total .01", async () => {
    for(let i=0;i<3;i++) await add("Micro",1);
    assert.equal(await rows().count(),1);
    assert.match(await rows().innerText(),/0,003 kg/);
    assert.match(await page.locator(".sigo-pos-total > strong").innerText(),/0,01/);
    await page.keyboard.press("F9");
    await page.waitForFunction(()=>window.__qa.confirms.length===3);
    await rows().waitFor({state:"hidden"});
    assert.equal((await state()).confirms[2].items[0].cantidad,.003);
  });
  await check("editor móvil conserva entrada vacía, presets visibles y sin venta accidental", async () => {
    await page.setViewportSize({width:390,height:844});
    await select("Queso");
    assert.equal(await quantity().inputValue(),"");
    await page.getByRole("button",{name:"750 g",exact:true}).click();
    assert.equal(await quantity().inputValue(),"750");
    const box=await page.locator(".sigo-medida-editor").boundingBox();
    assert.ok(box.x>=-1 && box.x+box.width<=391,"Editor must fit mobile width");
    await page.screenshot({path:path.join(artifacts,"peso-750g-mobile.png"),fullPage:true});
    await quantity().press("Escape");
    assert.equal(await rows().count(),0);
    assert.equal((await state()).confirms.length,3);
  });
  await check("payload conserva unidad esperada para no reinterpretar cambios concurrentes",async()=>{
    for(const confirmation of (await state()).confirms) assert.equal(confirmation.items[0].unidadMedida,"kg");
  });
  assert.deepEqual(unexpectedNetwork,[]);
  assert.deepEqual((await state()).blockedAccess,[]);
  assert.deepEqual(browserErrors,[]);
} catch (error) {
  failure=error;
  await page.screenshot({path:path.join(artifacts,"failure.png"),fullPage:true}).catch(()=>{});
} finally {
  const summary={status:failure?"FAIL":"PASS",realBrowser:true,syntheticOnly:true,physicalPrinterValidated:false,networkRequestsAllowed:[origin],unexpectedNetwork,browserErrors,cases:results,artifacts,error:failure?.message};
  await fs.writeFile(path.join(artifacts,"summary.json"),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
  await browser.close();
}
if(failure) throw failure;
