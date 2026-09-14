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
  ultimoErrorSeguro?: string | null;
  nota?: string;
  error?: string;
};

type WsaaResult = {
  ok?: boolean;
  ambiente?: string;
  servicio?: string;
  generationTime?: string;
  expirationTime?: string;
  wsfeValidado?: boolean;
  puntosVentaConfigurados?: number[];
  puntosVentaArca?: number[];
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

function mensajeWsaa(payload: WsaaResult | null, status: number) {
  if (payload?.message) return payload.message;
  switch (payload?.error) {
    case "FORBIDDEN": return "Tu sesión no tiene permiso para configurar ARCA en esta empresa.";
    case "ARCA_CONFIG_REQUIRED": return "Falta la configuración fiscal de ARCA para esta empresa.";
    case "ARCA_AMBIENTE_INVALIDO": return "El ambiente ARCA configurado no es válido.";
    case "ARCA_CUIT_INVALIDO": return "El CUIT emisor configurado no es válido.";
    case "ARCA_SERVICIO_INVALIDO": return "El servicio fiscal configurado no corresponde a WSFEv1.";
    case "ARCA_CERTIFICADO_REQUIRED": return "Falta vincular el certificado digital de ARCA.";
    case "ARCA_CERTIFICADO_VENCIDO": return "El certificado digital de ARCA está vencido.";
    case "ARCA_PUNTO_VENTA_REQUIRED": return "Falta un punto de venta activo para el ambiente seleccionado.";
    default: return payload?.error || `La autenticación WSAA falló (HTTP ${status}).`;
  }
}

export default function ArcaPreflight({ empresaId }: { empresaId: string }) {
  const [loading, setLoading] = useState(false);
  const [wsaaLoading, setWsaaLoading] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState("");
  const [wsaaOk, setWsaaOk] = useState("");
  const [wsaaIntento, setWsaaIntento] = useState("");

  async function tokenSesion() {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("AUTH_REQUIRED");
    return token;
  }

  async function validar({ conservarError = false }: { conservarError?: boolean } = {}): Promise<PreflightResult | null> {
    setLoading(true);
    if (!conservarError) setError("");
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
      return payload;
    } catch (err) {
      console.error("ARCA preflight", err);
      if (!conservarError) setError("No se pudo completar la prevalidación técnica. Revisá la sesión, permisos y conexión.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function autenticarWsaa() {
    setWsaaLoading(true);
    setError("");
    setWsaaOk("");
    setWsaaIntento("Enviando autenticación real a ARCA…");
    let errorDelIntento = "";
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
        throw new Error(mensajeWsaa(payload, response.status));
      }
      const vence = payload.expirationTime ? new Date(payload.expirationTime).toLocaleString("es-AR") : "";
      const puntos = payload.puntosVentaArca?.length ? ` · PV ARCA: ${payload.puntosVentaArca.join(", ")}` : "";
      const wsfe = payload.wsfeValidado ? "WSAA + WSFEv1 validados correctamente" : "WSAA validado correctamente";
      const exito = `${wsfe}${puntos}${vence ? ` · ticket vigente hasta ${vence}` : ""}.`;
      setWsaaOk(exito);
      setWsaaIntento("Último intento WSAA: aprobado.");
    } catch (err) {
      console.error("ARCA WSAA/WSFEv1 real", err);
      errorDelIntento = err instanceof Error ? err.message : "No se pudo autenticar contra ARCA.";
      setWsaaIntento("Último intento WSAA: rechazado o interrumpido.");
    } finally {
      const preflight = await validar({ conservarError: true });
      if (errorDelIntento) {
        const diagnostico = preflight?.ultimoErrorSeguro?.trim();
        setError(diagnostico || errorDelIntento);
      }
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
        <p className="form-help">Si ya cargaste CUIT, certificado y punto de venta, podés autenticar WSAA directamente. SIGO valida además el acceso autenticado a WSFEv1 y contrasta los puntos de venta antes de activar ARCA.</p>
      ) : null}

      {wsaaIntento ? <p className="form-help" role="status">{wsaaIntento}</p> : null}

      {result ? (
        <div className="arca-security-note" role="status">
          <strong>{result.emisionHabilitable ? "ARCA listo para emisión" : result.ok ? "Preparación técnica completa" : "Preparación incompleta"}</strong>
          <span>{marca(checks?.configuracion)} Configuración fiscal encontrada</span>
          <span>{marca(checks?.configuracionActiva)} Emisión ARCA activada por última autenticación</span>
          <span>{marca(checks?.ambienteValido)} Ambiente válido{result.ambiente ? ` · ${result.ambiente}` : ""}</span>
          <span>{marca(checks?.cuit)} CUIT válido con dígito verificador</span>
          <span>{marca(checks?.servicio)} Servicio WSAA = wsfe / WSFEv1</span>
          <span>{marca(checks?.certificado)} Certificado referenciado y vigente{checks?.certificadoEstado ? ` · ${checks.certificadoEstado}` : ""}</span>
          <span>{marca(checks?.puntoVenta)} Punto de venta activo y válido{checks?.puntosVentaActivos?.length ? ` · ${checks.puntosVentaActivos.join(", ")}` : ""}</span>
          <span>{marca(checks?.wsaaReachable)} WSAA accesible desde el backend</span>
          <span>{marca(checks?.wsfeReachable)} WSFEv1 accesible desde el backend · prueba FEDummy</span>
          <span>{result.autenticacionRealValidada ? "✓" : "—"} Autenticación WSAA real {result.autenticacionRealEstado ? `· ${result.autenticacionRealEstado}` : ""}{textoAntiguedad(result.autenticacionRealAntiguedadMinutos)}</span>
          <span>{result.emisionHabilitable ? "✓ Emisión habilitable: preflight + WSAA vigente" : "— Emisión todavía bloqueada hasta tener WSAA vigente"}</span>
          {result.ultimoErrorSeguro && !result.autenticacionRealValidada ? <span>Último diagnóstico seguro · {result.ultimoErrorSeguro}</span> : null}
          <span>{result.nota || "La emisión permanece bloqueada hasta validar WSAA con el certificado de la empresa."}</span>
        </div>
      ) : null}
      {wsaaOk ? <p className="sigo-matriz-success" role="status">{wsaaOk}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
