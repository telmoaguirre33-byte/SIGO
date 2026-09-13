import { useEffect, useMemo, useRef, useState } from "react";
import {
  anularVentaSigo,
  cargarItemsDevolviblesSigo,
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

export default function DevolucionesOperativas({ empresaId }: { empresaId: string }) {
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
    const cantidad = Number(cantidades[item.ventaItemId] ?? 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return [];
    return [{ ventaItemId: item.ventaItemId, cantidad }];
  }), [items, cantidades]);

  const totalParcial = useMemo(() => seleccionParcial.reduce((total, elegido) => {
    const item = items.find((fila) => fila.ventaItemId === elegido.ventaItemId);
    return total + (item ? item.precioUnitario * elegido.cantidad : 0);
  }, 0), [items, seleccionParcial]);

  async function devolverParcial() {
    if (!seleccionada || seleccionParcial.length === 0 || procesando) return;
    if (motivo.trim().length < 3) {
      setError("Ingresá el motivo de la devolución.");
      return;
    }
    const invalida = seleccionParcial.some((elegido) => {
      const item = items.find((fila) => fila.ventaItemId === elegido.ventaItemId);
      return !item || elegido.cantidad > item.cantidadDisponible;
    });
    if (invalida) {
      setError("Revisá las cantidades: no pueden superar lo disponible de la venta.");
      return;
    }
    if (!window.confirm(`¿Confirmar devolución por ${dinero(totalParcial)}? El stock volverá a ingresar y se registrará la contrapartida correspondiente.`)) return;

    setProcesando(true);
    setError("");
    setExito("");
    try {
      await registrarDevolucionSigo({
        empresaId,
        ventaId: seleccionada.id,
        motivo,
        items: seleccionParcial,
      });
      setExito(`Devolución registrada para la venta ${etiquetaVenta(seleccionada)}.`);
      setSeleccionada(null);
      setItems([]);
      setCantidades({});
      setMotivo("");
      await cargar(empresaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la devolución.");
    } finally {
      setProcesando(false);
    }
  }

  async function anularCompleta() {
    if (!seleccionada || procesando) return;
    if (motivo.trim().length < 3) {
      setError("Ingresá el motivo de la anulación.");
      return;
    }
    if (!window.confirm(`¿ANULAR completamente la venta ${etiquetaVenta(seleccionada)} por ${dinero(seleccionada.total)}? Se restituirá el stock restante y se generará la reversa de caja o cuenta corriente.`)) return;

    setProcesando(true);
    setError("");
    setExito("");
    try {
      await anularVentaSigo({ empresaId, ventaId: seleccionada.id, motivo });
      setExito(`Venta ${etiquetaVenta(seleccionada)} anulada correctamente.`);
      setSeleccionada(null);
      setItems([]);
      setCantidades({});
      setMotivo("");
      await cargar(empresaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular la venta.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="sigo-returns-page">
      <div className="page-header">
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

      <section className="panel">
        <div className="page-header">
          <div><h3>Ventas disponibles</h3><p>Elegí una venta confirmada para devolver productos o anularla por completo.</p></div>
        </div>
        {loading ? <p>Cargando ventas…</p> : (
          <div className="sigo-return-sales-grid">
            {ventas.map((venta) => (
              <button
                type="button"
                key={venta.id}
                className={`sigo-return-sale-card${seleccionada?.id === venta.id ? " active" : ""}`}
                onClick={() => void elegir(venta)}
              >
                <strong>{etiquetaVenta(venta)}</strong>
                <span>{new Date(venta.createdAt).toLocaleString("es-AR")}</span>
                <b>{dinero(venta.total)}</b>
              </button>
            ))}
            {ventas.length === 0 && <div className="table-empty">No hay ventas confirmadas disponibles para devolución.</div>}
          </div>
        )}
      </section>

      {seleccionada && (
        <section className="panel sigo-return-editor">
          <div className="page-header">
            <div>
              <h3>Venta {etiquetaVenta(seleccionada)}</h3>
              <p>Total original {dinero(seleccionada.total)} · Seleccioná cantidades para una devolución parcial o anulá el remanente completo.</p>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="products-table">
              <thead><tr><th>Producto</th><th>Vendido</th><th>Devuelto</th><th>Disponible</th><th>Devolver ahora</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.ventaItemId}>
                    <td><strong>{item.producto}</strong><small>{item.codigo ?? "Sin código"}</small></td>
                    <td>{item.cantidadVendida}</td>
                    <td>{item.cantidadDevuelta}</td>
                    <td>{item.cantidadDisponible}</td>
                    <td>
                      <input
                        className="sigo-return-qty"
                        type="number"
                        min="0"
                        max={item.cantidadDisponible}
                        step="1"
                        disabled={procesando || item.cantidadDisponible <= 0}
                        value={cantidades[item.ventaItemId] ?? ""}
                        onChange={(event) => setCantidades((actual) => ({ ...actual, [item.ventaItemId]: event.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="form-group sigo-return-reason">
            <span>Motivo *</span>
            <input value={motivo} disabled={procesando} placeholder="Ej.: cliente cambió de opinión / producto equivocado" onChange={(event) => setMotivo(event.target.value)} />
          </label>

          <div className="sigo-return-actions">
            <div><span>Devolución seleccionada</span><strong>{dinero(totalParcial)}</strong></div>
            <button className="admin-button" type="button" disabled={procesando || seleccionParcial.length === 0} onClick={() => void devolverParcial()}>
              {procesando ? "Procesando…" : "Procesar devolución"}
            </button>
            <button className="danger-button" type="button" disabled={procesando} onClick={() => void anularCompleta()}>
              {procesando ? "Procesando…" : "Anular venta completa"}
            </button>
          </div>
        </section>
      )}

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
