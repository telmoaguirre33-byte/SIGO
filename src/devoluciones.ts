import { supabase } from "./supabase";
import type { MedioPagoSigo } from "./ventas";
import { cantidadEscaladaMedida, normalizarUnidadVenta, type UnidadVenta } from "./ventaPorMedidas";

export type VentaDevolvibleSigo = {
  id: string;
  numero: number | null;
  total: number;
  medioPago: MedioPagoSigo;
  clienteId: string | null;
  createdAt: string;
};

export type ItemVentaDevolvibleSigo = {
  ventaItemId: string;
  productoId: string;
  producto: string;
  codigo: string | null;
  cantidadVendida: number;
  cantidadDevuelta: number;
  cantidadDisponible: number;
  precioUnitario: number;
  unidadMedida: UnidadVenta | null;
  subtotalOriginal: number;
  subtotalDevuelto: number;
  subtotalDisponible: number;
};

export type ResultadoDevolucionSigo = { id: string; total: number | null };

function milésimas(valor: unknown): number {
  if (valor == null) throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
  try { return cantidadEscaladaMedida(Number(valor), "kg", true); }
  catch { throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW"))); }
}

function centavos(valor: unknown): number {
  if (valor == null) throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
  const escalado = Number(valor) * 100;
  const entero = Math.round(escalado);
  if (!Number.isFinite(escalado) || escalado < 0 || !Number.isSafeInteger(entero)
    || Math.abs(escalado - entero) > Number.EPSILON * Math.max(1, Math.abs(escalado)) * 8) {
    throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
  }
  return entero;
}

/** Snapshot original y prorrateo acumulado, incluido el remanente exacto de centavos. */
export function estimarImporteDevolucion(item: ItemVentaDevolvibleSigo, cantidad: number): number {
  try { cantidadEscaladaMedida(cantidad, item.unidadMedida ?? "kg"); }
  catch { throw new Error("La cantidad no respeta la precisión de la unidad de la venta."); }
  const vendida = milésimas(item.cantidadVendida);
  const devuelta = milésimas(item.cantidadDevuelta);
  const nueva = milésimas(cantidad);
  const original = centavos(item.subtotalOriginal);
  const reintegrado = centavos(item.subtotalDevuelto);
  if (vendida <= 0 || devuelta > vendida || reintegrado > original || (devuelta === vendida && reintegrado !== original)) {
    throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
  }
  const disponible = vendida - devuelta;
  if (nueva > disponible) throw new Error("La cantidad a devolver supera lo disponible de esa venta.");
  const saldo = original - reintegrado;
  if (nueva === disponible) return saldo / 100;
  const numerador = BigInt(original) * BigInt(devuelta + nueva);
  const denominador = BigInt(vendida);
  const acumulado = Number((2n * numerador + denominador) / (2n * denominador));
  return Math.min(saldo, Math.max(0, acumulado - reintegrado)) / 100;
}

export type DevolucionRecienteSigo = {
  id: string;
  ventaId: string;
  tipo: "parcial" | "total";
  total: number;
  motivo: string;
  createdAt: string;
};

function numero(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function claveOperacion() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Conserva el mismo intento después de un error de red y de recargar esta pestaña.
// Si cambió el payload, la huella del servidor lo rechaza en vez de duplicar stock/dinero.
const clavesPendientes = new Map<string, string>();
function clavePendiente(empresaId: string, ventaId: string) {
  const referencia = `sigo:devolucion-pendiente:${empresaId}:${ventaId}`;
  let clave = clavesPendientes.get(referencia);
  try { clave ??= window.sessionStorage.getItem(referencia) || undefined; } catch { /* memoria de la pestaña */ }
  clave ??= claveOperacion();
  clavesPendientes.set(referencia, clave);
  try { window.sessionStorage.setItem(referencia, clave); } catch { /* No se sustituye la clave en memoria. */ }
  return clave;
}
function cerrarIntento(empresaId: string, ventaId: string) {
  const referencia = `sigo:devolucion-pendiente:${empresaId}:${ventaId}`;
  clavesPendientes.delete(referencia);
  try { window.sessionStorage.removeItem(referencia); } catch { /* El comprobante ya certificó la escritura. */ }
}

function mensaje(error: unknown) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  if (raw.includes("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")) return "El historial de cantidades o importes de esa venta requiere revisión administrativa. No se modificó la devolución.";
  if (raw.includes("RETURN_LEGACY_RETRY_REQUIRES_REVIEW")) return "Esta devolución antigua requiere revisar su comprobante antes de reintentar. No repitas la operación.";
  if (raw.includes("IDEMPOTENCY_CONFLICT")) return "La clave de esta devolución ya corresponde a otra solicitud. Revisá el historial antes de continuar.";
  if (raw.includes("RETURN_UNIT_INVALID")) return "La unidad histórica de la venta no es válida. Requiere revisión administrativa, sin convertirla a la unidad actual.";
  if (raw.includes("RETURN_QUANTITY_INVALID")) return "Revisá la cantidad y los decimales permitidos por la unidad de la venta.";
  if (raw.includes("RETURN_ITEM_NOT_FOUND") || raw.includes("RETURN_ITEM_INVALID")) return "El renglón no pertenece a esta venta o ya no está disponible.";
  if (raw.includes("SALE_NOT_RETURNABLE")) return "El estado de esta venta no permite devoluciones.";
  if (raw.includes("SALE_NOT_FOUND")) return "La venta ya no está disponible en esta empresa.";
  if (raw.includes("SALE_ALREADY_VOIDED")) return "La venta ya está anulada.";
  if (raw.includes("RETURN_REASON_REQUIRED")) return "Ingresá un motivo para la devolución o anulación.";
  if (raw.includes("RETURN_ITEMS_REQUIRED")) return "Seleccioná al menos un producto para devolver.";
  if (raw.includes("RETURN_QUANTITY_EXCEEDS_AVAILABLE")) return "La cantidad a devolver supera lo disponible de esa venta.";
  if (raw.includes("NOTHING_TO_RETURN")) return "La venta ya no tiene mercadería pendiente para devolver.";
  if (raw.includes("ACCOUNT_RETURN_REQUIRES_MANUAL_REVIEW")) return "La cuenta corriente ya no tiene saldo suficiente para revertir automáticamente esta devolución. Requiere revisión administrativa.";
  if (raw.includes("SALES_WRITE_FORBIDDEN")) return "Tu usuario no tiene permiso para anular o devolver ventas.";
  if (raw.includes("AUTH_REQUIRED")) return "La sesión venció. Volvé a ingresar.";
  return raw || "No se pudo procesar la devolución.";
}

export async function listarVentasDevolviblesSigo(empresaId: string, limite = 30): Promise<VentaDevolvibleSigo[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limite), 1), 100);
  const { data, error } = await supabase
    .from("ventas_sigo")
    .select("id,numero,total,medio_pago,cliente_id,created_at")
    .eq("empresa_id", empresaId)
    .eq("estado", "confirmada")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(mensaje(error));
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    numero: row.numero == null ? null : Number(row.numero),
    total: numero(row.total),
    medioPago: row.medio_pago as MedioPagoSigo,
    clienteId: row.cliente_id ? String(row.cliente_id) : null,
    createdAt: String(row.created_at),
  }));
}

async function leerFilasCompletas(consulta: (desde: number, hasta: number) => any): Promise<any[]> {
  const filas: any[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(mensaje(error));
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}

export async function cargarItemsDevolviblesSigo(empresaId: string, ventaId: string): Promise<ItemVentaDevolvibleSigo[]> {
  const items = await leerFilasCompletas((desde, hasta) => supabase
    .from("venta_items_sigo")
    .select("id,producto_id,cantidad,precio_unitario,subtotal,unidad_medida,productos(nombre,codigo_interno,codigo_barras)")
    .eq("empresa_id", empresaId)
    .eq("venta_id", ventaId)
    .order("id", { ascending: true }).range(desde, hasta));

  const ids = (items ?? []).map((item: any) => String(item.id));
  const devueltoPorItem = new Map<string, { cantidad: number; importe: number }>();
  if (ids.length > 0) {
    const devueltos = await leerFilasCompletas((desde, hasta) => supabase
      .from("devolucion_items_sigo")
      .select("venta_item_id,cantidad,subtotal")
      .eq("empresa_id", empresaId)
      .in("venta_item_id", ids)
      .order("id", { ascending: true }).range(desde, hasta));
    for (const row of devueltos ?? []) {
      const id = String((row as any).venta_item_id);
      const previo = devueltoPorItem.get(id) ?? { cantidad: 0, importe: 0 };
      const cantidad = previo.cantidad + milésimas((row as any).cantidad);
      const importe = previo.importe + centavos((row as any).subtotal);
      if (!Number.isSafeInteger(cantidad) || !Number.isSafeInteger(importe)) throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
      devueltoPorItem.set(id, { cantidad, importe });
    }
  }

  return (items ?? []).map((row: any) => {
    const producto = Array.isArray(row.productos) ? row.productos[0] : row.productos;
    const vendida = milésimas(row.cantidad);
    const devuelta = devueltoPorItem.get(String(row.id)) ?? { cantidad: 0, importe: 0 };
    const original = centavos(row.subtotal);
    const unidad = row.unidad_medida == null ? null : normalizarUnidadVenta(row.unidad_medida);
    if (row.unidad_medida != null && unidad !== row.unidad_medida) throw new Error(mensaje(new Error("RETURN_UNIT_INVALID")));
    if (vendida <= 0 || devuelta.cantidad > vendida || devuelta.importe > original || (devuelta.cantidad === vendida && devuelta.importe !== original)) {
      throw new Error(mensaje(new Error("RETURN_HISTORY_REQUIRES_MANUAL_REVIEW")));
    }
    return {
      ventaItemId: String(row.id),
      productoId: String(row.producto_id),
      producto: producto?.nombre ? String(producto.nombre) : "Producto",
      codigo: producto?.codigo_barras || producto?.codigo_interno || null,
      cantidadVendida: vendida / 1000,
      cantidadDevuelta: devuelta.cantidad / 1000,
      cantidadDisponible: (vendida - devuelta.cantidad) / 1000,
      unidadMedida: unidad,
      subtotalOriginal: original / 100,
      subtotalDevuelto: devuelta.importe / 100,
      subtotalDisponible: (original - devuelta.importe) / 100,
      precioUnitario: numero(row.precio_unitario),
    };
  });
}

async function leerResultadoPersistido(empresaId: string, id: string): Promise<ResultadoDevolucionSigo> {
  try {
    const { data, error } = await supabase.from("devoluciones_sigo").select("id,total").eq("empresa_id", empresaId).eq("id", id).single();
    if (!error && data?.id === id) return { id, total: centavos(data.total) / 100 };
  } catch { /* La escritura ya devolvió comprobante; no repetirla por un fallo de lectura. */ }
  return { id, total: null };
}

export async function registrarDevolucionSigo(input: {
  empresaId: string;
  ventaId: string;
  motivo: string;
  items: Array<{ ventaItemId: string; cantidad: number }>;
  idempotencyKey?: string;
}): Promise<ResultadoDevolucionSigo> {
  const { data, error } = await supabase.rpc("registrar_devolucion_sigo", {
    p_empresa_id: input.empresaId,
    p_venta_id: input.ventaId,
    p_items: input.items.map((item) => ({ venta_item_id: item.ventaItemId, cantidad: item.cantidad })),
    p_motivo: input.motivo.trim(),
    p_idempotency_key: input.idempotencyKey ?? clavePendiente(input.empresaId, input.ventaId),
    p_anular_total: false,
  });
  if (error) throw new Error(mensaje(error));
  if (!data) throw new Error("La devolución no devolvió comprobante.");
  if (!input.idempotencyKey) cerrarIntento(input.empresaId, input.ventaId);
  return leerResultadoPersistido(input.empresaId, String(data));
}

export async function anularVentaSigo(input: {
  empresaId: string;
  ventaId: string;
  motivo: string;
  idempotencyKey?: string;
}): Promise<ResultadoDevolucionSigo> {
  const { data, error } = await supabase.rpc("anular_venta_sigo", {
    p_empresa_id: input.empresaId,
    p_venta_id: input.ventaId,
    p_motivo: input.motivo.trim(),
    p_idempotency_key: input.idempotencyKey ?? clavePendiente(input.empresaId, input.ventaId),
  });
  if (error) throw new Error(mensaje(error));
  if (!data) throw new Error("La anulación no devolvió comprobante.");
  if (!input.idempotencyKey) cerrarIntento(input.empresaId, input.ventaId);
  return leerResultadoPersistido(input.empresaId, String(data));
}

export async function listarDevolucionesRecientesSigo(empresaId: string, limite = 20): Promise<DevolucionRecienteSigo[]> {
  const { data, error } = await supabase
    .from("devoluciones_sigo")
    .select("id,venta_id,tipo,total,motivo,created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limite), 1), 50));
  if (error) throw new Error(mensaje(error));
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    ventaId: String(row.venta_id),
    tipo: row.tipo === "total" ? "total" : "parcial",
    total: numero(row.total),
    motivo: String(row.motivo ?? ""),
    createdAt: String(row.created_at),
  }));
}
