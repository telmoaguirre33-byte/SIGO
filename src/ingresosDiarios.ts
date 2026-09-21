import { supabase } from "./supabase";

export type IngresoDiaSigo = {
  fecha: string;
  cantidadVentas: number;
  cobrado: number;
  aCobrar: number;
  totalVentas: number;
};

export type ResumenIngresosDiariosSigo = {
  desde: string;
  hasta: string;
  cantidadVentas: number;
  cobrado: number;
  aCobrar: number;
  totalVentas: number;
  dias: IngresoDiaSigo[];
};

export type ItemVentaDiaSigo = {
  producto: string;
  codigo: string | null;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

export type VentaDiaSigo = {
  id: string;
  numero: number | null;
  total: number;
  medioPago: string;
  createdAt: string;
  items: ItemVentaDiaSigo[];
};

type VentaIngresoRow = {
  total?: number | string | null;
  medio_pago?: string | null;
  created_at?: string | null;
};

const PAGE_SIZE = 1000;

function numeroSeguro(valor: number | string | null | undefined): number {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? numero : 0;
}

function fechaClave(fecha: Date): string {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inicioDia(valor: string): Date {
  const partes = valor.split("-").map(Number);
  if (partes.length !== 3 || partes.some((item) => !Number.isFinite(item))) throw new Error("Rango de fechas inválido.");
  const fecha = new Date(partes[0], partes[1] - 1, partes[2], 0, 0, 0, 0);
  if (Number.isNaN(fecha.getTime())) throw new Error("Rango de fechas inválido.");
  return fecha;
}

function finDia(valor: string): Date {
  const fecha = inicioDia(valor);
  fecha.setHours(23, 59, 59, 999);
  return fecha;
}

function crearDias(desde: Date, hasta: Date): Map<string, IngresoDiaSigo> {
  const dias = new Map<string, IngresoDiaSigo>();
  const cursor = new Date(desde);
  cursor.setHours(0, 0, 0, 0);
  const limite = new Date(hasta);
  limite.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= limite.getTime()) {
    const fecha = fechaClave(cursor);
    dias.set(fecha, { fecha, cantidadVentas: 0, cobrado: 0, aCobrar: 0, totalVentas: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export async function cargarVentasDelDiaSigo(empresaId: string, fecha: string): Promise<VentaDiaSigo[]> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");
  const desde = inicioDia(fecha);
  const hasta = finDia(fecha);
  const { data: ventas, error } = await supabase
    .from("ventas_sigo")
    .select("id,numero,total,medio_pago,created_at")
    .eq("empresa_id", empresaId)
    .eq("estado", "confirmada")
    .gte("created_at", desde.toISOString())
    .lte("created_at", hasta.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = (ventas ?? []).map((v: any) => String(v.id));
  const itemsPorVenta = new Map<string, ItemVentaDiaSigo[]>();
  if (ids.length) {
    const { data: items, error: itemsError } = await supabase
      .from("venta_items_sigo")
      .select("venta_id,cantidad,precio_unitario,subtotal,productos(nombre,codigo_interno,codigo_barras)")
      .eq("empresa_id", empresaId)
      .in("venta_id", ids);
    if (itemsError) throw itemsError;
    for (const row of items ?? []) {
      const producto = Array.isArray((row as any).productos) ? (row as any).productos[0] : (row as any).productos;
      const item: ItemVentaDiaSigo = {
        producto: String(producto?.nombre ?? "Producto"),
        codigo: producto?.codigo_interno ? String(producto.codigo_interno) : producto?.codigo_barras ? String(producto.codigo_barras) : null,
        cantidad: numeroSeguro((row as any).cantidad),
        precioUnitario: numeroSeguro((row as any).precio_unitario),
        subtotal: numeroSeguro((row as any).subtotal),
      };
      const ventaId = String((row as any).venta_id);
      itemsPorVenta.set(ventaId, [...(itemsPorVenta.get(ventaId) ?? []), item]);
    }
  }

  return (ventas ?? []).map((v: any) => ({
    id: String(v.id),
    numero: v.numero == null ? null : Number(v.numero),
    total: numeroSeguro(v.total),
    medioPago: String(v.medio_pago ?? "otro"),
    createdAt: String(v.created_at),
    items: itemsPorVenta.get(String(v.id)) ?? [],
  }));
}

export async function cargarIngresosDiariosSigo(
  empresaId: string,
  desde: string,
  hasta: string,
): Promise<ResumenIngresosDiariosSigo> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");

  const desdeDate = inicioDia(desde);
  const hastaDate = finDia(hasta);
  if (desdeDate.getTime() > hastaDate.getTime()) throw new Error("La fecha desde no puede ser posterior a la fecha hasta.");

  const maximo = new Date(desdeDate);
  maximo.setDate(maximo.getDate() + 366);
  if (hastaDate.getTime() > maximo.getTime()) throw new Error("El rango máximo permitido es de 366 días.");

  const ventas: VentaIngresoRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ventas_sigo")
      .select("total,medio_pago,created_at")
      .eq("empresa_id", empresaId)
      .eq("estado", "confirmada")
      .gte("created_at", desdeDate.toISOString())
      .lte("created_at", hastaDate.toISOString())
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const lote = (data ?? []) as VentaIngresoRow[];
    ventas.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }

  const porDia = crearDias(desdeDate, hastaDate);
  let cantidadVentas = 0;
  let cobrado = 0;
  let aCobrar = 0;
  let totalVentas = 0;

  for (const venta of ventas) {
    if (!venta.created_at) continue;
    const fechaVenta = new Date(venta.created_at);
    if (Number.isNaN(fechaVenta.getTime())) continue;
    const clave = fechaClave(fechaVenta);
    const dia = porDia.get(clave);
    if (!dia) continue;

    const total = Math.max(numeroSeguro(venta.total), 0);
    const esCuentaCorriente = venta.medio_pago === "cuenta_corriente";

    dia.cantidadVentas += 1;
    dia.totalVentas += total;
    if (esCuentaCorriente) dia.aCobrar += total;
    else dia.cobrado += total;

    cantidadVentas += 1;
    totalVentas += total;
    if (esCuentaCorriente) aCobrar += total;
    else cobrado += total;
  }

  return {
    desde: fechaClave(desdeDate),
    hasta: fechaClave(hastaDate),
    cantidadVentas,
    cobrado,
    aCobrar,
    totalVentas,
    dias: Array.from(porDia.values()).sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}
