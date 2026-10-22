import { supabase } from "./supabase";
import type { TicketFiscal } from "./ticketFiscal";
export type DatosEmisorImpresion = { domicilio: string; condicion_iva: string; ingresos_brutos: string; inicio_actividades: string | null; excepcion_inicio: string | null };
export type ConfigImpresion = { config: DatosEmisorImpresion | null; puedeConfigurar: boolean; identidad: { cuit_emisor: string; razon_social: string }; faltantes?: string[] };
export function leerImpresionFiscal(empresaId: string, puntoVenta: number): Promise<ConfigImpresion> { return fiscalFetch(`/api/arca/impresion?empresaId=${encodeURIComponent(empresaId)}&puntoVenta=${puntoVenta}`); }
export function guardarImpresionFiscal(empresaId: string, puntoVenta: number, datos: DatosEmisorImpresion): Promise<ConfigImpresion> { return fiscalFetch('/api/arca/impresion', { empresaId, puntoVenta, datos }); }
export type SolicitudFiscalCaja = { empresaId: string; ventaId: string | null; accion: "emitir" | "reimprimir" | "historial"; requestId: string };
export type PreparacionFiscal = {
  venta: { id: string; numero: number; total: number; cliente_id: string | null };
  config: { ambiente: "homologacion" | "produccion"; activo: boolean; ultima_prueba_ok: boolean } | null;
  puntos: Array<{ numero: number; ambiente: string }>;
  comprobante: { cae: string | null; punto_venta: number; tipo_cbte: number } | null;
};
export async function prepararFiscalCaja(empresaId: string, ventaId: string): Promise<PreparacionFiscal> {
  const [v, c, p, f] = await Promise.all([
    supabase.from("ventas_sigo").select("id,numero,total,cliente_id").eq("empresa_id", empresaId).eq("id", ventaId).eq("estado", "confirmada").is("anulada_at", null).single(),
    supabase.from("arca_config").select("ambiente,activo,ultima_prueba_ok").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("arca_puntos_venta").select("numero,ambiente").eq("empresa_id", empresaId).eq("activo", true).order("numero"),
    supabase.from("arca_comprobantes").select("cae,punto_venta,tipo_cbte").eq("empresa_id", empresaId).eq("venta_id", ventaId).maybeSingle(),
  ]);
  for (const q of [v, c, p, f]) if (q.error) throw new Error("No se pudo verificar la venta y su comprobante. No repitas el cobro.");
  if (!v.data) throw new Error("No se encontró la venta confirmada de esta empresa.");
  return { venta: v.data, config: c.data, puntos: (p.data || []).filter(pv => pv.ambiente === c.data?.ambiente), comprobante: f.data } as PreparacionFiscal;
}
async function fiscalFetch(path: string, body?: object) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("La sesión venció. Ingresá de nuevo; no repitas la venta.");
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error === "ARCA_PRINT_EMITTER_DATA_REQUIRED" && Array.isArray(payload.faltantes) ? `Faltan datos para imprimir la factura: ${payload.faltantes.join(", ")}. No se solicitó un CAE.` : mensajeFiscal(String(payload.error || "")));
    Object.assign(error, { code: payload.error }); throw error;
  }
  return payload;
}
export async function recuperarFiscalCaja(empresaId: string, ventaId: string): Promise<TicketFiscal> {
  const payload = await fiscalFetch(`/api/arca/comprobante?empresaId=${encodeURIComponent(empresaId)}&ventaId=${encodeURIComponent(ventaId)}`);
  return payload.comprobante as TicketFiscal;
}
const emisionesEnCurso = new Map<string, Promise<TicketFiscal>>();
export function marcaIntentoFiscal(empresaId: string, ventaId: string) { return `sigo:fiscal:intento:${empresaId}:${ventaId}`; }
export function emitirFiscalCaja(empresaId: string, preparado: PreparacionFiscal, puntoVenta: number, tipoCbte = 11): Promise<TicketFiscal> {
  const key = `${empresaId}:${preparado.venta.id}`;
  const pendiente = emisionesEnCurso.get(key); if (pendiente) return pendiente;
  if (!preparado.config?.activo || !preparado.config.ultima_prueba_ok || !preparado.puntos.some(p => p.numero === puntoVenta)) return Promise.reject(new Error("Falta validar ARCA o el punto de venta autorizado. La venta ya está cobrada."));
  try { sessionStorage.setItem(marcaIntentoFiscal(empresaId, preparado.venta.id), "iniciado"); } catch { /* storage denied: backend idempotency remains authoritative */ }
  const promise = fiscalFetch("/api/arca/cae-v2", { empresaId, ventaId: preparado.venta.id, puntoVenta, tipoCbte, condicionIvaReceptorId: 5, flujoCaja: true,
    confirmacion: preparado.config.ambiente === "produccion" ? "EMITIR_CAE_PRODUCCION" : "SOLICITAR_CAE_HOMOLOGACION" })
    .then(async payload => payload.comprobanteImprimible as TicketFiscal || await recuperarFiscalCaja(empresaId, preparado.venta.id))
    .finally(() => emisionesEnCurso.delete(key));
  emisionesEnCurso.set(key, promise); return promise;
}
export function mensajeFiscal(code: string): string {
  const mensajes: Record<string, string> = {
    ARCA_SECURE_STORAGE_REQUIRED: "La activación segura de facturación está pendiente del administrador. No se solicitó un CAE; la venta está cobrada.",
    ARCA_PRINT_CONFIG_FORBIDDEN: "Solo un administrador puede completar los datos de impresión fiscal.",
    ARCA_PRINT_CONFIG_FAILED: "No se pudo guardar la configuración de impresión. No se emitió una factura nueva.",
    ARCA_PRINT_TIPO_INCOMPATIBLE: "El tipo de factura no coincide con la condición IVA del emisor. No se solicitó un CAE.",
    ARCA_PRINT_SCHEMA_REQUIRED: "Falta completar la actualización fiscal del sistema. No se solicitó un CAE; la venta está cobrada.",
    ARCA_TIMEOUT: "La operación fiscal superó el tiempo disponible. La venta está cobrada. Consultá el resultado; no vuelvas a emitir ni cobrar.",
    ARCA_RECEIPT_AUTH_EXPIRED: "La autorización para consultar ARCA venció. El CAE no se duplicó; un administrador debe renovar la conexión.",
    ARCA_RECEIPT_PENDING: "La emisión sigue sin confirmarse. No repitas el cobro. Podés volver a consultar su estado.",
    ARCA_LEGACY_RECEIPT_IDENTITY_REQUIRED: "Existe un intento fiscal antiguo sin identidad original suficiente. No vuelvas a emitir ni cobrar: requiere conciliación manual segura con ARCA antes de continuar.",
    ARCA_RECEIPT_IDENTITY_MISMATCH: "Los datos originales no coinciden. Se bloqueó la impresión para no entregar una factura incorrecta.",
    ARCA_RECEIPT_NOT_VERIFIED: "No se pudo verificar el comprobante original. No se emitió uno nuevo.",
    ARCA_RECEIPT_RECOVERY_FAILED: "No se pudo recuperar el comprobante original. No se emitió uno nuevo.",
    ARCA_AUTH_NOT_VALIDATED: "ARCA necesita validación. La venta está cobrada; no la repitas.",
    ARCA_CAE_REJECTED_FINAL: "ARCA rechazó esta venta y no emitió CAE. Un administrador debe resolverla; no vuelvas a cobrarla.",
    ARCA_CAE_REJECTED: "ARCA rechazó la factura. Revisá los datos fiscales; la venta no se repetirá.",
    ARCA_CLIENT_FISCAL_DATA_REQUIRED: "Faltan los datos fiscales del cliente. Completalos antes de volver a emitir esta misma venta.",
    ARCA_NOT_ISSUED: "Esta venta no tiene factura fiscal. Usá su comprobante común o emití desde F11.",
    ARCA_NUMBER_RESERVATION_CONFLICT: "Otra emisión está en curso. Consultá el resultado antes de intentar otra vez.",
  };
  return mensajes[code] || "No se pudo completar la operación fiscal. La venta está cobrada; consultá el resultado antes de reintentar.";
}
