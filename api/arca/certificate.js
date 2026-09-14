import { X509Certificate, createPrivateKey, randomBytes, sign, verify } from "node:crypto";

const MAX_BASE64_CHARS = 350_000;
const BUCKET = "arca-secrets";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
}

function empresaValida(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function normalizarCuit(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 ? digits : "";
}

function extraerCuitCertificado(subject) {
  const texto = String(subject || "");
  const serial = texto.match(/(?:^|[\n,\/])\s*(?:serialNumber|2\.5\.4\.5)\s*=\s*(?:CUIT\s*)?([0-9]{11})(?=$|[\n,\/])/i);
  return serial?.[1] || "";
}

async function rpcPermitido(url, anonKey, auth, empresaId, permiso) {
  const response = await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: permiso }),
  });
  if (!response.ok) return false;
  return (await response.json().catch(() => false)) === true;
}

async function validarUsuario(req, empresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!userResponse.ok) return null;
  if (!(await rpcPermitido(url, anonKey, auth, empresaId, "arca.configure"))) return null;
  return { url, anonKey, auth };
}

function decodificarPem(base64, tipo) {
  const raw = String(base64 || "").trim();
  if (!raw || raw.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    throw new Error(`${tipo}_INVALIDO`);
  }
  const pem = Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8").trim();
  if (!pem || pem.length > 262_144) throw new Error(`${tipo}_INVALIDO`);
  return `${pem}\n`;
}

async function leerConfig(sesion, empresaId) {
  const response = await fetch(
    `${sesion.url}/rest/v1/arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=empresa_id,cuit_emisor,ambiente,activo`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth, Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("CONFIG_READ_FAILED");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function subirObjetoPrivado(sesion, empresaId, fileName, content, contentType = "application/x-pem-file") {
  const path = `${empresaId}/${fileName}`;
  const response = await fetch(
    `${sesion.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(empresaId)}/${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: {
        apikey: sesion.anonKey,
        Authorization: sesion.auth,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: content,
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`STORAGE_UPLOAD_FAILED:${fileName}:${response.status}:${detail.slice(0, 120)}`);
  }
  return `storage://${BUCKET}/${path}`;
}

async function invalidarTicketsWsaa(sesion, empresaId) {
  await Promise.all(["homologacion", "produccion"].map((ambiente) =>
    subirObjetoPrivado(
      sesion,
      empresaId,
      `ticket-wsfe-${ambiente}.json`,
      JSON.stringify({ version: 0, invalidatedAt: new Date().toISOString() }),
      "application/json",
    ),
  ));
}

async function guardarMetadata(sesion, empresaId, metadata) {
  const response = await fetch(
    `${sesion.url}/rest/v1/arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: sesion.anonKey,
        Authorization: sesion.auth,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!response.ok) throw new Error(`CONFIG_UPDATE_FAILED:${response.status}`);
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("CONFIG_UPDATE_NOT_APPLIED");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const empresaId = String(req.body?.empresaId || "").trim();
  if (!empresaValida(empresaId)) return json(res, 400, { error: "EMPRESA_INVALIDA" });

  let sesion;
  try {
    sesion = await validarUsuario(req, empresaId);
  } catch {
    sesion = null;
  }
  if (!sesion) return json(res, 403, { error: "FORBIDDEN" });

  try {
    const config = await leerConfig(sesion, empresaId);
    if (!config) return json(res, 409, { error: "ARCA_CONFIG_REQUIRED", message: "Guardá CUIT y ambiente antes de cargar el certificado." });

    const cuitConfigurado = normalizarCuit(config.cuit_emisor);
    if (!cuitConfigurado) {
      return json(res, 409, { error: "ARCA_CUIT_REQUIRED", message: "Configurá un CUIT emisor válido antes de vincular el certificado." });
    }

    const certificadoPem = decodificarPem(req.body?.certificadoBase64, "CERTIFICADO");
    const clavePrivadaPem = decodificarPem(req.body?.clavePrivadaBase64, "CLAVE_PRIVADA");
    const passphrase = typeof req.body?.passphrase === "string" ? req.body.passphrase : undefined;
    if (passphrase && passphrase.length > 256) return json(res, 400, { error: "PASSPHRASE_INVALIDA" });

    if (!certificadoPem.includes("-----BEGIN CERTIFICATE-----")) {
      return json(res, 400, { error: "CERTIFICADO_PEM_INVALIDO" });
    }
    if (!clavePrivadaPem.includes("PRIVATE KEY-----")) {
      return json(res, 400, { error: "CLAVE_PRIVADA_PEM_INVALIDA" });
    }

    let certificado;
    let clavePrivada;
    try {
      certificado = new X509Certificate(certificadoPem);
      clavePrivada = createPrivateKey({ key: clavePrivadaPem, format: "pem", passphrase });
    } catch {
      return json(res, 400, { error: "CERTIFICADO_O_CLAVE_NO_LEGIBLE" });
    }

    const vigenteDesdeAt = Date.parse(certificado.validFrom);
    const venceAt = Date.parse(certificado.validTo);
    const ahora = Date.now();
    if (!Number.isFinite(vigenteDesdeAt) || !Number.isFinite(venceAt)) {
      return json(res, 400, { error: "CERTIFICADO_VIGENCIA_INVALIDA" });
    }
    if (vigenteDesdeAt > ahora) {
      return json(res, 400, { error: "CERTIFICADO_AUN_NO_VIGENTE", vigenteDesde: certificado.validFrom || null });
    }
    if (venceAt <= ahora) {
      return json(res, 400, { error: "CERTIFICADO_VENCIDO", vence: certificado.validTo || null });
    }

    const cuitCertificado = extraerCuitCertificado(certificado.subject);
    if (!cuitCertificado) {
      return json(res, 400, {
        error: "CERTIFICADO_SERIALNUMBER_INVALIDO",
        message: "El certificado no informa serialNumber=CUIT seguido de 11 dígitos.",
      });
    }
    if (cuitCertificado !== cuitConfigurado) {
      return json(res, 409, {
        error: "CERTIFICADO_CUIT_NO_COINCIDE",
        cuitConfigurado,
        cuitCertificado,
      });
    }

    const challenge = randomBytes(48);
    let coincide = false;
    try {
      const firma = sign("sha256", challenge, clavePrivada);
      coincide = verify("sha256", challenge, certificado.publicKey, firma);
    } catch {
      coincide = false;
    }
    if (!coincide) return json(res, 400, { error: "CERTIFICADO_CLAVE_NO_COINCIDEN" });

    // Si el archivo .key llegó cifrado, la passphrase se usa únicamente en memoria.
    // Guardamos una copia PKCS#8 normalizada dentro del bucket privado para que WSAA
    // pueda firmar futuros TRA sin persistir la contraseña del archivo original.
    const clavePrivadaNormalizada = clavePrivada.export({ format: "pem", type: "pkcs8" }).toString();
    if (!clavePrivadaNormalizada.includes("-----BEGIN PRIVATE KEY-----")) {
      return json(res, 500, { error: "CLAVE_PRIVADA_NORMALIZACION_FALLIDA" });
    }

    const certificadoRef = await subirObjetoPrivado(sesion, empresaId, "certificate.pem", certificadoPem);
    await subirObjetoPrivado(sesion, empresaId, "private-key.pem", clavePrivadaNormalizada);
    await invalidarTicketsWsaa(sesion, empresaId);

    const fingerprint = certificado.fingerprint256.replace(/:/g, "").toLowerCase();
    await guardarMetadata(sesion, empresaId, {
      certificado_ref: certificadoRef,
      certificado_fingerprint: fingerprint,
      certificado_vence: new Date(venceAt).toISOString(),
      activo: false,
      ultima_prueba_ok: false,
      ultima_prueba_at: null,
      ultimo_error: null,
      updated_at: new Date().toISOString(),
    });

    return json(res, 200, {
      ok: true,
      fingerprint,
      vigenteDesde: new Date(vigenteDesdeAt).toISOString(),
      vence: new Date(venceAt).toISOString(),
      cuit: cuitCertificado,
      subject: certificado.subject,
      issuer: certificado.issuer,
      nota: "Certificado y clave privada normalizada guardados en almacenamiento privado por empresa. La passphrase y la clave privada no se almacenan en arca_config ni se devuelven al navegador.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    console.error("SIGO ARCA certificate setup error", message.replace(/-----BEGIN[\s\S]*/g, "[SECRET_REDACTED]"));
    return json(res, 502, { error: "ARCA_CERTIFICATE_SETUP_FAILED" });
  }
}
