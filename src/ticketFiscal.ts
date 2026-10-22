import QRCode from "qrcode";

export type FormatoFiscal = "58" | "80" | "a4";
export type TicketFiscal = {
  punto_venta: number; tipo_cbte: number; numero_cbte: number; cae: string; cae_vencimiento: string | null;
  ventaNumero: number; total: number; fecha: string; ambiente: "produccion" | "homologacion";
  receptorDocTipo: number; receptorDocumento: string; condicionIvaReceptorId?: number | null;
  receptorRazonSocial?: string; emisorCuit: string; emisorRazonSocial: string;
  emisorDomicilio?: string; emisorCondicionIva?: string; emisorIngresosBrutos?: string; emisorInicioActividades?: string;
  moneda?: string; cotizacion?: number; neto?: number; iva?: number;
  items: Array<{ nombre: string; cantidad: number; unidad?: string | null; precio_unitario: number; subtotal: number }>;
  advertencia?: string;
};
const escapar = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const dinero = (n: number) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
const decimales = (value: number, precision: number) => Math.abs(value - Math.round(value * 10 ** precision) / 10 ** precision) <= Number.EPSILON * Math.max(1, value);
function fechaFiscalValida(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function urlQrFiscal(c: TicketFiscal): string {
  const moneda = c.moneda ?? "PES";
  const cotizacion = c.cotizacion ?? (moneda === "PES" ? 1 : NaN);
  if (!/^[1-9]\d{13}$/.test(c.cae) || !/^[1-9]\d{10}$/.test(c.emisorCuit) || !fechaFiscalValida(c.fecha)
    || !Number.isFinite(c.total) || c.total <= 0 || c.total >= 1e13
    || !decimales(c.total, 2)
    || !entero(c.punto_venta, 1, 99998) || ![1, 6, 11].includes(c.tipo_cbte) || !entero(c.numero_cbte, 1, 99999999)
    || !/^[A-Z]{3}$/.test(moneda) || !Number.isFinite(cotizacion) || cotizacion <= 0 || cotizacion >= 1e13
    || !decimales(cotizacion, 6) || (moneda === "PES" && cotizacion !== 1)
    || !entero(c.receptorDocTipo, 0, 99)) {
    throw new Error("El comprobante no tiene los datos originales necesarios para generar el QR fiscal.");
  }
  if (!/^\d{1,20}$/.test(c.receptorDocumento || "0")) throw new Error("El documento fiscal original es inválido.");
  const doc = Number(c.receptorDocumento || 0);
  if (!Number.isSafeInteger(doc) || (c.receptorDocTipo !== 99 && doc <= 0) || (c.receptorDocTipo === 99 && doc !== 0)) {
    throw new Error("El documento fiscal original falta o no puede representarse con precisión.");
  }
  // Especificación oficial versión 1, URL ARCA, JSON numérico y Base64 estándar:
  // https://arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
  // Fail closed on unsafe 20-digit IDs rather than silently rounding them in JavaScript.
  const datos = { ver: 1, fecha: c.fecha, cuit: Number(c.emisorCuit), ptoVta: c.punto_venta,
    tipoCmp: c.tipo_cbte, nroCmp: c.numero_cbte, importe: c.total, moneda, ctz: cotizacion,
    ...(c.receptorDocTipo !== 99 ? { tipoDocRec: c.receptorDocTipo, nroDocRec: doc } : {}),
    tipoCodAut: "E", codAut: Number(c.cae) };
  return `https://www.arca.gob.ar/fe/qr/?p=${encodeURIComponent(btoa(JSON.stringify(datos)))}`;
}
export async function construirTicketFiscalHtml(c: TicketFiscal, formato: FormatoFiscal = "58"): Promise<string> {
  if (!c.items.length) throw new Error("No se pudo recuperar el detalle de la venta. No se imprimió una página vacía.");
  if (c.items.some(i => !i.nombre.trim() || !Number.isFinite(i.cantidad) || i.cantidad <= 0
    || !Number.isFinite(i.precio_unitario) || i.precio_unitario < 0 || !Number.isFinite(i.subtotal) || i.subtotal < 0)) {
    throw new Error("El detalle original de la venta está incompleto. No se envió a imprimir.");
  }
  if ([c.neto, c.iva].some(n => n != null && (!Number.isFinite(n) || n < 0))) throw new Error("Los importes fiscales originales están incompletos.");
  const qrUrl = urlQrFiscal(c);
  const simbolo = QRCode.create(qrUrl, { errorCorrectionLevel: "M" });
  // Whole modules at a common 203 dpi thermal resolution, including four white
  // modules on every edge. Fixed 38 mm aliasing can make denser valid QRs unreadable.
  const tamanoQrMm = (simbolo.modules.size + 8) * 4 * 25.4 / 203;
  if (tamanoQrMm > 46) throw new Error("El QR fiscal excede el tamaño seguro para el ticket térmico.");
  const qr = await QRCode.toString(qrUrl, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const ancho = formato === "58" ? 48 : formato === "80" ? 70 : 185;
  const nombre = c.tipo_cbte === 1 ? "Factura A" : c.tipo_cbte === 6 ? "Factura B" : "Factura C";
  const items = c.items.map(i => `<section class="item"><div class="nombre">${escapar(i.nombre)}</div><div class="detalle"><span>${escapar(i.cantidad.toLocaleString("es-AR", { minimumFractionDigits: ["kg", "l", "m", "m2", "m3"].includes(i.unidad || "") ? 3 : 0, maximumFractionDigits: 6 }))}${i.unidad ? ` ${escapar(i.unidad)}` : ""} × $ ${dinero(i.precio_unitario)}</span><strong>$ ${dinero(i.subtotal)}</strong></div></section>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${nombre} ${c.punto_venta}-${c.numero_cbte}</title><style>
    @page { size: ${formato === "a4" ? "A4" : formato + "mm 200mm"}; margin: ${formato === "a4" ? "10mm" : "3mm"}; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; color: black; }
    body { font: ${formato === "58" ? "11px" : "12px"}/1.3 Arial, sans-serif; }
    .ticket { display: flow-root; width: ${ancho}mm; max-width: ${ancho}mm; margin: 0; overflow-wrap: anywhere; }
    h1 { font-size: 15px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 5px 0; }
    .centro { text-align: center; } .separador { border-top: 1px dashed black; margin: 7px 0; }
    .item { padding: 5px 0; border-bottom: 1px dashed #777; break-inside: avoid; }
    .nombre { font-weight: 600; } .detalle { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 6px; }
    .detalle span, .detalle strong { max-width: 100%; } .total { margin: 8px 0; font-size: 16px; font-weight: bold; }
    .fiscal { break-inside: avoid; } .qr { text-align: center; margin: 6px 0; } .qr svg { width: ${tamanoQrMm}mm; height: ${tamanoQrMm}mm; max-width: 100%; display: inline-block; shape-rendering: crispEdges; }
    .nota { font-size: 9px; margin-top: 5px; } .homologacion { border: 2px solid black; padding: 4px; font-weight: bold; margin: 0 0 8px; }
  </style></head><body><main class="ticket">
    ${c.ambiente === "homologacion" ? '<p class="homologacion centro">HOMOLOGACIÓN · SIN VALIDEZ FISCAL</p>' : ""}
    <header class="centro"><h1>${escapar(c.emisorRazonSocial)}</h1><div>CUIT ${escapar(c.emisorCuit)}</div><h2>${nombre}</h2><div>Cód. ${String(c.tipo_cbte).padStart(3, "0")}</div><strong>${String(c.punto_venta).padStart(5, "0")}-${String(c.numero_cbte).padStart(8, "0")}</strong></header>
    ${c.emisorDomicilio ? `<div class="centro">${escapar(c.emisorDomicilio)}</div>` : ""}
    ${c.emisorCondicionIva ? `<div class="centro">${escapar(c.emisorCondicionIva)}</div>` : ""}
    ${c.emisorIngresosBrutos ? `<div>IIBB: ${escapar(c.emisorIngresosBrutos)}</div>` : ""}
    ${c.emisorInicioActividades ? `<div>INICIO DE ACTIVIDADES: ${escapar(c.emisorInicioActividades)}</div>` : ""}
    <div class="separador"></div><div>Fecha: ${escapar(c.fecha.split("-").reverse().join("/"))}</div><div>Venta SIGO: ${escapar(c.ventaNumero)}</div>
    ${c.moneda && c.moneda !== "PES" ? `<div>Moneda: ${escapar(c.moneda)} · Cotización: ${escapar(c.cotizacion)}</div>` : ""}
    <div>Receptor: ${escapar(c.receptorRazonSocial || (c.receptorDocTipo === 99 ? "Consumidor Final" : "Documento original"))}</div>
    ${c.condicionIvaReceptorId === 5 || c.receptorDocTipo === 99 ? '<div>A CONSUMIDOR FINAL</div>' : ""}
    ${c.receptorDocTipo !== 99 ? `<div>${c.receptorDocTipo === 80 ? "CUIT" : c.receptorDocTipo === 96 ? "DNI" : "Documento " + c.receptorDocTipo}: ${escapar(c.receptorDocumento)}</div>` : ""}
    <div class="separador"></div>${items}<div class="total">TOTAL $ ${dinero(c.total)}</div>
    ${c.tipo_cbte === 1 && c.iva != null ? `<div>${c.neto != null ? `Neto: $ ${dinero(c.neto)} · ` : ""}IVA: $ ${dinero(c.iva)}</div>` : ""}
    <section class="fiscal"><div>CAE: <strong>${escapar(c.cae)}</strong></div><div>Vencimiento CAE: ${escapar(c.cae_vencimiento || "—")}</div><div class="qr">${qr}</div>
    <div class="nota centro">Comprobante electrónico autorizado por ARCA<br>Emitido desde SIGO</div></section>
    ${c.advertencia ? `<p class="nota">${escapar(c.advertencia)}</p>` : ""}
  </main></body></html>`;
}

export function calcularAltoPaginaTermica(altoPx: number): number {
  if (!Number.isFinite(altoPx) || altoPx <= 0) throw new Error("El ticket está vacío. No se envió a imprimir.");
  const altoMm = Math.max(60, Math.ceil(altoPx * 25.4 / 96) + 8);
  // Fail closed rather than silently clip or send multiple half-empty 500 mm sheets.
  // Larger originals remain available for explicit A4 printing from fiscal history.
  if (altoMm > 500) throw new Error("El comprobante supera los 50 cm de ticket. No se envió a la térmica; imprimilo en A4 desde el historial fiscal.");
  return altoMm;
}

// No script, load handler or timer in the HTML prints. Only this explicit action does.
export async function imprimirTicketFiscal(c: TicketFiscal, formato: FormatoFiscal = "58", alCerrar?: () => void): Promise<void> {
  const html = await construirTicketFiscalHtml(c, formato);
  const frame = document.createElement("iframe");
  frame.title = "Impresión de comprobante fiscal";
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${formato === "58" ? 58 : formato === "80" ? 80 : 210}mm;height:100px;border:0;`;
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  if (!w) { frame.remove(); throw new Error("No se pudo preparar la impresión. El CAE se conserva; usá F12."); }
  try {
    w.document.open(); w.document.write(html); w.document.close();
    await w.document.fonts.ready;
    // Use the visible parent clock: offscreen iframe animation frames may be throttled.
    await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    const ticket = w.document.querySelector<HTMLElement>(".ticket");
    const altoPx = ticket?.getBoundingClientRect().height ?? 0;
    if (!Number.isFinite(altoPx) || altoPx <= 0) throw new Error("El ticket está vacío. No se envió a imprimir.");
    if (formato !== "a4") {
      // Explicit finite page length; never use `58mm auto` or a square `58mm` page.
      // Excessively long content is refused before invoking print; never truncate it.
      const altoMm = calcularAltoPaginaTermica(altoPx);
      const style = w.document.createElement("style");
      style.textContent = `@page { size: ${formato}mm ${altoMm}mm; margin: 3mm; }`;
      w.document.head.appendChild(style);
    }
    let cerrado = false;
    const cerrar = () => { if (cerrado) return; cerrado = true; frame.remove(); alCerrar?.(); };
    w.addEventListener("afterprint", cerrar, { once: true });
    w.focus(); w.print();
    // No automatic second print or early frame removal. afterprint handles print/cancel.
  } catch (e) { frame.remove(); throw e; }
}
