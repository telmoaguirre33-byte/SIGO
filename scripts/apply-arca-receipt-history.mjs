import fs from "node:fs";

const path = "src/ArcaCaeEmission.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`ARCA_RECEIPT_HISTORY_TARGET_NOT_FOUND:${label}`);
  source = source.replace(from, to);
}

// La pantalla de facturación debe mostrar ventas recientes, no solamente las que aún
// no tienen CAE. Así una venta ya facturada sigue disponible para reimpresión.
replaceRequired(
  `.order("created_at", { ascending: false })\n          .limit(30),`,
  `.order("created_at", { ascending: false })\n          .limit(500),`,
  "sales-limit",
);

replaceRequired(
  `.from("arca_comprobantes")\n          .select("venta_id")\n          .eq("empresa_id", empresaId)\n          .not("cae", "is", null),`,
  `.from("arca_comprobantes")\n          .select("venta_id,punto_venta,tipo_cbte,numero_cbte,cae,cae_vencimiento,emitido_at")\n          .eq("empresa_id", empresaId)\n          .not("cae", "is", null)\n          .order("emitido_at", { ascending: false })\n          .limit(500),`,
  "issued-query",
);

const stateMarker = `  const [ultimoComprobante, setUltimoComprobante] = useState<ComprobanteImprimible | null>(null);`;
const stateBlock = `${stateMarker}\n  const [comprobantesEmitidos, setComprobantesEmitidos] = useState<Array<Comprobante & { venta_id: string; emitido_at: string | null }>>([]);\n  const [busquedaVenta, setBusquedaVenta] = useState("");`;
if (!source.includes("const [comprobantesEmitidos")) {
  if (!source.includes(stateMarker)) throw new Error("ARCA_RECEIPT_HISTORY_TARGET_NOT_FOUND:state");
  source = source.replace(stateMarker, stateBlock);
}

const derivedMarker = `  const requiereDatosFiscales = Boolean(!venta?.cliente_id && ["1", "6"].includes(condicionIva));`;
const derivedBlock = `${derivedMarker}\n  const comprobanteVenta = comprobantesEmitidos.find((item) => item.venta_id === ventaId) ?? null;\n  const ventasFiltradas = useMemo(() => {\n    const q = busquedaVenta.trim().toLocaleLowerCase("es-AR");\n    if (!q) return ventas;\n    const qSinSeparadores = q.replace(/[.$\\s-]/g, "");\n    return ventas.filter((item) => {\n      const facturada = comprobantesEmitidos.some((cbte) => cbte.venta_id === item.id);\n      const fecha = new Date(item.created_at).toLocaleString("es-AR");\n      const total = Number(item.total || 0);\n      const texto = [\n        item.numero,\n        total,\n        total.toLocaleString("es-AR"),\n        fecha,\n        facturada ? "facturada factura comprobante cae" : "sin factura pendiente",\n      ].join(" ").toLocaleLowerCase("es-AR");\n      return texto.includes(q) || texto.replace(/[.$\\s-]/g, "").includes(qSinSeparadores);\n    });\n  }, [busquedaVenta, comprobantesEmitidos, ventas]);`;
if (!source.includes("const ventasFiltradas = useMemo")) {
  if (!source.includes(derivedMarker)) throw new Error("ARCA_RECEIPT_HISTORY_TARGET_NOT_FOUND:derived");
  source = source.replace(derivedMarker, derivedBlock);
}

const oldAvailable = `      const facturadas = new Set((emitidas ?? []).map((item) => String(item.venta_id || "")));\n      const disponibles = ((rows ?? []) as Venta[]).filter((item) => !facturadas.has(item.id));\n      setVentas(disponibles);\n      setVentaId((actual) => disponibles.some((item) => item.id === actual) ? actual : disponibles[0]?.id ?? "");\n      setEmisor((fiscal ?? null) as EmisorFiscal | null);`;
const newAvailable = `      const recientes = (rows ?? []) as Venta[];\n      const emitidasValidas = ((emitidas ?? []) as Array<Comprobante & { venta_id?: string | null; emitido_at?: string | null }>)\n        .filter((item) => Boolean(item.venta_id && item.cae))\n        .map((item) => ({\n          punto_venta: Number(item.punto_venta),\n          tipo_cbte: Number(item.tipo_cbte),\n          numero_cbte: Number(item.numero_cbte),\n          cae: String(item.cae),\n          cae_vencimiento: item.cae_vencimiento ?? null,\n          venta_id: String(item.venta_id),\n          emitido_at: item.emitido_at ? String(item.emitido_at) : null,\n        }));\n      setVentas(recientes);\n      setComprobantesEmitidos(emitidasValidas);\n      setVentaId((actual) => recientes.some((item) => item.id === actual) ? actual : recientes[0]?.id ?? "");\n      setEmisor((fiscal ?? null) as EmisorFiscal | null);`;
replaceRequired(oldAvailable, newAvailable, "available-sales");

const printMarker = `  function construirHtmlImpresion(formato: "a4" | "80" | "58") {`;
if (!source.includes("SIGO_RECEIPT_SELECTED_SALE")) {
  const selectedReceiptEffect = `  // SIGO_RECEIPT_SELECTED_SALE\n  useEffect(() => {\n    if (!venta) {\n      setComprobante(null);\n      setUltimoComprobante(null);\n      return;\n    }\n\n    if (!comprobanteVenta?.cae) {\n      setComprobante(null);\n      setUltimoComprobante(null);\n      return;\n    }\n\n    const condicionReceptor = venta.cliente_id\n      ? Number(clienteFiscal?.condicion_iva_receptor_id || (Number(comprobanteVenta.tipo_cbte) === 1 ? 1 : 5))\n      : (Number(comprobanteVenta.tipo_cbte) === 1 ? 1 : 5);\n    const receptorDocumento = venta.cliente_id ? soloDigitos(clienteFiscal?.documento || "") : "";\n    const receptorNombre = venta.cliente_id ? (clienteFiscal?.nombre || "Cliente registrado") : "Consumidor Final";\n\n    const recuperado: Comprobante = {\n      punto_venta: Number(comprobanteVenta.punto_venta),\n      tipo_cbte: Number(comprobanteVenta.tipo_cbte),\n      numero_cbte: Number(comprobanteVenta.numero_cbte),\n      cae: String(comprobanteVenta.cae),\n      cae_vencimiento: comprobanteVenta.cae_vencimiento ?? null,\n    };\n    setComprobante(recuperado);\n    setUltimoComprobante({\n      ...recuperado,\n      ventaNumero: Number(venta.numero),\n      total: Number(venta.total),\n      fecha: comprobanteVenta.emitido_at || venta.created_at || new Date().toISOString(),\n      tipoCbteSeleccionado: Number(comprobanteVenta.tipo_cbte),\n      condicionIvaReceptorId: condicionReceptor,\n      receptorCuit: receptorDocumento,\n      receptorRazonSocial: receptorNombre,\n      emisorCuit: emisor?.cuit_emisor || "",\n      emisorRazonSocial: emisor?.razon_social || "SIGO",\n      items: itemsVenta,\n    });\n  }, [\n    venta?.id,\n    venta?.numero,\n    venta?.total,\n    venta?.created_at,\n    venta?.cliente_id,\n    comprobanteVenta?.cae,\n    comprobanteVenta?.cae_vencimiento,\n    comprobanteVenta?.emitido_at,\n    comprobanteVenta?.numero_cbte,\n    comprobanteVenta?.punto_venta,\n    comprobanteVenta?.tipo_cbte,\n    clienteFiscal,\n    emisor,\n    itemsVenta,\n  ]);\n\n${printMarker}`;
  if (!source.includes(printMarker)) throw new Error("ARCA_RECEIPT_HISTORY_TARGET_NOT_FOUND:selected-receipt");
  source = source.replace(printMarker, selectedReceiptEffect);
}

const oldSaleField = `        <div className="form-group form-span-2">\n          <label>Venta confirmada</label>\n          <select value={ventaId} onChange={(event) => setVentaId(event.target.value)} disabled={loading || emitiendo}>\n            {ventas.length === 0 ? <option value="">No hay ventas pendientes de CAE</option> : null}\n            {ventas.map((item) => <option key={item.id} value={item.id}>Venta {item.numero} · $\${Number(item.total).toLocaleString("es-AR")}</option>)}\n          </select>\n        </div>`;
const newSaleField = `        <div className="form-group form-span-2">\n          <label>Buscar venta / ticket</label>\n          <input\n            type="search"\n            value={busquedaVenta}\n            onChange={(event) => setBusquedaVenta(event.target.value)}\n            placeholder="N.º de venta, importe (ej. 23000) o fecha"\n            disabled={loading || emitiendo}\n          />\n        </div>\n        <div className="form-group form-span-2">\n          <label>Venta para facturar o reimprimir</label>\n          <select value={ventaId} onChange={(event) => setVentaId(event.target.value)} disabled={loading || emitiendo}>\n            {ventasFiltradas.length === 0 ? <option value="">No se encontraron ventas recientes</option> : null}\n            {ventasFiltradas.map((item) => {\n              const facturada = comprobantesEmitidos.some((cbte) => cbte.venta_id === item.id);\n              return <option key={item.id} value={item.id}>Venta {item.numero} · $\${Number(item.total).toLocaleString("es-AR")} · {new Date(item.created_at).toLocaleString("es-AR")} · {facturada ? "FACTURADA / REIMPRIMIR" : "SIN FACTURAR"}</option>;\n            })}\n          </select>\n          <div className="form-actions" style={{ marginTop: 8 }}>\n            <button className="admin-button" type="button" onClick={() => void cargarVentas()} disabled={loading || emitiendo}>{loading ? "Actualizando…" : "↻ Actualizar ventas"}</button>\n          </div>\n        </div>`;
replaceRequired(oldSaleField, newSaleField, "sale-picker");

const oldButton = `      <button className="primary-button" type="button" onClick={() => void emitir()} disabled={!habilitado || !ventaId || !puntoVenta || emitiendo}>\n        {emitiendo ? "Solicitando y conciliando…" : ambiente === "produccion" ? "Emitir CAE real" : "Probar CAE en homologación"}\n      </button>`;
const newButton = `      <button className="primary-button" type="button" onClick={() => void emitir()} disabled={!habilitado || !ventaId || !puntoVenta || emitiendo || Boolean(comprobanteVenta?.cae)}>\n        {comprobanteVenta?.cae\n          ? "Factura ya emitida — usar Reimprimir / Compartir"\n          : emitiendo\n            ? "Emitiendo factura…"\n            : ambiente === "produccion"\n              ? "Emitir factura"\n              : "Probar factura en homologación"}\n      </button>`;
replaceRequired(oldButton, newButton, "emit-button");

replaceRequired(
  `<div className="panel-header"><div><h3>4. Emisión desde SIGO</h3><p>Seleccioná una venta confirmada. SIGO concilia el número antes de solicitar el CAE.</p></div></div>`,
  `<div className="panel-header"><div><h3>4. Facturación y comprobantes</h3><p>Elegí cualquier venta reciente: podés emitir su factura o recuperar el comprobante original para reimprimirlo y enviarlo al cliente.</p></div></div>`,
  "header",
);

const buttonsMarker = `      {ultimoComprobante ? (\n        <div className="form-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>`;
if (!source.includes("Comprobante recuperado de la venta seleccionada")) {
  if (!source.includes(buttonsMarker)) throw new Error("ARCA_RECEIPT_HISTORY_TARGET_NOT_FOUND:buttons-message");
  source = source.replace(buttonsMarker, `      {comprobanteVenta?.cae && ultimoComprobante ? <p className="sigo-matriz-success" role="status">Comprobante recuperado de la venta seleccionada. Podés reimprimirlo o compartirlo sin generar un CAE nuevo.</p> : null}\n${buttonsMarker}`);
}

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_RECEIPT_HISTORY_OK");
