import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import { isLegacyDuplicateProduct, type BarcodeProduct } from "./barcode";
import { listarClientesSigo, type ClienteSigo } from "./clientes";
import { guardarProductoSigo, listarProductosSigo, type ProductoSigo } from "./productos";
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

export default function VentaRapidaOperativa({ empresaId, puedeEditarProductos = false }: { empresaId: string; puedeEditarProductos?: boolean }) {
  const [items, setItems] = useState<ItemVenta[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoSigo[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [catalogoError, setCatalogoError] = useState("");
  const [productoBloqueado, setProductoBloqueado] = useState<{ producto: BarcodeProduct; razon: "precio" | "stock" } | null>(null);
  const [precioRapido, setPrecioRapido] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);
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
    setCatalogo([]);
    setBusquedaProducto("");
    setCatalogoError("");
    setProductoBloqueado(null);
    setPrecioRapido("");
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
      const [clientesResultado, catalogoResultado] = await Promise.allSettled([
        listarClientesSigo(empresaId),
        listarProductosSigo(empresaId),
      ]);
      if (!cancelled && empresaActivaRef.current === empresaId) {
        if (clientesResultado.status === "fulfilled") setClientes(clientesResultado.value);
        else {
          setClientes([]);
          setClientesError(clientesResultado.reason instanceof Error ? clientesResultado.reason.message : "No se pudieron cargar los clientes.");
        }
        if (catalogoResultado.status === "fulfilled") setCatalogo(catalogoResultado.value);
        else {
          setCatalogo([]);
          setCatalogoError(catalogoResultado.reason instanceof Error ? catalogoResultado.reason.message : "No se pudo cargar el catálogo para búsqueda manual.");
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

  const productosEncontrados = useMemo(() => {
    const q = busquedaProducto.trim().toLocaleLowerCase("es-AR");
    if (q.length < 2) return [];
    return catalogo
      .filter((producto) => [producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es-AR")
        .includes(q))
      .slice(0, 12);
  }, [busquedaProducto, catalogo]);

  function marcarProductoBloqueado(producto: BarcodeProduct, razon: "precio" | "stock") {
    setProductoBloqueado({ producto, razon });
    setPrecioRapido(producto.precio_venta && Number(producto.precio_venta) > 0 ? String(producto.precio_venta) : "");
    setExito("");
  }

  function seleccionarProductoManual(producto: ProductoSigo) {
    setError("");
    setExito("");
    setAdvertencia("");
    if (isLegacyDuplicateProduct(producto)) {
      setError(`${producto.nombre}: identidad de código pendiente de revisión física. SIGO bloqueó la venta para evitar operar sobre el producto equivocado.`);
      return;
    }
    const precio = Number(producto.precio_venta ?? 0);
    if (!Number.isFinite(precio) || precio <= 0) {
      marcarProductoBloqueado(producto, "precio");
      setError(`${producto.nombre}: ingresá su precio de venta para poder cobrarlo.`);
      return;
    }
    const stock = Number(producto.stock_actual ?? 0);
    if (!Number.isFinite(stock) || stock <= 0) {
      marcarProductoBloqueado(producto, "stock");
      setError(`${producto.nombre}: no tiene stock disponible. Ingresalo desde Compras para conservar trazabilidad.`);
      return;
    }
    setProductoBloqueado(null);
    setBusquedaProducto("");
    agregar(producto);
  }

  async function guardarPrecioRapido() {
    if (!productoBloqueado || productoBloqueado.razon !== "precio" || !puedeEditarProductos || guardandoPrecio) return;
    const precio = Number(precioRapido.replace(",", "."));
    if (!Number.isFinite(precio) || precio <= 0) {
      setError("Ingresá un precio de venta mayor a cero.");
      return;
    }

    const empresaOperacion = empresaId;
    const original = productoBloqueado.producto;
    setGuardandoPrecio(true);
    setError("");
    try {
      await guardarProductoSigo({
        empresaId: empresaOperacion,
        productoId: original.id,
        nombre: original.nombre,
        codigoInterno: original.codigo_interno,
        codigoBarras: original.codigo_barras,
        descripcion: original.descripcion,
        categoria: original.categoria,
        marca: original.marca,
        proveedor: original.proveedor,
        costoActual: null,
        costoUltimaCompra: null,
        precioVenta: precio,
        margenGanancia: null,
        margenPorcentaje: null,
        stockActual: null,
        stockMinimo: original.stock_minimo,
        stockMaximo: original.stock_maximo,
      });
      if (empresaActivaRef.current !== empresaOperacion) return;
      const actualizado: BarcodeProduct = { ...original, precio_venta: precio };
      setCatalogo((actual) => actual.map((item) => item.id === original.id ? { ...item, precio_venta: precio } : item));
      setProductoBloqueado(null);
      setPrecioRapido("");
      setBusquedaProducto("");
      agregar(actualizado);
      setExito(`Precio guardado y ${original.nombre} agregado al carrito.`);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el precio del producto.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setGuardandoPrecio(false);
    }
  }

  function agregar(producto: BarcodeProduct) {
    if (confirmando) return;
    setError("");
    setExito("");
    setAdvertencia("");
    setProductoBloqueado(null);
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
    setProductoBloqueado(null);
    setPrecioRapido("");
    setBusquedaProducto("");
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
        <BarcodeScanner
          empresaId={empresaId}
          action="vender"
          onProduct={agregar}
          onBlockedProduct={marcarProductoBloqueado}
        />

        <div className="form-group" style={{ marginTop: 16 }}>
          <label htmlFor="venta-buscar-producto">O buscar por nombre, código o marca</label>
          <input
            id="venta-buscar-producto"
            type="search"
            placeholder="Ej.: resma A4, tinta Epson o código interno"
            value={busquedaProducto}
            onChange={(event) => setBusquedaProducto(event.target.value)}
            disabled={confirmando}
          />
        </div>
        {catalogoError ? <p className="form-error" role="alert">Catálogo: {catalogoError}</p> : null}
        {productosEncontrados.length > 0 ? (
          <div className="table-wrapper" style={{ marginTop: 10 }}>
            <table className="products-table">
              <thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th></th></tr></thead>
              <tbody>
                {productosEncontrados.map((producto) => (
                  <tr key={producto.id}>
                    <td><strong>{producto.nombre}</strong><small>{producto.codigo_interno || producto.codigo_barras || "Sin código"}</small></td>
                    <td>{Number(producto.precio_venta || 0) > 0 ? `$ ${Number(producto.precio_venta).toLocaleString("es-AR")}` : "Sin precio"}</td>
                    <td>{producto.stock_actual ?? "No disponible"}</td>
                    <td><button type="button" className="admin-button" onClick={() => seleccionarProductoManual(producto)}>Elegir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {busquedaProducto.trim().length >= 2 && productosEncontrados.length === 0 && !catalogoError ? (
          <p className="barcode-help">No se encontraron productos con esa búsqueda en la empresa activa.</p>
        ) : null}

        {productoBloqueado ? (
          <div className="arca-security-note" style={{ marginTop: 14 }}>
            <strong>{productoBloqueado.producto.nombre}</strong>
            {productoBloqueado.razon === "precio" ? (
              puedeEditarProductos ? (
                <>
                  <span>El producto tiene stock, pero no tiene precio válido. Podés prepararlo acá y SIGO lo agregará al carrito después de verificar el guardado.</span>
                  <div className="form-actions">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Precio de venta"
                      value={precioRapido}
                      onChange={(event) => setPrecioRapido(event.target.value)}
                      disabled={guardandoPrecio}
                      aria-label="Precio de venta del producto bloqueado"
                    />
                    <button type="button" className="primary-button" onClick={() => void guardarPrecioRapido()} disabled={guardandoPrecio}>
                      {guardandoPrecio ? "Guardando y verificando…" : "Guardar precio y agregar"}
                    </button>
                  </div>
                </>
              ) : <span>Pedile a un propietario o administrador que configure el precio de venta.</span>
            ) : (
              <span>El producto no tiene stock disponible. Ingresalo desde Compras; SIGO no inventará stock desde Caja.</span>
            )}
          </div>
        ) : null}
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
