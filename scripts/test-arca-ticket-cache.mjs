import assert from "node:assert/strict";
import { guardarTicketWsaa, leerTicketWsaa, normalizarTicketGuardado } from "../api/arca/wsaa.js";

const empresaId = "11111111-1111-4111-8111-111111111111";
const cuit = "30712345678";
const ambiente = "produccion";
const ahora = Date.now();
const ticket = {
  token: "token-wsaa-prueba",
  sign: "firma-wsaa-prueba",
  generationTime: new Date(ahora - 60_000).toISOString(),
  expirationTime: new Date(ahora + 60 * 60_000).toISOString(),
};
const sesion = { url: "https://sigo-test.supabase.co", anonKey: "anon", auth: "Bearer user" };
let privatePayload = "";

const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const value = String(url);
  if (!value.includes(`${empresaId}/ticket-wsfe-produccion.json`)) throw new Error(`Unexpected ticket path: ${value}`);
  if ((init.method || "GET") === "POST") {
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.headers["x-upsert"], "true");
    privatePayload = String(init.body || "");
    return new Response("{}", { status: 200 });
  }
  return new Response(privatePayload, { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  assert.equal(normalizarTicketGuardado({ ...ticket, version: 1, service: "wsfe", ambiente, cuit }, ambiente, cuit)?.token, ticket.token);
  assert.equal(normalizarTicketGuardado({ ...ticket, version: 1, service: "wsfe", ambiente, cuit, expirationTime: new Date(ahora - 1).toISOString() }, ambiente, cuit), null);
  assert.equal(normalizarTicketGuardado({ ...ticket, version: 1, service: "wsfe", ambiente: "homologacion", cuit }, ambiente, cuit), null);

  await guardarTicketWsaa(sesion, empresaId, ambiente, cuit, ticket);
  assert.equal(privatePayload.includes(ticket.token), true);
  const recovered = await leerTicketWsaa(sesion, empresaId, ambiente, cuit);
  assert.deepEqual(recovered, ticket);
  assert.equal(await leerTicketWsaa(sesion, empresaId, ambiente, "20123456789"), null);
  console.log("SIGO_ARCA_WSAA_PRIVATE_TICKET_CACHE_OK");
} finally {
  global.fetch = originalFetch;
}
