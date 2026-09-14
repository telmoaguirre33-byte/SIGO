import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

type Ambiente = "homologacion" | "produccion";

type Venta = {
  id: string;
  numero: number;
  total: number;
  created_at: string;
  cliente_id: string | null;
};

type PuntoVenta = {
  numero: number;
  ambiente: Ambiente;
  activo: boolean;
};

type Comprobante = {
  punto_venta: number;
  tipo_cbte: number;
  numero_cbte: number;
  cae: string;
  cae_vencimiento: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  ARCA_AUTH_NOT_VALIDATED: "Primero debe aprobarse la autenticación WSAA y la validación WSFEv1.",
  ARCA_TICKET_REFRESH_REQUIRED: "El Ticket de Acceso venció o no está disponible. Volvé a autenticar WSAA; SIGO no solicitará un segundo ticket mientras exista uno vigente.",
  ARCA_PRODUCT_FISCAL_DATA_REQUIRED: "La venta contiene productos sin clasificación fiscal de IVA.",
  ARCA_PRODUCT_PRICE_TAX_MODE_UNSUPPORTED: "La venta contiene productos cuyo precio no está marcado como IVA incluido.",
  ARCA_CLIENT_FISCAL_DATA_REQUIRED: "El cliente no tiene documento y condición frente al IVA completos.",
  ARCA_INVOICE_A_CLIENT_REQUIRED: "Factura A requiere un cliente con CUIT y condición IVA Responsable Inscripto.",
  ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY: "La venta ya reservó otro punto de venta o tipo de comprobante. SIGO no duplicó la emisión.",
  ARCA_CONSUMER_IVA_CONDITION_REQUIRED: "Seleccioná la condición frente al IVA del consumidor final.",
  ARCA_PRODUCTION_CONFIRMATION_REQUIRED: "La emisión productiva requiere confirmación explícita.",
  ARCA_CAE_REJECTED: "ARCA rechazó el comprobante. Revisá el diagnóstico mostrado debajo.",
  ARCA_NUMBER_RESERVATION_CONFLICT: "Otra emisión tomó ese número. Reintentá para obtener el siguiente.",
  ARCA_TIMEOUT: "ARCA no respondió a tiempo. Reintentá: SIGO conciliará antes de volver a solicitar.",
};

export default function ArcaCaeEmission({
  empresaId,
  ambiente,
  habilitado,
  puntos,
}: {
  empresaId: string;
  ambiente: Ambiente;
  habilitado: boolean;
  puntos: PuntoVenta[];
}) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [ventaId, setVentaId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [tipoCbte, setTipoCbte] = useState("11");
  const [condicionIva, setCondicionIva] = useState("5");
  const [loading, setLoading] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [comprobante, setComprobante] = useState<Comprobante | null>(null);

  const puntosActivos = useMemo(
    () => puntos.filter((pv) => pv.activo && pv.ambiente === ambiente),
    [ambiente, puntos],
  );
  const venta = ventas.find((item) => item.id === ventaId) ?? null;

  async function cargarVentas() {
    setLoading(true);
    setError("");
    try {
      const [{ data: rows, error: salesError }, { data: emitidas, error: issuedError }] = await Promise.all([
        supabase
          .from("ventas_sigo")
          .select("id,numero,total,created_at,cliente_id")
          .eq("empresa_id", empresaId)
          .eq("estado", "confirmada")
          .is("anulada_at", null)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("arca_comprobantes")
          .select("venta_id")
          .eq("empresa_id", empresaId)
          .not("cae", "is", null),
      ]);
      if (salesError) throw salesError;
      if (issuedError) throw issuedError;
      const facturadas = new Set((emitidas ?? []).map((item) => String(item.venta_id || "")));
      const disponibles = ((rows ?? []) as Venta[]).filter((item) => !facturadas.has(item.id));
      setVentas(disponibles);
      setVentaId((actual) => disponibles.some((item) => item.id === actual) ? actual : disponibles[0]?.id ?? "");
    } catch (cause) {
      console.error(cause);
      setError("No se pudieron cargar las ventas confirmadas para facturar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargarVentas(); }, [empresaId]);
  useEffect(() => {
    if (!puntosActivos.some((pv) => String(pv.numero) === puntoVenta)) {
      setPuntoVenta(puntosActivos[0] ? String(puntosActivos[0].numero) : "");
    }
  }, [puntosActivos, puntoVenta]);

  async function emitir() {
    if (!venta || !puntoVenta || emitiendo) return;
    const esProduccion = ambiente === "produccion";
    const mensaje = esProduccion
      ? `Vas a solicitar un CAE REAL para la venta ${venta.numero} por $${Number(venta.total).toLocaleString("es-AR")}. Esta acción tiene efecto fiscal. ¿Confirmás?`
      : `Vas a solicitar un CAE de HOMOLOGACIÓN para la venta ${venta.numero}. No tiene efecto fiscal real. ¿Continuar?`;
    if (!window.confirm(mensaje)) return;

    setEmitiendo(true);
    setError("");
    setDiagnostico("");
    setComprobante(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("SESSION_REQUIRED");
      const response = await fetch("/api/arca/cae", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          empresaId,
          ventaId: venta.id,
          puntoVenta: Number(puntoVenta),
          tipoCbte: Number(tipoCbte),
          condicionIvaReceptorId: Number(condicionIva),
          confirmacion: esProduccion ? "EMITIR_CAE_PRODUCCION" : "SOLICITAR_CAE_HOMOLOGACION",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = String(payload?.error || "ARCA_CAE_FAILED");
        const details = Array.isArray(payload?.observaciones)
          ? payload.observaciones.map((item: { code?: string; message?: string }) => `${item.code || "ARCA"}: ${item.message || "Rechazado"}`).join(" · ")
          : "";
        setDiagnostico(details);
        throw new Error(code);
      }
      setComprobante(payload.comprobante as Comprobante);
      await cargarVentas();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "ARCA_CAE_FAILED";
      setError(code === "SESSION_REQUIRED" ? "La sesión venció. Volvé a ingresar a SIGO." : ERROR_MESSAGES[code] || "No se pudo completar la solicitud de CAE.");
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <section className="panel arca-card arca-emit-card">
      <div className="panel-header"><div><h3>4. Emisión desde SIGO</h3><p>Seleccioná una venta confirmada. SIGO concilia el número antes de solicitar el CAE.</p></div></div>
      <div className="form-grid">
        <div className="form-group form-span-2">
          <label>Venta confirmada</label>
          <select value={ventaId} onChange={(event) => setVentaId(event.target.value)} disabled={loading || emitiendo}>
            {ventas.length === 0 ? <option value="">No hay ventas pendientes de CAE</option> : null}
            {ventas.map((item) => <option key={item.id} value={item.id}>Venta {item.numero} · ${Number(item.total).toLocaleString("es-AR")}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Punto de venta</label><select value={puntoVenta} onChange={(event) => setPuntoVenta(event.target.value)}>{puntosActivos.map((pv) => <option key={pv.numero} value={pv.numero}>PV {String(pv.numero).padStart(4, "0")}</option>)}</select></div>
        <div className="form-group"><label>Comprobante</label><select value={tipoCbte} onChange={(event) => setTipoCbte(event.target.value)}><option value="11">Factura C</option><option value="6">Factura B</option><option value="1">Factura A</option></select></div>
        {!venta?.cliente_id ? <div className="form-group form-span-2"><label>Condición IVA receptor</label><select value={condicionIva} onChange={(event) => setCondicionIva(event.target.value)}><option value="5">Consumidor Final</option><option value="6">Responsable Monotributo</option><option value="1">IVA Responsable Inscripto</option><option value="4">IVA Exento</option></select></div> : null}
      </div>
      <button className="primary-button" type="button" onClick={() => void emitir()} disabled={!habilitado || !ventaId || !puntoVenta || emitiendo}>
        {emitiendo ? "Solicitando y conciliando…" : ambiente === "produccion" ? "Emitir CAE real" : "Probar CAE en homologación"}
      </button>
      {!habilitado ? <small>Bloqueado hasta validar WSAA + WSFEv1 en esta empresa.</small> : null}
      {ambiente === "produccion" ? <small>Producción: SIGO pedirá una confirmación explícita antes de cada emisión real.</small> : <small>Homologación: el comprobante no tiene efecto fiscal real.</small>}
      {comprobante ? <p className="sigo-matriz-success" role="status">CAE {comprobante.cae} · Comprobante {String(comprobante.punto_venta).padStart(4, "0")}-{String(comprobante.numero_cbte).padStart(8, "0")}{comprobante.cae_vencimiento ? ` · vence ${comprobante.cae_vencimiento}` : ""}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {diagnostico ? <small role="alert">{diagnostico}</small> : null}
    </section>
  );
}
