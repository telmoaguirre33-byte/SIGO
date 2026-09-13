import { useEffect, useMemo, useState, type FormEvent } from "react";
import ArcaCertificateUpload from "./ArcaCertificateUpload";
import ArcaPreflight from "./ArcaPreflight";
import { supabase } from "./supabase";

type Ambiente = "homologacion" | "produccion";

type ArcaConfig = {
  empresa_id: string;
  ambiente: Ambiente;
  cuit_emisor: string;
  razon_social: string | null;
  certificado_ref: string | null;
  certificado_vence: string | null;
  activo: boolean;
  ultima_prueba_ok: boolean | null;
  ultimo_error: string | null;
};

type PuntoVenta = {
  id: string;
  numero: number;
  nombre: string | null;
  ambiente: Ambiente;
  activo: boolean;
};

const ARCA_PORTAL = "https://www.arca.gob.ar/";
const ARCA_FACTURA = "https://www.arca.gob.ar/fe/";
const ARCA_WS = "https://www.arca.gob.ar/ws/documentacion/wsaa.asp";
const ARCA_CERTIFICADOS = "https://www.arca.gob.ar/ws/documentacion/certificados.asp";
const ARCA_WSFE = "https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp";

export default function ArcaFacturacion({ empresaId }: { empresaId: string }) {
  const [config, setConfig] = useState<ArcaConfig | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [ambiente, setAmbiente] = useState<Ambiente>("produccion");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [nombrePv, setNombrePv] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      const [{ data: cfg, error: cfgError }, { data: pvs, error: pvError }] = await Promise.all([
        supabase.from("arca_config").select("empresa_id,ambiente,cuit_emisor,razon_social,certificado_ref,certificado_vence,activo,ultima_prueba_ok,ultimo_error").eq("empresa_id", empresaId).maybeSingle(),
        supabase.from("arca_puntos_venta").select("id,numero,nombre,ambiente,activo").eq("empresa_id", empresaId).order("numero", { ascending: true }),
      ]);
      if (cfgError) throw cfgError;
      if (pvError) throw pvError;
      const actual = (cfg ?? null) as ArcaConfig | null;
      setConfig(actual);
      setPuntos((pvs ?? []) as PuntoVenta[]);
      if (actual) {
        setCuit(actual.cuit_emisor ?? "");
        setRazonSocial(actual.razon_social ?? "");
        setAmbiente(actual.ambiente ?? "produccion");
      }
    } catch (e) {
      console.error(e);
      setError("No se pudo cargar la configuración de facturación ARCA.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, [empresaId]);

  const estado = useMemo(() => {
    if (!config) return { texto: "Configuración inicial", clase: "pending" };
    if (!config.certificado_ref) return { texto: "Falta vincular certificado", clase: "warning" };
    if (!puntos.some((pv) => pv.activo && pv.ambiente === config.ambiente)) return { texto: "Falta punto de venta", clase: "warning" };
    if (config.activo && config.ultima_prueba_ok) return { texto: "ARCA conectado", clase: "ready" };
    return { texto: "Listo para validar conexión", clase: "pending" };
  }, [config, puntos]);

  async function guardarDatos(event: FormEvent) {
    event.preventDefault();
    const cuitLimpio = cuit.replace(/\D/g, "");
    if (cuitLimpio.length !== 11) {
      setError("El CUIT debe tener 11 dígitos.");
      return;
    }
    setSaving(true); setError(""); setOk("");
    try {
      const { error: saveError } = await supabase.from("arca_config").upsert({
        empresa_id: empresaId,
        ambiente,
        cuit_emisor: cuitLimpio,
        razon_social: razonSocial.trim() || null,
        wsaa_service: "wsfe",
        wsfe_version: "WSFEv1",
        activo: config?.activo ?? false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "empresa_id" });
      if (saveError) throw saveError;
      setOk("Datos fiscales guardados.");
      await cargar();
    } catch (e) {
      console.error(e);
      setError("No se pudieron guardar los datos fiscales. Revisá permisos y CUIT.");
    } finally { setSaving(false); }
  }

  async function agregarPuntoVenta(event: FormEvent) {
    event.preventDefault();
    const numero = Number(puntoVenta);
    if (!Number.isInteger(numero) || numero < 1 || numero > 99999) {
      setError("Ingresá un punto de venta válido entre 1 y 99999.");
      return;
    }
    setSaving(true); setError(""); setOk("");
    try {
      const { error: pvError } = await supabase.from("arca_puntos_venta").upsert({
        empresa_id: empresaId,
        numero,
        nombre: nombrePv.trim() || null,
        ambiente,
        activo: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "empresa_id,ambiente,numero" });
      if (pvError) throw pvError;
      setPuntoVenta(""); setNombrePv("");
      setOk("Punto de venta guardado en SIGO.");
      await cargar();
    } catch (e) {
      console.error(e);
      setError("No se pudo guardar el punto de venta.");
    } finally { setSaving(false); }
  }

  return (
    <div className="arca-page">
      <div className="page-header arca-head">
        <div>
          <span className="arca-kicker">FACTURACIÓN ELECTRÓNICA</span>
          <h2>Conectar SIGO con ARCA</h2>
          <p>Configurá una vez tu CUIT, certificado y punto de venta para emitir comprobantes electrónicos desde SIGO.</p>
        </div>
        <span className={`arca-status ${estado.clase}`}>{estado.texto}</span>
      </div>

      {loading ? <div className="panel"><p>Cargando configuración ARCA…</p></div> : (
        <>
          <div className="arca-steps">
            <article className="arca-step active"><span>1</span><strong>Datos fiscales</strong><small>CUIT y razón social</small></article>
            <article className={config?.certificado_ref ? "arca-step active" : "arca-step"}><span>2</span><strong>ARCA</strong><small>Certificado y relación WSFE</small></article>
            <article className={puntos.length ? "arca-step active" : "arca-step"}><span>3</span><strong>Punto de venta</strong><small>Numeración fiscal</small></article>
            <article className={config?.activo && config?.ultima_prueba_ok ? "arca-step active" : "arca-step"}><span>4</span><strong>Emitir</strong><small>CAE desde SIGO</small></article>
          </div>

          <div className="arca-grid">
            <section className="panel arca-card">
              <div className="panel-header"><div><h3>1. Datos de facturación</h3><p>Información del emisor que SIGO usará en cada comprobante.</p></div></div>
              <form className="form-grid" onSubmit={guardarDatos}>
                <div className="form-group"><label>Ambiente</label><select value={ambiente} onChange={(e) => setAmbiente(e.target.value as Ambiente)}><option value="produccion">Producción</option><option value="homologacion">Homologación / pruebas</option></select></div>
                <div className="form-group"><label>CUIT *</label><input inputMode="numeric" placeholder="20123456789" value={cuit} onChange={(e) => setCuit(e.target.value)} required /></div>
                <div className="form-group form-span-2"><label>Razón social</label><input placeholder="Razón social / nombre fiscal" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} /></div>
                <div className="form-actions form-span-2"><button className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar datos fiscales"}</button></div>
              </form>
            </section>

            <section className="panel arca-card arca-connect-card">
              <div className="panel-header"><div><h3>2. Vincular con ARCA</h3><p>ARCA exige certificado digital X.509 y autorización para el servicio WSFE.</p></div></div>
              <div className="arca-connect-actions">
                <a className="primary-button arca-link" href={ARCA_PORTAL} target="_blank" rel="noreferrer">Ingresar a ARCA</a>
                <a className="admin-button arca-link" href={ARCA_CERTIFICADOS} target="_blank" rel="noreferrer">Certificados digitales</a>
                <a className="admin-button arca-link" href={ARCA_WS} target="_blank" rel="noreferrer">Configurar WSAA / WSFE</a>
                <a className="admin-button arca-link" href={ARCA_WSFE} target="_blank" rel="noreferrer">Documentación WSFEv1</a>
                <a className="admin-button arca-link" href={ARCA_FACTURA} target="_blank" rel="noreferrer">Factura electrónica ARCA</a>
              </div>
              <div className="arca-security-note"><strong>SIGO nunca debe pedir tu clave fiscal.</strong><span>La vinculación se hace en ARCA. SIGO trabaja con certificado digital y WSFEv1 para solicitar el CAE. En ARCA, el servicio de negocio correspondiente a WSFEv1 se identifica como WSFE.</span></div>
            </section>

            <ArcaCertificateUpload empresaId={empresaId} onUploaded={() => { void cargar(); }} />

            <ArcaPreflight empresaId={empresaId} />

            <section className="panel arca-card">
              <div className="panel-header"><div><h3>3. Punto de venta</h3><p>Debe ser el punto de venta habilitado en ARCA para el sistema de facturación elegido.</p></div></div>
              <form className="form-grid" onSubmit={agregarPuntoVenta}>
                <div className="form-group"><label>Número *</label><input type="number" min="1" max="99999" placeholder="0002" value={puntoVenta} onChange={(e) => setPuntoVenta(e.target.value)} required /></div>
                <div className="form-group"><label>Nombre</label><input placeholder="Casa central" value={nombrePv} onChange={(e) => setNombrePv(e.target.value)} /></div>
                <div className="form-actions form-span-2"><button className="primary-button" disabled={saving}>Guardar punto de venta</button></div>
              </form>
              {puntos.length > 0 && <div className="arca-pv-list">{puntos.map((pv) => <span key={pv.id}>PV {String(pv.numero).padStart(4, "0")} · {pv.ambiente === "produccion" ? "Producción" : "Pruebas"}{pv.nombre ? ` · ${pv.nombre}` : ""}</span>)}</div>}
            </section>

            <section className="panel arca-card arca-emit-card">
              <div className="panel-header"><div><h3>4. Emisión desde SIGO</h3><p>Cuando certificado + relación WSFEv1 + punto de venta estén validados, SIGO podrá solicitar CAE automáticamente.</p></div></div>
              <button className="primary-button" disabled={!config?.activo || !config?.ultima_prueba_ok}>Emitir factura electrónica</button>
              {!config?.activo || !config?.ultima_prueba_ok ? <small>La emisión queda bloqueada hasta validar una autenticación WSAA real con el certificado de esta empresa.</small> : null}
            </section>
          </div>
          {ok ? <p className="sigo-matriz-success" role="status">{ok}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}
