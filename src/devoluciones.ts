import { supabase } from "./supabase";
import type { MedioPagoSigo } from "./ventas";

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
};

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

function mensaje(error: unknown) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

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

export async function cargarItemsDevolviblesSigo(empresaId: string, ventaId: string): Promise<ItemVentaDevolvibleSigo[]> {
  const { data: items, error: itemsError } = await supabase
    .from("venta_items_sigo")
    .select("id,producto_id,cantidad,precio_unitario,productos(nombre,codigo_interno,codigo_barras)")
    .eq("empresa_id", empresaId)
    .eq("venta_id", ventaId)
    .order("id", { ascending: true });
  if (itemsError) throw new Error(mensaje(itemsError));

  const ids = (items ?? []).map((item: any) => String(item.id));
  const devueltoPorItem = new Map<string, number>();
  if (ids.length > 0) {
    const { data: devueltos, error: devError } = await supabase
      .from("devolucion_items_sigo")
      .select("venta_item_id,cantidad")
      .eq("empresa_id", empresaId)
      .in("venta_item_id", ids);
    if (devError) throw new Error(mensaje(devError));
    for (const row of devueltos ?? []) {
      const id = String((row as any).venta_item_id);
      devueltoPorItem.set(id, (devueltoPorItem.get(id) ?? 0) + numero((row as any).cantidad));
    }
  }

  return (items ?? []).map((row: any) => {
    const producto = Array.isArray(row.productos) ? row.productos[0] : row.productos;
    const vendida = numero(row.cantidad);
    const devuelta = devueltoPorItem.get(String(row.id)) ?? 0;
    return {
      ventaItemId: String(row.id),
      productoId: String(row.producto_id),
      producto: producto?.nombre ? String(producto.nombre) : "Producto",
      codigo: producto?.codigo_barras || producto?.codigo_interno || null,
      cantidadVendida: vendida,
      cantidadDevuelta: devuelta,
      cantidadDisponible: Math.max(vendida - devuelta, 0),
      precioUnitario: numero(row.precio_unitario),
    };
  });
}

export async function registrarDevolucionSigo(input: {
  empresaId: string;
  ventaId: string;
  motivo: string;
  items: Array<{ ventaItemId: string; cantidad: number }>;
  idempotencyKey?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("registrar_devolucion_sigo", {
    p_empresa_id: input.empresaId,
    p_venta_id: input.ventaId,
    p_items: input.items.map((item) => ({ venta_item_id: item.ventaItemId, cantidad: item.cantidad })),
    p_motivo: input.motivo.trim(),
    p_idempotency_key: input.idempotencyKey ?? claveOperacion(),
    p_anular_total: false,
  });
  if (error) throw new Error(mensaje(error));
  if (!data) throw new Error("La devolución no devolvió comprobante.");
  return String(data);
}

export async function anularVentaSigo(input: {
  empresaId: string;
  ventaId: string;
  motivo: string;
  idempotencyKey?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("anular_venta_sigo", {
    p_empresa_id: input.empresaId,
    p_venta_id: input.ventaId,
    p_motivo: input.motivo.trim(),
    p_idempotency_key: input.idempotencyKey ?? claveOperacion(),
  });
  if (error) throw new Error(mensaje(error));
  if (!data) throw new Error("La anulación no devolvió comprobante.");
  return String(data);
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
