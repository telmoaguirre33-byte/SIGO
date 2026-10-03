import { useEffect, useRef, useState } from "react";
import { verificarSaludOperativaSigo, type SaludOperativaSigo } from "./health";
import { cargarResumenOperativoSigo, type ResumenOperativoSigo } from "./informes";
import { cargarRiesgoStockSigo, type ResumenRiesgoStockSigo, type EstadoRiesgoStockSigo } from "./stockRiesgo";
import RankingProductosStock from "./RankingProductosStock";

const vacio: ResumenOperativoSigo = {
  productos: 0,
  productosSinStock: 0,
  productosCriticos: 0,
  unidadesStock: 0,
  clientes: 0,
  clientesConDeuda: 0,
  saldoClientes: 0,
  comprasCantidad: 0,
  comprasTotal: 0,
  ventasCantidad: 0,
  ventasTotal: 0,
  ventasHoy: 0,
  ventasHoyTotal: 0,
  ventasHoyPorHora: [],
  ventasPorHora30Dias: [],
  ventasPorDiaSemana30Dias: [],
  cajaHoyIngresos: 0,
  cajaHoyEgresos: 0,
  cajaHoyNeto: 0,
  cajaHoyPorMedio: {},
  modulosNoDisponibles: [],
  ventasUltimos7Dias: [],
  ventas7DiasTotal: 0,
  ventas7DiasAnteriorTotal: 0,
  variacionVentas7Dias: null,
  ventas30DiasTotal: 0,
  ventas30DiasAnteriorTotal: 0,
  variacionVentas30Dias: null,
  ticketPromedio30Dias: 0,
  compras30DiasTotal: 0,
  balanceComercial30Dias: 0,
  caja7DiasIngresos: 0,
  caja7DiasEgresos: 0,
  caja7DiasNeto: 0,
};

function dinero(valor: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(valor);
}

function numero(valor: number, decimales = 0) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

function GraficoVentas7Dias({ datos }: { datos: Array<{ fecha: string; total: number; cantidad: number }> }) {
  const maximo = Math.max(1, ...datos.map((item) => item.total));
  return <div className="sigo-trend-chart" aria-label="Ventas de los últimos 7 días">
    {datos.map((item) => <div className="sigo-trend-column" key={item.fecha} title={dinero(item.total)}>
      <div className="sigo-trend-value">{item.total > 0 ? dinero(item.total) : "—"}</div>
      <div className="sigo-trend-track"><div className="sigo-trend-bar" style={{height: `${Math.max(item.total > 0 ? 8 : 2, (item.total / maximo) * 100)}%`}} /></div>
      <strong>{new Date(item.fecha + "T12:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})}</strong>
      <small>{item.cantidad} vta.</small>
    </div>)}
  </div>;
}


function GraficoPicos({datos,etiqueta}:{datos:Array<{hora:number;total:number;cantidad:number}>;etiqueta:string}) { const max=Math.max(1,...datos.map(d=>d.cantidad)); return <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>{etiqueta}</strong><span>Operaciones confirmadas por hora</span></div></div><div style={{display:"flex",alignItems:"end",gap:5,height:115,overflowX:"auto"}}>{datos.filter(d=>d.hora>=7&&d.hora<=23).map(d=><div key={d.hora} title={`${d.hora}:00 · ${d.cantidad} ventas · ${dinero(d.total)}`} style={{minWidth:28,textAlign:"center",fontSize:10}}><div style={{height:78,display:"flex",alignItems:"end",justifyContent:"center"}}><span style={{display:"block",width:16,height:`${Math.max(3,(d.cantidad/max)*74)}px`,background:"currentColor",borderRadius:"4px 4px 0 0"}}/></div><strong>{d.hora}</strong></div>)}</div></div>; }
function GraficoDias({datos}:{datos:Array<{dia:string;total:number;cantidad:number}>}) { const max=Math.max(1,...datos.map(d=>d.total)); return <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>Días de mayor venta</strong><span>Acumulado de los últimos 30 días</span></div></div><div style={{display:"flex",alignItems:"end",gap:12,height:130}}>{datos.map(d=><div key={d.dia} title={`${d.dia} · ${d.cantidad} ventas · ${dinero(d.total)}`} style={{flex:1,textAlign:"center",fontSize:11}}><div style={{height:82,display:"flex",alignItems:"end",justifyContent:"center"}}><span style={{display:"block",width:"55%",height:`${Math.max(3,(d.total/max)*78)}px`,background:"currentColor",borderRadius:"5px 5px 0 0"}}/></div><strong>{d.dia}</strong></div>)}</div></div>; }

function nombreMedio(medio: string) {
  const nombres: Record<string, string> = {
    efectivo: "Efectivo",
    debito: "Débito",
    credito: "Crédito",
    transferencia: "Transferencia",
    mercado_pago: "Mercado Pago",
    cuenta_corriente: "Cuenta corriente",
    otro: "Otro",
  };
  return nombres[medio] ?? medio;
}

function etiquetaSalud(salud: SaludOperativaSigo) {
  if (salud.estado === "operativo") return "Operación crítica disponible";
  if (salud.estado === "parcial") return "Operación parcialmente validada";
  return "Bloqueo de base detectado";
}

function etiquetaRiesgo(estado: EstadoRiesgoStockSigo) {
  const etiquetas: Record<EstadoRiesgoStockSigo, string> = {
    sin_stock: "SIN STOCK",
    urgente: "QUIEBRE URGENTE",
    proximo: "PRÓXIMO QUIEBRE",
    revisar: "REVISAR REPOSICIÓN",
    ok: "OK",
    sin_historial: "SIN HISTÓRICO",
  };
  return etiquetas[estado];
}

type CategoriaInforme = "ventas" | "stock" | "caja" | "compras" | "clientes" | "gerencial";
type VistaStock = "menu" | "ranking" | "quiebre" | "actual" | "rotacion";

function exportarRankingExcel(filas: Array<{ nombre: string; cantidad: number; total: number }>, criterio: "unidades" | "facturacion") {
  const encabezados = ["Posición", "Producto", "Unidades vendidas", "Facturación", "Criterio"];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lineas = [encabezados.map(esc).join(";"), ...filas.map((fila, i) => [i + 1, fila.nombre, fila.cantidad, fila.total, criterio === "facturacion" ? "Facturación" : "Unidades"].map(esc).join(";"))];
  const blob = new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `SIGO-ranking-productos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(enlace); enlace.click(); enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1500);
}

export default function InformesOperativos({ empresaId }: { empresaId: string }) {
  const [resumen, setResumen] = useState<ResumenOperativoSigo>(vacio);
  const [salud, setSalud] = useState<SaludOperativaSigo | null>(null);
  const [riesgoStock, setRiesgoStock] = useState<ResumenRiesgoStockSigo | null>(null);
  const [riesgoError, setRiesgoError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoria, setCategoria] = useState<CategoriaInforme | null>(null);
  const [vistaStock, setVistaStock] = useState<VistaStock>("menu");
  const empresaActivaRef = useRef(empresaId);
  const cargaRef = useRef(0);

  async function cargar(targetEmpresaId = empresaId) {
    const cargaId = ++cargaRef.current;
    setLoading(true);
    setError("");
    setRiesgoError("");
    try {
      const [nuevoResumen, nuevaSalud, nuevoRiesgo] = await Promise.all([
        cargarResumenOperativoSigo(targetEmpresaId),
        verificarSaludOperativaSigo(targetEmpresaId),
        cargarRiesgoStockSigo(targetEmpresaId, 30)
          .then((value) => ({ value, error: "" }))
          .catch((err: unknown) => ({
            value: null,
            error: err instanceof Error ? err.message : "No se pudo calcular el riesgo de quiebre.",
          })),
      ]);
      if (empresaActivaRef.current !== targetEmpresaId || cargaRef.current !== cargaId) return;
      setResumen(nuevoResumen);
      setSalud(nuevaSalud);
      setRiesgoStock(nuevoRiesgo.value);
      setRiesgoError(nuevoRiesgo.error);
    } catch (err) {
      if (empresaActivaRef.current !== targetEmpresaId || cargaRef.current !== cargaId) return;
      setResumen(vacio);
      setSalud(null);
      setRiesgoStock(null);
      setRiesgoError("");
      setError(err instanceof Error ? err.message : "No se pudieron cargar los informes.");
    } finally {
      if (empresaActivaRef.current === targetEmpresaId && cargaRef.current === cargaId) setLoading(false);
    }
  }

  useEffect(() => {
    empresaActivaRef.current = empresaId;
    cargaRef.current += 1;
    setResumen(vacio);
    setSalud(null);
    setRiesgoStock(null);
    setRiesgoError("");
    setError("");
    setLoading(true);
    void cargar(empresaId);
    // cargar captura el tenant y descarta respuestas tardías de otra empresa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  if (loading) return <div className="panel"><p>Cargando indicadores operativos…</p></div>;

  const mediosCaja = Object.entries(resumen.cajaHoyPorMedio).sort((a, b) => b[1] - a[1]);

  const catalogo: Array<{icono:string; titulo:string; texto:string; categoria:CategoriaInforme}> = [
    { icono: "↗", titulo: "Ventas e ingresos", texto: "Ventas, facturación y productos vendidos.", categoria: "ventas" },
    { icono: "◫", titulo: "Stock", texto: "Ranking, rotación y riesgo de quiebre.", categoria: "stock" },
    { icono: "$", titulo: "Caja", texto: "Ingresos, egresos y medios de pago.", categoria: "caja" },
    { icono: "↓", titulo: "Compras", texto: "Compras y proveedores.", categoria: "compras" },
    { icono: "👥", titulo: "Clientes", texto: "Cuenta corriente y cobranzas.", categoria: "clientes" },
    { icono: "▥", titulo: "Gerencial", texto: "Resumen completo del negocio.", categoria: "gerencial" },
  ];

  return (
    <div className="products-page sigo-reports-page">
      <div className="page-header sigo-reports-heading">
        <div>
          <h2>Informes</h2>
          <p>{categoria ? "Elegí el informe que querés consultar." : "¿Qué querés analizar?"}</p>
        </div>
        <button className="admin-button" onClick={() => void cargar(empresaId)}>Actualizar</button>
      </div>

      {!categoria && <>
        <section className="sigo-report-summary" aria-label="Indicadores principales">
          <div><span>Ventas hoy</span><strong>{resumen.ventasHoy}</strong></div>
          <div><span>Facturación hoy</span><strong>{dinero(resumen.ventasHoyTotal)}</strong></div>
          <div><span>Stock crítico</span><strong>{resumen.productosCriticos}</strong></div>
        </section>
        <section className="sigo-report-list" aria-label="Categorías de informes">
          {catalogo.map((item) => (
            <button
              key={item.titulo}
              type="button"
              className="sigo-report-list-row"
              onClick={() => { setCategoria(item.categoria); if (item.categoria === "stock") setVistaStock("menu"); }}
            >
              <span className="sigo-report-list-icon" aria-hidden="true">{item.icono}</span>
              <span className="sigo-report-list-copy"><strong>{item.titulo}</strong><small>{item.texto}</small></span>
              <span className="sigo-report-list-action">Ver informe →</span>
            </button>
          ))}
        </section>
      </>}
      {categoria && <div style={{marginBottom:16}}><button className="admin-button" onClick={() => { setCategoria(null); setVistaStock("menu"); }}>← Informes</button></div>}

      {error && (
        <div className="panel" role="alert">
          <h3>No se pudo cargar el tablero</h3>
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <>
          {categoria === "ventas" && <section id="informe-ventas" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>↗</span><h3>Ventas</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Ventas de hoy</span><strong>{resumen.ventasHoy}</strong><small>{dinero(resumen.ventasHoyTotal)}</small></div>
              <div className="stat-card"><span>Ventas últimos 30 días</span><strong>{dinero(resumen.ventas30DiasTotal)}</strong><small>{resumen.variacionVentas30Dias == null ? "Sin período comparable" : `${resumen.variacionVentas30Dias >= 0 ? "▲" : "▼"} ${Math.abs(resumen.variacionVentas30Dias).toFixed(1)}% vs. 30 días anteriores`}</small></div>
              <div className="stat-card"><span>Ticket promedio 30 días</span><strong>{dinero(resumen.ticketPromedio30Dias)}</strong><small>Promedio por venta confirmada</small></div>
              <div className="stat-card"><span>Ventas históricas</span><strong>{resumen.ventasCantidad}</strong><small>{dinero(resumen.ventasTotal)}</small></div>
            </div>
            <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>Evolución reciente</strong><span>Ventas confirmadas · últimos 7 días</span></div><strong>{dinero(resumen.ventas7DiasTotal)}</strong></div><GraficoVentas7Dias datos={resumen.ventasUltimos7Dias} /></div>
          </section>}

          {categoria === "stock" && <section id="informe-stock" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>◫</span><h3>Stock</h3></div>
            {vistaStock !== "menu" && <button className="admin-button" style={{marginBottom:14}} onClick={() => setVistaStock("menu")}>← Stock</button>}
            {vistaStock === "menu" && <div className="sigo-stock-menu-row">
              <button onClick={() => setVistaStock("ranking")}><span>🏆</span><strong>Ranking</strong><small>Más vendidos</small></button>
              <button onClick={() => setVistaStock("quiebre")}><span>⚠️</span><strong>Riesgo de quiebre</strong><small>Cobertura</small></button>
              <button onClick={() => setVistaStock("actual")}><span>📦</span><strong>Stock actual</strong><small>Existencias</small></button>
              <button onClick={() => setVistaStock("rotacion")}><span>📉</span><strong>Rotación</strong><small>Movimiento</small></button>
            </div>}
            {vistaStock === "ranking" && <RankingProductosStock empresaId={empresaId} />}
            {(vistaStock === "actual" || vistaStock === "quiebre" || vistaStock === "rotacion") && <div className="stats-grid sigo-stock-stats-rows">
              <div className="stat-card"><span>Unidades en stock</span><strong>{resumen.unidadesStock}</strong><small>{resumen.productos} productos</small></div>
              <div className="stat-card"><span>Stock crítico</span><strong>{resumen.productosCriticos}</strong><small>{resumen.productosSinStock} sin stock</small></div>
              {riesgoStock && <div className="stat-card"><span>Quiebre urgente</span><strong>{riesgoStock.urgentes}</strong><small>≤ 7 días de cobertura</small></div>}
              {riesgoStock && <div className="stat-card"><span>Próximo quiebre</span><strong>{riesgoStock.proximos}</strong><small>8 a 15 días de cobertura</small></div>}
              {riesgoStock && <div className="stat-card"><span>Reposición a revisar</span><strong>{riesgoStock.revisar}</strong><small>16 a {riesgoStock.coberturaObjetivoDias} días</small></div>}
              {riesgoStock && <div className="stat-card"><span>Compra sugerida</span><strong>{dinero(riesgoStock.inversionSugerida)}</strong><small>Para recuperar {riesgoStock.coberturaObjetivoDias} días de cobertura</small></div>}
            </div>}

            {(vistaStock === "quiebre" || vistaStock === "rotacion") && riesgoStock && (
              <>
                <p className="sigo-stock-risk-note">
                  Cálculo basado en las ventas confirmadas de los últimos {riesgoStock.diasAnalizados} días. SIGO divide el stock actual por la venta promedio diaria para estimar los días de cobertura.
                </p>
                {riesgoStock.productosPrioritarios.length > 0 ? (
                  <div className="sigo-stock-risk-grid" aria-label="Productos con riesgo de quiebre">
                    {riesgoStock.productosPrioritarios.slice(0, 10).map((item) => (
                      <article className={`sigo-stock-risk-item risk-${item.estado}`} key={item.productoId}>
                        <div>
                          <strong>{item.nombre}</strong>
                          <span>{etiquetaRiesgo(item.estado)}</span>
                        </div>
                        <p>
                          Stock {numero(item.stockActual)} · Vendido {numero(item.ventasPeriodo)} en {riesgoStock.diasAnalizados} días · Promedio {numero(item.ventaPromedioDia, 2)}/día
                        </p>
                        <small>
                          {item.diasCobertura == null ? "Sin histórico de ventas" : `${numero(item.diasCobertura, 1)} días de cobertura`}
                          {item.compraSugerida > 0 ? ` · Reponer ${numero(item.compraSugerida)} u.` : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="sigo-health-inline"><strong>Sin riesgos calculados</strong><span>No hay productos vendidos con cobertura inferior a {riesgoStock.coberturaObjetivoDias} días.</span></div>
                )}
                {riesgoStock.sinHistorial > 0 && (
                  <div className="sigo-health-inline">
                    <strong>{riesgoStock.sinHistorial} productos sin histórico de venta</strong>
                    <span>No se proyecta quiebre hasta que registren ventas reales.</span>
                  </div>
                )}
              </>
            )}

            {(vistaStock === "quiebre" || vistaStock === "rotacion") && riesgoError && (
              <div className="sigo-health-inline" role="alert">
                <strong>Riesgo de quiebre no disponible</strong>
                <span>{riesgoError}</span>
              </div>
            )}
          </section>}

          {categoria === "clientes" && <section id="informe-clientes" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>👥</span><h3>Cuenta corriente</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Clientes</span><strong>{resumen.clientes}</strong><small>{resumen.clientesConDeuda} con deuda</small></div>
              <div className="stat-card"><span>Saldo a cobrar</span><strong>{dinero(resumen.saldoClientes)}</strong><small>Sólo saldos deudores</small></div>
              <div className="stat-card"><span>Clientes al día</span><strong>{Math.max(0, resumen.clientes - resumen.clientesConDeuda)}</strong><small>Sin saldo deudor registrado</small></div>
              <div className="stat-card"><span>Deuda promedio</span><strong>{dinero(resumen.clientesConDeuda > 0 ? resumen.saldoClientes / resumen.clientesConDeuda : 0)}</strong><small>Por cliente con deuda</small></div>
            </div>
          </section>}

          {categoria === "compras" && <section id="informe-compras" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>↓</span><h3>Compras</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Compras confirmadas</span><strong>{resumen.comprasCantidad}</strong><small>{dinero(resumen.comprasTotal)}</small></div>
              <div className="stat-card"><span>Compras últimos 30 días</span><strong>{dinero(resumen.compras30DiasTotal)}</strong><small>Mercadería confirmada</small></div>
              <div className="stat-card"><span>Ventas últimos 30 días</span><strong>{dinero(resumen.ventas30DiasTotal)}</strong><small>Para comparar actividad comercial</small></div>
              <div className="stat-card"><span>Ventas − compras</span><strong>{dinero(resumen.balanceComercial30Dias)}</strong><small>Indicador operativo, no utilidad contable</small></div>
            </div>
          </section>}

          {categoria === "caja" && <section id="informe-caja" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>$</span><h3>Caja de hoy</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Neto hoy</span><strong>{dinero(resumen.cajaHoyNeto)}</strong><small>Ingresos {dinero(resumen.cajaHoyIngresos)} · Egresos {dinero(resumen.cajaHoyEgresos)}</small></div>
              <div className="stat-card"><span>Ingresos · 7 días</span><strong>{dinero(resumen.caja7DiasIngresos)}</strong><small>Movimientos registrados</small></div>
              <div className="stat-card"><span>Egresos · 7 días</span><strong>{dinero(resumen.caja7DiasEgresos)}</strong><small>Movimientos registrados</small></div>
              <div className="stat-card"><span>Neto · 7 días</span><strong>{dinero(resumen.caja7DiasNeto)}</strong><small>Ingresos menos egresos</small></div>
              {mediosCaja.map(([medio, total]) => (
                <div className="stat-card" key={medio}>
                  <span>{nombreMedio(medio)}</span>
                  <strong>{dinero(total)}</strong>
                  <small>Ingresos registrados</small>
                </div>
              ))}
            </div>
          </section>}

          {categoria === "gerencial" && <section id="informe-resumen" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>▥</span><h3>Resumen gerencial</h3></div>
            <p>Una vista rápida de la evolución real del negocio.</p>
            <div className="stats-grid sigo-manager-kpis">
              <div className="stat-card"><span>Ventas últimos 7 días</span><strong>{dinero(resumen.ventas7DiasTotal)}</strong><small>{resumen.variacionVentas7Dias == null ? "Sin período anterior comparable" : `${resumen.variacionVentas7Dias >= 0 ? "▲" : "▼"} ${Math.abs(resumen.variacionVentas7Dias).toFixed(1)}% vs. 7 días anteriores`}</small></div>
              <div className="stat-card"><span>Ventas de hoy</span><strong>{dinero(resumen.ventasHoyTotal)}</strong><small>{resumen.ventasHoy} operaciones</small></div>
              <div className="stat-card"><span>Caja neta hoy</span><strong>{dinero(resumen.cajaHoyNeto)}</strong><small>Ingresos menos egresos</small></div>
              <div className="stat-card"><span>Cuentas por cobrar</span><strong>{dinero(resumen.saldoClientes)}</strong><small>{resumen.clientesConDeuda} clientes con deuda</small></div>
            </div>
            <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>Evolución de ventas</strong><span>Últimos 7 días</span></div><strong>{dinero(resumen.ventas7DiasTotal)}</strong></div><GraficoVentas7Dias datos={resumen.ventasUltimos7Dias} /></div><GraficoPicos datos={resumen.ventasPorHora30Dias} etiqueta="Horas pico · acumulado 30 días" /><GraficoDias datos={resumen.ventasPorDiaSemana30Dias} />
            {salud && (
              <div className="sigo-health-inline" role={salud.estado === "operativo" ? undefined : "alert"}>
                <strong>{etiquetaSalud(salud)}</strong>
                <span>{salud.operativos}/{salud.total} bloques críticos accesibles.</span>
              </div>
            )}
          </section>}

          {categoria && resumen.modulosNoDisponibles.length > 0 && (
            <div className="panel" role="alert">
              <h3>Tablero parcial</h3>
              <p>Los módulos siguientes no respondieron y sus indicadores se muestran en cero: {resumen.modulosNoDisponibles.join(", ")}.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
