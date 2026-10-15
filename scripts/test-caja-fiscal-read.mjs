import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
const empresaId = "00000000-0000-4000-8000-000000000001", ventaId = "00000000-0000-4000-8000-000000000099";
async function harness(options = {}) {
  const calls = [];
  let saveFailures = options.failSave ? 1 : 0;
  const receipts = options.emit ? [] : [{ id: "receipt", empresa_id: empresaId, venta_id: ventaId, cae: "12345678901234", cae_vencimiento: "2026-10-25", resultado: "A", punto_venta: 1, tipo_cbte: 11, numero_cbte: 42 }];
  const context = vm.createContext({ console, Response, URL, AbortController, setTimeout, clearTimeout,
    process: { env: { SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture" } },
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes("/auth/v1/user")) return new Response("{}", { status: options.deny ? 403 : 200 });
      if (url.includes("/rpc/tiene_permiso_empresa")) return Response.json(!options.deny);
      if (url.includes("/rest/v1/arca_config")) return Response.json([{ ambiente: "produccion", cuit_emisor: "20123456789", razon_social: "QA",
        activo: true, ultima_prueba_ok: true, wsaa_service: "wsfe", wsfe_version: "WSFEv1", certificado_ref: "fixture", certificado_vence: "2030-01-01" }]);
      if (url.includes("/rest/v1/arca_comprobantes")) {
        if (init.method === "POST") receipts.push({ id: "receipt", cae: null, ...JSON.parse(init.body) });
        if (init.method === "PATCH") {
          if (saveFailures-- > 0 || options.alwaysFailSave) return Response.json({ error: "simulated CAE persistence failure" }, { status: 500 });
          if (!url.includes("cae=is.null") || !receipts[0].cae) Object.assign(receipts[0], JSON.parse(init.body));
        }
        return Response.json(receipts);
      }
      if (url.includes("/rest/v1/ventas_sigo")) return Response.json([{ id: ventaId, total: 250, estado: "confirmada", anulada_at: null }]);
      if (url.includes("/rest/v1/venta_items_sigo")) return Response.json([{ producto_id: "00000000-0000-4000-8000-000000000011", subtotal: 250 }]);
      if (url.includes("/rest/v1/arca_puntos_venta")) return Response.json([{ id: "point" }]);
      const body = JSON.parse(init.body || "{}");
      if (options.emit && body.action === "FECompUltimoAutorizado") return Response.json({ ok: true, body: "<CbteNro>41</CbteNro>" });
      if (options.emit && body.action === "FECAESolicitar") return Response.json({ ok: true, body: "<FECAEDetResponse><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20261025</CAEFchVto></FECAEDetResponse>" });
      assert.equal(body.action, "FECompConsultar", "La recuperación nunca debe solicitar CAE ni reservar numeración");
      if (options.notFound) return Response.json({ ok: true, body: "<ResultGet/>" });
      return Response.json({ ok: true, body: `<ResultGet><Resultado>A</Resultado><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20261025</FchVto><CbteFch>${options.oldDate ? "20260901" : "20261015"}</CbteFch><ImpTotal>${options.mismatch ? 251 : 250}</ImpTotal><ImpNeto>250</ImpNeto><ImpIVA>0</ImpIVA><ImpOpEx>0</ImpOpEx><ImpTotConc>0</ImpTotConc><ImpTrib>0</ImpTrib><DocTipo>99</DocTipo><DocNro>0</DocNro><MonId>PES</MonId><MonCotiz>1</MonCotiz></ResultGet>` });
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
  run.issue = async (confirmacion = "EMITIR_CAE_PRODUCCION") => {
    let status, body;
    const res = { setHeader() { return this; }, status(code) { status = code; return this; }, send(text) { body = JSON.parse(text); return this; } };
    await cae.namespace.default({ method: "POST", headers: { authorization: "Bearer fixture" },
      body: { empresaId, ventaId, puntoVenta: 1, tipoCbte: 11, condicionIvaReceptorId: 5, confirmacion } }, res);
    return { status, body, calls, receipts };
  };
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
  const run = await harness(); assert.equal((await run("DELETE")).status, 405);
  const r = await run("GET", { empresaId: "bad", ventaId }); assert.equal(r.status, 400); assert.equal(r.calls.length, 0);
});
test("endpoint CAE real con WSFE simulado: emite una vez, recupera y reimprime sin nuevas ventas/stock", async () => {
  const run = await harness({ emit: true });
  const first = await run.issue(); assert.equal(first.status, 200); assert.equal(first.body.alreadyIssued, false);
  const repeated = await run.issue(); assert.equal(repeated.status, 200); assert.equal(repeated.body.alreadyIssued, true);
  const original = await run(); assert.equal(original.status, 200); assert.equal(original.body.comprobante.cae, first.body.comprobante.cae);
  assert.equal(repeated.receipts.length, 1);
  assert.equal(repeated.calls.filter(c => JSON.parse(c.init.body || "{}").action === "FECAESolicitar").length, 1);
  assert.ok(!repeated.calls.some(c => /\/(ventas_sigo|venta_items_sigo|productos|stock)/.test(c.url) && ["POST", "PATCH", "DELETE"].includes(c.init.method)));
});
test("endpoint CAE rechaza emisión sin la confirmación fiscal necesaria", async () => {
  const run = await harness({ emit: true }); const result = await run.issue("NO_CONFIRMADO");
  assert.equal(result.status, 409); assert.equal(result.receipts.length, 0);
  assert.ok(!result.calls.some(c => JSON.parse(c.init.body || "{}").action === "FECAESolicitar"));
});

test("ARCA autoriza y falla guardar CAE: bloquea lectura/emisión y concilia el mismo original una sola vez", async () => {
  const run = await harness({ emit: true, failSave: true });
  const first = await run.issue(); assert.equal(first.status, 502); assert.equal(first.receipts.length, 1);
  assert.equal(first.receipts[0].cae, null); assert.equal(first.receipts[0].numero_cbte, 42);
  const pending = await run(); assert.equal(pending.status, 409); assert.equal(pending.body.error, "ARCA_FISCAL_RECONCILIATION_PENDING");
  const retryIssue = await run.issue(); assert.equal(retryIssue.status, 409); assert.equal(retryIssue.body.error, "ARCA_FISCAL_RECONCILIATION_PENDING");
  const recovered = await run("POST"); assert.equal(recovered.status, 200);
  assert.equal(recovered.body.comprobante.cae, "12345678901234"); assert.equal(recovered.body.comprobante.numero_cbte, 42);
  const repeated = await run("POST"); assert.equal(repeated.status, 200); assert.deepEqual(repeated.body, recovered.body);
  assert.equal(first.receipts.length, 1);
  assert.equal(first.calls.filter(c => JSON.parse(c.init.body || "{}").action === "FECAESolicitar").length, 1);
  assert.equal(first.calls.filter(c => c.url.includes("/arca_comprobantes") && c.init.method === "POST").length, 1);
  const updates = first.calls.filter(c => c.init.method === "PATCH" && c.url.includes("cae=is.null"));
  assert.equal(updates.length, 1); assert.ok(updates[0].url.includes(`empresa_id=eq.${empresaId}&venta_id=eq.${ventaId}`));
  assert.ok(!first.calls.some(c => /\/(ventas_sigo|venta_items_sigo|productos|stock)/.test(c.url) && ["POST", "PATCH", "DELETE"].includes(c.init.method)));
});
for (const [label, options] of [["ARCA no devuelve el original", { notFound: true }], ["persiste el fallo de guardado", { alwaysFailSave: true }], ["total original distinto", { mismatch: true }]]) {
  test(`reserva incierta permanece bloqueada: ${label}`, async () => {
    const run = await harness({ emit: true, failSave: true, ...options });
    const first = await run.issue(); assert.equal(first.receipts[0].cae, null);
    const recovery = await run("POST"); assert.equal(recovery.body.error, "ARCA_FISCAL_RECONCILIATION_PENDING");
    assert.equal(first.receipts[0].cae, null); assert.equal((await run.issue()).status, 409);
    assert.equal(first.calls.filter(c => JSON.parse(c.init.body || "{}").action === "FECAESolicitar").length, 1);
  });
}
