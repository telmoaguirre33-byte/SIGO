import { useState } from "react";
import { supabase } from "./supabase";

type PreflightResult = {
  ok: boolean;
  etapa?: string;
  ambiente?: "homologacion" | "produccion";
  checks?: {
    configuracion?: boolean;
    configuracionActiva?: boolean;
    ambienteValido?: boolean;
    cuit?: boolean;
    servicio?: boolean;
    certificado?: boolean;
    certificadoEstado?: string;
    certificadoVence?: string | null;
    certificadoDiasRestantes?: number | null;
    puntoVenta?: boolean;
    puntosVentaActivos?: number[];
    wsaaReachable?: boolean;
    wsfeReachable?: boolean;
  };
  autenticacionRealValidada?: boolean;
  autenticacionRealEstado?: string;
  autenticacionRealAntiguedadMinutos?: number | null;
  emisionHabilitable?: boolean;
  ultimaPruebaAt?: string | null;
  nota?: string;
  error?: string;
};

type WsaaResult = {
  ok?: boolean;
  ambiente?: string;
  servicio?: string;
  generationTime?: string;
  expirationTime?: string;
  nota?: string;
  error?: string;
  message?: string;
};

function marca(ok?: boolean) {
  return ok ? "✓" : "—";
}

function textoAntiguedad(minutos?: number | null) {
  if (minutos == null || !Number.isFinite(minutos)) return "";
  if (minutos < 60) return ` · hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return ` · hace ${horas} h${resto ? ` ${resto} min` : ""}`;
}

export default function ArcaPreflight({ empresaId }: { empresaId: string }) {
  const [loading, setLoading] = useState(false);
  const [wsaaLoading, setWsaaLoading] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState("");
  const [wsaaOk, setWsaaOk] = useState("");

  async function tokenSesion() {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("AUTH_REQUIRED");
    return token;
  }

  async function validar() {
    setLoading(true);
    setError("");
    try {
      const token = await tokenSesion();
      const response = await fetch("/api/arca/preflight", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ empresaId }),
      });
      const payload = await response.json().catch(() => null) as PreflightResult | null;
      if (!response.ok || !payload) throw new Error(payload?.error || `HTTP_${response.status}`);
      setResult(payload);
    } catch (err) {
      console.error("ARCA preflight", err);
      setError("No se pudo completar la prevalidación técnica. Revisá la sesión, permisos y conexión.");
    } finally {
      setLoading(false);
    }
  }

  async function autenticarWsaa() {
    setWsaaLoading(true);
    setError("");
    setWsaaOk("");
    try {
      const token = await tokenSesion();
      const response = await fetch("/api/arca/wsaa", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ empresaId }),
      });
      const payload = await response.json().catch(() => null) as WsaaResult | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP_${response.status}`);
      }
      const vence = payload.expirationTime ? new Date(payload.expirationTime).toLocaleString("es-AR") : "";
      setWsaaOk(`WSAA validado correctamente${vence ? ` · ticket vigente hasta ${vence}` : ""}.`);
      await validar();
    } catch (err) {
      console.error("ARCA WSAA real", err);
      setError(err instanceof Error ? err.message : "No se pudo autenticar contra WSAA.");
      await validar();
    } finally {
      setWsaaLoading(false);
    }
  }

  const checks = result?.checks;

  return (
    <section className="panel arca-card">
      <div className="panel-header">
        <div>
          <h3>Prevalidación técnica</h3>
          <p>Comprueba tenant, ambiente, CUIT, certificado referenciado, punto de venta y acceso de red a WSAA/WSFEv1 sin pedir ni guardar tu clave fiscal.</p>
        </div>
      </div>

      <div className="form-actions" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button className="admin-button" type="button" onClick={() => void validar()} disabled={loading || wsaaLoading}>
          {loading ? "Validando…" : "Validar preparación ARCA"}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => void autenticarWsaa()}
          disabled={wsaaLoading || loading}
        >
          {wsaaLoading ? "Autenticando con ARCA…" : result?.autenticacionRealValidada ? "Renovar autenticación WSAA" : "Autenticar WSAA real"}
        </button>
      </div>

      {!result ? (
        <p className="form-help">Si ya cargaste CUIT, certificado y punto de venta, podés autenticar WSAA directamente. El backend vuelve a validar los requisitos antes de activar ARCA.</p>
      ) : null}

      {result ? (
        <div className="arca-security-note" role="status">
          <strong>{result.emisionHabilitable ? "ARCA listo para emisión" : result.ok ? "Preparación técnica completa" : "Preparación incompleta"}</strong>
          <span>{marca(checks?.configuracion)} Configuración fiscal encontrada</span>
          <span>{marca(checks?.configuracionActiva)} Configuración ARCA activa</span>
          <span>{marca(checks?.ambienteValido)} Ambiente válido{result.ambiente ? ` · ${result.ambiente}` : ""}</span>
          <span>{marca(checks?.cuit)} CUIT válido con dígito verificador</span>
          <span>{marca(checks?.servicio)} Servicio WSAA = wsfe / WSFEv1</span>
          <span>{marca(checks?.certificado)} Certificado referenciado y vigente{checks?.certificadoEstado ? ` · ${checks.certificadoEstado}` : ""}</span>
          <span>{marca(checks?.puntoVenta)} Punto de venta activo y válido{checks?.puntosVentaActivos?.length ? ` · ${checks.puntosVentaActivos.join(", ")}` : ""}</span>
          <span>{marca(checks?.wsaaReachable)} WSAA accesible desde el backend</span>
          <span>{marca(checks?.wsfeReachable)} WSFEv1 accesible desde el backend</span>
          <span>{result.autenticacionRealValidada ? "✓" : "—"} Autenticación WSAA real {result.autenticacionRealEstado ? `· ${result.autenticacionRealEstado}` : ""}{textoAntiguedad(result.autenticacionRealAntiguedadMinutos)}</span>
          <span>{result.emisionHabilitable ? "✓ Emisión habilitable: preflight + WSAA vigente" : "— Emisión todavía bloqueada hasta tener WSAA vigente"}</span>
          <span>{result.nota || "La emisión permanece bloqueada hasta validar WSAA con el certificado de la empresa."}</span>
        </div>
      ) : null}
      {wsaaOk ? <p className="sigo-matriz-success" role="status">{wsaaOk}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
