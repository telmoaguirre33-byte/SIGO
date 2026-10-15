import { consultarComprobante, rest, sesionUsuario } from "./cae-v2.js";
import { leerTicketWsaa } from "./wsaa.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

// Sólo recupera FECompConsultar. No reserva números, no emite CAE ni escribe ventas/stock.
export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const empresaId = String(req.query?.empresaId || "");
  const ventaId = String(req.query?.ventaId || "");
  if (!UUID.test(empresaId) || !UUID.test(ventaId)) return json(res, 400, { error: "INPUT_INVALID" });
  try {
    const session = await sesionUsuario(req, empresaId);
    if (!session) return json(res, 403, { error: "ARCA_ISSUE_FORBIDDEN" });
    const [configs, receipts, sales] = await Promise.all([
      rest(session, `arca_config?empresa_id=eq.${empresaId}&select=ambiente,cuit_emisor,razon_social`),
      rest(session, `arca_comprobantes?empresa_id=eq.${empresaId}&venta_id=eq.${ventaId}&select=id,empresa_id,venta_id,punto_venta,tipo_cbte,numero_cbte,cae,cae_vencimiento,resultado`),
      rest(session, `ventas_sigo?empresa_id=eq.${empresaId}&id=eq.${ventaId}&select=id,total,estado,anulada_at`),
    ]);
    const config = configs?.[0], receipt = receipts?.[0], sale = sales?.[0];
    if (!config || !sale || sale.estado !== "confirmada" || sale.anulada_at) return json(res, 409, { error: "ARCA_SALE_NOT_CONFIRMED" });
    if (receipts?.length !== 1 || !/^\d{14}$/.test(receipt?.cae || "") || receipt.resultado !== "A") return json(res, 409, { error: "ARCA_AUTHORIZED_RECEIPT_REQUIRED" });
    const ticket = await leerTicketWsaa(session, empresaId, config.ambiente, config.cuit_emisor);
    if (!ticket) return json(res, 409, { error: "ARCA_TICKET_REFRESH_REQUIRED" });
    const original = await consultarComprobante(session, config.ambiente, ticket, config.cuit_emisor,
      receipt.punto_venta, receipt.tipo_cbte, Number(receipt.numero_cbte));
    if (!original || original.resultado !== "A" || original.cae !== receipt.cae || !original.fecha ||
      !Number.isFinite(original.importe) || original.importe <= 0 || Math.abs(original.importe - Number(sale.total)) > .01 ||
      !Number.isInteger(original.tipoDocRec) || !original.nroDocRec || !original.moneda || !(original.ctz > 0) ||
      !/^\d{11}$/.test(config.cuit_emisor) || !original.caeVencimiento) return json(res, 409, { error: "ARCA_ORIGINAL_RECEIPT_MISMATCH" });
    return json(res, 200, { ok: true, comprobante: { ...receipt, cae_vencimiento: original.caeVencimiento },
      emisor: { cuit: config.cuit_emisor, nombre: config.razon_social, ambiente: config.ambiente },
      qr: { ver: 1, fecha: original.fecha, cuit: Number(config.cuit_emisor), ptoVta: receipt.punto_venta,
        tipoCmp: receipt.tipo_cbte, nroCmp: Number(receipt.numero_cbte), importe: original.importe,
        moneda: original.moneda, ctz: original.ctz, tipoDocRec: original.tipoDocRec,
        nroDocRec: Number(original.nroDocRec), tipoCodAut: "E", codAut: Number(original.cae) } });
  } catch (error) {
    console.error("SIGO receipt recovery failed", error?.code || "READ_FAILED");
    return json(res, 502, { error: "ARCA_RECEIPT_READ_FAILED" });
  }
}
