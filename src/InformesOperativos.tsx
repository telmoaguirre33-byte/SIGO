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
  cajaHoyIngresos: 0,
  cajaHoyEgresos: 0,
  cajaHoyNeto: 0,
  cajaHoyPorMedio: {},
  modulosNoDisponibles: [],
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

      {!categoria && <section className="sigo-report-catalog" aria-label="Categorías de informes">
        {catalogo.map((item) => (
          <button
            key={item.titulo}
            type="button"
            className="sigo-report-card"
            onClick={() => { setCategoria(item.categoria); if (item.categoria === "stock") setVistaStock("menu"); }}
          >
            <span className="sigo-report-icon" aria-hidden="true">{item.icono}</span>
            <strong>{item.titulo}</strong>
            <span>{item.texto}</span>
          </button>
        ))}
      </section>}
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
              <div className="stat-card"><span>Ventas confirmadas</span><strong>{resumen.ventasCantidad}</strong><small>{dinero(resumen.ventasTotal)}</small></div>
            </div>
          </section>}

          {categoria === "stock" && <section id="informe-stock" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>◫</span><h3>Stock</h3></div>
            {vistaStock !== "menu" && <button className="admin-button" style={{marginBottom:14}} onClick={() => setVistaStock("menu")}>← Stock</button>}
            {vistaStock === "menu" && <div className="sigo-report-catalog">
              <button className="sigo-report-card" onClick={() => setVistaStock("ranking")}><span className="sigo-report-icon">🏆</span><strong>Ranking de productos</strong><span>Más vendidos · Top 5 a Top 50</span></button>
              <button className="sigo-report-card" onClick={() => setVistaStock("quiebre")}><span className="sigo-report-icon">⚠️</span><strong>Riesgo de quiebre</strong><span>Cobertura y reposición sugerida</span></button>
              <button className="sigo-report-card" onClick={() => setVistaStock("actual")}><span className="sigo-report-icon">📦</span><strong>Stock actual</strong><span>Existencias, críticos y sin stock</span></button>
              <button className="sigo-report-card" onClick={() => setVistaStock("rotacion")}><span className="sigo-report-icon">📉</span><strong>Rotación</strong><span>Movimiento y cobertura de productos</span></button>
            </div>}
            {vistaStock === "ranking" && <RankingProductosStock empresaId={empresaId} />}
            {(vistaStock === "actual" || vistaStock === "quiebre" || vistaStock === "rotacion") && <div className="stats-grid">
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
            </div>
          </section>}

          {categoria === "compras" && <section id="informe-compras" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>↓</span><h3>Compras</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Compras confirmadas</span><strong>{resumen.comprasCantidad}</strong><small>{dinero(resumen.comprasTotal)}</small></div>
            </div>
          </section>}

          {categoria === "caja" && <section id="informe-caja" className="panel sigo-report-detail">
            <div className="sigo-detail-title"><span>$</span><h3>Caja de hoy</h3></div>
            <div className="stats-grid">
              <div className="stat-card"><span>Neto</span><strong>{dinero(resumen.cajaHoyNeto)}</strong><small>Ingresos {dinero(resumen.cajaHoyIngresos)} · Egresos {dinero(resumen.cajaHoyEgresos)}</small></div>
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
            <p>SIGO consolida ventas confirmadas, caja, compras, stock y cuentas corrientes sin mezclar empresas.</p>
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
