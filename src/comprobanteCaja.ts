import { supabase } from "./supabase";

export type FormatoComprobante = "58" | "80" | "a4";
export type VentaComprobante = { id: string; empresa_id: string; numero: number; created_at: string; estado: string; anulada_at: string | null; total: number; cliente_id: string | null };
export type LineaComprobante = { nombre: string; cantidad: number; precio_unitario: number; subtotal: number };
export type FiscalComprobante = { id: string; empresa_id: string; venta_id: string; punto_venta: number; tipo_cbte: number; numero_cbte: number; cae: string; cae_vencimiento: string; resultado: string };
export type DocumentoCaja = { venta: VentaComprobante; items: LineaComprobante[]; comercio: string; direccion: string;
  fiscal: FiscalComprobante | null; qr: Record<string, string | number> | null; ambiente?: string; cuit?: string;
  importes?: { neto: number; iva: number; exento: number; noGravado: number; tributos: number } };
export type OpcionesFiscal = { ambiente: string; activo: boolean; ultima_prueba_ok: boolean; puntos: number[]; cliente: { nombre: string; documento: string; condicion_iva_receptor_id: number; arca_doc_tipo: number } | null };

export const dineroComprobante = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const tipoFactura = (n: number) => {
  const labels: Record<number, string> = { 1: "Factura A", 6: "Factura B", 11: "Factura C" };
  return labels[n] || `Comprobante ${n}`;
};

export function validarDocumento(doc: DocumentoCaja) {
  if (!doc.venta.id || doc.venta.estado !== "confirmada" || doc.venta.anulada_at || !doc.comercio.trim() ||
    !Number.isFinite(doc.venta.total) || doc.venta.total <= 0 || !doc.items.length) throw new Error("La venta no tiene un comprobante completo y confirmado.");
  for (const item of doc.items) {
    if (!item.nombre.trim() || ![item.cantidad, item.precio_unitario, item.subtotal].every(Number.isFinite) ||
      item.cantidad <= 0 || item.precio_unitario < 0 || item.subtotal < 0) throw new Error("El detalle del comprobante es inválido.");
  }
  if (Math.abs(doc.items.reduce((n, i) => n + i.subtotal, 0) - doc.venta.total) > .01) throw new Error("El total persistido no coincide con el detalle. No se generó el comprobante.");
  if (doc.importes && (!Object.values(doc.importes).every(n => Number.isFinite(n) && n >= 0) ||
    Math.abs(Object.values(doc.importes).reduce((n, value) => n + value, 0) - doc.venta.total) > .01)) throw new Error("Los importes fiscales no coinciden con la venta.");
  if (doc.fiscal && (!doc.qr || doc.fiscal.venta_id !== doc.venta.id || doc.fiscal.empresa_id !== doc.venta.empresa_id ||
    doc.fiscal.resultado !== "A" || !/^\d{14}$/.test(doc.fiscal.cae) || !doc.fiscal.cae_vencimiento ||
    Number(doc.qr.codAut) !== Number(doc.fiscal.cae) || Number(doc.qr.importe) !== doc.venta.total ||
    Number(doc.qr.ptoVta) !== Number(doc.fiscal.punto_venta) || Number(doc.qr.tipoCmp) !== Number(doc.fiscal.tipo_cbte) ||
    Number(doc.qr.nroCmp) !== Number(doc.fiscal.numero_cbte) || Number(doc.qr.cuit) !== Number(doc.cuit) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(doc.qr.fecha)) || doc.qr.tipoCodAut !== "E")) throw new Error("No se pudo verificar el comprobante fiscal original.");
}

async function apiFiscal(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Iniciá sesión para recuperar el comprobante fiscal.");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    const message = body.error === "ARCA_TICKET_REFRESH_REQUIRED" ? "La autorización fiscal venció. Un administrador debe renovarla antes de recuperar el original." :
      body.error === "ARCA_NUMBER_RESERVATION_CONFLICT" ? "Otra emisión tomó ese número. Volvé a consultar antes de reintentar." :
      body.error === "ARCA_TIMEOUT" ? "ARCA no respondió a tiempo. Volvé a recuperar la venta; SIGO conciliará antes de emitir." :
      `No se pudo recuperar o autorizar el comprobante: ${body.error || "respuesta inválida"}.`;
    throw new Error(message);
  }
  return body;
}

export async function recuperarDocumentoCaja(empresaId: string, ventaId: string, soloComercial = false): Promise<DocumentoCaja> {
  const [{ data: venta, error: ve }, { data: rows, error: ie }, { data: config, error: ce }, { data: empresa, error: ee }] = await Promise.all([
    supabase.from("ventas_sigo").select("id,empresa_id,numero,created_at,estado,anulada_at,total,cliente_id").eq("empresa_id", empresaId).eq("id", ventaId).single(),
    supabase.from("venta_items_sigo").select("cantidad,precio_unitario,subtotal,productos(nombre)").eq("empresa_id", empresaId).eq("venta_id", ventaId),
    supabase.from("configuracion_ticket_sigo").select("nombre_negocio,direccion").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("empresas").select("nombre,razon_social").eq("id", empresaId).single(),
  ]);
  if (ve || ie || ce || ee || venta?.id !== ventaId || venta?.empresa_id !== empresaId) throw new Error("No se pudo recuperar la venta de la empresa activa.");
  const doc: DocumentoCaja = { venta: { ...venta, total: Number(venta.total) }, comercio: config?.nombre_negocio || empresa?.razon_social || empresa?.nombre || "",
    direccion: config?.direccion || "", items: (rows ?? []).map((r: any) => ({ nombre: (Array.isArray(r.productos) ? r.productos[0] : r.productos)?.nombre || "",
      cantidad: Number(r.cantidad), precio_unitario: Number(r.precio_unitario), subtotal: Number(r.subtotal) })), fiscal: null, qr: null };
  validarDocumento(doc);
  if (!soloComercial) {
    const { data: issued, error } = await supabase.from("arca_comprobantes").select("id,cae,resultado").eq("empresa_id", empresaId).eq("venta_id", ventaId).maybeSingle();
    if (error) throw new Error("No se pudo comprobar si la venta ya tiene factura. No se generó un ticket sustituto.");
    if (issued?.cae) {
      const body = await apiFiscal(`/api/arca/comprobante?empresaId=${encodeURIComponent(empresaId)}&ventaId=${encodeURIComponent(ventaId)}`);
      doc.fiscal = body.comprobante; doc.qr = body.qr; doc.cuit = body.emisor.cuit; doc.ambiente = body.emisor.ambiente;
      doc.importes = body.importes;
      doc.comercio = body.emisor.nombre || doc.comercio;
    }
  }
  validarDocumento(doc);
  return doc;
}

export async function leerOpcionesFiscal(empresaId: string, venta: VentaComprobante): Promise<OpcionesFiscal> {
  const [{ data: config, error }, { data: points, error: pe }] = await Promise.all([
    supabase.from("arca_config").select("ambiente,activo,ultima_prueba_ok").eq("empresa_id", empresaId).single(),
    supabase.from("arca_puntos_venta").select("numero,ambiente,activo").eq("empresa_id", empresaId).eq("activo", true).order("numero"),
  ]);
  if (error || pe || !config?.activo || config.ultima_prueba_ok !== true || !["homologacion", "produccion"].includes(config.ambiente)) throw new Error("La integración fiscal de esta empresa debe estar autorizada antes de emitir.");
  let cliente = null;
  if (venta.cliente_id) {
    const result = await supabase.from("clientes_sigo").select("nombre,documento,condicion_iva_receptor_id,arca_doc_tipo").eq("empresa_id", empresaId).eq("id", venta.cliente_id).single();
    if (result.error) throw new Error("No se pudieron recuperar los datos fiscales del cliente.");
    cliente = result.data;
  }
  return { ...config, puntos: (points || []).filter((p: any) => p.ambiente === config.ambiente && p.activo).map((p: any) => p.numero), cliente };
}

export async function emitirFacturaCaja(empresaId: string, ventaId: string, opciones: OpcionesFiscal, puntoVenta: number, tipoCbte: number, condicionIva: number) {
  // Última comprobación de lectura antes de emitir. El servidor mantiene reserva/conciliación e idempotencia.
  const current = await recuperarDocumentoCaja(empresaId, ventaId);
  if (current.fiscal) return current;
  if (!opciones.puntos.includes(puntoVenta)) throw new Error("Seleccioná un punto de venta activo.");
  await apiFiscal("/api/arca/cae-v2", { method: "POST", body: JSON.stringify({ empresaId, ventaId, puntoVenta, tipoCbte,
    condicionIvaReceptorId: condicionIva, confirmacion: opciones.ambiente === "produccion" ? "EMITIR_CAE_PRODUCCION" : "SOLICITAR_CAE_HOMOLOGACION" }) });
  const result = await recuperarDocumentoCaja(empresaId, ventaId);
  if (!result.fiscal) throw new Error("La emisión no pudo verificarse. Recuperá el comprobante antes de reintentar.");
  return result;
}
