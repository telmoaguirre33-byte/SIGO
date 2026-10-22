import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { imprimirTicketVenta } from "./ticketVenta";
import { imprimirTicketFiscal, type TicketFiscal } from "./ticketFiscal";
import FiscalPrintSetup from "./FiscalPrintSetup";
import { leerImpresionFiscal, type ConfigImpresion, prepararFiscalCaja, recuperarFiscalCaja, emitirFiscalCaja, marcaIntentoFiscal, type PreparacionFiscal, type SolicitudFiscalCaja } from "./fiscalCaja";

type Inicio = { preparado: PreparacionFiscal; ticket?: TicketFiscal; requiereAccion?: string; comun?: boolean; configuracionImpresion?: ConfigImpresion };
export default function FiscalCajaFlow({ solicitud, alCerrar }: { solicitud: SolicitudFiscalCaja; alCerrar: () => void }) {
  const { empresaId, ventaId, accion } = solicitud;
  const [estado, setEstado] = useState(accion === "historial" ? "Historial de comprobantes" : "Recuperando venta…");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(accion !== "historial");
  const [preparado, setPreparado] = useState<PreparacionFiscal | null>(null);
  const [ticket, setTicket] = useState<TicketFiscal | null>(null);
  const [configImpresion, setConfigImpresion] = useState<ConfigImpresion | null>(null);
  const [puntoVenta, setPuntoVenta] = useState("");
  const [tipoCbte, setTipoCbte] = useState("11");
  const [ventas, setVentas] = useState<Array<{ id: string; numero: number; total: number; created_at: string }>>([]);
  const [seleccion, setSeleccion] = useState(ventaId || "");
  const [busqueda, setBusqueda] = useState("");
  const [offset, setOffset] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const inicioRef = useRef<Promise<Inicio> | null>(null);
  const accionEnCurso = useRef(false);
  const impresoRef = useRef(false);

  function cerrarConFactura(c: TicketFiscal) {
    window.dispatchEvent(new CustomEvent("sigo:fiscal:estado", { detail: { empresaId, mensaje: c.ambiente === "homologacion" ? "Comprobante de prueba listo; F12 para reimprimir." : "Factura autorizada; F12 para reimprimir." } }));
    alCerrar();
  }
  async function imprimir(c: TicketFiscal) {
    setEstado("Ticket fiscal listo · abriendo impresión de 58 mm…");
    await imprimirTicketFiscal(c, "58", () => cerrarConFactura(c));
  }
  useEffect(() => {
    if (!ventaId) return;
    let activo = true;
    if (!inicioRef.current) inicioRef.current = (async (): Promise<Inicio> => {
      const p = await prepararFiscalCaja(empresaId, ventaId);
      if (p.comprobante) {
        // Any reservation is recovered read-only. Repeated F11 never silently retries CAE.
        return { preparado: p, ticket: await recuperarFiscalCaja(empresaId, ventaId) };
      }
      let iniciado = false;
      try { iniciado = Boolean(sessionStorage.getItem(marcaIntentoFiscal(empresaId, ventaId))); } catch { /* optional client guard */ }
      if (accion === "reimprimir" && !iniciado) return { preparado: p, comun: true };
      if (iniciado) return { preparado: p, requiereAccion: "Hay un intento fiscal anterior. Consultá el resultado antes de reintentar; no repitas el cobro." };
      if (p.puntos.length !== 1) return { preparado: p, requiereAccion: "Elegí el punto de venta autorizado para continuar. No se cambió la configuración fiscal." };
      const configuracionImpresion = await leerImpresionFiscal(empresaId, p.puntos[0].numero);
      if (!configuracionImpresion.config || configuracionImpresion.faltantes?.length) return { preparado: p, configuracionImpresion, requiereAccion: "Completá los datos de impresión fiscal antes de emitir." };
      if (activo) setEstado("Emitiendo factura en ARCA…");
      return { preparado: p, ticket: await emitirFiscalCaja(empresaId, p, p.puntos[0].numero) };
    })();
    void inicioRef.current.then(async result => {
      if (!activo) return;
      setPreparado(result.preparado);
      if (result.configuracionImpresion) setConfigImpresion(result.configuracionImpresion);
      setPuntoVenta(String(result.preparado.comprobante?.punto_venta || result.preparado.puntos[0]?.numero || ""));
      setTipoCbte(String(result.preparado.comprobante?.tipo_cbte || 11));
      if (result.ticket) {
        setTicket(result.ticket); setEstado("Factura fiscal recuperada");
        if (!impresoRef.current && !result.ticket.advertencia) { impresoRef.current = true; await imprimir(result.ticket); }
      } else if (result.comun) {
        setEstado("Comprobante común · NO FISCAL");
        if (!impresoRef.current) { impresoRef.current = true; await imprimirTicketVenta(empresaId, ventaId, "80", true); }
      } else setEstado(result.requiereAccion || "Venta cobrada");
    }).catch(cause => { if (activo) { setError(cause instanceof Error ? cause.message : "No se pudo recuperar la factura. No repitas la venta."); setEstado("Venta cobrada · factura pendiente"); } })
      .finally(() => { if (activo) setOcupado(false); });
    return () => { activo = false; };
  }, [solicitud.requestId]);

  useEffect(() => {
    let activo = true;
    if (accion !== "historial") return;
    setOcupado(true); setError("");
    void Promise.resolve(supabase.from("ventas_sigo").select("id,numero,total,created_at").eq("empresa_id", empresaId).eq("estado", "confirmada").is("anulada_at", null).order("created_at", { ascending: false }).range(offset, offset + 49))
      .then(({ data, error: e }) => {
        if (!activo) return;
        if (e) { setError("No se pudo cargar el historial."); return; }
        setVentas(data || []); setHayMas((data?.length || 0) === 50); setSeleccion(data?.[0]?.id || "");
      }).finally(() => { if (activo) setOcupado(false); });
    return () => { activo = false; };
  }, [empresaId, accion, offset]);

  async function consultar(imprimirDespues = false) {
    const target = seleccion || ventaId;
    if (!target || accionEnCurso.current) return;
    accionEnCurso.current = true; setOcupado(true); setError(""); setTicket(null); setEstado("Consultando comprobante original…");
    try {
      const p = await prepararFiscalCaja(empresaId, target); setPreparado(p);
      setPuntoVenta(String(p.comprobante?.punto_venta || p.puntos[0]?.numero || ""));
      setTipoCbte(String(p.comprobante?.tipo_cbte || 11));
      if (p.comprobante) {
        const c = await recuperarFiscalCaja(empresaId, target); setTicket(c); setEstado("Factura fiscal original · sin nueva emisión");
        if (imprimirDespues) await imprimir(c);
      } else {
        let intentoFiscal = false;
        try { intentoFiscal = Boolean(sessionStorage.getItem(marcaIntentoFiscal(empresaId, target))); } catch { /* optional guard */ }
        if (intentoFiscal) { setEstado("Hay un intento fiscal pendiente de verificar. No se imprimió un ticket común ni se repitió la emisión."); return; }
        setEstado("Esta venta no tiene factura fiscal registrada. Comprobante común NO FISCAL.");
        if (imprimirDespues) await imprimirTicketVenta(empresaId, target, "80", true);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo consultar el comprobante original."); }
    finally { accionEnCurso.current = false; setOcupado(false); }
  }
  async function emitirExplicito() {
    if (accionEnCurso.current || accion !== "emitir" || !ventaId) return;
    accionEnCurso.current = true; setOcupado(true); setError(""); setEstado("Emitiendo factura en ARCA…");
    try {
      const p = await prepararFiscalCaja(empresaId, ventaId); setPreparado(p);
      if (p.comprobante?.cae) { const c = await recuperarFiscalCaja(empresaId, ventaId); setTicket(c); await imprimir(c); return; }
      const configuracionImpresion = await leerImpresionFiscal(empresaId, Number(puntoVenta));
      if (!configuracionImpresion.config || configuracionImpresion.faltantes?.length) { setConfigImpresion(configuracionImpresion); setEstado("Completá los datos de impresión fiscal antes de emitir."); return; }
      const c = await emitirFiscalCaja(empresaId, p, Number(puntoVenta), Number(tipoCbte));
      setTicket(c); await imprimir(c);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo emitir. No repitas la venta."); }
    finally { accionEnCurso.current = false; setOcupado(false); }
  }
  const filtradas = ventas.filter(v => `${v.numero} ${v.total} ${new Date(v.created_at).toLocaleDateString("es-AR")}`.includes(busqueda.trim()));
  return <section className="panel arca-card arca-emit-card" aria-busy={ocupado}>
    <div className="panel-header"><h3>{accion === "historial" ? "Reimprimir comprobantes" : "Ticket fiscal de caja"}</h3></div>
    <p role="status">{estado}</p>
    {preparado ? <p>Venta {preparado.venta.numero} · $ {Number(preparado.venta.total).toLocaleString("es-AR")}</p> : null}
    {accion === "historial" ? <div className="form-grid">
      <label>Buscar en esta página<input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Venta, importe o fecha" /></label>
      <label>Venta<select value={seleccion} disabled={ocupado} onChange={e => { setSeleccion(e.target.value); setTicket(null); setPreparado(null); }}><option value="">Elegir venta</option>{filtradas.map(v => <option key={v.id} value={v.id}>Venta {v.numero} · $ {v.total} · {new Date(v.created_at).toLocaleString("es-AR")}</option>)}</select></label>
      <div className="form-actions"><button disabled={ocupado || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 50))}>Más recientes</button><button disabled={ocupado || !hayMas} onClick={() => setOffset(n => n + 50)}>Anteriores</button><button disabled={ocupado || !seleccion} onClick={() => void consultar(true)}>Reimprimir comprobante original</button></div>
    </div> : null}
    {configImpresion && (!configImpresion.config || configImpresion.faltantes?.length) ? <FiscalPrintSetup empresaId={empresaId} puntoVenta={Number(puntoVenta)} configuracion={configImpresion} alGuardar={c => { setConfigImpresion(c); setEstado("Datos de impresión guardados. Continuá con esta misma venta, sin repetir el cobro."); }} /> : null}
    {accion === "emitir" && !ticket && !ocupado ? <div className="form-grid">
      <label>Punto de venta autorizado<select value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)}><option value="">Elegir</option>{preparado?.puntos.map(p => <option key={p.numero} value={p.numero}>{p.numero}</option>)}</select></label>
      <label>Tipo de factura<select value={tipoCbte} onChange={e => setTipoCbte(e.target.value)} disabled={Boolean(preparado?.comprobante)}><option value="11">Factura C</option><option value="6">Factura B</option><option value="1">Factura A</option></select></label>
      <button disabled={!puntoVenta || Boolean(preparado?.comprobante?.cae) || Boolean(configImpresion && (!configImpresion.config || configImpresion.faltantes?.length))} onClick={() => void emitirExplicito()}>Continuar emisión de esta venta</button>
    </div> : null}
    {ticket ? <>{ticket.advertencia ? <p role="alert">{ticket.advertencia}</p> : null}<p>CAE {ticket.cae} · Factura {String(ticket.punto_venta).padStart(5, "0")}-{String(ticket.numero_cbte).padStart(8, "0")}</p><button disabled={ocupado} onClick={() => { if (accionEnCurso.current) return; accionEnCurso.current = true; setOcupado(true); void imprimir(ticket).catch(e => setError(e.message)).finally(() => { accionEnCurso.current = false; setOcupado(false); }); }}>Reimprimir fiscal 58 mm</button><button disabled={ocupado} onClick={() => { if (accionEnCurso.current) return; accionEnCurso.current = true; setOcupado(true); void imprimirTicketFiscal(ticket, "a4", () => cerrarConFactura(ticket)).catch(e => setError(e.message)).finally(() => { accionEnCurso.current = false; setOcupado(false); }); }}>Imprimir factura A4</button></> : null}
    <div className="form-actions"><button disabled={ocupado || !(seleccion || ventaId)} onClick={() => void consultar()}>Consultar resultado sin emitir</button><button onClick={() => ticket ? cerrarConFactura(ticket) : alCerrar()}>Volver a caja</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <small>Impresión de 58 mm. Elegí POS-58 (copy 1), escala 100% y desactivá encabezados/pies en el diálogo. SIGO no modifica Windows ni el controlador.</small>
  </section>;
}
