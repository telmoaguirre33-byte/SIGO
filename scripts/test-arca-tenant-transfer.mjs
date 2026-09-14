import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

process.env.SUPABASE_URL = "https://sigo-test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";

const sourceId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const cuit = "30712345678";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sigo-arca-transfer-"));
const certPath = path.join(temp, "certificate.pem");
const keyPath = path.join(temp, "private-key.pem");
const openssl = spawnSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2",
  "-subj", `/CN=SIGO Test/serialNumber=${cuit}`,
  "-keyout", keyPath,
  "-out", certPath,
], { encoding: "utf8" });
if (openssl.status !== 0) throw new Error(`OpenSSL test fixture failed: ${openssl.stderr}`);
const certificatePem = fs.readFileSync(certPath, "utf8");
const privateKeyPem = fs.readFileSync(keyPath, "utf8");

const { default: handler } = await import("../api/arca/transfer.js");

function response(status, payload, contentType = "application/json") {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = String(value); return this; },
  };
}

async function run({ targetConfigured = false } = {}) {
  const writes = [];
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    const method = init.method || "GET";
    if (value.endsWith("/auth/v1/user")) return response(200, { id: "user" });
    if (value.endsWith("/rest/v1/rpc/tiene_permiso_empresa")) return response(200, true);
    if (value.includes(`/rest/v1/arca_config?empresa_id=eq.${sourceId}`)) {
      return response(200, [{
        empresa_id: sourceId,
        ambiente: "produccion",
        cuit_emisor: cuit,
        razon_social: "SIGO Test",
        certificado_ref: `storage://arca-secrets/${sourceId}/certificate.pem`,
        certificado_fingerprint: "old",
        certificado_vence: new Date(Date.now() + 86_400_000).toISOString(),
        wsaa_service: "wsfe",
        wsfe_version: "WSFEv1",
      }]);
    }
    if (value.includes(`/rest/v1/arca_config?empresa_id=eq.${targetId}`)) {
      return response(200, targetConfigured ? [{ empresa_id: targetId, certificado_ref: "storage://existing" }] : []);
    }
    if (value.includes(`/storage/v1/object/authenticated/arca-secrets/${sourceId}/certificate.pem`)) {
      return response(200, certificatePem, "application/x-pem-file");
    }
    if (value.includes(`/storage/v1/object/authenticated/arca-secrets/${sourceId}/private-key.pem`)) {
      return response(200, privateKeyPem, "application/x-pem-file");
    }
    if (value.includes(`/rest/v1/arca_puntos_venta?empresa_id=eq.${sourceId}`)) {
      return response(200, [{ numero: 13, nombre: "Casa central", ambiente: "produccion", activo: true }]);
    }
    if (method === "POST" && value.includes(`/storage/v1/object/arca-secrets/${targetId}/`)) {
      writes.push({ kind: "secret", url: value, body: String(init.body || "") });
      return response(200, { Key: value });
    }
    if (method === "POST" && value.includes("/rest/v1/arca_config?on_conflict=empresa_id")) {
      writes.push({ kind: "config", body: JSON.parse(String(init.body)) });
      return response(201, [JSON.parse(String(init.body))]);
    }
    if (method === "POST" && value.includes("/rest/v1/arca_puntos_venta?on_conflict=")) {
      writes.push({ kind: "puntos", body: JSON.parse(String(init.body)) });
      return response(201, []);
    }
    throw new Error(`Unexpected mock request: ${method} ${value}`);
  };

  const req = {
    method: "POST",
    headers: { authorization: "Bearer test-user-token" },
    body: { origenEmpresaId: sourceId, destinoEmpresaId: targetId },
  };
  const res = makeRes();
  await handler(req, res);
  return { res, writes };
}

try {
  const success = await run();
  assert.equal(success.res.statusCode, 200);
  const payload = JSON.parse(success.res.body);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.puntosVenta, [13]);
  assert.equal(success.res.body.includes("PRIVATE KEY"), false);
  assert.equal(success.res.body.includes(certificatePem.slice(0, 30)), false);
  assert.equal(success.writes.filter((item) => item.kind === "secret").length, 2);
  const configWrite = success.writes.find((item) => item.kind === "config")?.body;
  assert.equal(configWrite.empresa_id, targetId);
  assert.equal(configWrite.activo, false);
  assert.equal(configWrite.ultima_prueba_ok, false);
  assert.equal(configWrite.cuit_emisor, cuit);
  assert.equal(success.writes.find((item) => item.kind === "puntos")?.body[0].numero, 13);

  const protectedTarget = await run({ targetConfigured: true });
  assert.equal(protectedTarget.res.statusCode, 409);
  assert.equal(JSON.parse(protectedTarget.res.body).error, "ARCA_TARGET_ALREADY_CONFIGURED");
  assert.equal(protectedTarget.writes.length, 0);

  console.log("SIGO_ARCA_TENANT_TRANSFER_INTEGRATION_OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
