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

type SolicitudDevolucion = {
  empresaId: string;
  ventaId: string;
  motivo: string;
  items?: Array<{ ventaItemId: string; cantidad: number }>;
  idempotencyKey?: string;
};
type OperacionPendiente = { tipo: "parcial" | "total"; input: SolicitudDevolucion; clave: string };
const enCurso = new Map<string, { identidad: string; promesa: Promise<string> }>();
const storageKey = (empresaId: string) => `sigo:devolucion-pendiente:v1:${empresaId}`;

export function devolucionPendienteSigo(empresaId: string): OperacionPendiente | null {
  const raw = localStorage.getItem(storageKey(empresaId));
  if (!raw) return null;
  const op = JSON.parse(raw) as OperacionPendiente;
  if (op.input?.empresaId !== empresaId || !op.input.ventaId || !op.clave || !["parcial", "total"].includes(op.tipo)) {
    throw new Error("La operación pendiente requiere revisión antes de otra devolución.");
  }
  return op;
}

function identidadOperacion(tipo: OperacionPendiente["tipo"], input: SolicitudDevolucion) {
  return JSON.stringify([tipo, input.empresaId, input.ventaId, input.motivo.trim(),
    [...(input.items ?? [])].sort((a, b) => a.ventaItemId.localeCompare(b.ventaItemId))]);
}

function ejecutarDevolucion(tipo: OperacionPendiente["tipo"], input: SolicitudDevolucion): Promise<string> {
  const identidad = identidadOperacion(tipo, input);
  const actual = enCurso.get(input.empresaId);
  if (actual) {
    if (actual.identidad !== identidad) return Promise.reject(new Error("Primero conciliá la devolución pendiente."));
    return actual.promesa;
  }
  const promesa = (async () => {
    const pendiente = devolucionPendienteSigo(input.empresaId);
    if (pendiente && identidadOperacion(pendiente.tipo, pendiente.input) !== identidad) {
      throw new Error("Hay una devolución pendiente de confirmación. Reintentá la operación original antes de modificarla.");
    }
    const op: OperacionPendiente = pendiente ?? { tipo, input: { ...input, motivo: input.motivo.trim(), items: input.items?.map(i => ({ ...i })) }, clave: input.idempotencyKey ?? crypto.randomUUID() };
    // Persistir ANTES de enviar: una recarga o timeout debe conservar la identidad original.
    localStorage.setItem(storageKey(input.empresaId), JSON.stringify(op));
    const params = {
      p_empresa_id: op.input.empresaId, p_venta_id: op.input.ventaId,
      p_motivo: op.input.motivo, p_idempotency_key: op.clave,
      ...(tipo === "parcial" ? { p_items: op.input.items!.map(i => ({ venta_item_id: i.ventaItemId, cantidad: i.cantidad })), p_anular_total: false } : {}),
    };
    let id: string | null = null;
    let fallo: unknown;
    try {
      const { data, error } = await supabase.rpc(tipo === "parcial" ? "registrar_devolucion_sigo" : "anular_venta_sigo", params);
      if (error) throw error;
      if (!data) throw new Error("La operación no devolvió comprobante.");
      id = String(data);
    } catch (error) {
      fallo = error;
      // Timeout tras commit y colisiones concurrentes se concilian leyendo la MISMA clave.
      try {
        const { data, error: lecturaError } = await supabase.from("devoluciones_sigo")
          .select("id").eq("empresa_id", op.input.empresaId).eq("venta_id", op.input.ventaId)
          .eq("idempotency_key", op.clave).maybeSingle();
        if (!lecturaError && data?.id) id = String(data.id);
      } catch { /* Conservar la solicitud para reintentar sin crear otra clave. */ }
    }
    if (!id) throw new Error(`${mensaje(fallo)} La operación queda pendiente de confirmación; reintentá la original.`);
    localStorage.removeItem(storageKey(input.empresaId));
    return id;
  })();
  enCurso.set(input.empresaId, { identidad, promesa });
  void promesa.finally(() => enCurso.delete(input.empresaId)).catch(() => {});
  return promesa;
}

export function registrarDevolucionSigo(input: SolicitudDevolucion & { items: Array<{ ventaItemId: string; cantidad: number }> }): Promise<string> {
  return ejecutarDevolucion("parcial", input);
}

export function anularVentaSigo(input: SolicitudDevolucion): Promise<string> {
  return ejecutarDevolucion("total", input);
}

export function reintentarDevolucionPendienteSigo(empresaId: string): Promise<string> {
  const op = devolucionPendienteSigo(empresaId);
  if (!op) return Promise.reject(new Error("No hay devolución pendiente."));
  return ejecutarDevolucion(op.tipo, op.input);
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

