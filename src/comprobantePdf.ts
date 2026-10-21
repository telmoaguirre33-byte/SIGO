import { dineroComprobante, recuperarDocumentoCaja, tipoFactura, validarDocumento, type DocumentoCaja, type FormatoComprobante } from "./comprobanteCaja";

// PDF vectorial: texto seleccionable en español y QR, sin servidor ni credenciales.
function textoPdf(text: string) {
  const aliases: Record<string, number> = { "–": 150, "—": 151, "’": 146, "“": 147, "”": 148, "€": 128 };
  return [...text].map((c) => {
    const byte = aliases[c] ?? c.charCodeAt(0);
    if (byte > 255) throw new Error("El comprobante contiene un carácter que esta fuente PDF no puede representar. No se generó un archivo incompleto.");
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

export function urlQrFiscal(doc: DocumentoCaja) {
  if (!doc.qr) return null;
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(doc.qr))}`;
}

export async function crearPdfComprobante(doc: DocumentoCaja, formato: FormatoComprobante = "a4"): Promise<File> {
  validarDocumento(doc);
  const width = formato === "a4" ? 595.28 : Number(formato) * 72 / 25.4;
  const margin = formato === "a4" ? 36 : 10;
  const size = formato === "a4" ? 11 : formato === "80" ? 9 : 8;
  const maxChars = Math.floor((width - margin * 2) / (size * .58));
  const lines: string[] = [];
  function line(value: string) {
    for (const paragraph of value.replace(/[\r\n\t]/g, " ").split("\n")) {
      let rest = paragraph;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut < maxChars / 2) cut = maxChars;
        lines.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
      }
      lines.push(rest);
    }
  }
  line(doc.comercio);
  if (doc.direccion) line(doc.direccion);
  if (doc.cuit) line(`CUIT ${doc.cuit}`);
  line(doc.fiscal ? `${tipoFactura(doc.fiscal.tipo_cbte)} ${String(doc.fiscal.punto_venta).padStart(4, "0")}-${String(doc.fiscal.numero_cbte).padStart(8, "0")}` : `Ticket de venta Nº ${doc.venta.numero}`);
  line(doc.fiscal ? `Fecha fiscal: ${doc.qr?.fecha}` : `Fecha: ${new Date(doc.venta.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Cordoba" })}`);
  line(`Venta SIGO Nº ${doc.venta.numero}`);
  if (doc.fiscal) line(`Receptor: Doc. ${doc.qr?.tipoDocRec} Nº ${doc.qr?.nroDocRec}`);
  line("--------------------------------");
  for (const item of doc.items) {
    line(item.nombre);
    line(`${item.cantidad} x ${dineroComprobante(item.precio_unitario)} = ${dineroComprobante(item.subtotal)}`);
  }
  line("--------------------------------");
  if (doc.importes) {
    line(`Neto ${dineroComprobante(doc.importes.neto)} - IVA ${dineroComprobante(doc.importes.iva)}`);
    if (doc.importes.exento) line(`Exento ${dineroComprobante(doc.importes.exento)}`);
    if (doc.importes.noGravado) line(`No gravado ${dineroComprobante(doc.importes.noGravado)}`);
    if (doc.importes.tributos) line(`Otros tributos ${dineroComprobante(doc.importes.tributos)}`);
  }
  line(`TOTAL ${dineroComprobante(doc.venta.total)}`);
  if (doc.fiscal) {
    line(`CAE: ${doc.fiscal.cae}`);
    line(`Vencimiento CAE: ${doc.fiscal.cae_vencimiento}`);
    line(doc.ambiente === "homologacion" ? "HOMOLOGACIÓN - SIN VALIDEZ FISCAL" : "Comprobante electrónico autorizado por ARCA");
  } else line("COMPROBANTE NO FISCAL - No válido como factura.");

  const leading = size * 1.5;
  const qrUrl = urlQrFiscal(doc);
  const qr = qrUrl ? (await import("qrcode")).default.create(qrUrl, { errorCorrectionLevel: "M" }) : null;
  const qrSize = Math.min(120, width - 2 * margin);
  const extra = qr ? qrSize + 24 : 0;
  const height = formato === "a4" ? 841.89 : Math.min(841.89, Math.max(220, lines.length * leading + margin * 2 + extra));
  const pages: string[] = [];
  let stream = "", y = height - margin;
  function finish() { pages.push(stream); stream = ""; y = height - margin; }
  for (const text of lines) {
    if (y < margin + leading) finish();
    stream += `BT /F1 ${size} Tf ${margin} ${y.toFixed(2)} Td <${textoPdf(text)}> Tj ET\n`;
    y -= leading;
  }
  if (qr) {
    if (y < margin + qrSize + 8) finish();
    const cell = qrSize / (qr.modules.size + 8);
    const bottom = y - qrSize;
    for (let row = 0; row < qr.modules.size; row++) for (let col = 0; col < qr.modules.size; col++) {
      if (qr.modules.get(row, col)) stream += `${(margin + (col + 4) * cell).toFixed(3)} ${(bottom + (qr.modules.size + 3 - row) * cell).toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f\n`;
    }
  }
  finish();
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const pageIds: number[] = [];
  for (const content of pages) {
    const pageId = objects.length + 1, streamId = pageId + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const name = doc.fiscal ? `SIGO-${tipoFactura(doc.fiscal.tipo_cbte).replace(/ /g, "-")}-${doc.fiscal.punto_venta}-${doc.fiscal.numero_cbte}.pdf` : `SIGO-Ticket-${doc.venta.numero}.pdf`;
  return new File([pdf], name, { type: "application/pdf" });
}

export function descargarPdf(file: File) {
  const url = URL.createObjectURL(file), a = document.createElement("a");
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function compartirPdfWhatsApp(file: File, doc: DocumentoCaja): Promise<"compartido" | "descargado" | "cancelado"> {
  validarDocumento(doc);
  const text = `${doc.comercio} · ${doc.fiscal ? tipoFactura(doc.fiscal.tipo_cbte) : "Ticket"} · Total ${dineroComprobante(doc.venta.total)}`;
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: file.name, text, files: [file] }); return "compartido"; }
    catch (error) { if ((error as DOMException).name === "AbortError") return "cancelado"; }
  }
  descargarPdf(file);
  // Una ventana con nombre permite reutilizar la abierta por SIGO. WhatsApp decide la sesión.
  window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`, "sigo-whatsapp");
  return "descargado";
}

export async function imprimirPdf(file: File) {
  // iframe evita un popup posterior a await, sin navegar fuera de Caja.
  const frame = document.createElement("iframe"), url = URL.createObjectURL(file);
  frame.title = "Comprobante para imprimir"; frame.style.position = "fixed"; frame.style.width = "1px"; frame.style.height = "1px";
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
  frame.src = url; document.body.appendChild(frame);
  window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120000);
}

export async function imprimirComercialCaja(empresaId: string, ventaId: string, formato: FormatoComprobante = "80", _directo = true) {
  const doc = await recuperarDocumentoCaja(empresaId, ventaId, true);
  await imprimirPdf(await crearPdfComprobante(doc, formato));
}
