import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import type { BarcodeProduct } from "./barcode";
import { listarClientesSigo, type ClienteSigo } from "./clientes";
import {
  confirmarVentaSigo,
  listarVentasRecientesSigo,
  type MedioPagoSigo,
  type VentaRecienteSigo,
} from "./ventas";

type ItemVenta = { producto: BarcodeProduct; cantidad: number };

const DINERO_TOLERANCIA = 0.01;

function nuevaClaveVenta() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function etiquetaMedio(medio: MedioPagoSigo) {
  const etiquetas: Record<MedioPagoSigo, string> = {
    efectivo: "Efectivo",
    debito: "Débito",
    credito: "Crédito",
    transferencia: "Transferencia",
    mercado_pago: "Mercado Pago",
    cuenta_corriente: "Cuenta corriente",
    otro: "Otro",
  };
  return etiquetas[medio];
}

export default function VentaRapidaOperativa({ empresaId }: { empresaId: string }) {
  const [items, setItems] = useState<ItemVenta[]>([]);
  const [medioPago, setMedioPago] = useState<MedioPagoSigo>("efectivo");
  const [clientes, setClientes] = useState<ClienteSigo[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clientesError, setClientesError] = useState("");
  const [ventasRecientes, setVentasRecientes] = useState<VentaRecienteSigo[]>([]);
  const [ventasError, setVentasError] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [advertencia, setAdvertencia] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(nuevaClaveVenta);
  const empresaActivaRef = useRef(empresaId);

  async function cargarVentasRecientes(targetEmpresaId = empresaId) {
    setVentasError("");
    try {
      const data = await listarVentasRecientesSigo(targetEmpresaId, 8);
      if (empresaActivaRef.current === targetEmpresaId) setVentasRecientes(data);
    } catch (err) {
      if (empresaActivaRef.current !== targetEmpresaId) return;
      setVentasRecientes([]);
      setVentasError(err instanceof Error ? err.message : "No se pudieron verificar las ventas recientes.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    empresaActivaRef.current = empresaId;
    setItems([]);
    setMedioPago("efectivo");
    setClientes([]);
    setClienteId("");
    setClientesError("");
    setVentasRecientes([]);
    setVentasError("");
    setError("");
    setExito("");
    setAdvertencia("");
    setIdempotencyKey(nuevaClaveVenta());

    async function cargar() {
      try {
        const data = await listarClientesSigo(empresaId);
        if (!cancelled && empresaActivaRef.current === empresaId) setClientes(data);
      } catch (err) {
        if (!cancelled && empresaActivaRef.current === empresaId) {
          setClientes([]);
          setClientesError(err instanceof Error ? err.message : "No se pudieron cargar los clientes.");
        }
      }
      if (!cancelled && empresaActivaRef.current === empresaId) await cargarVentasRecientes(empresaId);
    }
    void cargar();
    return () => { cancelled = true; };
    // cargarVentasRecientes depende únicamente del mismo empresaId del efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const clienteSeleccionado = useMemo(
    () => clientes.find((cliente) => cliente.id === clienteId) ?? null,
    [clientes, clienteId],
  );

  function agregar(producto: BarcodeProduct) {
    if (confirmando) return;
    setError("");
    setExito("");
    setAdvertencia("");
    const precio = Number(producto.precio_venta);
    if (!Number.isFinite(precio) || precio <= 0) {
      setError(`${producto.nombre}: definí un precio de venta mayor a cero antes de vender.`);
      return;
    }
    const stock = Number(producto.stock_actual);
    if (!Number.isFinite(stock) || stock <= 0) {
      setError(`${producto.nombre}: sin stock disponible.`);
      return;
    }

    setItems((actual) => {
      const existente = actual.find((item) => item.producto.id === producto.id);
      const cantidadActual = existente?.cantidad ?? 0;
      if (cantidadActual + 1 > stock) {
        setError(`${producto.nombre}: no hay stock para agregar otra unidad.`);
        return actual;
      }
      if (existente) {
        return actual.map((item) => item.producto.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item);
      }
      return [...actual, { producto, cantidad: 1 }];
    });
  }

  function cambiarCantidad(productoId: string, delta: number) {
    setError("");
    setItems((actual) => actual.flatMap((item) => {
      if (item.producto.id !== productoId) return [item];
      const siguiente = item.cantidad + delta;
      if (siguiente <= 0) return [];
      if (item.producto.stock_actual != null && siguiente > Number(item.producto.stock_actual)) {
        setError(`${item.producto.nombre}: stock máximo disponible ${item.producto.stock_actual}.`);
        return [item];
      }
      return [{ ...item, cantidad: siguiente }];
    }));
  }

  function vaciar() {
    if (confirmando) return;
    setItems([]);
    setError("");
    setExito("");
    setAdvertencia("");
    setClienteId("");
    setMedioPago("efectivo");
    setIdempotencyKey(nuevaClaveVenta());
  }

  const total = useMemo(
    () => items.reduce((suma, item) => suma + Number(item.producto.precio_venta ?? 0) * item.cantidad, 0),
    [items],
  );

  const superaLimite = medioPago === "cuenta_corriente"
    && clienteSeleccionado?.limite_credito != null
    && Number(clienteSeleccionado.saldo_actual || 0) + total > Number(clienteSeleccionado.limite_credito);

  const puedeConfirmar = items.length > 0
    && (medioPago !== "cuenta_corriente" || Boolean(clienteId))
    && !superaLimite
    && items.every((item) => {
      const precio = Number(item.producto.precio_venta);
      const stock = Number(item.producto.stock_actual);
      return Number.isFinite(precio)
        && precio > 0
        && Number.isFinite(stock)
        && stock >= 0
        && item.cantidad > 0
        && item.cantidad <= stock;
    });

  async function confirmar() {
    if (!puedeConfirmar || confirmando) return;
    const empresaConfirmacion = empresaId;
    setConfirmando(true);
    setError("");
    setExito("");
    setAdvertencia("");
    try {
      const resultado = await confirmarVentaSigo({
        empresaId: empresaConfirmacion,
        medioPago,
        clienteId: clienteId || null,
        idempotencyKey,
        items: items.map((item) => ({ productoId: item.producto.id, cantidad: item.cantidad })),
      });
      if (empresaActivaRef.current !== empresaConfirmacion) return;

      const totalConfirmado = resultado.totalVerificado ?? total;
      const advertencias: string[] = [];
      if (
        resultado.totalVerificado != null
        && Math.abs(resultado.totalVerificado - total) > DINERO_TOLERANCIA
      ) {
        advertencias.push(
          `El precio cambió mientras confirmabas. SIGO registró el total vigente del backend: $ ${resultado.totalVerificado.toLocaleString("es-AR")}.`,
        );
      }
      if (resultado.integridad !== "ok") {
        advertencias.push(
          resultado.integridad === "revisar"
            ? "La venta quedó registrada, pero no se pudo conciliar su movimiento de Caja/Cuenta Corriente o stock. NO repitas la venta: revisá el estado operativo o Informes."
            : "La venta quedó registrada, pero la conciliación automática no pudo verificarse. NO repitas la venta hasta revisar Ventas/Informes.",
        );
      }

      setExito(`Venta confirmada · ${resultado.ventaId.slice(0, 8).toUpperCase()} · Total verificado $ ${totalConfirmado.toLocaleString("es-AR")}`);
      setAdvertencia(advertencias.join(" "));
      setItems([]);
      setClienteId("");
      setMedioPago("efectivo");
      setIdempotencyKey(nuevaClaveVenta());
      const [data] = await Promise.all([listarClientesSigo(empresaConfirmacion), cargarVentasRecientes(empresaConfirmacion)]);
      if (empresaActivaRef.current === empresaConfirmacion) setClientes(data);
    } catch (err) {
      if (empresaActivaRef.current === empresaConfirmacion) {
        setError(err instanceof Error ? err.message : "No se pudo confirmar la venta.");
      }
    } finally {
      if (empresaActivaRef.current === empresaConfirmacion) setConfirmando(false);
    }
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Venta rápida</h2>
          <p>Pistola USB/Bluetooth, ingreso manual o cámara celular. Confirmación transaccional con descuento de stock, caja y cuenta corriente por cliente.</p>
        </div>
        <button className="admin-button" disabled={items.length === 0 || confirmando} onClick={vaciar}>Vaciar</button>
      </div>

      <div className="panel">
        <h3>Escanear producto</h3>
        <BarcodeScanner empresaId={empresaId} action="vender" onProduct={agregar} />
      </div>

      <div className="panel">
        <div className="page-header">
          <div><h3>Carrito</h3><p>El precio final, stock, cliente y límite de crédito se vuelven a validar en backend al confirmar.</p></div>
          <div className="topbar-actions" style={{ alignItems: "end" }}>
            <label className="form-group" style={{ minWidth: 210 }}>
              <span>Cliente</span>
              <select value={clienteId} disabled={confirmando} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">Consumidor final / sin cliente</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre} · saldo $ {Number(cliente.saldo_actual || 0).toLocaleString("es-AR")}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-group" style={{ minWidth: 190 }}>
              <span>Medio de pago</span>
              <select value={medioPago} disabled={confirmando} onChange={(e) => setMedioPago(e.target.value as MedioPagoSigo)}>
                <option value="efectivo">Efectivo</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
                <option value="transferencia">Transferencia</option>
                <option value="mercado_pago">Mercado Pago</option>
                <option value="cuenta_corriente">Cuenta corriente</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>
        </div>

        {clientesError && <p className="form-error" role="alert">Clientes: {clientesError}</p>}
        {medioPago === "cuenta_corriente" && !clienteId && (
          <p className="form-error" role="alert">Seleccioná un cliente para vender en cuenta corriente.</p>
        )}
        {medioPago === "cuenta_corriente" && clienteSeleccionado && (
          <p style={{ marginTop: 0, opacity: 0.78 }}>
            {clienteSeleccionado.nombre} · saldo actual $ {Number(clienteSeleccionado.saldo_actual || 0).toLocaleString("es-AR")}
            {clienteSeleccionado.limite_credito == null ? " · sin límite configurado" : ` · límite $ ${Number(clienteSeleccionado.limite_credito).toLocaleString("es-AR")}`}
          </p>
        )}
        {superaLimite && <p className="form-error" role="alert">La operación supera el límite de crédito configurado para el cliente.</p>}

        <div className="table-wrapper">
          <table className="products-table">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th><th>Stock</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.producto.id}>
                  <td><strong>{item.producto.nombre}</strong></td>
                  <td>
                    <div className="row-actions">
                      <button className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, -1)}>−</button>
                      <strong>{item.cantidad}</strong>
                      <button className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, 1)}>+</button>
                    </div>
                  </td>
                  <td>$ {Number(item.producto.precio_venta).toLocaleString("es-AR")}</td>
                  <td>$ {(Number(item.producto.precio_venta) * item.cantidad).toLocaleString("es-AR")}</td>
                  <td>{item.producto.stock_actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="table-empty">Escaneá un producto para iniciar la venta.</div>}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {exito && <p role="status"><strong>{exito}</strong></p>}
        {advertencia && <p className="form-error" role="alert"><strong>{advertencia}</strong></p>}

        <div className="form-actions">
          <strong>Total: $ {total.toLocaleString("es-AR")}</strong>
          <button className="primary-button" disabled={!puedeConfirmar || confirmando} onClick={() => void confirmar()}>
            {confirmando ? "Confirmando…" : "Confirmar venta"}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="page-header">
          <div>
            <h3>Últimas ventas y conciliación</h3>
            <p>Control inmediato de que cada venta tenga su ingreso de Caja o su deuda en Cuenta Corriente.</p>
          </div>
          <button className="admin-button" disabled={confirmando} onClick={() => void cargarVentasRecientes()}>Actualizar</button>
        </div>
        {ventasError && <p className="form-error" role="alert">Ventas: {ventasError}</p>}
        <div className="table-wrapper">
          <table className="products-table">
            <thead><tr><th>Venta</th><th>Hora</th><th>Medio</th><th>Total</th><th>Conciliación</th></tr></thead>
            <tbody>
              {ventasRecientes.map((venta) => (
                <tr key={venta.id}>
                  <td><strong>{venta.numero ? `#${venta.numero}` : venta.id.slice(0, 8).toUpperCase()}</strong></td>
                  <td>{new Date(venta.createdAt).toLocaleString("es-AR")}</td>
                  <td>{etiquetaMedio(venta.medioPago)}</td>
                  <td>$ {venta.total.toLocaleString("es-AR")}</td>
                  <td>
                    <strong>
                      {venta.integridad === "ok" ? "OK" : venta.integridad === "revisar" ? "REVISAR" : "NO VERIFICADO"}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ventasRecientes.length === 0 && !ventasError && <div className="table-empty">Todavía no hay ventas recientes para esta empresa.</div>}
        </div>
      </div>
    </div>
  );
}
