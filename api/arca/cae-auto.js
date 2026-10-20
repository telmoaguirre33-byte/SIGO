import caeV2Handler from "./cae-v2.js";
import wsaaV2Handler from "./wsaa-v2.js";

function captureResponse() {
  let statusCode = 200;
  let body = null;
  const headers = new Map();

  const res = {
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return res;
    },
    status(code) {
      statusCode = Number(code) || 200;
      return res;
    },
    send(value) {
      if (typeof value === "string") {
        try { body = JSON.parse(value); }
        catch { body = value; }
      } else {
        body = value;
      }
      return res;
    },
  };

  return {
    res,
    result() { return { statusCode, body, headers }; },
  };
}

async function runHandler(handler, req) {
  const capture = captureResponse();
  await handler(req, capture.res);
  return capture.result();
}

function sendCaptured(res, captured) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(captured.statusCode || 500)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(captured.body ?? { error: "ARCA_EMPTY_RESPONSE" }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json ? res.status(405).json({ error: "METHOD_NOT_ALLOWED" }) : res.status(405).send(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
  }

  const originalBody = req.body && typeof req.body === "object" ? { ...req.body } : {};
  const first = await runHandler(caeV2Handler, { ...req, body: originalBody });
  const firstError = first.body && typeof first.body === "object" ? String(first.body.error || "") : "";

  if (first.statusCode !== 409 || firstError !== "ARCA_TICKET_REFRESH_REQUIRED") {
    return sendCaptured(res, first);
  }

  // El TA venció: SIGO intenta renovarlo automáticamente con el certificado ya vinculado.
  // wsaa-v2 mantiene las mismas barreras de permisos y nunca expone token, sign ni clave privada.
  const empresaId = String(originalBody.empresaId || "").trim();
  const refresh = await runHandler(wsaaV2Handler, { ...req, body: { empresaId } });
  const refreshOk = refresh.statusCode >= 200 && refresh.statusCode < 300 && refresh.body && typeof refresh.body === "object" && refresh.body.ok === true;

  if (!refreshOk) {
    const refreshError = refresh.body && typeof refresh.body === "object" ? String(refresh.body.error || "ARCA_TICKET_AUTO_REFRESH_FAILED") : "ARCA_TICKET_AUTO_REFRESH_FAILED";
    return sendCaptured(res, {
      statusCode: refresh.statusCode === 401 || refresh.statusCode === 403 ? refresh.statusCode : 409,
      body: {
        error: "ARCA_TICKET_AUTO_REFRESH_FAILED",
        refreshError,
        message: "SIGO no pudo renovar automáticamente la autorización fiscal.",
      },
      headers: new Map(),
    });
  }

  const second = await runHandler(caeV2Handler, { ...req, body: originalBody });
  return sendCaptured(res, second);
}
