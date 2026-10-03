import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import { imprimirTicketVenta } from "./ticketVenta";
import { isLegacyDuplicateProduct, type BarcodeProduct } from "./barcode";
import { listarClientesSigo, type ClienteSigo } from "./clientes";
import { guardarProductoSigo, listarProductosSigo, type ProductoSigo } from "./productos";
import { listarOfertasProductos, ofertaVigente, precioConOferta, type OfertaProducto } from "./ofertasProductos";
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

function precioUnitarioVenta(item: ItemVenta, ofertas: OfertaProducto[], descuentoPct: number) {
  const oferta = ofertaVigente(ofertas, item.producto.id);
  const base = oferta
    ? precioConOferta(Number(item.producto.precio_venta ?? 0), Number(oferta.descuento_porcentaje))
    : Number(item.producto.precio_venta ?? 0);
  return descuentoPct > 0 ? precioConOferta(base, descuentoPct) : base;
}

export default function VentaRapidaOperativa({ empresaId, puedeEditarProductos = false }: { empresaId: string; puedeEditarProductos?: boolean }) {
  const [items, setItems] = useState<ItemVenta[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoSigo[]>([]);
  const [ofertas, setOfertas] = useState<OfertaProducto[]>([]);
  const [ofertasError, setOfertasError] = useState("");
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
  const [ultimaVentaTicket, setUltimaVentaTicket] = useState<string | null>(null);
  const [advertencia, setAdvertencia] = useState("");
  const [descuentoPct,setDescuentoPct]=useState(0);
  const [productoSeleccionadoId,setProductoSeleccionadoId]=useState<string|null>(null);
  const [descuentoAbierto,setDescuentoAbierto]=useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(nuevaClaveVenta);
  const empresaActivaRef = useRef(empresaId);
  const buscarRef = useRef<HTMLInputElement | null>(null);
  const productosEncontradosRef = useRef<ProductoSigo[]>([]);
  const productoSeleccionadoIdRef = useRef<string|null>(null);

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
    setOfertas([]);
    setOfertasError("");
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
    setUltimaVentaTicket(null);
    setAdvertencia("");
    setIdempotencyKey(nuevaClaveVenta());

    async function cargar() {
      const [clientesResultado, catalogoResultado, ofertasResultado] = await Promise.allSettled([
        listarClientesSigo(empresaId),
        listarProductosSigo(empresaId),
        listarOfertasProductos(empresaId),
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
        if (ofertasResultado.status === "fulfilled") setOfertas(ofertasResultado.value);
        else {
          setOfertas([]);
          setOfertasError(ofertasResultado.reason instanceof Error ? ofertasResultado.reason.message : "No se pudieron verificar las ofertas vigentes.");
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

  productosEncontradosRef.current = productosEncontrados;
  const productoSeleccionadoVisibleId = productosEncontrados.some((producto) => producto.id === productoSeleccionadoId)
    ? productoSeleccionadoId
    : productosEncontrados[0]?.id ?? null;
  productoSeleccionadoIdRef.current = productoSeleccionadoVisibleId;

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
    setProductoSeleccionadoId(null);
    agregar(producto);
  }

  function manejarTeclaBusquedaProducto(key: string) {
    const resultados = productosEncontradosRef.current;
    const consultaActiva = Boolean(busquedaProducto.trim());
    if ((key === "ArrowDown" || key === "ArrowUp") && consultaActiva && resultados.length > 0) {
      const indiceActual = resultados.findIndex((producto) => producto.id === productoSeleccionadoIdRef.current);
      const indiceBase = indiceActual < 0 ? 0 : indiceActual;
      const siguiente = key === "ArrowDown"
        ? Math.min(resultados.length - 1, indiceBase + 1)
        : Math.max(0, indiceBase - 1);
      const producto = resultados[siguiente];
      productoSeleccionadoIdRef.current = producto.id;
      setProductoSeleccionadoId(producto.id);
      window.setTimeout(() => {
        Array.from(document.querySelectorAll<HTMLElement>("[data-pos-suggestion]"))
          .find((fila) => fila.dataset.productId === producto.id)
          ?.scrollIntoView({ block: "nearest" });
      }, 0);
      return true;
    }
    if (key === "Escape" && consultaActiva) {
      setBusquedaProducto("");
      productoSeleccionadoIdRef.current = null;
      setProductoSeleccionadoId(null);
      return true;
    }
    if (key === "Enter" && consultaActiva) {
      const producto = resultados.find((fila) => fila.id === productoSeleccionadoIdRef.current);
      if (producto) seleccionarProductoManual(producto);
      return true;
    }
    return false;
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
    setDescuentoPct(0); setDescuentoAbierto(false);
    setIdempotencyKey(nuevaClaveVenta());
    window.setTimeout(()=>buscarRef.current?.focus(),0);
  }

  const subtotal = useMemo(() => items.reduce((suma,item)=>{
    const unitario=precioUnitarioVenta(item,ofertas,0);
    return suma+Math.round((unitario*item.cantidad+Number.EPSILON)*100)/100;
  },0),[items,ofertas]);
  const total = useMemo(()=>Math.max(0,items.reduce((suma,item)=>{
    const precioFinal=precioUnitarioVenta(item,ofertas,descuentoPct);
    return suma+Math.round((precioFinal*item.cantidad+Number.EPSILON)*100)/100;
  },0)),[items,ofertas,descuentoPct]);

  const superaLimite = medioPago === "cuenta_corriente"
    && clienteSeleccionado?.limite_credito != null
    && Number(clienteSeleccionado.saldo_actual || 0) + total > Number(clienteSeleccionado.limite_credito);

  const puedeConfirmar = items.length > 0
    && !ofertasError
    && (medioPago !== "cuenta_corriente" || Boolean(clienteId))
    && !superaLimite
    && items.every((item) => {
      const precio = Number(item.producto.precio_venta);
      const stock = Number(item.producto.stock_actual);
      return Number.isFinite(precio)
        && precio > 0
        && Number.isFinite(stock)
        && stock > 0
        && item.cantidad > 0
        && item.cantidad <= stock;
    });

  async function confirmar(imprimirDespues = false) {
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
        descuentoPct,
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

      setExito("Venta confirmada");
      window.setTimeout(() => setExito(""), 2200);
      setUltimaVentaTicket(resultado.ventaId);
      setAdvertencia(advertencias.join(" "));
      if (imprimirDespues) {
        try { await imprimirTicketVenta(empresaConfirmacion, resultado.ventaId, "80", true); }
        catch (printErr) { setError(printErr instanceof Error ? printErr.message : "La venta se confirmó, pero no se pudo abrir la impresión del ticket."); }
      }
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

  const unidades = items.reduce((n,item)=>n+item.cantidad,0);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (!["F1", "F2", "F6", "F9", "F10", "F11", "F12"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "F1") vaciar();
      if (event.key === "F2") buscarRef.current?.focus();
      if (event.key === "F6") setDescuentoAbierto((value) => !value);
      if (event.key === "F9") void confirmar();
      if (event.key === "F10") void confirmar(true);
      if (event.key === "F11") {
        event.stopPropagation();
        if (ultimaVentaTicket) window.dispatchEvent(new CustomEvent("sigo:arca:venta", { detail: { empresaId, ventaId: ultimaVentaTicket } }));
        else setError("Primero confirmá la venta para emitir la factura fiscal.");
      }
      if (event.key === "F12") {
        event.stopPropagation();
        if (ultimaVentaTicket) void imprimirTicketVenta(empresaId, ultimaVentaTicket, "80", true)
          .catch((err) => setError(err instanceof Error ? err.message : "No se pudo reimprimir el ticket."));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <div className="sigo-pos">
      <header className="sigo-pos-title"><div><strong>🛒 CAJA - VENTA</strong><span>Escaneá, buscá o agregá productos. Todo en una sola pantalla.</span></div><button className="admin-button" disabled={!items.length||confirmando} onClick={vaciar}>Vaciar</button></header>
      <div className="sigo-pos-toolbar">
        <button type="button" onClick={vaciar}>▣ <strong>NUEVA VENTA</strong><small>F1</small></button>
        <button type="button" onClick={()=>buscarRef.current?.focus()}>⌕ <strong>BUSCAR PRODUCTO</strong><small>F2</small></button>
        <button type="button" onClick={()=>document.querySelector<HTMLElement>(".barcode-camera-button")?.click()}>📷 <strong>CÁMARA</strong><small>F3</small></button>
        <button type="button" onClick={()=>document.getElementById("sigo-pos-cliente")?.focus()}>👤 <strong>CLIENTE</strong><small>F8</small></button>
        <button type="button" onClick={()=>setDescuentoAbierto(v=>!v)}>◇ <strong>DESCUENTO</strong><small>F6 · {descuentoPct}%</small></button>
      </div>
      {descuentoAbierto&&<div className="sigo-pos-discount"><strong>Descuento</strong>{[0,5,10,15,20].map(n=><button type="button" className={descuentoPct===n?"active":""} onClick={()=>{setDescuentoPct(n);setDescuentoAbierto(false)}} key={n}>{n}%</button>)}<label>Otro % <input type="number" min="0" max="99.99" step="0.01" value={descuentoPct} onChange={e=>setDescuentoPct(Math.max(0,Math.min(99.99,Number(e.target.value)||0)))}/></label></div>}
      <div className="sigo-pos-scan">
        <BarcodeScanner empresaId={empresaId} action="vender" onProduct={agregar} onBlockedProduct={marcarProductoBloqueado} onQueryChange={(query)=>{setBusquedaProducto(query);productoSeleccionadoIdRef.current=null;setProductoSeleccionadoId(null)}} onManualQuery={(query)=>{setBusquedaProducto(query);productoSeleccionadoIdRef.current=null;setProductoSeleccionadoId(null);return true}} onProductSearchKeyDown={manejarTeclaBusquedaProducto}/>
        
        {busquedaProducto.trim()&&productosEncontrados.length>0&&<div className="sigo-pos-results">{productosEncontrados.map((p)=><button type="button" data-pos-suggestion="" data-product-id={p.id} aria-selected={p.id===productoSeleccionadoVisibleId} className={p.id===productoSeleccionadoVisibleId?"active":""} key={p.id} onMouseEnter={()=>{productoSeleccionadoIdRef.current=p.id;setProductoSeleccionadoId(p.id)}} onClick={()=>seleccionarProductoManual(p)}><strong>{p.nombre}{Number(p.stock_actual??0)<=0?" · SIN STOCK":""}</strong><span>{p.codigo_interno||p.codigo_barras||"Sin código"} · $ {Number(p.precio_venta||0).toLocaleString("es-AR")} · Stock {p.stock_actual??0}</span></button>)}</div>}{busquedaProducto.trim()&&productosEncontrados.length===0&&!catalogoError&&<div className="sigo-pos-results"><div className="table-empty">No encontré productos. Probá con nombre, marca, código interno o EAN.</div></div>}
      </div>
      {productoBloqueado&&<div className="form-error"><strong>{productoBloqueado.producto.nombre}</strong> · {productoBloqueado.razon==="stock"?"Sin stock disponible.":"Sin precio válido."}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}{ofertasError&&<p className="form-error" role="alert">No se puede cobrar hasta comprobar los precios de oferta: {ofertasError}</p>}{exito&&<span className="sigo-pos-success-inline" role="status">{exito}</span>}{advertencia&&<p className="form-error">{advertencia}</p>}
      <div className="sigo-pos-grid">
        <section className="sigo-pos-cart">
          <div className="table-wrapper"><table className="products-table"><thead><tr><th>#</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead><tbody>{items.map((item,i)=>{const precio=precioUnitarioVenta(item,ofertas,descuentoPct);return <tr key={item.producto.id}><td>{i+1}</td><td><strong>{item.producto.nombre}</strong><small>{item.producto.codigo_interno||item.producto.codigo_barras||""}</small></td><td><div className="sigo-pos-qty"><button onClick={()=>cambiarCantidad(item.producto.id,-1)}>−</button><strong>{item.cantidad}</strong><button onClick={()=>cambiarCantidad(item.producto.id,1)}>+</button></div></td><td>$ {precio.toLocaleString("es-AR")}</td><td><strong>$ {(Math.round((precio*item.cantidad+Number.EPSILON)*100)/100).toLocaleString("es-AR")}</strong></td><td><button className="sigo-pos-remove" onClick={()=>setItems(a=>a.filter(x=>x.producto.id!==item.producto.id))}>🗑</button></td></tr>})}</tbody></table>{!items.length&&<div className="table-empty">Escaneá o buscá un producto para iniciar la venta.</div>}</div>
          <div className="sigo-pos-payments">{(["efectivo","debito","credito","transferencia","mercado_pago","cuenta_corriente"] as MedioPagoSigo[]).map(m=><button type="button" className={medioPago===m?"active":""} onClick={()=>setMedioPago(m)} key={m}>{etiquetaMedio(m)}</button>)}</div>
        </section>
        <aside className="sigo-pos-summary">
          <div className="sigo-pos-total"><span>TOTAL</span><strong>$ {total.toLocaleString("es-AR")}</strong>{descuentoPct>0&&<small>Subtotal $ {subtotal.toLocaleString("es-AR")} · Descuento {descuentoPct}%</small>}<p>Productos <b>{items.length}</b> · Unidades <b>{unidades}</b></p></div>
          <label><span>Cliente</span><select id="sigo-pos-cliente" value={clienteId} onChange={e=>setClienteId(e.target.value)}><option value="">Consumidor final / sin cliente</option>{clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <button className="sigo-pos-action cobrar" disabled={!puedeConfirmar||confirmando} onClick={()=>void confirmar()}>💳 COBRAR <kbd>F9</kbd></button>
          <button className="sigo-pos-action ticket" disabled={!puedeConfirmar||confirmando} onClick={()=>void confirmar(true)}>🖨 COBRAR + TICKET <kbd>F10</kbd></button>
          <button className="sigo-pos-action fiscal" type="button" onClick={()=>{if(ultimaVentaTicket)window.dispatchEvent(new CustomEvent("sigo:arca:venta",{detail:{empresaId,ventaId:ultimaVentaTicket}}));else setError("Primero confirmá la venta para emitir la factura fiscal.");}}>▤ FACTURA FISCAL <kbd>F11</kbd></button>
          <button className="sigo-pos-action reprint" disabled={!ultimaVentaTicket||confirmando} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket).catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir el ticket."));}}>🖨 REIMPRIMIR <kbd>F12</kbd></button>
          <div className="sigo-pos-mini-actions"><button type="button" disabled={!ultimaVentaTicket} onClick={()=>{const m=encodeURIComponent("Ticket SIGO · Total $ "+total.toLocaleString("es-AR"));window.open("https://wa.me/?text="+m,"_blank","noopener,noreferrer")}}>WhatsApp</button><button type="button" disabled={!ultimaVentaTicket} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket,"a4").catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir A4."));}}>A4</button><button type="button" disabled={!ultimaVentaTicket} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket).catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir el ticket."));}}>Ticket 58/80</button><button type="button" onClick={()=>document.querySelector<HTMLElement>(".arca-launcher")?.click()}>ARCA</button></div>
        </aside>
      </div>
    </div>
  );
}
