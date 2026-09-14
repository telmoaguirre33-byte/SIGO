import http from "node:http";
import https from "node:https";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || "");
const MAX_BODY = 2_500_000;
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

const ENDPOINTS = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

const ACTIONS = new Set([
  "FEDummy",
  "FEParamGetPtosVenta",
  "FECompUltimoAutorizado",
  "FECompConsultar",
  "FECAESolicitar",
]);

const FEDUMMY_SOAP = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>`;

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  });
  res.end(JSON.stringify(payload));
}

async function validarUsuario(authorization) {
  if (!SUPABASE_URL || !authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;

  if (JWKS) {
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `${SUPABASE_URL}/auth/v1`,
        audience: "authenticated",
      });
      if (payload?.sub) return true;
    } catch {
      // Algunos proyectos Supabase heredados todavía usan validación vía Auth API.
    }
  }

  if (!SUPABASE_ANON_KEY) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization },
  }).catch(() => null);
  return Boolean(response?.ok);
}

function leerJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function soapActionUrl(action) {
  return `http://ar.gov.afip.dif.FEV1/${action}`;
}

function postWsfe(endpoint, action, soap, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint);
    let settled = false;
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      family: 4,
      agent: false,
      timeout: timeoutMs,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(soap),
        SOAPAction: soapActionUrl(action),
        Connection: "close",
        "User-Agent": "SIGO-ARCA-Bridge/1.2",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length <= MAX_BODY) body += chunk;
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status: Number(response.statusCode || 0), body });
      });
    });
    request.on("timeout", () => request.destroy(new Error("WSFE_TIMEOUT")));
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.end(soap);
  });
}

async function healthWsfe() {
  try {
    const result = await postWsfe(ENDPOINTS.produccion, "FEDummy", FEDUMMY_SOAP, 10000);
    const ok = result.status >= 200 && result.status < 300 && /FEDummyResult|AppServer|DbServer|AuthServer/i.test(result.body);
    return { ok, status: result.status };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.code || error?.message || "NETWORK_ERROR").slice(0, 120) };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, {
      ok: true,
      service: "sigo-arca-bridge",
      auth: SUPABASE_URL ? "configured" : "missing",
    });
  }

  if (req.method === "GET" && req.url === "/health/wsfe") {
    const status = await healthWsfe();
    return json(res, status.ok ? 200 : 502, { ...status, service: "wsfev1", transport: "railway-ipv4" });
  }

  if (req.method !== "POST" || req.url !== "/wsfe") {
    return json(res, 404, { error: "NOT_FOUND" });
  }

  const authorization = String(req.headers.authorization || "");
  if (!(await validarUsuario(authorization))) return json(res, 401, { error: "UNAUTHORIZED" });

  let input;
  try {
    input = await leerJson(req);
  } catch (error) {
    return json(res, error?.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, { error: error?.message || "BAD_REQUEST" });
  }

  const ambiente = String(input?.ambiente || "");
  const action = String(input?.action || "");
  const soap = String(input?.soap || "");
  if (!ENDPOINTS[ambiente]) return json(res, 400, { error: "AMBIENTE_INVALIDO" });
  if (!ACTIONS.has(action)) return json(res, 400, { error: "ACTION_NOT_ALLOWED" });
  if (!soap.startsWith("<?xml") || soap.length > MAX_BODY) return json(res, 400, { error: "SOAP_INVALID" });

  try {
    const result = await postWsfe(ENDPOINTS[ambiente], action, soap);
    return json(res, 200, {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      body: result.body,
      transport: "railway-ipv4-relay",
    });
  } catch (error) {
    return json(res, 502, {
      ok: false,
      error: "WSFE_BRIDGE_NETWORK_FAILED",
      detail: String(error?.code || error?.message || "NETWORK_ERROR").slice(0, 120),
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SIGO ARCA bridge listening on ${PORT}`);
});
