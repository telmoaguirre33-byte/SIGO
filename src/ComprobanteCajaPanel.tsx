import { useEffect, useRef, useState } from "react";
import { dineroComprobante, emitirFacturaCaja, leerOpcionesFiscal, recuperarDocumentoCaja, tipoFactura, type DocumentoCaja, type FormatoComprobante, type OpcionesFiscal } from "./comprobanteCaja";
import { compartirPdfWhatsApp, crearPdfComprobante, descargarPdf, imprimirPdf } from "./comprobantePdf";

export type AccionComprobante = "fiscal" | "reimprimir" | "whatsapp";
export default function ComprobanteCajaPanel({ empresaId, ventaId, accion, onCerrar, formatoInicial = "80" }: { empresaId: string; ventaId: string; accion: AccionComprobante; onCerrar: () => void; formatoInicial?: FormatoComprobante }) {
  const [doc, setDoc] = useState<DocumentoCaja | null>(null);
  const [options, setOptions] = useState<OpcionesFiscal | null>(null);
  const [punto, setPunto] = useState(""); const [tipo, setTipo] = useState("11"); const [condicion, setCondicion] = useState("5");
  const [formato, setFormato] = useState<FormatoComprobante>(formatoInicial);
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(true);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const lock = useRef(false), active = useRef(true), generation = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    active.current = true;
    async function load() {
      try {
        const recovered = await recuperarDocumentoCaja(empresaId, ventaId);
        if (!active.current) return;
        setDoc(recovered);
        if (accion === "fiscal" && !recovered.fiscal) {
          const opts = await leerOpcionesFiscal(empresaId, recovered.venta);
          if (!active.current) return;
          setOptions(opts); setPunto(opts.puntos[0] ? String(opts.puntos[0]) : "");
          setCondicion(String(opts.cliente?.condicion_iva_receptor_id || 5));
        }
      } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "No se pudo recuperar el comprobante."); }
      finally { if (active.current) setBusy(false); }
    }
    void load(); return () => { active.current = false; generation.current++; };
  }, [empresaId, ventaId, accion]);

  useEffect(() => {
    const version = ++generation.current;
    setFile(null);
    if (!doc || (accion === "fiscal" && !doc.fiscal)) return;
    void crearPdfComprobante(doc, formato).then((pdf) => { if (active.current && generation.current === version) setFile(pdf); })
      .catch((e) => { if (active.current && generation.current === version) setError(e.message); });
  }, [doc, formato, accion]);

  async function emitir() {
    if (!doc || !options || busy || lock.current) return;
    const real = options.ambiente === "produccion";
    if (!window.confirm(`Venta Nº ${doc.venta.numero} · ${dineroComprobante(doc.venta.total)} · ${tipoFactura(Number(tipo))} · Punto ${punto}. ${real ? "Se emitirá un comprobante fiscal REAL con efecto fiscal." : "Se solicitará un comprobante de homologación, sin efecto fiscal real."} ¿Confirmás la emisión?`)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await emitirFacturaCaja(empresaId, ventaId, options, Number(punto), Number(tipo), Number(condicion));
      if (active.current) { setDoc(next); setNotice("Factura autorizada. Elegí el formato e imprimí el original."); }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "La emisión no pudo verificarse. Recuperá el comprobante antes de reintentar."); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function compartir() {
    if (!file || !doc) return;
    const result = await compartirPdfWhatsApp(file, doc);
    if (active.current) setNotice(result === "descargado" ? `PDF descargado: ${file.name}. En WhatsApp, pulsá Adjuntar → Documento y seleccioná este archivo. Revisá el destinatario y confirmá el envío.` : result === "compartido" ? "PDF preparado para compartir." : "Envío cancelado.");
  }
  const heading = accion === "fiscal" ? "Factura fiscal de la última venta" : accion === "whatsapp" ? "Enviar comprobante PDF por WhatsApp" : "Reimprimir último comprobante";
  return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0008", display: "grid", placeItems: "center" }}><section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={heading} className="panel" style={{ width: "min(900px, 92vw)", maxHeight: "84vh", overflow: "auto", background: "white", color: "#111", padding: 24 }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) onCerrar();
      if (event.key === "Tab") {
        const targets = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)") || []);
        const index = targets.indexOf(document.activeElement as HTMLElement);
        if (targets.length && (index < 0 || (!event.shiftKey && index === targets.length - 1) || (event.shiftKey && index === 0))) {
          event.preventDefault(); targets[event.shiftKey ? targets.length - 1 : 0].focus();
        }
      }
    }}>
    <h2>{heading}</h2><button type="button" autoFocus disabled={busy} onClick={onCerrar}>Volver a Caja</button>
    {busy && <p role="status">Recuperando o autorizando comprobante…</p>}
    {error && <p role="alert">{error}</p>}
    {doc && <><p><strong>{doc.comercio}</strong> · Venta Nº {doc.venta.numero} · <strong>Total {dineroComprobante(doc.venta.total)}</strong></p>
      {doc.fiscal ? <p>{tipoFactura(doc.fiscal.tipo_cbte)} {String(doc.fiscal.punto_venta).padStart(4, "0")}-{String(doc.fiscal.numero_cbte).padStart(8, "0")} · CAE {doc.fiscal.cae} · Vencimiento {doc.fiscal.cae_vencimiento}</p> : <p>Ticket comercial · Comprobante no fiscal.</p>}
      {options && !doc.fiscal && <fieldset disabled={busy}><legend>Confirmar factura de esta venta</legend>
        <label>Punto de venta <select value={punto} onChange={(e) => setPunto(e.target.value)}>{options.puntos.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Tipo de factura <select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="11">Factura C</option><option value="6">Factura B</option><option value="1">Factura A</option></select></label>
        <label>Condición IVA receptor <select disabled={Boolean(options.cliente)} value={condicion} onChange={(e) => setCondicion(e.target.value)}><option value="5">Consumidor final</option><option value="1">Responsable inscripto</option><option value="6">Monotributo</option><option value="4">Exento</option></select></label>
        {options.cliente && <p>Cliente registrado: {options.cliente.nombre} · Documento {options.cliente.documento}</p>}
        <button type="button" disabled={!punto || busy} onClick={() => void emitir()}>Autorizar factura de esta venta</button>
      </fieldset>}
      {!(accion === "fiscal" && !doc.fiscal) && <><label>Formato <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoComprobante)}><option value="58">Ticket 58 mm</option><option value="80">Ticket 80 mm</option><option value="a4">A4</option></select></label>
        <button type="button" disabled={!file || busy} onClick={() => { if (file) void imprimirPdf(file); }}>Imprimir comprobante</button>
        <button type="button" disabled={!file || busy} onClick={() => { if (file) descargarPdf(file); }}>Descargar PDF</button>
        <button type="button" disabled={!file || busy} onClick={() => void compartir().catch((e) => setError(e.message))}>Compartir PDF por WhatsApp</button>
        {doc.fiscal && <p>Se recuperó el original autorizado. Imprimir o compartir no emite otra factura.</p>}
      </>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section></div>;
}
