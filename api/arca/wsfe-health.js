import https from "node:https";

const SOAP = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" /></soap:Body></soap:Envelope>`;

function probe() {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request({
      protocol: "https:",
      hostname: "servicios1.afip.gov.ar",
      port: 443,
      path: "/wsfev1/service.asmx",
      method: "POST",
      family: 4,
      agent: false,
      timeout: 10000,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(SOAP),
        SOAPAction: "http://ar.gov.afip.dif.FEV1/FEDummy",
        Connection: "close",
        "User-Agent": "SIGO-WSFEv1-Health/1.0",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 12000) body += chunk; });
      response.on("end", () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300 && /FEDummyResult|AppServer|DbServer|AuthServer/i.test(body),
        status: response.statusCode || 0,
        ms: Date.now() - started,
        protocol: "https.request-ipv4",
      }));
    });
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", (error) => resolve({
      ok: false,
      status: 0,
      ms: Date.now() - started,
      protocol: "https.request-ipv4",
      error: String(error?.code || error?.message || "NETWORK_ERROR").slice(0, 120),
    }));
    req.end(SOAP);
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const result = await probe();
  return res.status(result.ok ? 200 : 502).json(result);
}
