import { useEffect, useRef, useState } from "react";
import { verificarSaludOperativaSigo, type SaludOperativaSigo } from "./health";
import { cargarResumenOperativoSigo,
  cargarVentasPeriodoSigo, cargarComprasPeriodoSigo,
  type ResumenOperativoSigo, type ResumenVentasPeriodoSigo, type ResumenComprasPeriodoSigo } from "./informes";
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

function GraficoVentas7Dias({ datos }: { datos: Array<{ fecha: string; total: number; cantidad: number; etiqueta?: string }> }) {
  const maximo = Math.max(1, ...datos.map((item) => item.total));
  return <div className="sigo-trend-chart" aria-label="Evolución de ventas del período seleccionado">
    {datos.map((item) => <div className="sigo-trend-column" key={item.fecha} title={dinero(item.total)}>
      <div className="sigo-trend-value">{item.total > 0 ? dinero(item.total) : "—"}</div>
      <div className="sigo-trend-track"><div className="sigo-trend-bar" style={{height: `${Math.max(item.total > 0 ? 8 : 2, (item.total / maximo) * 100)}%`}} /></div>
      <strong>{item.etiqueta ?? new Date(item.fecha + "T12:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})}</strong>
      <small>{item.cantidad} vta.</small>
    </div>)}
  </div>;
}

function agruparEvolucionVentas(datos: Array<{ fecha: string; total: number; cantidad: number }>, desde: string, hasta: string) {
  const inicio = new Date(`${desde}T12:00:00`);
  const fin = new Date(`${hasta}T12:00:00`);
  const dias = Math.max(1, Math.floor((fin.getTime() - inicio.getTime()) / 86_400_000) + 1);
  const modo = dias > 180 ? "mes" : dias > 31 ? "semana" : "dia";
  const grupos = new Map<string, { fecha: string; total: number; cantidad: number; etiqueta: string }>();
  for (const dato of datos) {
    const fecha = new Date(`${dato.fecha}T12:00:00`);
    if (modo === "semana") fecha.setDate(fecha.getDate() - ((fecha.getDay() + 6) % 7));
    if (modo === "mes") fecha.setDate(1);
    const clave = [fecha.getFullYear().toString().padStart(4, "0"), String(fecha.getMonth() + 1).padStart(2, "0"), String(fecha.getDate()).padStart(2, "0")].join("-");
    const etiqueta = modo === "mes"
      ? fecha.toLocaleDateString("es-AR", { month: "short", year: "2-digit" })
      : modo === "semana"
        ? `Sem. ${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`
        : fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    const actual = grupos.get(clave) ?? { fecha: clave, total: 0, cantidad: 0, etiqueta };
    actual.total += dato.total;
    actual.cantidad += dato.cantidad;
    grupos.set(clave, actual);
  }
  return Array.from(grupos.values());
}


function GraficoGerencial({ ventas, compras, gastosTotal }: { ventas: Array<{fecha:string;total:number}>; compras: Array<{fecha:string;compras:number}>; gastosTotal:number }) {
  const comprasMap=new Map(compras.map(d=>[d.fecha,d.compras]));
  const gastoDia=ventas.length ? gastosTotal/ventas.length : 0;
  const datos=ventas.map(v=>({fecha:v.fecha,ventas:v.total,compras:comprasMap.get(v.fecha)??0,ganancia:v.total-(comprasMap.get(v.fecha)??0)-gastoDia}));
  const maxPos=Math.max(1,...datos.flatMap(d=>[d.ventas,d.compras,Math.max(0,d.ganancia)]));
  const maxNeg=Math.max(0,...datos.map(d=>Math.max(0,-d.ganancia)));
  const ancho=Math.max(720,datos.length*58), alto=330;
  const margenSup=24, margenInf=42, area=alto-margenSup-margenInf;
  const proporcionNeg=maxNeg>0 ? Math.min(.42,Math.max(.22,maxNeg/(maxPos+maxNeg))) : 0;
  const altoNeg=area*proporcionNeg, altoPos=area-altoNeg;
  const base=margenSup+altoPos;
  const escalaPos=altoPos/maxPos, escalaNeg=maxNeg>0?altoNeg/maxNeg:0;
  const yGan=(g:number)=>g>=0?base-g*escalaPos:base+(-g)*escalaNeg;
  const puntos=datos.map((d,i)=>`${31+i*58},${yGan(d.ganancia)}`).join(" ");
  return <div className="sigo-gerencial-chart-wrap">
    <div className="sigo-gerencial-legend"><span className="venta">Ventas</span><span className="ganancia">Ganancia estimada</span><span className="compra">Compras</span><span className="linea">Línea de ganancia</span></div>
    <div className="sigo-gerencial-chart-scroll"><svg width={ancho} height={alto} role="img" aria-label="Ventas, ganancia estimada y compras por día">
      <line x1="0" y1={base} x2={ancho} y2={base} stroke="#64748b" strokeWidth="1.5" />
      <text x="4" y={base-6} fontSize="10" fill="#64748b">$0</text>
      {datos.map((d,i)=>{const x=12+i*58; const vh=Math.max(1,d.ventas*escalaPos), ch=Math.max(1,d.compras*escalaPos), gh=d.ganancia>=0?Math.max(1,d.ganancia*escalaPos):Math.max(2,(-d.ganancia)*escalaNeg); const gy=d.ganancia>=0?base-gh:base; return <g key={d.fecha}>
        <rect x={x} y={base-vh} width="12" height={vh} rx="2" fill="#1677e8"><title>{`Ventas ${d.fecha}: ${dinero(d.ventas)}`}</title></rect>
        <rect x={x+14} y={gy} width="12" height={gh} rx="2" fill={d.ganancia>=0?"#63b32e":"#d94b45"}><title>{`${d.ganancia>=0?"Ganancia":"Pérdida"} estimada ${d.fecha}: ${dinero(d.ganancia)}`}</title></rect>
        <rect x={x+28} y={base-ch} width="12" height={ch} rx="2" fill="#9aa5b1"><title>{`Compras ${d.fecha}: ${dinero(d.compras)}`}</title></rect>
        <text x={x+20} y={alto-14} textAnchor="middle" fontSize="10" fill="#53657c">{new Date(d.fecha+"T12:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})}</text>
      </g>})}
      <polyline points={puntos} fill="none" stroke="#2f7d32" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {datos.map((d,i)=><circle key={"p"+d.fecha} cx={31+i*58} cy={yGan(d.ganancia)} r="3.5" fill={d.ganancia>=0?"#2f7d32":"#b42318"}><title>{`${d.ganancia>=0?"Ganancia":"Pérdida"} estimada: ${dinero(d.ganancia)}`}</title></circle>)}
    </svg></div>
  </div>;
}

function GraficoPicos({datos,etiqueta}:{datos:Array<{hora:number;total:number;cantidad:number}>;etiqueta:string}) { const max=Math.max(1,...datos.map(d=>d.cantidad)); return <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>{etiqueta}</strong><span>Operaciones confirmadas por hora</span></div></div><div style={{display:"flex",alignItems:"end",gap:5,height:115,overflowX:"auto"}}>{datos.filter(d=>d.hora>=7&&d.hora<=23).map(d=><div key={d.hora} title={`${d.hora}:00 · ${d.cantidad} ventas · ${dinero(d.total)}`} style={{minWidth:28,textAlign:"center",fontSize:10}}><div style={{height:78,display:"flex",alignItems:"end",justifyContent:"center"}}><span style={{display:"block",width:16,height:`${Math.max(3,(d.cantidad/max)*74)}px`,background:"currentColor",borderRadius:"4px 4px 0 0"}}/></div><strong>{d.hora}</strong></div>)}</div></div>; }
function GraficoDias({datos, etiqueta="Días de mayor venta"}:{datos:Array<{dia:string;total:number;cantidad:number}>;etiqueta?:string}) { const max=Math.max(1,...datos.map(d=>d.total)); return <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>{etiqueta}</strong><span>Ventas confirmadas del período elegido</span></div></div><div style={{display:"flex",alignItems:"end",gap:12,height:130}}>{datos.map(d=><div key={d.dia} title={`${d.dia} · ${d.cantidad} ventas · ${dinero(d.total)}`} style={{flex:1,textAlign:"center",fontSize:11}}><div style={{height:82,display:"flex",alignItems:"end",justifyContent:"center"}}><span style={{display:"block",width:"55%",height:`${Math.max(3,(d.total/max)*78)}px`,background:"currentColor",borderRadius:"5px 5px 0 0"}}/></div><strong>{d.dia}</strong></div>)}</div></div>; }

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
type PeriodoGerencial = "hoy" | "2" | "3" | "7" | "15" | "30" | "3m" | "personalizado";

function fechaLocalIso(fecha: Date) {
  return `${fecha.getFullYear().toString().padStart(4, "0")}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

function rangoGerencial(periodo: Exclude<PeriodoGerencial, "personalizado">) {
  const fin = new Date();
  fin.setHours(0, 0, 0, 0);
  const inicio = new Date(fin);
  if (periodo === "3m") inicio.setMonth(inicio.getMonth() - 3);
  else inicio.setDate(inicio.getDate() - (periodo === "hoy" ? 0 : Number(periodo) - 1));
  return { desde: fechaLocalIso(inicio), hasta: fechaLocalIso(fin) };
}

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
  const hoyIso = new Date().toISOString().slice(0, 10);
  const desde30Iso = (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();
  const [comprasDesde, setComprasDesde] = useState(desde30Iso);
  const [comprasHasta, setComprasHasta] = useState(hoyIso);
  const [comprasPeriodo, setComprasPeriodo] = useState<ResumenComprasPeriodoSigo | null>(null);
  const [comprasPeriodoError, setComprasPeriodoError] = useState("");
  const [ventasDesde, setVentasDesde] = useState(desde30Iso);
  const [ventasHasta, setVentasHasta] = useState(hoyIso);
  const [ventasPeriodo, setVentasPeriodo] = useState<ResumenVentasPeriodoSigo | null>(null);
  const [gerencialPeriodo, setGerencialPeriodo] = useState<PeriodoGerencial>("7");
  const rangoInicialGerencial = rangoGerencial("7");
  const [gerencialDesde, setGerencialDesde] = useState(rangoInicialGerencial.desde);
  const [gerencialHasta, setGerencialHasta] = useState(rangoInicialGerencial.hasta);
  const [ventasGerenciales, setVentasGerenciales] = useState<ResumenVentasPeriodoSigo | null>(null);
  const [ventasGerencialesError, setVentasGerencialesError] = useState("");
  const [comprasGerenciales, setComprasGerenciales] = useState<ResumenComprasPeriodoSigo | null>(null);
  const [gastosGerenciales, setGastosGerenciales] = useState({ luz: 0, agua: 0, empleados: 0, internet: 0, otros: 0 });
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
    let activo = true;
    setVentasPeriodo(null);
    void cargarVentasPeriodoSigo(empresaId, ventasDesde, ventasHasta).then(v => { if (activo) setVentasPeriodo(v); }).catch(() => { if (activo) setVentasPeriodo(null); });
    return () => { activo = false; };
  }, [empresaId, ventasDesde, ventasHasta]);

  useEffect(() => {
    let activo = true;
    setComprasPeriodo(null);
    setComprasPeriodoError("");
    void cargarComprasPeriodoSigo(empresaId, comprasDesde, comprasHasta)
      .then((valor) => { if (activo) setComprasPeriodo(valor); })
      .catch((err: unknown) => { if (activo) { setComprasPeriodo(null); setComprasPeriodoError(err instanceof Error ? err.message : "No se pudieron consultar las compras del período."); } });
    return () => { activo = false; };
  }, [empresaId, comprasDesde, comprasHasta]);

  useEffect(() => {
    let activo = true;
    setVentasGerenciales(null);
    setVentasGerencialesError("");
    void cargarVentasPeriodoSigo(empresaId, gerencialDesde, gerencialHasta)
      .then((valor) => { if (activo) setVentasGerenciales(valor); })
      .catch((err: unknown) => { if (activo) { setVentasGerenciales(null); setVentasGerencialesError(err instanceof Error ? err.message : "No se pudieron consultar las ventas del período."); } });
    return () => { activo = false; };
  }, [empresaId, gerencialDesde, gerencialHasta]);

  useEffect(() => {
    let activo = true;
    setComprasGerenciales(null);
    void cargarComprasPeriodoSigo(empresaId, gerencialDesde, gerencialHasta)
      .then((valor) => { if (activo) setComprasGerenciales(valor); })
      .catch(() => { if (activo) setComprasGerenciales(null); });
    return () => { activo = false; };
  }, [empresaId, gerencialDesde, gerencialHasta]);

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
  const evolucionVentas = agruparEvolucionVentas(ventasPeriodo?.dias ?? [], ventasDesde, ventasHasta);
  const evolucionGerencial = agruparEvolucionVentas(ventasGerenciales?.dias ?? [], gerencialDesde, gerencialHasta);
  const gastosTotalGerencial = Object.values(gastosGerenciales).reduce((t, v) => t + Number(v || 0), 0);
  const facturacionGerencial = ventasGerenciales?.total ?? 0;
  const comprasTotalGerencial = comprasGerenciales?.comprasTotal ?? 0;
  // Hasta contar con costo vendido por ítem, se muestra como resultado comercial estimado y no como margen contable.
  const margenEstimadoGerencial = facturacionGerencial - comprasTotalGerencial;
  const gananciaNetaGerencial = margenEstimadoGerencial - gastosTotalGerencial;
  const rentabilidadGerencial = facturacionGerencial > 0 ? (gananciaNetaGerencial / facturacionGerencial) * 100 : 0;

  function exportarGerencialExcel() {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const filas = [
      ["SIGO Gestión - Informe gerencial"],
      ["Desde", gerencialDesde, "Hasta", gerencialHasta],
      ["Facturación", facturacionGerencial],
      ["Compras", comprasTotalGerencial],
      ["Resultado comercial estimado", margenEstimadoGerencial],
      ["Gastos", gastosTotalGerencial],
      ["Ganancia neta estimada", gananciaNetaGerencial],
      ["Rentabilidad estimada %", rentabilidadGerencial.toFixed(2)],
      [],
      ["Gastos cargados"],
      ["Luz", gastosGerenciales.luz], ["Agua", gastosGerenciales.agua], ["Empleados", gastosGerenciales.empleados],
      ["Internet", gastosGerenciales.internet], ["Otros", gastosGerenciales.otros],
      [],
      ["Fecha", "Facturación", "Ventas"],
      ...(ventasGerenciales?.dias ?? []).map(d => [d.fecha, d.total, d.cantidad]),
    ];
    const blob = new Blob(["\\ufeff" + filas.map(f => f.map(esc).join(";")).join("\\r\\n")], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a"); enlace.href = URL.createObjectURL(blob);
    enlace.download = `SIGO-informe-gerencial-${gerencialDesde}-a-${gerencialHasta}.csv`;
    document.body.appendChild(enlace); enlace.click(); enlace.remove(); setTimeout(() => URL.revokeObjectURL(enlace.href), 1500);
  }

  function elegirPeriodoGerencial(periodo: PeriodoGerencial) {
    setGerencialPeriodo(periodo);
    if (periodo === "personalizado") return;
    const rango = rangoGerencial(periodo);
    setGerencialDesde(rango.desde);
    setGerencialHasta(rango.hasta);
  }

  return (
    <div className="products-page sigo-reports-page">
      <div className="sigo-reports-heading">
        <div className="sigo-reports-title-row">
          <button className="admin-button sigo-reports-back" type="button" onClick={() => { if (categoria) { setCategoria(null); setVistaStock("menu"); } else { window.history.back(); } }}>← Volver</button>
          <div>
          <h2>Informes</h2>
          <p>{categoria ? "Elegí el informe que querés consultar." : "¿Qué querés analizar?"}</p>
          </div>
        </div>
        <button className="admin-button sigo-reports-refresh" onClick={() => void cargar(empresaId)}>Actualizar</button>
      </div>

      {!categoria && <>
        <section className="panel" aria-label="Resumen gerencial" style={{marginBottom:16}}>
          <div className="sigo-detail-title"><span>▥</span><h3>Resultado gerencial</h3></div>
          <div className="sigo-compras-periodo sigo-ventas-periodo">
            <strong>Período</strong>
            <label>Desde <input type="date" value={gerencialDesde} max={gerencialHasta} onChange={(e) => { setGerencialPeriodo("personalizado"); setGerencialDesde(e.target.value); }} /></label>
            <label>Hasta <input type="date" value={gerencialHasta} min={gerencialDesde} max={hoyIso} onChange={(e) => { setGerencialPeriodo("personalizado"); setGerencialHasta(e.target.value); }} /></label>
            <button className="admin-button" type="button" onClick={exportarGerencialExcel}>Exportar Excel</button>
          </div>
          <div className="sigo-gerencial-summary-cards">
            <div className="stat-card"><span>Facturado</span><strong>{dinero(facturacionGerencial)}</strong></div>
            <div className="stat-card"><span>Resultado comercial</span><strong>{dinero(margenEstimadoGerencial)}</strong><small>Ventas − compras</small></div>
            <div className="stat-card"><span>Compras</span><strong>{dinero(comprasTotalGerencial)}</strong></div>
            <div className="stat-card"><span>Gastos</span><strong>{dinero(gastosTotalGerencial)}</strong></div>
            <div className="stat-card"><span>Ganancia neta estimada</span><strong>{dinero(gananciaNetaGerencial)}</strong></div>
            <div className="stat-card"><span>Rentabilidad</span><strong>{numero(rentabilidadGerencial,1)}%</strong></div>
          </div>
          <div className="sigo-manager-chart-card sigo-gerencial-chart-card"><div className="sigo-manager-chart-head"><div><strong>Evolución del período</strong><span>Ventas · ganancia estimada · compras · {gerencialDesde} → {gerencialHasta}</span></div></div><GraficoGerencial ventas={ventasGerenciales?.dias ?? []} compras={comprasGerenciales?.dias ?? []} gastosTotal={gastosTotalGerencial} /></div>
          <details className="sigo-gerencial-expenses" open>
            <summary style={{cursor:"pointer",fontWeight:700}}>Gastos opcionales para calcular lo que realmente queda</summary>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(120px,1fr))",gap:10,marginTop:12}}>
              {(["luz","agua","empleados","internet","otros"] as const).map((clave)=><label key={clave} className="form-group"><span style={{textTransform:"capitalize"}}>{clave}</span><div className="sigo-money-input"><span>$</span><input type="number" min="0" placeholder="0" value={gastosGerenciales[clave] || ""} onChange={(e)=>setGastosGerenciales(g=>({...g,[clave]:e.target.value === "" ? 0 : Number(e.target.value)}))}/></div></label>)}
            </div>
            <small>Estos gastos se usan sólo para estimar la ganancia neta del período mostrado.</small>
          </details>
        </section>
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
            <div className="sigo-compras-periodo sigo-ventas-periodo">
              <strong>Período de ventas</strong>
              <label>Desde <input type="date" value={ventasDesde} max={ventasHasta} onChange={(e) => setVentasDesde(e.target.value)} /></label>
              <label>Hasta <input type="date" value={ventasHasta} min={ventasDesde} max={hoyIso} onChange={(e) => setVentasHasta(e.target.value)} /></label>
              <small>Seleccioná de cuándo a cuándo para consultar ventas, facturación, ticket promedio y evolución.</small>
            </div>
            <div className="stats-grid sigo-sales-stats-rows">
              <div className="stat-card"><span>Ventas del período</span><strong>{ventasPeriodo?.cantidad ?? 0}</strong><small>{dinero(ventasPeriodo?.total ?? 0)}</small></div>
              <div className="stat-card"><span>Facturación del período</span><strong>{dinero(ventasPeriodo?.total ?? 0)}</strong><small>{ventasDesde} → {ventasHasta}</small></div>
              <div className="stat-card"><span>Ticket promedio del período</span><strong>{dinero(ventasPeriodo?.ticketPromedio ?? 0)}</strong><small>Promedio por venta confirmada</small></div>
              <div className="stat-card"><span>Días analizados</span><strong>{ventasPeriodo?.dias.length ?? 0}</strong><small>Período seleccionado</small></div>
            </div>
            <div className="sigo-manager-chart-card sigo-sales-chart-compact"><div className="sigo-manager-chart-head"><div><strong>Evolución del período</strong><span>{ventasDesde} → {ventasHasta}</span></div><strong>{dinero(ventasPeriodo?.total ?? 0)}</strong></div><GraficoVentas7Dias datos={evolucionVentas} /></div>
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

          {categoria === "clientes" && <section id="informe-clientes" className="panel sigo-report-detail sigo-clientes-report">
            <div className="sigo-detail-title"><span>👥</span><h3>Cuenta corriente</h3></div>
            <div className="stats-grid sigo-clientes-rows">
              <div className="stat-card"><span>Clientes</span><strong>{resumen.clientes}</strong><small>{resumen.clientesConDeuda} con deuda</small></div>
              <div className="stat-card"><span>Saldo a cobrar</span><strong>{dinero(resumen.saldoClientes)}</strong><small>Sólo saldos deudores</small></div>
              <div className="stat-card"><span>Clientes al día</span><strong>{Math.max(0, resumen.clientes - resumen.clientesConDeuda)}</strong><small>Sin saldo deudor registrado</small></div>
              <div className="stat-card"><span>Deuda promedio</span><strong>{dinero(resumen.clientesConDeuda > 0 ? resumen.saldoClientes / resumen.clientesConDeuda : 0)}</strong><small>Por cliente con deuda</small></div>
            </div>
          </section>}

          {categoria === "compras" && <section id="informe-compras" className="panel sigo-report-detail sigo-compras-report">
            <div className="sigo-detail-title"><span>↓</span><h3>Compras</h3></div>
            <div className="sigo-compras-periodo">
              <strong>Período de compras</strong>
              <label>Desde <input type="date" value={comprasDesde} max={comprasHasta} onChange={(e) => setComprasDesde(e.target.value)} /></label>
              <label>Hasta <input type="date" value={comprasHasta} min={comprasDesde} max={hoyIso} onChange={(e) => setComprasHasta(e.target.value)} /></label>
              <small>Seleccioná de cuándo a cuándo para analizar la facturación de compras.</small>
            </div>
            {comprasPeriodoError ? <p className="form-error" role="alert">{comprasPeriodoError}</p> : null}
            <div className="stats-grid sigo-compras-rows">
              <div className="stat-card"><span>Compras confirmadas · período</span><strong>{comprasPeriodo?.comprasCantidad ?? 0}</strong><small>Importe comprado: {dinero(comprasPeriodo?.comprasTotal ?? 0)}</small></div>
              <div className="stat-card"><span>Ventas confirmadas · período</span><strong>{comprasPeriodo?.ventasCantidad ?? 0}</strong><small>Facturación: {dinero(comprasPeriodo?.ventasTotal ?? 0)}</small></div>
              <div className="stat-card"><span>Ventas − compras</span><strong>{dinero(comprasPeriodo?.balanceComercial ?? 0)}</strong><small>Período {comprasDesde} → {comprasHasta}; indicador operativo</small></div>
            </div>
          </section>}

          {categoria === "caja" && <section id="informe-caja" className="panel sigo-report-detail sigo-caja-report">
            <div className="sigo-detail-title"><span>$</span><h3>Caja de hoy</h3></div>
            <div className="stats-grid sigo-caja-rows">
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
            <div className="sigo-compras-periodo sigo-ventas-periodo">
              <strong>Período de análisis</strong>
              {([["hoy","Hoy"],["2","2 días"],["3","3 días"],["7","7 días"],["15","15 días"],["30","30 días"],["3m","3 meses"],["personalizado","Personalizado"]] as Array<[PeriodoGerencial,string]>).map(([valor,etiqueta])=><button type="button" key={valor} className={gerencialPeriodo===valor?"primary-button":"admin-button"} onClick={()=>elegirPeriodoGerencial(valor)}>{etiqueta}</button>)}
              {gerencialPeriodo==="personalizado" ? <>
                <label>Desde <input type="date" value={gerencialDesde} max={gerencialHasta} onChange={(e) => setGerencialDesde(e.target.value)} /></label>
                <label>Hasta <input type="date" value={gerencialHasta} min={gerencialDesde} max={hoyIso} onChange={(e) => setGerencialHasta(e.target.value)} /></label>
              </> : null}
              <small>{gerencialDesde} → {gerencialHasta}</small>
            </div>
            {ventasGerencialesError ? <p className="form-error" role="alert">{ventasGerencialesError}</p> : null}
            <div className="stats-grid sigo-manager-kpis">
              <div className="stat-card"><span>Facturación del período</span><strong>{dinero(ventasGerenciales?.total ?? 0)}</strong><small>{ventasGerenciales?.cantidad ?? 0} ventas confirmadas</small></div>
              <div className="stat-card"><span>Ventas confirmadas</span><strong>{ventasGerenciales?.cantidad ?? 0}</strong><small>Período {gerencialDesde} → {gerencialHasta}</small></div>
              <div className="stat-card"><span>Ticket promedio</span><strong>{dinero(ventasGerenciales?.ticketPromedio ?? 0)}</strong><small>Del período elegido</small></div>
              <div className="stat-card"><span>Días analizados</span><strong>{ventasGerenciales?.dias.length ?? 0}</strong><small>Incluye días sin ventas</small></div>
            </div>
            <div className="sigo-manager-chart-card"><div className="sigo-manager-chart-head"><div><strong>Evolución de ventas del período</strong><span>{gerencialDesde} → {gerencialHasta}</span></div><strong>{dinero(ventasGerenciales?.total ?? 0)}</strong></div><GraficoVentas7Dias datos={evolucionGerencial} /></div>
            <GraficoPicos datos={ventasGerenciales?.porHora ?? []} etiqueta="Horas pico · período seleccionado" />
            <GraficoDias datos={ventasGerenciales?.porDiaSemana ?? []} etiqueta="Días de la semana · período seleccionado" />
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
