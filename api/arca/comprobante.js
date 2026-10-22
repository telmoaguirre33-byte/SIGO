import { snapshotConfiable } from "./lib/receipt-store.js";
import { coincideComprobanteOriginal, leerItemsImpresion } from "./lib/print-config.js";
import { json, UUID, rest, first, sesionUsuario, consultarComprobante } from "./cae-v2.js";
import { leerTicketWsaa } from "./wsaa.js";

// Read-only recovery: no sale creation, CAE request, credential refresh or DB write.
export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const empresaId = String(req.query?.empresaId || "");
  const ventaId = String(req.query?.ventaId || "");
  if (!UUID.test(empresaId) || !UUID.test(ventaId)) return json(res, 400, { error: "ARCA_CAE_INPUT_INVALID" });
  const sesion = await sesionUsuario(req, empresaId);
  if (!sesion) return json(res, 403, { error: "ARCA_ISSUE_FORBIDDEN" });
  try {
    const cbte = first(await rest(sesion, `arca_comprobantes?empresa_id=eq.${encodeURIComponent(empresaId)}&venta_id=eq.${encodeURIComponent(ventaId)}&select=*`));
    if (!cbte) return json(res, 404, { error: "ARCA_NOT_ISSUED" });
    if (cbte.resultado === "rechazado_definitivo" && !cbte.cae) return json(res, 409, { error: "ARCA_CAE_REJECTED_FINAL" });
    const snapshot = cbte.impresion_snapshot;
    if (snapshot && !(await snapshotConfiable(sesion, rest))) return json(res, 409, { error: "ARCA_SECURE_STORAGE_REQUIRED" });
    const snapshotIdentificado = snapshot?.version === 1 && snapshot.empresaId === empresaId && snapshot.ventaId === ventaId
      && snapshot.numero_cbte === Number(cbte.numero_cbte) && snapshot.punto_venta === Number(cbte.punto_venta)
      && snapshot.tipo_cbte === Number(cbte.tipo_cbte);
    if (snapshot && !snapshotIdentificado) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
    if (cbte.cae && snapshotIdentificado && snapshot.cae === cbte.cae) {
      return json(res, 200, { ok: true, fuente: "snapshot", comprobante: snapshot });
    }
    if (!cbte.cae && !snapshotIdentificado) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
    const [config, venta, items] = await Promise.all([
      rest(sesion, `arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=ambiente,cuit_emisor,razon_social`).then(first),
      rest(sesion, `ventas_sigo?empresa_id=eq.${encodeURIComponent(empresaId)}&id=eq.${encodeURIComponent(ventaId)}&select=id,numero,total,estado,anulada_at`).then(first),
      leerItemsImpresion(sesion, rest, empresaId, ventaId),
    ]);
    if (!config || !venta || !Array.isArray(items) || !items.length) return json(res, 409, { error: "ARCA_RECEIPT_DATA_MISSING" });
    const ambiente = snapshotIdentificado ? snapshot.ambiente : config.ambiente;
    const cuitEmisor = snapshotIdentificado ? snapshot.emisorCuit : config.cuit_emisor;
    const ticket = await leerTicketWsaa(sesion, empresaId, ambiente, cuitEmisor);
    if (!ticket) return json(res, 409, { error: "ARCA_RECEIPT_AUTH_EXPIRED" });
    const original = await consultarComprobante(sesion, ambiente, ticket, cuitEmisor, cbte.punto_venta, cbte.tipo_cbte, Number(cbte.numero_cbte));
    if (!original) return json(res, 409, { error: cbte.cae ? "ARCA_RECEIPT_NOT_VERIFIED" : "ARCA_RECEIPT_PENDING" });
    if ((cbte.cae && original.cae !== cbte.cae) || !original.fecha || !Number.isFinite(original.total) || original.total <= 0
      || Math.abs(original.total - Number(snapshotIdentificado ? snapshot.total : venta.total)) > .01 || !Number.isInteger(original.receptorDocTipo) || original.receptorDocTipo < 1
      || !original.receptorDocumento) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
    if (snapshotIdentificado && !coincideComprobanteOriginal(snapshot, original)) return json(res, 409, { error: "ARCA_RECEIPT_IDENTITY_MISMATCH" });
    if (snapshotIdentificado) return json(res, 200, { ok: true, fuente: "snapshot_conciliado", comprobante: {
      ...snapshot, ...original, cae_vencimiento: original.caeVencimiento,
      condicionIvaReceptorId: original.condicionIvaReceptorId ?? snapshot.condicionIvaReceptorId,
    } });
    const ids = [...new Set(items.map(i => String(i.producto_id)).filter(id => UUID.test(id)))];
    const products = ids.length ? await rest(sesion, `productos?empresa_id=eq.${encodeURIComponent(empresaId)}&id=in.(${ids.join(",")})&select=id,nombre`) : [];
    const nombres = new Map(products.map(p => [String(p.id), String(p.nombre)]));
    return json(res, 200, { ok: true, fuente: "consulta_arca", comprobante: {
      punto_venta: Number(cbte.punto_venta), tipo_cbte: Number(cbte.tipo_cbte), numero_cbte: Number(cbte.numero_cbte),
      cae: original.cae, cae_vencimiento: original.caeVencimiento, ventaNumero: Number(venta.numero),
      total: original.total, fecha: original.fecha, ambiente: config.ambiente,
      receptorDocTipo: original.receptorDocTipo, receptorDocumento: original.receptorDocumento,
      condicionIvaReceptorId: original.condicionIvaReceptorId,
      receptorRazonSocial: original.receptorDocTipo === 99 ? "Consumidor Final" : "Documento fiscal verificado en ARCA",
      emisorCuit: config.cuit_emisor, emisorRazonSocial: config.razon_social || "Emisor CUIT " + config.cuit_emisor,
      moneda: original.moneda, cotizacion: original.cotizacion, neto: original.neto, iva: original.iva,
      items: items.map(i => ({ nombre: nombres.get(String(i.producto_id)) || "Artículo " + i.producto_id, cantidad: Number(i.cantidad), unidad: i.unidad_medida || null, precio_unitario: Number(i.precio_unitario), subtotal: Number(i.subtotal) })),
      advertencia: "Reimpresión: datos fiscales verificados en ARCA. Los nombres comerciales se muestran según el catálogo actual; el original no conserva esos textos.",
    } });
  } catch (error) {
    const timeout = /timeout|abort/i.test(String(error?.message || error));
    return json(res, timeout ? 504 : 502, { error: timeout ? "ARCA_TIMEOUT" : "ARCA_RECEIPT_RECOVERY_FAILED" });
  }
}
