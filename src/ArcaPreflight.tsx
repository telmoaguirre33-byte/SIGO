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
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState("");

  async function validar() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token;
      if (!token) throw new Error("AUTH_REQUIRED");

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

  const checks = result?.checks;
  return (
    <section className="panel arca-card">
      <div className="panel-header">
        <div>
          <h3>Prevalidación técnica</h3>
          <p>Comprueba tenant, ambiente, CUIT, certificado referenciado, punto de venta y acceso de red a WSAA/WSFEv1 sin pedir ni guardar tu clave fiscal.</p>
        </div>
      </div>

      <button className="admin-button" type="button" onClick={() => void validar()} disabled={loading}>
        {loading ? "Validando…" : "Validar preparación ARCA"}
      </button>

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
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
