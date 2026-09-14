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

type ItemVenta = {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  nombre: string;
};

type ClienteFiscal = {
  nombre: string;
  documento: string | null;
  condicion_iva_receptor_id: number | null;
};

type EmisorFiscal = {
  cuit_emisor: string;
  razon_social: string | null;
};

type ComprobanteImprimible = Comprobante & {
  ventaNumero: number;
  total: number;
  fecha: string;
  tipoCbteSeleccionado: number;
  condicionIvaReceptorId: number;
  receptorCuit: string;
  receptorRazonSocial: string;
  emisorCuit: string;
  emisorRazonSocial: string;
  items: ItemVenta[];
};

const ERROR_MESSAGES: Record<string, string> = {
  ARCA_AUTH_NOT_VALIDATED: "Primero debe aprobarse la autenticación WSAA y la validación WSFEv1.",
  ARCA_TICKET_REFRESH_REQUIRED: "El Ticket de Acceso venció o no está disponible. Volvé a autenticar WSAA; SIGO no solicitará un segundo ticket mientras exista uno vigente.",
  ARCA_PRODUCT_FISCAL_DATA_REQUIRED: "La venta contiene productos sin clasificación fiscal de IVA.",
  ARCA_PRODUCT_PRICE_TAX_MODE_UNSUPPORTED: "La venta contiene productos cuyo precio no está marcado como IVA incluido.",
  ARCA_CLIENT_FISCAL_DATA_REQUIRED: "El cliente no tiene documento y condición frente al IVA completos.",
  ARCA_RECEPTOR_CUIT_REQUIRED: "Ingresá un CUIT válido de 11 dígitos para el receptor.",
  ARCA_RECEPTOR_RAZON_SOCIAL_REQUIRED: "Ingresá la razón social del receptor.",
  ARCA_INVOICE_A_CLIENT_REQUIRED: "Factura A requiere CUIT y condición IVA Responsable Inscripto.",
  ARCA_SALE_RESERVED_WITH_OTHER_FISCAL_IDENTITY: "La venta ya reservó otro punto de venta o tipo de comprobante. SIGO no duplicó la emisión.",
  ARCA_CONSUMER_IVA_CONDITION_REQUIRED: "Seleccioná la condición frente al IVA del consumidor final.",
  ARCA_PRODUCTION_CONFIRMATION_REQUIRED: "La emisión productiva requiere confirmación explícita.",
  ARCA_CAE_REJECTED: "ARCA rechazó el comprobante. Revisá el diagnóstico mostrado debajo.",
  ARCA_NUMBER_RESERVATION_CONFLICT: "Otra emisión tomó ese número. Reintentá para obtener el siguiente.",
  ARCA_TIMEOUT: "ARCA no respondió a tiempo. Reintentá: SIGO conciliará antes de volver a solicitar.",
};

function soloDigitos(value: string) {
  return value.replace(/\D/g, "");
}

function moneda(value: number) {
  return `$${Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaVisible(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("es-AR");
}

function tipoComprobanteLabel(tipo: number) {
  if (tipo === 1) return "Factura A";
  if (tipo === 6) return "Factura B";
  return "Factura C";
}

function condicionIvaLabel(condicion: number) {
  if (condicion === 1) return "IVA Responsable Inscripto";
  if (condicion === 6) return "Responsable Monotributo";
  if (condicion === 4) return "IVA Exento";
  return "Consumidor Final";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
  const [receptorCuit, setReceptorCuit] = useState("");
  const [receptorRazonSocial, setReceptorRazonSocial] = useState("");
  const [emisor, setEmisor] = useState<EmisorFiscal | null>(null);
  const [clienteFiscal, setClienteFiscal] = useState<ClienteFiscal | null>(null);
  const [itemsVenta, setItemsVenta] = useState<ItemVenta[]>([]);
  const [loading, setLoading] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [comprobante, setComprobante] = useState<Comprobante | null>(null);
  const [ultimoComprobante, setUltimoComprobante] = useState<ComprobanteImprimible | null>(null);

  const puntosActivos = useMemo(
    () => puntos.filter((pv) => pv.activo && pv.ambiente === ambiente),
    [ambiente, puntos],
  );
  const venta = ventas.find((item) => item.id === ventaId) ?? null;
  const requiereDatosFiscales = Boolean(!venta?.cliente_id && ["1", "6"].includes(condicionIva));

  async function cargarVentas() {
    setLoading(true);
    setError("");
    try {
      const [{ data: rows, error: salesError }, { data: emitidas, error: issuedError }, { data: fiscal, error: fiscalError }] = await Promise.all([
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
        supabase
          .from("arca_config")
          .select("cuit_emisor,razon_social")
          .eq("empresa_id", empresaId)
          .maybeSingle(),
      ]);
      if (salesError) throw salesError;
      if (issuedError) throw issuedError;
      if (fiscalError) throw fiscalError;
      const facturadas = new Set((emitidas ?? []).map((item) => String(item.venta_id || "")));
      const disponibles = ((rows ?? []) as Venta[]).filter((item) => !facturadas.has(item.id));
      setVentas(disponibles);
      setVentaId((actual) => disponibles.some((item) => item.id === actual) ? actual : disponibles[0]?.id ?? "");
      setEmisor((fiscal ?? null) as EmisorFiscal | null);
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

  useEffect(() => {
    let cancelado = false;
    async function cargarDetalleVenta() {
      setItemsVenta([]);
      setClienteFiscal(null);
      if (!venta) return;
      try {
        const { data: items, error: itemsError } = await supabase
          .from("venta_items_sigo")
          .select("producto_id,cantidad,precio_unitario,subtotal")
          .eq("empresa_id", empresaId)
          .eq("venta_id", venta.id);
        if (itemsError) throw itemsError;

        const ids = [...new Set((items ?? []).map((item) => String(item.producto_id || "")).filter(Boolean))];
        let nombres = new Map<string, string>();
        if (ids.length > 0) {
          const { data: productos, error: productosError } = await supabase
            .from("productos")
            .select("id,nombre")
            .eq("empresa_id", empresaId)
            .in("id", ids);
          if (productosError) throw productosError;
          nombres = new Map((productos ?? []).map((producto) => [String(producto.id), String(producto.nombre || "Producto")]));
        }

        if (!cancelado) {
          setItemsVenta((items ?? []).map((item) => ({
            producto_id: String(item.producto_id || ""),
            cantidad: Number(item.cantidad || 0),
            precio_unitario: Number(item.precio_unitario || 0),
            subtotal: Number(item.subtotal || 0),
            nombre: nombres.get(String(item.producto_id || "")) || "Producto",
          })));
        }

        if (venta.cliente_id) {
          const { data: cliente, error: clienteError } = await supabase
            .from("clientes_sigo")
            .select("nombre,documento,condicion_iva_receptor_id")
            .eq("empresa_id", empresaId)
            .eq("id", venta.cliente_id)
            .maybeSingle();
          if (clienteError) throw clienteError;
          if (!cancelado) setClienteFiscal((cliente ?? null) as ClienteFiscal | null);
        }
      } catch (cause) {
        console.warn("No se pudo cargar el detalle imprimible de la venta", cause);
      }
    }
    void cargarDetalleVenta();
    return () => { cancelado = true; };
  }, [empresaId, ventaId, venta?.cliente_id]);

  function construirHtmlImpresion(formato: "a4" | "80" | "58") {
    if (!ultimoComprobante) return "";
    const c = ultimoComprobante;
    const termico = formato !== "a4";
    const ancho = formato === "58" ? "50mm" : formato === "80" ? "72mm" : "190mm";
    const pageSize = formato === "a4" ? "A4" : `${formato}mm auto`;
    const fontSize = formato === "58" ? "10px" : formato === "80" ? "11px" : "12px";
    const filas = c.items.length > 0
      ? c.items.map((item) => `<tr><td>${escapeHtml(item.nombre)}</td><td class="num">${item.cantidad}</td><td class="num">${escapeHtml(moneda(item.precio_unitario))}</td><td class="num">${escapeHtml(moneda(item.subtotal))}</td></tr>`).join("")
      : `<tr><td colspan="4">Venta SIGO #${c.ventaNumero}</td></tr>`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(tipoComprobanteLabel(c.tipoCbteSeleccionado))} ${String(c.punto_venta).padStart(4, "0")}-${String(c.numero_cbte).padStart(8, "0")}</title><style>
      @page{size:${pageSize};margin:${termico ? "3mm" : "10mm"}}
      *{box-sizing:border-box} body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:${fontSize}}
      .doc{width:${ancho};max-width:100%;margin:0 auto}.center{text-align:center}.muted{color:#555}.strong{font-weight:800}.line{border-top:1px dashed #777;margin:8px 0}
      h1{font-size:${termico ? "16px" : "22px"};margin:0 0 4px} h2{font-size:${termico ? "14px" : "18px"};margin:6px 0}
      .grid{display:grid;grid-template-columns:${termico ? "1fr" : "1fr 1fr"};gap:4px 18px}.box{border:1px solid #aaa;padding:8px;margin:8px 0}
      table{width:100%;border-collapse:collapse;margin-top:8px} th,td{padding:${termico ? "3px 2px" : "5px"};border-bottom:1px solid #ddd;vertical-align:top} th{text-align:left}.num{text-align:right;white-space:nowrap}
      .total{font-size:${termico ? "15px" : "18px"};font-weight:900;text-align:right;margin-top:10px}.footer{margin-top:12px;font-size:${termico ? "9px" : "11px"};line-height:1.4}
      @media print{button{display:none!important}}
    </style></head><body><main class="doc">
      <div class="center"><h1>${escapeHtml(c.emisorRazonSocial || "SIGO")}</h1><div>CUIT ${escapeHtml(c.emisorCuit || "—")}</div></div>
      <div class="line"></div><div class="center"><h2>${escapeHtml(tipoComprobanteLabel(c.tipoCbteSeleccionado))}</h2><div class="strong">${String(c.punto_venta).padStart(4, "0")}-${String(c.numero_cbte).padStart(8, "0")}</div></div><div class="line"></div>
      <div class="grid"><div><span class="muted">Fecha:</span> ${escapeHtml(fechaVisible(c.fecha))}</div><div><span class="muted">Venta SIGO:</span> #${c.ventaNumero}</div></div>
      <div class="box"><div class="strong">Receptor</div><div>${escapeHtml(c.receptorRazonSocial || "Consumidor Final")}</div>${c.receptorCuit ? `<div>CUIT ${escapeHtml(c.receptorCuit)}</div>` : ""}<div>${escapeHtml(condicionIvaLabel(c.condicionIvaReceptorId))}</div></div>
      <table><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">P.Unit.</th><th class="num">Subtotal</th></tr></thead><tbody>${filas}</tbody></table>
      <div class="total">TOTAL ${escapeHtml(moneda(c.total))}</div>
      <div class="line"></div><div><strong>CAE:</strong> ${escapeHtml(c.cae)}</div><div><strong>Vencimiento CAE:</strong> ${escapeHtml(fechaVisible(c.cae_vencimiento))}</div>
      <div class="footer center">Comprobante electrónico autorizado por ARCA · Emitido desde SIGO</div>
    </main></body></html>`;
  }

  function imprimir(formato: "a4" | "80" | "58") {
    const html = construirHtmlImpresion(formato);
    if (!html) return;
    const popup = window.open("", "_blank", "width=900,height=900");
    if (!popup) {
      setError("El navegador bloqueó la ventana de impresión. Habilitá ventanas emergentes para SIGO e intentá nuevamente.");
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  }

  function compartirWhatsApp() {
    if (!ultimoComprobante) return;
    const c = ultimoComprobante;
    const detalle = c.items.slice(0, 12).map((item) => `• ${item.cantidad} x ${item.nombre} = ${moneda(item.subtotal)}`).join("\n");
    const texto = [
      `${tipoComprobanteLabel(c.tipoCbteSeleccionado)} ${String(c.punto_venta).padStart(4, "0")}-${String(c.numero_cbte).padStart(8, "0")}`,
      c.emisorRazonSocial,
      c.emisorCuit ? `CUIT ${c.emisorCuit}` : "",
      c.receptorRazonSocial ? `Cliente: ${c.receptorRazonSocial}` : "",
      c.receptorCuit ? `CUIT cliente: ${c.receptorCuit}` : "",
      detalle,
      `TOTAL ${moneda(c.total)}`,
      `CAE ${c.cae}`,
      c.cae_vencimiento ? `Vencimiento CAE ${fechaVisible(c.cae_vencimiento)}` : "",
      "Emitido desde SIGO",
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  }

  async function emitir() {
    if (!venta || !puntoVenta || emitiendo) return;

    const cuit = soloDigitos(receptorCuit);
    if (requiereDatosFiscales && cuit.length !== 11) {
      setError("Ingresá un CUIT válido de 11 dígitos para el receptor.");
      return;
    }
    if (requiereDatosFiscales && receptorRazonSocial.trim().length < 2) {
      setError("Ingresá la razón social del receptor.");
      return;
    }

    const esProduccion = ambiente === "produccion";
    const receptorTexto = requiereDatosFiscales ? ` · ${receptorRazonSocial.trim()} · CUIT ${cuit}` : "";
    const mensaje = esProduccion
      ? `Vas a solicitar un CAE REAL para la venta ${venta.numero} por $${Number(venta.total).toLocaleString("es-AR")}${receptorTexto}. Esta acción tiene efecto fiscal. ¿Confirmás?`
      : `Vas a solicitar un CAE de HOMOLOGACIÓN para la venta ${venta.numero}${receptorTexto}. No tiene efecto fiscal real. ¿Continuar?`;
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
          receptorCuit: requiereDatosFiscales ? cuit : null,
          receptorRazonSocial: requiereDatosFiscales ? receptorRazonSocial.trim() : null,
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
      const emitido = payload.comprobante as Comprobante;
      setComprobante(emitido);
      const condicionReceptor = venta.cliente_id
        ? Number(clienteFiscal?.condicion_iva_receptor_id || condicionIva || 5)
        : Number(condicionIva || 5);
      const cuitReceptor = venta.cliente_id ? soloDigitos(clienteFiscal?.documento || "") : (requiereDatosFiscales ? cuit : "");
      const nombreReceptor = venta.cliente_id
        ? (clienteFiscal?.nombre || "Cliente registrado")
        : (requiereDatosFiscales ? receptorRazonSocial.trim() : "Consumidor Final");
      setUltimoComprobante({
        ...emitido,
        ventaNumero: venta.numero,
        total: Number(venta.total),
        fecha: new Date().toISOString(),
        tipoCbteSeleccionado: Number(tipoCbte),
        condicionIvaReceptorId: condicionReceptor,
        receptorCuit: cuitReceptor,
        receptorRazonSocial: nombreReceptor,
        emisorCuit: emisor?.cuit_emisor || "",
        emisorRazonSocial: emisor?.razon_social || "SIGO",
        items: itemsVenta,
      });
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
        {requiereDatosFiscales ? (
          <>
            <div className="form-group">
              <label>CUIT del cliente *</label>
              <input
                value={receptorCuit}
                onChange={(event) => setReceptorCuit(soloDigitos(event.target.value).slice(0, 11))}
                inputMode="numeric"
                placeholder="11 dígitos"
                maxLength={11}
                disabled={emitiendo}
              />
            </div>
            <div className="form-group">
              <label>Razón social *</label>
              <input
                value={receptorRazonSocial}
                onChange={(event) => setReceptorRazonSocial(event.target.value.slice(0, 160))}
                placeholder="Nombre o razón social"
                disabled={emitiendo}
              />
            </div>
          </>
        ) : null}
      </div>
      <button className="primary-button" type="button" onClick={() => void emitir()} disabled={!habilitado || !ventaId || !puntoVenta || emitiendo}>
        {emitiendo ? "Solicitando y conciliando…" : ambiente === "produccion" ? "Emitir CAE real" : "Probar CAE en homologación"}
      </button>
      {!habilitado ? <small>Bloqueado hasta validar WSAA + WSFEv1 en esta empresa.</small> : null}
      {requiereDatosFiscales ? <small>Para Responsable Inscripto o Monotributista, SIGO enviará el CUIT a ARCA como documento fiscal del receptor.</small> : null}
      {ambiente === "produccion" ? <small>Producción: SIGO pedirá una confirmación explícita antes de cada emisión real.</small> : <small>Homologación: el comprobante no tiene efecto fiscal real.</small>}
      {comprobante ? <p className="sigo-matriz-success" role="status">CAE {comprobante.cae} · Comprobante {String(comprobante.punto_venta).padStart(4, "0")}-{String(comprobante.numero_cbte).padStart(8, "0")}{comprobante.cae_vencimiento ? ` · vence ${comprobante.cae_vencimiento}` : ""}</p> : null}
      {ultimoComprobante ? (
        <div className="form-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <button className="admin-button" type="button" onClick={() => imprimir("a4")}>🖨 Imprimir A4</button>
          <button className="admin-button" type="button" onClick={() => imprimir("80")}>🧾 Ticket 80 mm</button>
          <button className="admin-button" type="button" onClick={() => imprimir("58")}>🧾 Ticket 58 mm</button>
          <button className="primary-button" type="button" onClick={compartirWhatsApp}>WhatsApp</button>
        </div>
      ) : null}
      {ultimoComprobante ? <small>Las opciones 80 mm y 58 mm están preparadas para impresoras térmicas instaladas o vinculadas al dispositivo.</small> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {diagnostico ? <small role="alert">{diagnostico}</small> : null}
    </section>
  );
}
