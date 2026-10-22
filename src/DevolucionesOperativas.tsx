import { formatoCantidadMedida, pasoCantidadMedida } from "./ventaPorMedidas";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  anularVentaSigo,
  cargarItemsDevolviblesSigo,
  estimarImporteDevolucion,
  listarDevolucionesRecientesSigo,
  listarVentasDevolviblesSigo,
  registrarDevolucionSigo,
  type DevolucionRecienteSigo,
  type ItemVentaDevolvibleSigo,
  type VentaDevolvibleSigo,
} from "./devoluciones";

function dinero(valor: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(valor);
}

function etiquetaVenta(venta: VentaDevolvibleSigo) {
  return venta.numero ? `#${venta.numero}` : venta.id.slice(0, 8).toUpperCase();
}

export default function DevolucionesOperativas({ empresaId, onVolver }: { empresaId: string; onVolver?: () => void }) {
  const [ventas, setVentas] = useState<VentaDevolvibleSigo[]>([]);
  const [seleccionada, setSeleccionada] = useState<VentaDevolvibleSigo | null>(null);
  const [items, setItems] = useState<ItemVentaDevolvibleSigo[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [historial, setHistorial] = useState<DevolucionRecienteSigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const empresaRef = useRef(empresaId);
  const procesandoRef = useRef(false);

  async function cargar(target = empresaId) {
    setLoading(true);
    setError("");
    try {
      const [nuevasVentas, nuevasDevoluciones] = await Promise.all([
        listarVentasDevolviblesSigo(target, 40),
        listarDevolucionesRecientesSigo(target, 20),
      ]);
      if (empresaRef.current !== target) return;
      setVentas(nuevasVentas);
      setHistorial(nuevasDevoluciones);
      if (seleccionada && !nuevasVentas.some((venta) => venta.id === seleccionada.id)) {
        setSeleccionada(null);
        setItems([]);
        setCantidades({});
      }
    } catch (err) {
      if (empresaRef.current !== target) return;
      setError(err instanceof Error ? err.message : "No se pudieron cargar las devoluciones.");
    } finally {
      if (empresaRef.current === target) setLoading(false);
    }
  }

  useEffect(() => {
    empresaRef.current = empresaId;
    setSeleccionada(null);
    setItems([]);
    setCantidades({});
    setMotivo("");
    setExito("");
    void cargar(empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  async function elegir(venta: VentaDevolvibleSigo) {
    if (procesandoRef.current) return;
    setSeleccionada(venta);
    setItems([]);
    setCantidades({});
    setMotivo("");
    setError("");
    setExito("");
    try {
      const detalle = await cargarItemsDevolviblesSigo(empresaId, venta.id);
      if (empresaRef.current !== empresaId) return;
      setItems(detalle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el detalle de la venta.");
    }
  }

  const seleccionParcial = useMemo(() => items.flatMap((item) => {
    const cantidad = Number((cantidades[item.ventaItemId] ?? "0").replace(",", "."));
    if (!Number.isFinite(cantidad) || cantidad <= 0) return [];
    return [{ ventaItemId: item.ventaItemId, cantidad }];
  }), [items, cantidades]);

  const estimacion = useMemo(() => {
    try {
      for (const texto of Object.values(cantidades)) {
        const n = Number(texto.replace(",", "."));
        if (!Number.isFinite(n) || n < 0) throw new Error("Ingresá cantidades válidas para devolver.");
      }
      const centavos = seleccionParcial.reduce((total, elegido) => {
        const item = items.find((fila) => fila.ventaItemId === elegido.ventaItemId);
        if (!item) throw new Error("El renglón ya no está disponible.");
        return total + Math.round(estimarImporteDevolucion(item, elegido.cantidad) * 100);
      }, 0);
      return { total: centavos / 100, error: "" };
    } catch (err) {
      return { total: 0, error: err instanceof Error ? err.message : "Revisá las cantidades." };
    }
  }, [items, seleccionParcial, cantidades]);
  const totalParcial = estimacion.total;
  const totalRemanente = items.reduce((total, item) => total + Math.round(item.subtotalDisponible * 100), 0) / 100;

  async function devolverParcial() {
    if (!seleccionada || seleccionParcial.length === 0 || procesandoRef.current) return;
    if (motivo.trim().length < 3) {
      setError("Ingresá el motivo de la devolución.");
      return;
    }
    if (estimacion.error) { setError(estimacion.error); return; }
    const invalida = seleccionParcial.some((elegido) => {
      const item = items.find((fila) => fila.ventaItemId === elegido.ventaItemId);
      return !item || elegido.cantidad > item.cantidadDisponible;
    });
    if (invalida) {
      setError("Revisá las cantidades: no pueden superar lo disponible de la venta.");
      return;
    }
    if (!window.confirm(`¿Confirmar devolución por un importe estimado de ${dinero(totalParcial)}? El stock volverá a ingresar y se registrará la contrapartida correspondiente.`)) return;

    procesandoRef.current = true;
    setProcesando(true);
    setError("");
    setExito("");
    try {
      const resultado = await registrarDevolucionSigo({
        empresaId,
        ventaId: seleccionada.id,
        motivo,
        items: seleccionParcial,
      });
      setExito(resultado.total == null
        ? `Devolución registrada para la venta ${etiquetaVenta(seleccionada)}. No se pudo verificar el importe persistido; revisá el historial y no repitas la operación.`
        : `Devolución registrada para la venta ${etiquetaVenta(seleccionada)}. Importe registrado: ${dinero(resultado.total)}.`);
      setSeleccionada(null);
      setItems([]);
      setCantidades({});
      setMotivo("");
      await cargar(empresaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la devolución.");
    } finally {
      procesandoRef.current = false;
      setProcesando(false);
    }
  }

  async function anularCompleta() {
    if (!seleccionada || procesandoRef.current) return;
    if (motivo.trim().length < 3) {
      setError("Ingresá el motivo de la anulación.");
      return;
    }
    if (!window.confirm(`¿ANULAR completamente el remanente de la venta ${etiquetaVenta(seleccionada)} por un importe estimado de ${dinero(totalRemanente)}? Se restituirá el stock restante y se generará la reversa de caja o cuenta corriente.`)) return;

    procesandoRef.current = true;
    setProcesando(true);
    setError("");
    setExito("");
    try {
      const resultado = await anularVentaSigo({ empresaId, ventaId: seleccionada.id, motivo });
      setExito(resultado.total == null
        ? `Venta ${etiquetaVenta(seleccionada)} anulada. No se pudo verificar el importe persistido; revisá el historial y no repitas la operación.`
        : `Venta ${etiquetaVenta(seleccionada)} anulada. Importe registrado: ${dinero(resultado.total)}.`);
      setSeleccionada(null);
      setItems([]);
      setCantidades({});
      setMotivo("");
      await cargar(empresaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular la venta.");
    } finally {
      procesandoRef.current = false;
      setProcesando(false);
    }
  }

  return (
    <div className="sigo-returns-page">
      <div className="page-header">
        <div className="sigo-returns-header-actions">{onVolver ? <button className="admin-button" type="button" onClick={onVolver}>← Volver</button> : null}</div>
        <div>
          <h2>Devoluciones y anulaciones</h2>
          <p>Revertí una venta sin borrar historial: SIGO restituye stock y registra la contrapartida de caja o cuenta corriente.</p>
        </div>
        <button className="admin-button" type="button" disabled={loading || procesando} onClick={() => void cargar()}>Actualizar</button>
      </div>

      <div className="sigo-return-warning">
        <strong>Importante</strong>
        <span>Para débito, crédito o Mercado Pago, SIGO registra el egreso interno. El reintegro en la terminal o proveedor de pagos debe hacerse también en ese servicio.</span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {exito && <p className="sigo-return-success" role="status">{exito}</p>}

      {seleccionada && (
        <section className="panel sigo-return-editor">
          <div className="page-header">
            <div>
              <h3>Venta {etiquetaVenta(seleccionada)}</h3>
              <p>Total original {dinero(seleccionada.total)} · Seleccioná cantidades para una devolución parcial o anulá el remanente completo.</p>
            </div>
          </div>

          <div className="sigo-return-compact-editor">
            <div className="sigo-return-compact-items">
              {items.map((item) => (
                <label key={item.ventaItemId} className="sigo-return-compact-item">
                  <span><strong>{item.producto}</strong><small>Disponible: {formatoCantidadMedida(item.cantidadDisponible, item.unidadMedida)}{item.unidadMedida == null ? " · sin unidad histórica" : ""} · Saldo {dinero(item.subtotalDisponible)}</small></span>
                  <input className="sigo-return-qty" type="number" min="0" max={item.cantidadDisponible} step={item.unidadMedida == null ? 0.001 : pasoCantidadMedida(item.unidadMedida)} aria-label={`Cantidad a devolver de ${item.producto}${item.unidadMedida ? ` en ${item.unidadMedida}` : ""}`} disabled={procesando || item.cantidadDisponible <= 0} value={cantidades[item.ventaItemId] ?? ""} placeholder="Cant." onChange={(event) => setCantidades((actual) => ({ ...actual, [item.ventaItemId]: event.target.value }))} />
                </label>
              ))}
            </div>
            <label className="sigo-return-compact-reason">
              <span>Motivo</span>
              <input value={motivo} disabled={procesando} placeholder="Motivo de devolución / anulación" onChange={(event) => setMotivo(event.target.value)} />
            </label>
            <div className="sigo-return-compact-total"><span>Importe estimado</span><strong>{estimacion.error ? "Revisá cantidades" : dinero(totalParcial)}</strong></div>
            {estimacion.error && <p className="form-error" role="alert">{estimacion.error}</p>}
            <button className="admin-button" type="button" disabled={procesando || seleccionParcial.length === 0 || Boolean(estimacion.error)} onClick={() => void devolverParcial()}>{procesando ? "Procesando…" : "Devolver"}</button>
            <button className="danger-button" type="button" disabled={procesando || !items.some((item) => item.cantidadDisponible > 0)} onClick={() => void anularCompleta()}>{procesando ? "Procesando…" : "Anular venta"}</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="page-header">
          <div><h3>Ventas disponibles</h3><p>Elegí una venta confirmada para devolver productos o anularla por completo.</p></div>
        </div>
        {loading ? <p>Cargando ventas…</p> : (
          <div className="sigo-return-sales-list">
            <div className="sigo-return-sales-head"><span>Venta</span><span>Fecha / hora</span><span>Total</span><span></span></div>
            {ventas.map((venta) => (
              <button
                type="button"
                key={venta.id}
                className={`sigo-return-sale-row${seleccionada?.id === venta.id ? " active" : ""}`}
                disabled={procesando}
                onClick={() => void elegir(venta)}
              >
                <strong>{etiquetaVenta(venta)}</strong>
                <span>{new Date(venta.createdAt).toLocaleString("es-AR")}</span>
                <b>{dinero(venta.total)}</b>
                <span>{seleccionada?.id === venta.id ? "Seleccionada" : "Seleccionar"}</span>
              </button>
            ))}
            {ventas.length === 0 && <div className="table-empty">No hay ventas confirmadas disponibles para devolución.</div>}
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Historial reciente</h3>
        <div className="table-wrapper">
          <table className="products-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Venta</th><th>Total</th><th>Motivo</th></tr></thead>
            <tbody>
              {historial.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("es-AR")}</td>
                  <td><strong>{item.tipo === "total" ? "ANULACIÓN TOTAL" : "DEVOLUCIÓN PARCIAL"}</strong></td>
                  <td>{item.ventaId.slice(0, 8).toUpperCase()}</td>
                  <td>{dinero(item.total)}</td>
                  <td>{item.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {historial.length === 0 && <div className="table-empty">Todavía no hay devoluciones registradas.</div>}
        </div>
      </section>
    </div>
  );
}
