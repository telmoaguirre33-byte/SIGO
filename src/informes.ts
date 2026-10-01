import { supabase } from "./supabase";
import { listarClientesSigo } from "./clientes";
import { listarProductosSigo } from "./productos";

export type ResumenOperativoSigo = {
  productos: number;
  productosSinStock: number;
  productosCriticos: number;
  unidadesStock: number;
  clientes: number;
  clientesConDeuda: number;
  saldoClientes: number;
  comprasCantidad: number;
  comprasTotal: number;
  ventasCantidad: number;
  ventasTotal: number;
  ventasHoy: number;
  ventasHoyTotal: number;
  cajaHoyIngresos: number;
  cajaHoyEgresos: number;
  cajaHoyNeto: number;
  cajaHoyPorMedio: Record<string, number>;
  modulosNoDisponibles: string[];
  ventasUltimos7Dias: Array<{ fecha: string; total: number; cantidad: number }>;
  ventas7DiasTotal: number;
  ventas7DiasAnteriorTotal: number;
  variacionVentas7Dias: number | null;
};

type VentaRow = {
  total?: number | string | null;
  created_at?: string | null;
};

type CompraRow = {
  total?: number | string | null;
  created_at?: string | null;
};

type CajaRow = {
  tipo?: "ingreso" | "egreso" | string | null;
  medio_pago?: string | null;
  importe?: number | string | null;
};

function numeroSeguro(valor: number | string | null | undefined): number {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? numero : 0;
}

async function listarVentasSigoCompletas(empresaId: string): Promise<VentaRow[]> {
  const pagina = 1000;
  const filas: VentaRow[] = [];

  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from("ventas_sigo")
      .select("total,created_at")
      .eq("empresa_id", empresaId)
      .eq("estado", "confirmada")
      .order("created_at", { ascending: false })
      .range(desde, desde + pagina - 1);

    if (error) throw error;
    const lote = (data ?? []) as VentaRow[];
    filas.push(...lote);
    if (lote.length < pagina) break;
  }

  return filas;
}

async function listarComprasSigoCompletas(empresaId: string): Promise<CompraRow[]> {
  const pagina = 1000;
  const filas: CompraRow[] = [];

  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from("compras_sigo")
      .select("total,created_at")
      .eq("empresa_id", empresaId)
      .eq("estado", "confirmada")
      .order("created_at", { ascending: false })
      .range(desde, desde + pagina - 1);

    if (error) throw error;
    const lote = (data ?? []) as CompraRow[];
    filas.push(...lote);
    if (lote.length < pagina) break;
  }

  return filas;
}

async function listarCajaHoySigo(empresaId: string, inicioHoyIso: string): Promise<CajaRow[]> {
  const pagina = 1000;
  const filas: CajaRow[] = [];

  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from("caja_movimientos_sigo")
      .select("tipo,medio_pago,importe")
      .eq("empresa_id", empresaId)
      .gte("created_at", inicioHoyIso)
      .order("created_at", { ascending: false })
      .range(desde, desde + pagina - 1);

    if (error) throw error;
    const lote = (data ?? []) as CajaRow[];
    filas.push(...lote);
    if (lote.length < pagina) break;
  }

  return filas;
}

export async function cargarResumenOperativoSigo(empresaId: string): Promise<ResumenOperativoSigo> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");

  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);

  const [productosResult, clientesResult, comprasResult, ventasResult, cajaResult] = await Promise.allSettled([
    listarProductosSigo(empresaId),
    listarClientesSigo(empresaId),
    listarComprasSigoCompletas(empresaId),
    listarVentasSigoCompletas(empresaId),
    listarCajaHoySigo(empresaId, inicioHoy.toISOString()),
  ]);

  const modulosNoDisponibles: string[] = [];
  const productos = productosResult.status === "fulfilled" ? productosResult.value : [];
  const clientes = clientesResult.status === "fulfilled" ? clientesResult.value : [];
  const compras = comprasResult.status === "fulfilled" ? comprasResult.value : [];
  const ventas = ventasResult.status === "fulfilled" ? ventasResult.value : [];
  const cajaHoy = cajaResult.status === "fulfilled" ? cajaResult.value : [];

  if (productosResult.status === "rejected") modulosNoDisponibles.push("Productos/Stock");
  if (clientesResult.status === "rejected") modulosNoDisponibles.push("Clientes/Cuentas corrientes");
  if (comprasResult.status === "rejected") modulosNoDisponibles.push("Compras/Proveedores");
  if (ventasResult.status === "rejected") modulosNoDisponibles.push("Ventas");
  if (cajaResult.status === "rejected") modulosNoDisponibles.push("Caja");

  const visibles = productos.filter((producto) => producto.stock_actual != null);
  const productosSinStock = visibles.filter((producto) => numeroSeguro(producto.stock_actual) <= 0).length;
  const productosCriticos = visibles.filter((producto) =>
    producto.stock_minimo != null && numeroSeguro(producto.stock_actual) <= numeroSeguro(producto.stock_minimo)
  ).length;
  const unidadesStock = visibles.reduce((total, producto) => total + numeroSeguro(producto.stock_actual), 0);

  const saldosPositivos = clientes
    .map((cliente) => numeroSeguro(cliente.saldo_actual))
    .filter((saldo) => saldo > 0);
  const clientesConDeuda = saldosPositivos.length;
  const saldoClientes = saldosPositivos.reduce((total, saldo) => total + saldo, 0);
  const comprasTotal = compras.reduce((total, compra) => total + numeroSeguro(compra.total), 0);
  const ventasTotal = ventas.reduce((total, venta) => total + numeroSeguro(venta.total), 0);

  const ventasDeHoy = ventas.filter((venta) => venta.created_at && new Date(venta.created_at).getTime() >= inicioHoy.getTime());
  const ventasHoyTotal = ventasDeHoy.reduce((total, venta) => total + numeroSeguro(venta.total), 0);

  const inicio7 = new Date(inicioHoy);
  inicio7.setDate(inicio7.getDate() - 6);
  const inicioAnterior = new Date(inicio7);
  inicioAnterior.setDate(inicioAnterior.getDate() - 7);
  const ventasUltimos7Dias = Array.from({ length: 7 }, (_, indice) => {
    const dia = new Date(inicio7);
    dia.setDate(dia.getDate() + indice);
    const siguiente = new Date(dia);
    siguiente.setDate(siguiente.getDate() + 1);
    const delDia = ventas.filter((venta) => {
      if (!venta.created_at) return false;
      const fecha = new Date(venta.created_at).getTime();
      return fecha >= dia.getTime() && fecha < siguiente.getTime();
    });
    return { fecha: dia.toISOString().slice(0, 10), total: delDia.reduce((total, venta) => total + numeroSeguro(venta.total), 0), cantidad: delDia.length };
  });
  const ventas7DiasTotal = ventasUltimos7Dias.reduce((total, dia) => total + dia.total, 0);
  const ventas7DiasAnteriorTotal = ventas.filter((venta) => venta.created_at && new Date(venta.created_at).getTime() >= inicioAnterior.getTime() && new Date(venta.created_at).getTime() < inicio7.getTime()).reduce((total, venta) => total + numeroSeguro(venta.total), 0);
  const variacionVentas7Dias = ventas7DiasAnteriorTotal > 0 ? ((ventas7DiasTotal - ventas7DiasAnteriorTotal) / ventas7DiasAnteriorTotal) * 100 : null;

  const cajaHoyIngresos = cajaHoy
    .filter((movimiento) => movimiento.tipo === "ingreso")
    .reduce((total, movimiento) => total + numeroSeguro(movimiento.importe), 0);
  const cajaHoyEgresos = cajaHoy
    .filter((movimiento) => movimiento.tipo === "egreso")
    .reduce((total, movimiento) => total + numeroSeguro(movimiento.importe), 0);
  const cajaHoyPorMedio = cajaHoy.reduce<Record<string, number>>((acumulado, movimiento) => {
    if (movimiento.tipo !== "ingreso") return acumulado;
    const medio = movimiento.medio_pago?.trim() || "otro";
    acumulado[medio] = (acumulado[medio] ?? 0) + numeroSeguro(movimiento.importe);
    return acumulado;
  }, {});

  return {
    productos: productos.length,
    productosSinStock,
    productosCriticos,
    unidadesStock,
    clientes: clientes.length,
    clientesConDeuda,
    saldoClientes,
    comprasCantidad: compras.length,
    comprasTotal,
    ventasCantidad: ventas.length,
    ventasTotal,
    ventasHoy: ventasDeHoy.length,
    ventasHoyTotal,
    cajaHoyIngresos,
    cajaHoyEgresos,
    cajaHoyNeto: cajaHoyIngresos - cajaHoyEgresos,
    cajaHoyPorMedio,
    modulosNoDisponibles,
    ventasUltimos7Dias,
    ventas7DiasTotal,
    ventas7DiasAnteriorTotal,
    variacionVentas7Dias,
  };
}
