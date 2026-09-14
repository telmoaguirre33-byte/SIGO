import assert from "node:assert/strict";
import { detalleFiscal, solicitarCae, consultarComprobante, ultimoAutorizado } from "../api/arca/cae.js";

const originalFetch = global.fetch;
const calls = [];
global.fetch = async (_url, init) => {
  calls.push(init);
  const action = String(init?.headers?.SOAPAction || "");
  if (action.endsWith("/FECompUltimoAutorizado")) {
    return new Response('<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>13</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>', { status: 200 });
  }
  if (action.endsWith("/FECompConsultar")) {
    return new Response('<FECompConsultarResponse><FECompConsultarResult><ResultGet><Resultado>A</Resultado><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20260924</FchVto><PtoVta>13</PtoVta><CbteTipo>6</CbteTipo></ResultGet></FECompConsultarResult></FECompConsultarResponse>', { status: 200 });
  }
  if (action.endsWith("/FECAESolicitar")) {
    return new Response('<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20260924</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>', { status: 200 });
  }
  throw new Error(`Unexpected SOAP action: ${action}`);
};

try {
  const ticket = { token: "token-prueba", sign: "firma-prueba" };
  const last = await ultimoAutorizado("https://example.test/wsfe", ticket, "20123456789", 13, 6);
  assert.equal(last, 41);

  const fiscal = detalleFiscal(6, 121, [{ producto_id: "p1", subtotal: 121 }], new Map([
    ["p1", { iva_alicuota_id: 5, iva_tasa: 21, precio_incluye_iva: true }],
  ]));
  assert.deepEqual({ total: fiscal.impTotal, neto: fiscal.impNeto, iva: fiscal.impIva }, { total: 121, neto: 100, iva: 21 });

  const issued = await solicitarCae("https://example.test/wsfe", ticket, "20123456789", {
    puntoVenta: 13,
    tipoCbte: 6,
    numeroCbte: 42,
    receptor: { docTipo: 99, docNro: "0", condicionIvaReceptorId: 5 },
    fiscal,
  });
  assert.equal(issued.cae, "12345678901234");
  assert.equal(issued.caeVencimiento, "2026-09-24");

  const recovered = await consultarComprobante("https://example.test/wsfe", ticket, "20123456789", 13, 6, 42);
  assert.equal(recovered?.cae, "12345678901234");
  assert.match(String(calls.find((call) => String(call.headers.SOAPAction).endsWith("/FECAESolicitar"))?.body), /<ar:CbteDesde>42<\/ar:CbteDesde>/);
  assert.match(String(calls.find((call) => String(call.headers.SOAPAction).endsWith("/FECAESolicitar"))?.body), /<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/);
  console.log("SIGO_ARCA_CAE_PROTOCOL_MOCK_OK");
} finally {
  global.fetch = originalFetch;
}
