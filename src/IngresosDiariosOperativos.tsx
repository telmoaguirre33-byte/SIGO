import { useEffect, useMemo, useRef, useState } from "react";
import { cargarIngresosDiariosSigo, type ResumenIngresosDiariosSigo } from "./ingresosDiarios";

type Preset = "hoy" | "ayer" | "7" | "30" | "90" | "mes" | "mes_pasado" | "personalizado";

function isoLocal(fecha: Date) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rangoPreset(preset: Preset): { desde: string; hasta: string } {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hasta = new Date(hoy);
  const desde = new Date(hoy);

  if (preset === "ayer") {
    desde.setDate(desde.getDate() - 1);
    hasta.setDate(hasta.getDate() - 1);
  } else if (preset === "7" || preset === "30" || preset === "90") {
    desde.setDate(desde.getDate() - Number(preset) + 1);
  } else if (preset === "mes") {
    desde.setDate(1);
  } else if (preset === "mes_pasado") {
    desde.setMonth(desde.getMonth() - 1, 1);
    hasta.setDate(0);
  }

  return { desde: isoLocal(desde), hasta: isoLocal(hasta) };
}

function dinero(valor: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(valor);
}

function fechaCorta(valor: string) {
  const [year, month, day] = valor.split("-").map(Number);
  const fecha = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(fecha);
}

export default function IngresosDiariosOperativos({ empresaId }: { empresaId: string }) {
  const inicial = useMemo(() => rangoPreset("7"), []);
  const [preset, setPreset] = useState<Preset>("7");
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [resumen, setResumen] = useState<ResumenIngresosDiariosSigo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const requestRef = useRef(0);

  async function cargar(rango = { desde, hasta }) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const data = await cargarIngresosDiariosSigo(empresaId, rango.desde, rango.hasta);
      if (requestRef.current !== requestId) return;
      setResumen(data);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setResumen(null);
      setError(err instanceof Error ? err.message : "No se pudo cargar el detalle diario de ingresos.");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }

  function aplicarPreset(nuevo: Preset) {
    setPreset(nuevo);
    if (nuevo === "personalizado") return;
    const rango = rangoPreset(nuevo);
    setDesde(rango.desde);
    setHasta(rango.hasta);
    void cargar(rango);
  }

  useEffect(() => {
    const rango = rangoPreset("7");
    setDesde(rango.desde);
    setHasta(rango.hasta);
    void cargar(rango);
    return () => { requestRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  return (
    <section className="sigo-income-block" aria-label="Ingresos y ventas por día">
      <div className="sigo-income-heading">
        <div>
          <span className="sigo-income-kicker">INGRESOS</span>
          <h3>Ventas por día</h3>
          <p>Revisá rápidamente cómo rindió cada jornada y cuánto quedó cobrado o a cobrar.</p>
        </div>
        <button className="admin-button" type="button" onClick={() => void cargar()} disabled={loading}>Actualizar</button>
      </div>

      <div className="sigo-income-presets" role="group" aria-label="Rango de fechas">
        {([
          ["hoy", "Hoy"],
          ["ayer", "Ayer"],
          ["7", "7 días"],
          ["30", "30 días"],
          ["90", "90 días"],
          ["mes", "Este mes"],
          ["mes_pasado", "Mes pasado"],
          ["personalizado", "Personalizado"],
        ] as Array<[Preset, string]>).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={preset === value ? "active" : ""}
            onClick={() => aplicarPreset(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "personalizado" && (
        <div className="sigo-income-custom-range">
          <label><span>Desde</span><input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} /></label>
          <button className="primary-button" type="button" onClick={() => void cargar()} disabled={!desde || !hasta || loading}>Aplicar</button>
        </div>
      )}

      {loading && <div className="sigo-income-state">Calculando ingresos del período…</div>}
      {!loading && error && <div className="sigo-income-state error" role="alert">{error}</div>}

      {!loading && !error && resumen && (
        <>
          <div className="sigo-income-summary">
            <div><span>Cantidad de ventas</span><strong>{resumen.cantidadVentas}</strong></div>
            <div><span>Cobrado</span><strong>{dinero(resumen.cobrado)}</strong></div>
            <div><span>A cobrar</span><strong>{dinero(resumen.aCobrar)}</strong></div>
            <div><span>Total ventas</span><strong>{dinero(resumen.totalVentas)}</strong></div>
          </div>

          <div className="sigo-income-table-wrap">
            <table className="sigo-income-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Ventas</th>
                  <th>Cobrado</th>
                  <th>A cobrar</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.dias.map((dia) => (
                  <>
                    <tr
                      key={dia.fecha}
                      className={dia.cantidadVentas === 0 ? "empty-day" : ""}
                      onClick={() => dia.cantidadVentas > 0 && setDiaAbierto((actual) => actual === dia.fecha ? null : dia.fecha)}
                      style={dia.cantidadVentas > 0 ? { cursor: "pointer" } : undefined}
                      aria-expanded={dia.cantidadVentas > 0 ? diaAbierto === dia.fecha : undefined}
                    >
                      <td><strong>{fechaCorta(dia.fecha)}</strong><small>{dia.fecha}{dia.cantidadVentas > 0 ? " · tocar para ver productos" : ""}</small></td>
                      <td>{dia.cantidadVentas}</td>
                      <td>{dinero(dia.cobrado)}</td>
                      <td>{dinero(dia.aCobrar)}</td>
                      <td><strong>{dinero(dia.totalVentas)}</strong></td>
                    </tr>
                    {diaAbierto === dia.fecha && dia.cantidadVentas > 0 && (
                      <tr key={`${dia.fecha}-detalle`} className="sigo-income-products-row">
                        <td colSpan={5}>
                          <div style={{ padding: "12px 8px" }}>
                            <strong>Productos vendidos</strong>
                            {dia.productos.length === 0 ? (
                              <p style={{ margin: "8px 0 0" }}>No se encontró detalle de productos para estas ventas.</p>
                            ) : (
                              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                {dia.productos.map((producto) => (
                                  <div key={producto.productoId} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #e5e7eb", paddingBottom: 8 }}>
                                    <span><strong>{producto.nombre}</strong><br /><small>{producto.cantidad} unidad{producto.cantidad === 1 ? "" : "es"}</small></span>
                                    <strong>{dinero(producto.total)}</strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
