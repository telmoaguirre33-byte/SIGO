import { X509Certificate, createPrivateKey, randomBytes, sign, verify } from "node:crypto";

const BUCKET = "arca-secrets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
}

async function permitido(sesion, empresaId) {
  const response = await fetch(`${sesion.url}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: "arca.configure" }),
  });
  return response.ok && (await response.json().catch(() => false)) === true;
}

async function sesionUsuario(req, origenEmpresaId, destinoEmpresaId) {
  const { url, anonKey } = supabaseEnv();
  const auth = String(req.headers.authorization || "");
  if (!url || !anonKey || !auth.startsWith("Bearer ")) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!userResponse.ok) return null;
  const sesion = { url, anonKey, auth };
  if (!(await permitido(sesion, origenEmpresaId)) || !(await permitido(sesion, destinoEmpresaId))) return null;
  return sesion;
}

async function rest(sesion, path, init = {}) {
  const response = await fetch(`${sesion.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sesion.anonKey,
      Authorization: sesion.auth,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`REST_${response.status}`);
  return payload;
}

async function leerConfig(sesion, empresaId) {
  const select = "empresa_id,ambiente,cuit_emisor,razon_social,certificado_ref,certificado_fingerprint,certificado_vence,wsaa_service,wsfe_version";
  const rows = await rest(sesion, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=${encodeURIComponent(select)}`);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function descargarSecreto(sesion, empresaId, fileName) {
  const response = await fetch(
    `${sesion.url}/storage/v1/object/authenticated/${BUCKET}/${encodeURIComponent(empresaId)}/${encodeURIComponent(fileName)}`,
    { headers: { apikey: sesion.anonKey, Authorization: sesion.auth } },
  );
  if (!response.ok) throw new Error(`SECRET_READ_FAILED:${fileName}:${response.status}`);
  const value = await response.text();
  if (!value || value.length > 300_000) throw new Error(`SECRET_INVALID:${fileName}`);
  return value;
}

async function subirSecreto(sesion, empresaId, fileName, value, contentType = "application/x-pem-file") {
  const response = await fetch(
    `${sesion.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(empresaId)}/${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: {
        apikey: sesion.anonKey,
        Authorization: sesion.auth,
        "Content-Type": contentType,
        // Sólo llegamos acá si arca_config del destino no contiene certificado.
        // Upsert permite reparar un intento interrumpido entre los dos archivos sin
        // reemplazar una configuración fiscal ya activa.
        "x-upsert": "true",
      },
      body: value,
    },
  );
  if (!response.ok) throw new Error(`SECRET_COPY_FAILED:${fileName}:${response.status}`);
  return `storage://${BUCKET}/${empresaId}/${fileName}`;
}

async function invalidarTicketsWsaa(sesion, empresaId) {
  await Promise.all(["homologacion", "produccion"].map((ambiente) =>
    subirSecreto(
      sesion,
      empresaId,
      `ticket-wsfe-${ambiente}.json`,
      JSON.stringify({ version: 0, invalidatedAt: new Date().toISOString() }),
      "application/json",
    ),
  ));
}

function validarPar(config, certificadoPem, clavePrivadaPem) {
  const certificado = new X509Certificate(certificadoPem);
  const clave = createPrivateKey({ key: clavePrivadaPem, format: "pem" });
  const challenge = randomBytes(48);
  const coincide = verify("sha256", challenge, certificado.publicKey, sign("sha256", challenge, clave));
  if (!coincide) throw new Error("CERT_KEY_MISMATCH");
  const venceAt = Date.parse(certificado.validTo);
  if (!Number.isFinite(venceAt) || venceAt <= Date.now()) throw new Error("CERT_EXPIRED");
  const cuitCertificado = String(certificado.subject || "").match(/(?:serialNumber|2\.5\.4\.5)\s*=\s*(?:CUIT\s*)?([0-9]{11})/i)?.[1] || "";
  if (!cuitCertificado || cuitCertificado !== String(config.cuit_emisor || "")) throw new Error("CERT_CUIT_MISMATCH");
  return {
    vence: new Date(venceAt).toISOString(),
    fingerprint: certificado.fingerprint256.replace(/:/g, "").toLowerCase(),
  };
}

function errorSeguro(error) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (raw.includes("SECRET_READ_FAILED")) return { status: 409, code: "ARCA_SOURCE_SECRET_MISSING", message: "La configuración encontrada no tiene ambos archivos privados disponibles. No se modificó el destino." };
  if (raw.includes("CERT_KEY_MISMATCH")) return { status: 409, code: "ARCA_SOURCE_CERT_KEY_MISMATCH", message: "El certificado y la clave privada de origen no coinciden. No se copiaron datos fiscales." };
  if (raw.includes("CERT_EXPIRED")) return { status: 409, code: "ARCA_SOURCE_CERT_EXPIRED", message: "El certificado de origen está vencido. No se copió al destino." };
  if (raw.includes("CERT_CUIT_MISMATCH")) return { status: 409, code: "ARCA_SOURCE_CUIT_MISMATCH", message: "El CUIT del certificado de origen no coincide con la configuración fiscal." };
  return { status: 502, code: "ARCA_TRANSFER_FAILED", message: "No se pudo reutilizar la configuración ARCA de forma segura. El origen se conservó sin cambios." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const origenEmpresaId = String(req.body?.origenEmpresaId || "").trim();
  const destinoEmpresaId = String(req.body?.destinoEmpresaId || "").trim();
  if (!UUID.test(origenEmpresaId) || !UUID.test(destinoEmpresaId) || origenEmpresaId === destinoEmpresaId) {
    return json(res, 400, { error: "ARCA_TRANSFER_INPUT_INVALID" });
  }

  const sesion = await sesionUsuario(req, origenEmpresaId, destinoEmpresaId);
  if (!sesion) return json(res, 403, { error: "ARCA_TRANSFER_FORBIDDEN" });

  try {
    const [origen, destino] = await Promise.all([
      leerConfig(sesion, origenEmpresaId),
      leerConfig(sesion, destinoEmpresaId),
    ]);
    if (!origen?.certificado_ref) return json(res, 409, { error: "ARCA_SOURCE_CONFIG_REQUIRED" });
    if (destino?.certificado_ref) {
      return json(res, 409, {
        error: "ARCA_TARGET_ALREADY_CONFIGURED",
        message: "La empresa destino ya tiene un certificado. SIGO no lo reemplazó.",
      });
    }
    if (!/^\d{11}$/.test(String(origen.cuit_emisor || "")) || origen.wsaa_service !== "wsfe" || origen.wsfe_version !== "WSFEv1") {
      return json(res, 409, { error: "ARCA_SOURCE_CONFIG_INVALID" });
    }

    const [certificadoPem, clavePrivadaPem, puntosVenta] = await Promise.all([
      descargarSecreto(sesion, origenEmpresaId, "certificate.pem"),
      descargarSecreto(sesion, origenEmpresaId, "private-key.pem"),
      rest(
        sesion,
        `arca_puntos_venta?empresa_id=eq.${encodeURIComponent(origenEmpresaId)}&activo=is.true&select=numero,nombre,ambiente,activo&order=numero.asc`,
      ),
    ]);
    const certificado = validarPar(origen, certificadoPem, clavePrivadaPem);

    const certificadoRef = await subirSecreto(sesion, destinoEmpresaId, "certificate.pem", certificadoPem);
    await subirSecreto(sesion, destinoEmpresaId, "private-key.pem", clavePrivadaPem);
    await invalidarTicketsWsaa(sesion, destinoEmpresaId);

    const ahora = new Date().toISOString();
    await rest(sesion, "arca_config?on_conflict=empresa_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        empresa_id: destinoEmpresaId,
        ambiente: origen.ambiente,
        cuit_emisor: origen.cuit_emisor,
        razon_social: origen.razon_social,
        certificado_ref: certificadoRef,
        certificado_fingerprint: certificado.fingerprint,
        certificado_vence: certificado.vence,
        wsaa_service: "wsfe",
        wsfe_version: "WSFEv1",
        activo: false,
        ultima_prueba_ok: false,
        ultima_prueba_at: null,
        ultimo_error: null,
        updated_at: ahora,
      }),
    });

    const pvs = (Array.isArray(puntosVenta) ? puntosVenta : [])
      .filter((pv) => Number.isInteger(Number(pv.numero)) && Number(pv.numero) > 0)
      .map((pv) => ({
        empresa_id: destinoEmpresaId,
        numero: Number(pv.numero),
        nombre: pv.nombre || null,
        ambiente: pv.ambiente === "homologacion" ? "homologacion" : "produccion",
        activo: true,
        updated_at: ahora,
      }));
    if (pvs.length > 0) {
      await rest(sesion, "arca_puntos_venta?on_conflict=empresa_id,ambiente,numero", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(pvs),
      });
    }

    return json(res, 200, {
      ok: true,
      ambiente: origen.ambiente,
      cuitUltimos4: String(origen.cuit_emisor).slice(-4),
      puntosVenta: pvs.map((pv) => pv.numero),
      nota: "La configuración se copió dentro del backend. La clave privada nunca fue enviada al navegador y el origen se conservó.",
    });
  } catch (error) {
    const safe = errorSeguro(error);
    console.error("SIGO ARCA tenant transfer", safe.code);
    return json(res, safe.status, { error: safe.code, message: safe.message });
  }
}
