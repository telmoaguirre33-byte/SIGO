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
  ventasHoyPorHora: Array<{ hora: number; total: number; cantidad: number }>;
  ventasPorHora30Dias: Array<{ hora: number; total: number; cantidad: number }>;
  ventasPorDiaSemana30Dias: Array<{ dia: string; total: number; cantidad: number }>;
  cajaHoyIngresos: number;
  cajaHoyEgresos: number;
  cajaHoyNeto: number;
  cajaHoyPorMedio: Record<string, number>;
  modulosNoDisponibles: string[];
  ventasUltimos7Dias: Array<{ fecha: string; total: number; cantidad: number }>;
  ventas7DiasTotal: number;
  ventas7DiasAnteriorTotal: number;
  variacionVentas7Dias: number | null;
  ventas30DiasTotal: number;
  ventas30DiasAnteriorTotal: number;
  variacionVentas30Dias: number | null;
  ticketPromedio30Dias: number;
  compras30DiasTotal: number;
  balanceComercial30Dias: number;
  caja7DiasIngresos: number;
  caja7DiasEgresos: number;
  caja7DiasNeto: number;
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
  created_at?: string | null;
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

async function listarCajaDesdeSigo(empresaId: string, inicioHoyIso: string): Promise<CajaRow[]> {
  const pagina = 1000;
  const filas: CajaRow[] = [];

  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from("caja_movimientos_sigo")
      .select("tipo,medio_pago,importe,created_at")
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

export type ResumenVentasPeriodoSigo = {
  desde: string;
  hasta: string;
  cantidad: number;
  total: number;
  ticketPromedio: number;
  dias: Array<{ fecha: string; total: number; cantidad: number }>;
  porHora: Array<{ hora: number; total: number; cantidad: number }>;
  porDiaSemana: Array<{ dia: string; total: number; cantidad: number }>;
};

export type ResumenComprasPeriodoSigo = {
  desde: string;
  hasta: string;
  comprasCantidad: number;
  comprasTotal: number;
  ventasCantidad: number;
  ventasTotal: number;
  balanceComercial: number;
};

export async function cargarComprasPeriodoSigo(empresaId: string, desde: string, hasta: string): Promise<ResumenComprasPeriodoSigo> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");
  if (!desde || !hasta) throw new Error("Elegí las fechas Desde y Hasta.");
  if (desde > hasta) throw new Error("La fecha Desde no puede ser posterior a Hasta.");
  const inicio = new Date(`${desde}T00:00:00`);
  const finExclusivo = new Date(`${hasta}T00:00:00`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(finExclusivo.getTime())) throw new Error("Elegí un período válido.");
  finExclusivo.setDate(finExclusivo.getDate() + 1);

  async function listar(tabla: "compras_sigo" | "ventas_sigo") {
    const filas: VentaRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      let consulta = supabase.from(tabla).select("total,created_at").eq("empresa_id", empresaId).eq("estado", "confirmada")
        .gte("created_at", inicio.toISOString()).lt("created_at", finExclusivo.toISOString())
        .order("created_at", { ascending: true }).range(offset, offset + 999);
      const { data, error } = await consulta;
      if (error) throw error;
      const lote = (data ?? []) as VentaRow[];
      filas.push(...lote);
      if (lote.length < 1000) break;
    }
    return filas;
  }

  const [compras, ventas] = await Promise.all([listar("compras_sigo"), listar("ventas_sigo")]);
  const comprasTotal = compras.reduce((total, fila) => total + numeroSeguro(fila.total), 0);
  const ventasTotal = ventas.reduce((total, fila) => total + numeroSeguro(fila.total), 0);
  return { desde, hasta, comprasCantidad: compras.length, comprasTotal, ventasCantidad: ventas.length, ventasTotal, balanceComercial: ventasTotal - comprasTotal };
}

export async function cargarVentasPeriodoSigo(empresaId: string, desde: string, hasta: string): Promise<ResumenVentasPeriodoSigo> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");
  if (!desde || !hasta) throw new Error("Elegí las fechas Desde y Hasta.");
  if (desde > hasta) throw new Error("La fecha Desde no puede ser posterior a Hasta.");

  const inicio = new Date(desde + "T00:00:00");
  const finExclusivo = new Date(hasta + "T00:00:00");
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(finExclusivo.getTime())) {
    throw new Error("Elegí un período válido.");
  }
  finExclusivo.setDate(finExclusivo.getDate() + 1);

  // Paginar dentro del período evita que el límite por defecto de PostgREST
  // recorte el gráfico o los KPI cuando hay más de mil ventas.
  const pagina = 1000;
  const ventas: VentaRow[] = [];
  for (let desdeFila = 0; ; desdeFila += pagina) {
    const { data, error } = await supabase
      .from("ventas_sigo")
      .select("total,created_at")
      .eq("empresa_id", empresaId)
      .eq("estado", "confirmada")
      .gte("created_at", inicio.toISOString())
      .lt("created_at", finExclusivo.toISOString())
      .order("created_at", { ascending: true })
      .range(desdeFila, desdeFila + pagina - 1);
    if (error) throw error;
    const lote = (data ?? []) as VentaRow[];
    ventas.push(...lote);
    if (lote.length < pagina) break;
  }

  const fechaLocal = (fecha: Date) => [
    fecha.getFullYear().toString().padStart(4, "0"),
    (fecha.getMonth() + 1).toString().padStart(2, "0"),
    fecha.getDate().toString().padStart(2, "0"),
  ].join("-");
  const porDia = new Map<string, { total: number; cantidad: number }>();
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0, cantidad: 0 }));
  const nombresDias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const porDiaSemana = nombresDias.map((dia) => ({ dia, total: 0, cantidad: 0 }));
  for (const venta of ventas) {
    if (!venta.created_at) continue;
    const fechaVenta = new Date(venta.created_at);
    const fecha = fechaLocal(fechaVenta);
    const actual = porDia.get(fecha) ?? { total: 0, cantidad: 0 };
    const totalVenta = numeroSeguro(venta.total);
    actual.total += totalVenta;
    actual.cantidad += 1;
    porDia.set(fecha, actual);
    porHora[fechaVenta.getHours()].total += totalVenta;
    porHora[fechaVenta.getHours()].cantidad += 1;
    porDiaSemana[fechaVenta.getDay()].total += totalVenta;
    porDiaSemana[fechaVenta.getDay()].cantidad += 1;
  }

  const dias: Array<{ fecha: string; total: number; cantidad: number }> = [];
  const cursor = new Date(inicio);
  while (cursor < finExclusivo) {
    const fecha = fechaLocal(cursor);
    const valor = porDia.get(fecha) ?? { total: 0, cantidad: 0 };
    dias.push({ fecha, ...valor });
    cursor.setDate(cursor.getDate() + 1);
  }
  const total = ventas.reduce((t,v)=>t+numeroSeguro(v.total),0);
  return { desde, hasta, cantidad: ventas.length, total, ticketPromedio: ventas.length ? total / ventas.length : 0, dias, porHora, porDiaSemana };
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
    listarCajaDesdeSigo(empresaId, new Date(inicioHoy.getTime() - 6 * 86400000).toISOString()),
  ]);

  const modulosNoDisponibles: string[] = [];
  const productos = productosResult.status === "fulfilled" ? productosResult.value : [];
  const clientes = clientesResult.status === "fulfilled" ? clientesResult.value : [];
  const compras = comprasResult.status === "fulfilled" ? comprasResult.value : [];
  const ventas = ventasResult.status === "fulfilled" ? ventasResult.value : [];
  const cajaMovimientos7 = cajaResult.status === "fulfilled" ? cajaResult.value : [];
  const cajaHoy = cajaMovimientos7.filter((m) => m.created_at && new Date(m.created_at).getTime() >= inicioHoy.getTime());

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
  const porHora=(filas:VentaRow[])=>Array.from({length:24},(_,hora)=>{const del=filas.filter(v=>v.created_at&&new Date(v.created_at).getHours()===hora);return {hora,total:del.reduce((t,v)=>t+numeroSeguro(v.total),0),cantidad:del.length};});
  const ventasHoyPorHora=porHora(ventasDeHoy);

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

  const inicio30 = new Date(inicioHoy); inicio30.setDate(inicio30.getDate() - 29);
  const inicio30Anterior = new Date(inicio30); inicio30Anterior.setDate(inicio30Anterior.getDate() - 30);
  const ventas30 = ventas.filter((v) => v.created_at && new Date(v.created_at).getTime() >= inicio30.getTime());
  const ventas30Anterior = ventas.filter((v) => v.created_at && new Date(v.created_at).getTime() >= inicio30Anterior.getTime() && new Date(v.created_at).getTime() < inicio30.getTime());
  const compras30 = compras.filter((c) => c.created_at && new Date(c.created_at).getTime() >= inicio30.getTime());
  const ventas30DiasTotal = ventas30.reduce((t,v)=>t+numeroSeguro(v.total),0);
  const ventasPorHora30Dias=porHora(ventas30);
  const dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const ventasPorDiaSemana30Dias=dias.map((dia,indice)=>{const del=ventas30.filter(v=>v.created_at&&new Date(v.created_at).getDay()===indice);return {dia,total:del.reduce((t,v)=>t+numeroSeguro(v.total),0),cantidad:del.length};});
  const ventas30DiasAnteriorTotal = ventas30Anterior.reduce((t,v)=>t+numeroSeguro(v.total),0);
  const variacionVentas30Dias = ventas30DiasAnteriorTotal > 0 ? ((ventas30DiasTotal-ventas30DiasAnteriorTotal)/ventas30DiasAnteriorTotal)*100 : null;
  const ticketPromedio30Dias = ventas30.length > 0 ? ventas30DiasTotal / ventas30.length : 0;
  const compras30DiasTotal = compras30.reduce((t,c)=>t+numeroSeguro(c.total),0);
  const balanceComercial30Dias = ventas30DiasTotal - compras30DiasTotal;

  const caja7DiasIngresos = cajaMovimientos7.filter((m) => m.tipo === "ingreso").reduce((t,m)=>t+numeroSeguro(m.importe),0);
  const caja7DiasEgresos = cajaMovimientos7.filter((m) => m.tipo === "egreso").reduce((t,m)=>t+numeroSeguro(m.importe),0);
  const caja7DiasNeto = caja7DiasIngresos - caja7DiasEgresos;

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
    ventasHoyPorHora,
    ventasPorHora30Dias,
    ventasPorDiaSemana30Dias,
    cajaHoyIngresos,
    cajaHoyEgresos,
    cajaHoyNeto: cajaHoyIngresos - cajaHoyEgresos,
    cajaHoyPorMedio,
    modulosNoDisponibles,
    ventasUltimos7Dias,
    ventas7DiasTotal,
    ventas7DiasAnteriorTotal,
    variacionVentas7Dias,
    ventas30DiasTotal,
    ventas30DiasAnteriorTotal,
    variacionVentas30Dias,
    ticketPromedio30Dias,
    compras30DiasTotal,
    balanceComercial30Dias,
    caja7DiasIngresos,
    caja7DiasEgresos,
    caja7DiasNeto,
  };
}
