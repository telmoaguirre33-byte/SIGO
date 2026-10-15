import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
const empresaId = "00000000-0000-4000-8000-000000000001", ventaId = "00000000-0000-4000-8000-000000000099";
async function harness(options = {}) {
  const calls = [];
  const context = vm.createContext({ console, Response, URL, AbortController, setTimeout, clearTimeout,
    process: { env: { SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture" } },
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes("/auth/v1/user")) return new Response("{}", { status: options.deny ? 403 : 200 });
      if (url.includes("/rpc/tiene_permiso_empresa")) return Response.json(!options.deny);
      if (url.includes("/rest/v1/arca_config")) return Response.json([{ ambiente: "produccion", cuit_emisor: "20123456789", razon_social: "QA" }]);
      if (url.includes("/rest/v1/arca_comprobantes")) return Response.json([{ id: "receipt", empresa_id: empresaId, venta_id: ventaId, cae: "12345678901234", cae_vencimiento: "2026-10-25", resultado: "A", punto_venta: 1, tipo_cbte: 11, numero_cbte: 42 }]);
      if (url.includes("/rest/v1/ventas_sigo")) return Response.json([{ id: ventaId, total: 250, estado: "confirmada", anulada_at: null }]);
      const body = JSON.parse(init.body || "{}");
      assert.equal(body.action, "FECompConsultar", "La recuperación nunca debe solicitar CAE ni reservar numeración");
      return Response.json({ ok: true, body: `<ResultGet><Resultado>A</Resultado><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20261025</FchVto><CbteFch>${options.oldDate ? "20260901" : "20261015"}</CbteFch><ImpTotal>${options.mismatch ? 251 : 250}</ImpTotal><DocTipo>99</DocTipo><DocNro>0</DocNro><MonId>PES</MonId><MonCotiz>1</MonCotiz></ResultGet>` });
    } });
  const extraer = (xml, tag) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml)?.[1] || "";
  const values = { WSFE: { produccion: "fake", homologacion: "fake" }, WSAA: {}, escapeXml: String, decodeXml: String,
    extraer, extraerErroresWsfe: () => [], leerTicketWsaa: async () => options.expired ? null : ({ token: "fixture", sign: "fixture" }),
    descargarSecreto() { throw new Error("Secret read forbidden"); }, autenticarWsaa() { throw new Error("Refresh forbidden in read test"); }, guardarTicketWsaa() { throw new Error("Write forbidden"); } };
  const wsaa = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  const cae = new vm.SourceTextModule(fs.readFileSync("api/arca/cae-v2.js", "utf8"), { context });
  await cae.link(async () => wsaa);
  const module = new vm.SourceTextModule(fs.readFileSync("api/arca/comprobante.js", "utf8"), { context });
  await module.link(async (name) => name.includes("cae-v2") ? cae : wsaa);
  await module.evaluate();
  async function run(method = "GET", query = { empresaId, ventaId }) {
    let status, body;
    const res = { setHeader() { return this; }, status(code) { status = code; return this; }, send(text) { body = JSON.parse(text); return this; } };
    await module.namespace.default({ method, query, headers: { authorization: "Bearer fixture" } }, res);
    return { status, body, calls };
  }
  return run;
}
test("recupera CAE y QR originales con fecha histórica, sin emisión ni escrituras", async () => {
  const run = await harness({ oldDate: true }); const result = await run();
  assert.equal(result.status, 200); assert.equal(result.body.qr.fecha, "2026-09-01"); assert.equal(result.body.qr.importe, 250);
  assert.equal(result.body.qr.codAut, 12345678901234);
  assert.ok(!result.calls.some(c => ["PATCH", "PUT", "DELETE"].includes(c.init.method)));
  assert.equal(result.calls.filter(c => c.url.includes("/wsfe")).length, 1);
});
test("repetir recuperación conserva el original; nunca genera venta o nueva factura", async () => {
  const run = await harness(); const a = await run(), b = await run();
  assert.deepEqual(a.body, b.body); assert.ok(!a.calls.some(c => /FECAESolicitar|FECompUltimoAutorizado/.test(c.init.body || "")));
});
for (const [label, options, status] of [["sin permiso", { deny: true }, 403], ["total distinto", { mismatch: true }, 409], ["ticket vencido", { expired: true }, 409]]) {
  test(`recuperación segura: ${label}`, async () => { const run = await harness(options); assert.equal((await run()).status, status); });
}
test("rechaza método de escritura e identidad inválida antes de contactar servicios", async () => {
  const run = await harness(); assert.equal((await run("POST")).status, 405);
  const r = await run("GET", { empresaId: "bad", ventaId }); assert.equal(r.status, 400); assert.equal(r.calls.length, 0);
});
