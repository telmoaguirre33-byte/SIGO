import { useEffect, useMemo, useState } from "react";
import ArcaCaeEmission from "./ArcaCaeEmission";
import { supabase } from "./supabase";

type Ambiente = "homologacion" | "produccion";
type PuntoVenta = { numero: number; ambiente: Ambiente; activo: boolean };
type Config = { ambiente: Ambiente; activo: boolean; ultima_prueba_ok: boolean | null };

export default function ArcaEmisionVendedor({ empresaId, empresaNombre }: { empresaId: string; empresaNombre: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setLoading(true);
      setError("");
      try {
        const [{ data: cfg, error: cfgError }, { data: pvs, error: pvError }] = await Promise.all([
          supabase
            .from("arca_config")
            .select("ambiente,activo,ultima_prueba_ok")
            .eq("empresa_id", empresaId)
            .maybeSingle(),
          supabase
            .from("arca_puntos_venta")
            .select("numero,ambiente,activo")
            .eq("empresa_id", empresaId)
            .eq("activo", true)
            .order("numero", { ascending: true }),
        ]);
        if (cfgError) throw cfgError;
        if (pvError) throw pvError;
        if (!cancelado) {
          setConfig((cfg ?? null) as Config | null);
          setPuntos((pvs ?? []) as PuntoVenta[]);
        }
      } catch (cause) {
        console.error("ARCA vendedor", cause);
        if (!cancelado) setError("No se pudo cargar la facturación de esta empresa.");
      } finally {
        if (!cancelado) setLoading(false);
      }
    }
    void cargar();
    return () => { cancelado = true; };
  }, [empresaId]);

  const habilitado = Boolean(config?.activo && config?.ultima_prueba_ok === true);
  const puntosEmpresa = useMemo(
    () => puntos.filter((item) => item.ambiente === config?.ambiente && item.activo),
    [config?.ambiente, puntos],
  );

  if (loading) return <div className="panel arca-card"><p>Cargando facturación…</p></div>;

  return (
    <div className="arca-page">
      <section className="panel arca-card arca-security-note" role="status">
        <strong>Facturación de vendedor · {empresaNombre}</strong>
        <span>Tu perfil puede emitir comprobantes de ventas confirmadas, pero no puede cambiar CUIT, certificados, puntos de venta, usuarios ni configuración fiscal.</span>
      </section>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!config ? <p className="form-error">ARCA todavía no está configurado para esta empresa.</p> : (
        <ArcaCaeEmission
          empresaId={empresaId}
          ambiente={config.ambiente}
          habilitado={habilitado}
          puntos={puntosEmpresa}
        />
      )}
    </div>
  );
}
