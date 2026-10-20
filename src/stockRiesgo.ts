import { supabase } from "./supabase";
import { listarProductosSigo, type ProductoSigo } from "./productos";

export type EstadoRiesgoStockSigo =
  | "sin_stock"
  | "urgente"
  | "proximo"
  | "revisar"
  | "ok"
  | "sin_historial";

export type RiesgoStockProductoSigo = {
  productoId: string;
  codigo: string | null;
  nombre: string;
  stockActual: number;
  ventasPeriodo: number;
  ventaPromedioDia: number;
  diasCobertura: number | null;
  estado: EstadoRiesgoStockSigo;
  compraSugerida: number;
  inversionSugerida: number;
};

export type ResumenRiesgoStockSigo = {
  diasAnalizados: number;
  coberturaObjetivoDias: number;
  sinStock: number;
  urgentes: number;
  proximos: number;
  revisar: number;
  sinHistorial: number;
  inversionSugerida: number;
  productosPrioritarios: RiesgoStockProductoSigo[];
};

type VentaIdRow = { id?: string | null };
type VentaItemRow = { producto_id?: string | null; cantidad?: number | string | null };

const COBERTURA_URGENTE_DIAS = 7;
const COBERTURA_PROXIMA_DIAS = 15;
const COBERTURA_OBJETIVO_DIAS = 30;
const PAGE_SIZE = 1000;
const IDS_POR_CONSULTA = 200;

function numeroSeguro(valor: number | string | null | undefined): number {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? numero : 0;
}

function normalizarDias(dias: number): number {
  if (!Number.isFinite(dias)) return 30;
  return Math.min(Math.max(Math.trunc(dias), 7), 365);
}

async function listarVentasPeriodo(empresaId: string, desdeIso: string): Promise<string[]> {
  const ids: string[] = [];

  for (let desde = 0; ; desde += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ventas_sigo")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("estado", "confirmada")
      .gte("created_at", desdeIso)
      .order("created_at", { ascending: false })
      .range(desde, desde + PAGE_SIZE - 1);

    if (error) throw error;
    const lote = (data ?? []) as VentaIdRow[];
    for (const fila of lote) {
      const id = String(fila.id ?? "").trim();
      if (id) ids.push(id);
    }
    if (lote.length < PAGE_SIZE) break;
  }

  return ids;
}

async function sumarVentasPorProducto(empresaId: string, ventaIds: string[]): Promise<Map<string, number>> {
  const acumulado = new Map<string, number>();

  for (let indice = 0; indice < ventaIds.length; indice += IDS_POR_CONSULTA) {
    const bloque = ventaIds.slice(indice, indice + IDS_POR_CONSULTA);
    const { data, error } = await supabase
      .from("venta_items_sigo")
      .select("producto_id,cantidad")
      .eq("empresa_id", empresaId)
      .in("venta_id", bloque);

    if (error) throw error;
    for (const fila of (data ?? []) as VentaItemRow[]) {
      const productoId = String(fila.producto_id ?? "").trim();
      const cantidad = numeroSeguro(fila.cantidad);
      if (!productoId || cantidad <= 0) continue;
      acumulado.set(productoId, (acumulado.get(productoId) ?? 0) + cantidad);
    }
  }

  return acumulado;
}

function costoProducto(producto: ProductoSigo): number {
  const actual = numeroSeguro(producto.costo_actual);
  if (actual > 0) return actual;
  return Math.max(numeroSeguro(producto.costo_ultima_compra), 0);
}

function construirRiesgo(
  producto: ProductoSigo,
  ventasPeriodo: number,
  diasAnalizados: number,
): RiesgoStockProductoSigo {
  const stockActual = Math.max(numeroSeguro(producto.stock_actual), 0);
  const ventaPromedioDia = ventasPeriodo > 0 ? ventasPeriodo / diasAnalizados : 0;
  const diasCobertura = ventaPromedioDia > 0 ? stockActual / ventaPromedioDia : null;

  let estado: EstadoRiesgoStockSigo;
  if (stockActual <= 0) estado = "sin_stock";
  else if (ventaPromedioDia <= 0) estado = "sin_historial";
  else if ((diasCobertura ?? 0) <= COBERTURA_URGENTE_DIAS) estado = "urgente";
  else if ((diasCobertura ?? 0) <= COBERTURA_PROXIMA_DIAS) estado = "proximo";
  else if ((diasCobertura ?? 0) <= COBERTURA_OBJETIVO_DIAS) estado = "revisar";
  else estado = "ok";

  const stockObjetivo = ventaPromedioDia > 0 ? Math.ceil(ventaPromedioDia * COBERTURA_OBJETIVO_DIAS) : 0;
  const compraSugerida = Math.max(stockObjetivo - stockActual, 0);

  return {
    productoId: producto.id,
    codigo: producto.codigo_barras || producto.codigo_interno || null,
    nombre: producto.nombre,
    stockActual,
    ventasPeriodo,
    ventaPromedioDia,
    diasCobertura,
    estado,
    compraSugerida,
    inversionSugerida: compraSugerida * costoProducto(producto),
  };
}

function prioridadEstado(estado: EstadoRiesgoStockSigo): number {
  const orden: Record<EstadoRiesgoStockSigo, number> = {
    sin_stock: 0,
    urgente: 1,
    proximo: 2,
    revisar: 3,
    ok: 4,
    sin_historial: 5,
  };
  return orden[estado];
}

export async function cargarRiesgoStockSigo(
  empresaId: string,
  dias = 30,
): Promise<ResumenRiesgoStockSigo> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");

  const diasAnalizados = normalizarDias(dias);
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - diasAnalizados + 1);

  const [productos, ventaIds] = await Promise.all([
    listarProductosSigo(empresaId),
    listarVentasPeriodo(empresaId, desde.toISOString()),
  ]);
  const ventasPorProducto = ventaIds.length > 0
    ? await sumarVentasPorProducto(empresaId, ventaIds)
    : new Map<string, number>();

  const riesgos = productos.map((producto) =>
    construirRiesgo(producto, ventasPorProducto.get(producto.id) ?? 0, diasAnalizados)
  );

  const prioritarios = riesgos
    .filter((item) => item.estado !== "ok" && item.estado !== "sin_historial")
    .sort((a, b) => {
      const estado = prioridadEstado(a.estado) - prioridadEstado(b.estado);
      if (estado !== 0) return estado;
      return (a.diasCobertura ?? 0) - (b.diasCobertura ?? 0);
    });

  return {
    diasAnalizados,
    coberturaObjetivoDias: COBERTURA_OBJETIVO_DIAS,
    sinStock: riesgos.filter((item) => item.estado === "sin_stock").length,
    urgentes: riesgos.filter((item) => item.estado === "urgente").length,
    proximos: riesgos.filter((item) => item.estado === "proximo").length,
    revisar: riesgos.filter((item) => item.estado === "revisar").length,
    sinHistorial: riesgos.filter((item) => item.estado === "sin_historial").length,
    inversionSugerida: prioritarios.reduce((total, item) => total + item.inversionSugerida, 0),
    productosPrioritarios: prioritarios.slice(0, 20),
  };
}
