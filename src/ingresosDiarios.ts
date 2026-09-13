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
