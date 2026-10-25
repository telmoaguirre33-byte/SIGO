import { supabase } from "./supabase";
import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import EditorCantidadMedida from "./EditorCantidadMedida";
import { cantidadEscaladaMedida, consolidarCantidadMedida, formatoCantidadMedida, formatoStockMedida, pasoCantidadMedida, precioUnitarioConDescuentosMedida, stockRestanteMedida, subtotalMedida, type UnidadVenta } from "./ventaPorMedidas";
import { crearIntentoCobro, guardarIntentoCobro, leerIntentoCobro, registrarCobroConfirmado, registrarCobroRechazado, type IntentoCobro } from "./intentoCobro";
import { imprimirTicketVenta } from "./ticketVenta";
import { isLegacyDuplicateProduct, normalizeBarcode, type BarcodeProduct } from "./barcode";
import { listarClientesSigo, type ClienteSigo } from "./clientes";
import { guardarProductoSigo, listarProductosSigo, listarUnidadesProductoSigo, type ProductoSigo } from "./productos";
import { listarOfertasProductos, ofertaVigente, type OfertaProducto } from "./ofertasProductos";
import {
  confirmarVentaSigo,
  VentaRechazadaSinCambiosError,
  listarVentasRecientesSigo,
  type MedioPagoSigo,
  type VentaRecienteSigo,
} from "./ventas";

type ItemVenta = { producto: BarcodeProduct; cantidad: number; unidad: UnidadVenta };

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
  return precioUnitarioConDescuentosMedida(Number(item.producto.precio_venta ?? 0), oferta ? Number(oferta.descuento_porcentaje) : 0, descuentoPct);
}

export default function VentaRapidaOperativa({ empresaId, puedeEditarProductos = false }: { empresaId: string; puedeEditarProductos?: boolean }) {
  const [items, setItems] = useState<ItemVenta[]>([]);
  const [unidadesProducto, setUnidadesProducto] = useState<Record<string, UnidadVenta | null>>({});
  const [unidadesCargadas, setUnidadesCargadas] = useState(false);
  const [productoPorMedida, setProductoPorMedida] = useState<BarcodeProduct | null>(null);
  const [reemplazandoCantidad, setReemplazandoCantidad] = useState(false);
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
  const [scannerInstanceKey,setScannerInstanceKey]=useState(0);
  const [descuentoAbierto,setDescuentoAbierto]=useState(false);
  const [intentoPendiente, setIntentoPendiente] = useState<IntentoCobro | null>(null);
  const [errorPersistenciaCobro, setErrorPersistenciaCobro] = useState("");
  const intentoVisible = intentoPendiente?.payload.empresaId === empresaId ? intentoPendiente : null;
  const cajaBloqueada = confirmando || Boolean(intentoPendiente) || Boolean(errorPersistenciaCobro);
  const confirmacionEnCursoRef = useRef(false);
  const operacionCobroRef = useRef<{ empresa: string; controller: AbortController } | null>(null);
  const montadoRef = useRef(false);
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);
  // Observe auth synchronously; never await auth from a payment or auth callback.
  // Legacy records contain no actor identity. This only guards this mounted view.
  const sesionCobroRef = useRef<{ conocida: boolean; usuario: string | null; cambio: boolean; epoca: number }>({ conocida: false, usuario: null, cambio: false, epoca: 0 });
  useEffect(() => {
    let activo = true;
    const { data } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!activo) return;
      const actual = sesionCobroRef.current;
      const usuario = sesion?.user?.id ?? null;
      // Un evento sin usuario durante la restauración/renovación de sesión
      // no prueba un cambio de identidad. Mantener la identidad conocida.
      // SIGNED_OUT y un usuario distinto sí invalidan la operación.
      const cierre = evento === "SIGNED_OUT";
      const identidadDistinta = actual.usuario !== null && usuario !== null && actual.usuario !== usuario;
      const cambio = cierre || identidadDistinta;
      sesionCobroRef.current = {
        conocida: actual.conocida || usuario !== null || cierre,
        usuario: cierre ? null : (usuario ?? actual.usuario),
        cambio: actual.cambio || cambio,
        epoca: actual.epoca + (cambio ? 1 : 0),
      };
    });
    return () => { activo = false; data.subscription.unsubscribe(); };
  }, []);
  const empresaActivaRef = useRef(empresaId);
  const contextoEmpresaRef = useRef({ empresa: empresaId, epoca: 0 });
  if (contextoEmpresaRef.current.empresa !== empresaId) {
    contextoEmpresaRef.current = { empresa: empresaId, epoca: contextoEmpresaRef.current.epoca + 1 };
  }
  const buscarRef = useRef<HTMLInputElement | null>(null);
  const cajaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    buscarRef.current = cajaRef.current?.querySelector<HTMLInputElement>(".barcode-entry-row input") ?? null;
    return () => { buscarRef.current = null; };
  }, [scannerInstanceKey, productoPorMedida]);
  const productosEncontradosRef = useRef<ProductoSigo[]>([]);
  const productoSeleccionadoIdRef = useRef<string|null>(null);

  async function cargarVentasRecientes(targetEmpresaId = empresaId, contextoVigente?: () => boolean) {
    setVentasError("");
    try {
      const data = await listarVentasRecientesSigo(targetEmpresaId, 8);
      if (empresaActivaRef.current === targetEmpresaId && (!contextoVigente || contextoVigente())) setVentasRecientes(data);
    } catch (err) {
      if (empresaActivaRef.current !== targetEmpresaId || (contextoVigente && !contextoVigente())) return;
      setVentasRecientes([]);
      setVentasError(err instanceof Error ? err.message : "No se pudieron verificar las ventas recientes.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (operacionCobroRef.current && operacionCobroRef.current.empresa !== empresaId) operacionCobroRef.current.controller.abort();
    empresaActivaRef.current = empresaId;
    setItems([]);
    setUnidadesProducto({});
    setUnidadesCargadas(false);
    setProductoPorMedida(null);
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
    try { setUltimaVentaTicket(sessionStorage.getItem(`sigo:ultima-venta:${empresaId}`)); }
    catch { setUltimaVentaTicket(null); }
    setAdvertencia("");
    setIntentoPendiente(null);
    setErrorPersistenciaCobro("");
    try {
      const intento = leerIntentoCobro(empresaId);
      if (intento?.estado === "pendiente") setIntentoPendiente(intento);
      if (intento?.estado === "confirmado") setUltimaVentaTicket(intento.ventaId!);
    } catch (err) {
      setErrorPersistenciaCobro(err instanceof Error ? err.message : "No se pudo verificar el último intento de cobro.");
    }

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
    // Unidad ausente o fallo de lectura: nunca degradar a venta por pieza.
    void listarUnidadesProductoSigo(empresaId).then((mapa) => {
      if (cancelled || empresaActivaRef.current !== empresaId) return;
      setUnidadesProducto(mapa);
      setUnidadesCargadas(true);
    }).catch((err) => {
      if (cancelled || empresaActivaRef.current !== empresaId) return;
      setUnidadesProducto({});
      setUnidadesCargadas(false);
      setError(err instanceof Error ? err.message : "No se pudieron verificar las unidades. Actualizá antes de vender.");
    });
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
    if (cajaBloqueada || confirmacionEnCursoRef.current || productoPorMedida) return;
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
    setScannerInstanceKey((key)=>key+1);
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
    if (cajaBloqueada || confirmacionEnCursoRef.current || !productoBloqueado || productoBloqueado.razon !== "precio" || !puedeEditarProductos || guardandoPrecio) return;
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
      setExito(`Precio guardado para ${original.nombre}. Revisá la cantidad antes de cobrar.`);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el precio del producto.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setGuardandoPrecio(false);
    }
  }

  function agregar(producto: BarcodeProduct) {
    if (cajaBloqueada || confirmacionEnCursoRef.current) return;
    if (productoPorMedida) { setError("Terminá o cancelá la cantidad en edición antes de agregar otro producto."); return; }
    const unidad = unidadesProducto[producto.id];
    if (producto.empresa_id !== empresaId || isLegacyDuplicateProduct(producto)) { setError("No se pudo verificar el producto en la empresa activa."); return; }
    if (!unidadesCargadas || !unidad) {
      setError(`${producto.nombre}: unidad de venta sin verificar. Revisá el producto y actualizá el catálogo; no se agregó al carrito.`);
      return;
    }
    if (unidad !== "unidad") {
      setReemplazandoCantidad(false);
      setProductoPorMedida(producto);
      return;
    }
    agregarCantidad(producto, 1);
  }

  function agregarCantidad(producto: BarcodeProduct, cantidadAgregar: number, reemplazar = false) {
    if (cajaBloqueada || confirmacionEnCursoRef.current) return;
    setError(""); setExito(""); setAdvertencia(""); setProductoBloqueado(null);
    const unidad = unidadesProducto[producto.id];
    if (producto.empresa_id !== empresaId || isLegacyDuplicateProduct(producto) || !unidadesCargadas || !unidad) {
      setError(`${producto.nombre}: no se pudo verificar el producto y su unidad en esta empresa.`);
      return;
    }
    const precio = Number(producto.precio_venta);
    if (!Number.isFinite(precio) || precio <= 0) { setError(`${producto.nombre}: definí un precio de venta mayor a cero antes de vender.`); return; }
    const stock = Number(producto.stock_actual);
    if (producto.stock_actual == null || !Number.isFinite(stock) || stock <= 0) { setError(`${producto.nombre}: sin stock disponible.`); return; }
    setItems((actual) => {
      const existentes = actual.filter((item) => item.producto.id === producto.id);
      if (existentes.some((item) => item.unidad !== unidad)) {
        setError(`${producto.nombre}: cambió la unidad. Retirá el renglón y revisá el producto.`);
        return actual;
      }
      let cantidad: number;
      try {
        cantidad = consolidarCantidadMedida([...(reemplazar ? [] : existentes.map((item) => item.cantidad)), cantidadAgregar], unidad, stock);
      } catch (err) {
        setError(`${producto.nombre}: ${err instanceof Error && err.message === "STOCK_INSUFICIENTE" ? "la cantidad total supera el stock disponible" : "cantidad o stock inválido para su unidad"}.`);
        return actual;
      }
      const nuevo = { producto, cantidad, unidad };
      if (!existentes.length) return [...actual, nuevo];
      let reemplazado = false;
      return actual.flatMap((item) => {
        if (item.producto.id !== producto.id) return [item];
        if (reemplazado) return [];
        reemplazado = true;
        return [nuevo];
      });
    });
    window.setTimeout(() => buscarRef.current?.focus(), 0);
  }

  function cambiarCantidad(productoId: string, delta: number) {
    if (cajaBloqueada || confirmacionEnCursoRef.current || productoPorMedida) return;
    setError("");
    setItems((actual) => actual.flatMap((item) => {
      if (item.producto.id !== productoId) return [item];
      try {
        const paso = pasoCantidadMedida(item.unidad);
        const siguienteEscalado = cantidadEscaladaMedida(item.cantidad, item.unidad) + Math.round(delta / paso);
        if (siguienteEscalado <= 0) return [];
        const siguiente = consolidarCantidadMedida([siguienteEscalado * paso], item.unidad, Number(item.producto.stock_actual));
        return [{ ...item, cantidad: siguiente }];
      } catch {
        setError(`${item.producto.nombre}: cantidad inválida o stock máximo disponible ${formatoStockMedida(Number(item.producto.stock_actual), item.unidad)}.`);
        return [item];
      }
    }));
  }

  function editarCantidad(item: ItemVenta) {
    if (cajaBloqueada || confirmacionEnCursoRef.current || productoPorMedida) return;
    setReemplazandoCantidad(true);
    setProductoPorMedida(item.producto);
    setError("");
  }

  function vaciar() {
    if (cajaBloqueada || confirmacionEnCursoRef.current) return;
    setItems([]);
    setProductoPorMedida(null);
    setError("");
    setExito("");
    setAdvertencia("");
    setClienteId("");
    setMedioPago("efectivo");
    setProductoBloqueado(null);
    setPrecioRapido("");
    setBusquedaProducto("");
    setProductoSeleccionadoId(null);
    setScannerInstanceKey((key)=>key+1);
    setDescuentoPct(0); setDescuentoAbierto(false);

    window.setTimeout(()=>buscarRef.current?.focus(),0);
  }

  const subtotal = useMemo(() => items.reduce((suma,item)=>{
    const unitario=precioUnitarioVenta(item,ofertas,0);
    return suma+subtotalMedida(item.cantidad, unitario);
  },0),[items,ofertas]);
  const total = useMemo(()=>Math.max(0,items.reduce((suma,item)=>{
    const precioFinal=precioUnitarioVenta(item,ofertas,descuentoPct);
    return suma+subtotalMedida(item.cantidad, precioFinal);
  },0)),[items,ofertas,descuentoPct]);

  const superaLimite = medioPago === "cuenta_corriente"
    && clienteSeleccionado?.limite_credito != null
    && Number(clienteSeleccionado.saldo_actual || 0) + total > Number(clienteSeleccionado.limite_credito);

  const puedeConfirmar = !cajaBloqueada && items.length > 0
    && unidadesCargadas
    && !productoPorMedida
    && total > 0
    && !ofertasError
    && (medioPago !== "cuenta_corriente" || Boolean(clienteId))
    && !superaLimite
    && items.every((item) => {
      const precio = Number(item.producto.precio_venta);
      const stock = Number(item.producto.stock_actual);
      try {
        consolidarCantidadMedida([item.cantidad], item.unidad, stock);
        if (subtotalMedida(item.cantidad, precioUnitarioVenta(item, ofertas, descuentoPct)) <= 0) return false;
      } catch { return false; }
      return unidadesProducto[item.producto.id] === item.unidad
        && Number.isFinite(precio)
        && precio > 0
        && Number.isFinite(stock)
        && stock > 0
        && item.cantidad > 0;
    });

  async function confirmar(imprimirDespues = false, emitirFiscalDespues = false, recuperar = false) {
    if (confirmando || confirmacionEnCursoRef.current || errorPersistenciaCobro
      || (recuperar ? !intentoPendiente : !puedeConfirmar)) return;
    const sesionConfirmacion = sesionCobroRef.current;
    if (!sesionConfirmacion.conocida || !sesionConfirmacion.usuario || sesionConfirmacion.cambio) {
      setError("La sesión cambió o todavía no pudo verificarse. Recargá la caja antes de recuperar o confirmar un cobro.");
      return;
    }
    confirmacionEnCursoRef.current = true;
    const empresaConfirmacion = empresaId;
    const epocaEmpresa = contextoEmpresaRef.current.epoca;
    const contextoVigente = () => {
      const actual = sesionCobroRef.current;
      return montadoRef.current && empresaActivaRef.current === empresaConfirmacion
        && contextoEmpresaRef.current.empresa === empresaConfirmacion && contextoEmpresaRef.current.epoca === epocaEmpresa
        && actual.conocida && !actual.cambio && actual.usuario === sesionConfirmacion.usuario
        && actual.epoca === sesionConfirmacion.epoca;
    };
    let intento: IntentoCobro | null = null;
    let protegido = false;
    let adoptarConfirmado = false;
    const controller = new AbortController();
    let dejarObservarSesion: (() => void) | undefined;
    let conciliacionEnCurso: Promise<unknown> | undefined;
    operacionCobroRef.current = { empresa: empresaConfirmacion, controller };
    setConfirmando(true);
    setError("");
    setExito("");
    setAdvertencia("");
    try {
      // Keep this operation observer until settlement, including while the POS is
      // unmounted, so a delayed SDK token lookup cannot dispatch under a new user.
      const { data } = supabase.auth.onAuthStateChange((evento, sesion) => {
        if (evento === "SIGNED_OUT" || (sesion?.user?.id && sesion.user.id !== sesionConfirmacion.usuario)) controller.abort();
      });
      dejarObservarSesion = () => data.subscription.unsubscribe();
      if (recuperar) {
        // Leer otra vez detecta cambios de sesión antes de enviar. No tomar nada del carrito.
        intento = leerIntentoCobro(empresaConfirmacion);
        if (!contextoVigente() || !intento || intento.payload.empresaId !== empresaConfirmacion
          || intento.payload.idempotencyKey !== intentoPendiente?.payload.idempotencyKey
          || intento.huella !== intentoPendiente?.huella
          || !["pendiente", "confirmado"].includes(intento.estado)) {
          throw new Error("El intento guardado cambió. Recargá la caja para revisar su estado antes de cobrar.");
        }
        // A late ACK may have confirmed storage after this view loaded its snapshot.
        adoptarConfirmado = intento.estado === "confirmado";
      } else {
        intento = crearIntentoCobro({
          empresaId: empresaConfirmacion, medioPago, clienteId: clienteId || null, descuentoPct,
          idempotencyKey: nuevaClaveVenta(),
          items: items.map((item) => ({ productoId: item.producto.id, cantidad: item.cantidad, unidadMedida: item.unidad })),
        }, total);
      }
      if (!adoptarConfirmado) guardarIntentoCobro(intento);
      if (!adoptarConfirmado) setIntentoPendiente(intento);
      protegido = true;
      const resultado = adoptarConfirmado ? {
        ventaId: intento.ventaId!,
        verificacion: Promise.resolve({ integridad: "no_verificada" as const, totalVerificado: null }),
      } : await confirmarVentaSigo(intento.payload, {
        recuperacion: recuperar,
        contextoVigente,
        signal: controller.signal,
        antesDeEnviar: () => {
          if (!contextoVigente()) throw new Error("La sesión o empresa cambió. Conservamos el intento; recargá la caja para revisarlo.");
          const actualizado: IntentoCobro = { ...intento!, fase: "enviado" };
          guardarIntentoCobro(actualizado);
          intento = actualizado;
          if (contextoVigente()) setIntentoPendiente(actualizado);
        },
      });
      conciliacionEnCurso = resultado.verificacion;
      // Tener UUID confirma la escritura aunque falle la conciliación posterior.
      // Persistir también si el operador cambió de empresa mientras esperaba.
      let guardado = true;
      try { if (!adoptarConfirmado) registrarCobroConfirmado(intento, resultado.ventaId); }
      catch { guardado = false; }
      try { sessionStorage.setItem(`sigo:ultima-venta:${empresaConfirmacion}`, resultado.ventaId); } catch { /* el registro confirmado también guarda el UUID */ }
      if (!contextoVigente()) {
        void resultado.verificacion.catch(() => undefined);
        return;
      }
      if (guardado) setIntentoPendiente(null);
      else setError("La venta quedó confirmada, pero no se pudo guardar su estado en este navegador. No hagas otro cobro: usá Recuperar el mismo cobro para guardar el resultado.");
      setExito(recuperar ? "Cobro recuperado. No se creó una venta adicional. Podés facturar o reimprimir esta venta con F11/F12." : "Venta confirmada");
      window.setTimeout(() => { if (contextoVigente()) setExito(""); }, recuperar ? 9000 : 2200);
      setUltimaVentaTicket(resultado.ventaId);
      // La recuperación nunca reanuda autorizaciones de impresión o emisión fiscal.
      if (!recuperar && emitirFiscalDespues) window.dispatchEvent(new CustomEvent("sigo:arca:venta", { detail: { empresaId: empresaConfirmacion, ventaId: resultado.ventaId } }));
      setAdvertencia("");
      const totalEsperado = intento.totalEsperado;
      void resultado.verificacion.then((verificado) => {
        if (!contextoVigente()) return;
        const advertencias: string[] = [];
        if (verificado.totalVerificado != null && Math.abs(verificado.totalVerificado - totalEsperado) > DINERO_TOLERANCIA) {
          advertencias.push(`El precio cambió mientras confirmabas. SIGO registró el total vigente del backend: $ ${verificado.totalVerificado.toLocaleString("es-AR")}.`);
        }
        if (verificado.integridad !== "ok") {
          advertencias.push(verificado.integridad === "revisar"
            ? "La venta quedó registrada, pero no se pudo conciliar su movimiento de Caja/Cuenta Corriente o stock. NO repitas la venta: revisá el estado operativo o Informes."
            : "La venta quedó registrada, pero la conciliación automática no pudo verificarse. NO repitas la venta hasta revisar Ventas/Informes.");
        }
        setAdvertencia(advertencias.join(" "));
      }).catch(() => {
        if (contextoVigente()) setAdvertencia("La venta quedó confirmada, pero no se pudo verificar la conciliación posterior. No repitas la venta hasta revisar Ventas/Informes.");
      });
      if (!recuperar && imprimirDespues) {
        void imprimirTicketVenta(empresaConfirmacion, resultado.ventaId, "80", true).catch((printErr) => {
          if (contextoVigente()) setError(printErr instanceof Error ? printErr.message : "La venta se confirmó, pero no se pudo abrir la impresión del ticket.");
        });
      }
      // En recuperación el catálogo puede contener ya el stock descontado: releer, no restarlo otra vez.
      if (!recuperar) {
        const cantidadesVendidas = new Map(intento.payload.items.map((item) => [item.productoId, item.cantidad]));
        setCatalogo((actual) => actual.map((producto) => {
          const cantidad = cantidadesVendidas.get(producto.id);
          return cantidad ? { ...producto, stock_actual: Math.max(0, Number(producto.stock_actual ?? 0) - cantidad) } : producto;
        }));
      } else {
        void listarProductosSigo(empresaConfirmacion).then((data) => {
          if (contextoVigente()) setCatalogo(data);
        }).catch(() => {
          if (contextoVigente()) setCatalogoError("El cobro fue recuperado, pero no se pudo actualizar el catálogo. Recargá antes de otra venta.");
        });
      }
      setItems([]);
      setBusquedaProducto("");
      setProductoSeleccionadoId(null);
      setScannerInstanceKey((key) => key + 1);
      setClienteId("");
      setMedioPago("efectivo");
      void listarClientesSigo(empresaConfirmacion).then((data) => {
        if (contextoVigente()) setClientes(data);
      }).catch((refreshErr) => {
        if (contextoVigente()) setClientesError(refreshErr instanceof Error ? refreshErr.message : "No se pudieron actualizar los clientes.");
      });
      void cargarVentasRecientes(empresaConfirmacion, contextoVigente);
    } catch (err) {
      // Solo un rechazo definitivo de la primera llamada prueba que este intento no cobró.
      // En una recuperación, el rollback actual NO descarta un commit anterior.
      let rechazoGuardado = false;
      if (protegido && !recuperar && intento && err instanceof VentaRechazadaSinCambiosError) {
        try { registrarCobroRechazado(intento); rechazoGuardado = true; } catch { /* conservar pendiente */ }
      }
      if (contextoVigente()) {
        if (rechazoGuardado) setIntentoPendiente(null);
        setError(err instanceof Error ? err.message : "No se pudo confirmar la venta.");
        if (protegido && !rechazoGuardado) setAdvertencia(!recuperar && intento?.fase === "preparacion"
          ? "La preparación del cobro no pudo completarse. Conservamos sus datos: usá Recuperar el mismo cobro para continuar."
          : "El resultado del cobro no está verificado. No vuelvas a armar ni cobrar esta venta: recuperá el mismo intento con el botón de recuperación.");
      }
    } finally {
      // Keep cancellation active through the bounded readback as well. A stale
      // callback may never refresh another actor's view or start its next read.
      if (conciliacionEnCurso) void conciliacionEnCurso.then(dejarObservarSesion, dejarObservarSesion);
      else dejarObservarSesion?.();
      if (operacionCobroRef.current?.controller === controller) operacionCobroRef.current = null;
      confirmacionEnCursoRef.current = false;
      if (montadoRef.current) setConfirmando(false);
    }
  }

  const resumenCantidades = [...new Set(items.map((item) => item.unidad))].map((unidad) => formatoCantidadMedida(items.filter((item) => item.unidad === unidad).reduce((total, item) => total + item.cantidad, 0), unidad)).join(" · ");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (productoPorMedida && ["F9", "F10", "F11", "F12"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.repeat) return;
      if ((cajaBloqueada || confirmacionEnCursoRef.current) && ["F1", "F6", "F9", "F10", "F11", "F12"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!["F1", "F2", "F6", "F9", "F10", "F11", "F12"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "F1") vaciar();
      if (event.key === "F2") buscarRef.current?.focus();
      if (event.key === "F6") setDescuentoAbierto((value) => !value);
      if (event.key === "F9") void confirmar();
      if (event.key === "F10") void confirmar(true);
      if (event.key === "F11") {
        event.stopPropagation();
        if (items.length > 0) void confirmar(false, true);
        else if (ultimaVentaTicket) window.dispatchEvent(new CustomEvent("sigo:arca:venta", { detail: { empresaId, ventaId: ultimaVentaTicket } }));
        else setError("No hay una venta para facturar.");
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
    <div className="sigo-pos" ref={cajaRef}>
      <header className="sigo-pos-title"><div><strong>🛒 CAJA - VENTA</strong><span>Escaneá, buscá o agregá productos. Todo en una sola pantalla.</span></div><button className="admin-button" disabled={!items.length||cajaBloqueada} onClick={vaciar}>Vaciar</button></header>
      <div className="sigo-pos-toolbar">
        <button type="button" disabled={cajaBloqueada} onClick={vaciar}>▣ <strong>NUEVA VENTA</strong><small>F1</small></button>
        <button type="button" onClick={()=>buscarRef.current?.focus()}>⌕ <strong>BUSCAR PRODUCTO</strong><small>F2</small></button>
        <button type="button" onClick={()=>document.querySelector<HTMLElement>(".barcode-camera-button")?.click()}>📷 <strong>CÁMARA</strong><small>F3</small></button>
        <button type="button" onClick={()=>document.getElementById("sigo-pos-cliente")?.focus()}>👤 <strong>CLIENTE</strong><small>F8</small></button>
        <button type="button" disabled={cajaBloqueada} onClick={()=>setDescuentoAbierto(v=>!v)}>◇ <strong>DESCUENTO</strong><small>F6 · {descuentoPct}%</small></button>
      </div>
      {descuentoAbierto&&!cajaBloqueada&&<div className="sigo-pos-discount"><strong>Descuento</strong>{[0,5,10,15,20].map(n=><button type="button" className={descuentoPct===n?"active":""} onClick={()=>{setDescuentoPct(n);setDescuentoAbierto(false)}} key={n}>{n}%</button>)}<label>Otro % <input type="number" min="0" max="99.99" step="0.01" value={descuentoPct} onChange={e=>setDescuentoPct(Math.max(0,Math.min(99.99,Number(e.target.value)||0)))}/></label></div>}
      {productoPorMedida && unidadesCargadas && unidadesProducto[productoPorMedida.id] && <EditorCantidadMedida
        key={`${productoPorMedida.id}-${reemplazandoCantidad ? "editar" : "agregar"}`}
        nombre={productoPorMedida.nombre}
        unidad={unidadesProducto[productoPorMedida.id]!}
        precio={precioUnitarioVenta({ producto: productoPorMedida, cantidad: 1, unidad: unidadesProducto[productoPorMedida.id]! }, ofertas, descuentoPct)}
        cantidadInicial={reemplazandoCantidad ? items.find((item) => item.producto.id === productoPorMedida.id)?.cantidad : undefined}
        reemplazar={reemplazandoCantidad}
        stockDisponible={(() => {
          try { return stockRestanteMedida(Number(productoPorMedida.stock_actual), reemplazandoCantidad ? [] : items.filter((item) => item.producto.id === productoPorMedida.id).map((item) => item.cantidad), unidadesProducto[productoPorMedida.id]!); }
          catch { return null; }
        })()}
        onConfirmar={(cantidad) => { agregarCantidad(productoPorMedida, cantidad, reemplazandoCantidad); setProductoPorMedida(null); }}
        onCancelar={() => { setProductoPorMedida(null); window.setTimeout(() => buscarRef.current?.focus(), 0); }}
      />}
      {(intentoVisible || errorPersistenciaCobro) && <div className="form-error" role="alert" data-cobro-pendiente="">
        {intentoVisible ? <>
          <strong>Hay un cobro pendiente de verificar.</strong>
          <p>No armes ni cobres otra venta. Recuperar completa o reconcilia el mismo cobro con su clave original, sin crear un segundo cobro. No imprime ni emite una factura automáticamente.</p>
          <p>{intentoVisible.payload.items.length} renglón(es) · {etiquetaMedio(intentoVisible.payload.medioPago)} · Total esperado $ {intentoVisible.totalEsperado.toLocaleString("es-AR")}.</p>
          <details key={`${empresaId}:${intentoVisible.payload.idempotencyKey}`} data-referencia-cobro="">
            <summary>Ver referencia del cobro</summary>
            <dl style={{ overflowWrap: "anywhere" }}>
              <dt>Empresa</dt><dd data-referencia-empresa="">{intentoVisible.payload.empresaId}</dd>
              <dt>Clave del cobro</dt><dd data-referencia-clave="">{intentoVisible.payload.idempotencyKey}</dd>
              <dt>Fase observada en este navegador</dt><dd data-referencia-fase="">{intentoVisible.fase ?? "desconocida"}</dd>
              <dt>Creado</dt><dd>{intentoVisible.creadoEn}</dd>
              <dt>Versión del registro</dt><dd>{intentoVisible.version}</dd>
            </dl>
            <p>Referencia de esta sesión y empresa. La fase registrada no confirma el resultado del cobro. Este registro no identifica al usuario que lo inició.</p>
          </details>
          <button type="button" data-recuperar-cobro="" disabled={confirmando || Boolean(errorPersistenciaCobro)} onClick={() => void confirmar(false, false, true)}>{confirmando ? "Verificando el mismo cobro…" : "Recuperar el mismo cobro"}</button>
        </> : errorPersistenciaCobro}
      </div>}
      <div className="sigo-pos-scan">
        {!cajaBloqueada && !productoPorMedida && <BarcodeScanner key={scannerInstanceKey} empresaId={empresaId} action="vender" onCachedCode={(code)=>{const encontrados=catalogo.filter((p)=>p.empresa_id===empresaId&&(normalizeBarcode(p.codigo_barras??"")===code||normalizeBarcode(p.codigo_interno??"")===code));return encontrados.length?encontrados:null}} onProduct={agregar} onBlockedProduct={marcarProductoBloqueado} onQueryChange={(query)=>{setBusquedaProducto(query);productoSeleccionadoIdRef.current=null;setProductoSeleccionadoId(null)}} onManualQuery={(query)=>{setBusquedaProducto(query);productoSeleccionadoIdRef.current=null;setProductoSeleccionadoId(null);return !/^\\d{6,}$/.test(query.trim())}} onProductSearchKeyDown={manejarTeclaBusquedaProducto}/>}

        {busquedaProducto.trim()&&productosEncontrados.length>0&&<div className="sigo-pos-results">{productosEncontrados.map((p)=><button type="button" data-pos-suggestion="" data-product-id={p.id} aria-selected={p.id===productoSeleccionadoVisibleId} className={p.id===productoSeleccionadoVisibleId?"active":""} key={p.id} onMouseEnter={()=>{productoSeleccionadoIdRef.current=p.id;setProductoSeleccionadoId(p.id)}} onClick={()=>seleccionarProductoManual(p)}><strong>{p.nombre}{Number(p.stock_actual??0)<=0?" · SIN STOCK":""}</strong><span>{p.codigo_interno||p.codigo_barras||"Sin código"} · $ {Number(p.precio_venta||0).toLocaleString("es-AR")} / {p.unidad_medida ?? "unidad sin verificar"} · Stock {formatoStockMedida(Number(p.stock_actual ?? 0), p.unidad_medida)}</span></button>)}</div>}{busquedaProducto.trim()&&productosEncontrados.length===0&&!catalogoError&&<div className="sigo-pos-results"><div className="table-empty">No encontré productos. Probá con nombre, marca, código interno o EAN.</div></div>}
      </div>
      {productoBloqueado&&<div className="form-error"><strong>{productoBloqueado.producto.nombre}</strong> · {productoBloqueado.razon==="stock"?"Sin stock disponible.":"Sin precio válido."}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}{ofertasError&&<p className="form-error" role="alert">No se puede cobrar hasta comprobar los precios de oferta: {ofertasError}</p>}{exito&&<span className="sigo-pos-success-inline" role="status">{exito}</span>}{advertencia&&<p className="form-error">{advertencia}</p>}
      <div className="sigo-pos-grid">
        <section className="sigo-pos-cart">
          <div className="table-wrapper"><table className="products-table"><thead><tr><th>#</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead><tbody>{items.map((item,i)=>{const precio=precioUnitarioVenta(item,ofertas,descuentoPct);return <tr key={item.producto.id}><td>{i+1}</td><td><strong>{item.producto.nombre}</strong><small>{item.producto.codigo_interno||item.producto.codigo_barras||""}</small></td><td><div className="sigo-pos-qty"><button disabled={cajaBloqueada || Boolean(productoPorMedida)} onClick={()=>cambiarCantidad(item.producto.id,-pasoCantidadMedida(item.unidad))}>−</button><button type="button" style={{ width: "auto", minWidth: "5rem", padding: "0 0.4rem" }} disabled={cajaBloqueada || Boolean(productoPorMedida)} aria-label={`Editar cantidad de ${item.producto.nombre}`} onClick={()=>editarCantidad(item)}><strong>{formatoCantidadMedida(item.cantidad, item.unidad)}</strong></button><button disabled={cajaBloqueada || Boolean(productoPorMedida)} onClick={()=>cambiarCantidad(item.producto.id,pasoCantidadMedida(item.unidad))}>+</button></div></td><td>$ {precio.toLocaleString("es-AR")} / {item.unidad}</td><td><strong>$ {subtotalMedida(item.cantidad, precio).toLocaleString("es-AR")}</strong></td><td><button className="sigo-pos-remove" disabled={cajaBloqueada || Boolean(productoPorMedida)} onClick={()=>setItems(a=>a.filter(x=>x.producto.id!==item.producto.id))}>🗑</button></td></tr>})}</tbody></table>{!items.length&&<div className="table-empty">Escaneá o buscá un producto para iniciar la venta.</div>}</div>
          <div className="sigo-pos-payments">{(["efectivo","debito","credito","transferencia","mercado_pago","cuenta_corriente"] as MedioPagoSigo[]).map(m=><button type="button" disabled={cajaBloqueada} className={medioPago===m?"active":""} onClick={()=>setMedioPago(m)} key={m}>{etiquetaMedio(m)}</button>)}</div>
        </section>
        <aside className="sigo-pos-summary">
          <div className="sigo-pos-total"><span>TOTAL</span><strong>$ {total.toLocaleString("es-AR")}</strong>{descuentoPct>0&&<small>Subtotal $ {subtotal.toLocaleString("es-AR")} · Descuento {descuentoPct}%</small>}<p>Productos <b>{items.length}</b> · Cantidades <b>{resumenCantidades || "0"}</b></p></div>
          <label><span>Cliente</span><select disabled={cajaBloqueada} id="sigo-pos-cliente" value={clienteId} onChange={e=>setClienteId(e.target.value)}><option value="">Consumidor final / sin cliente</option>{clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <button className="sigo-pos-action cobrar" disabled={!puedeConfirmar||cajaBloqueada} onClick={()=>void confirmar()}>💳 COBRAR <kbd>F9</kbd></button>
          <button className="sigo-pos-action ticket" disabled={!puedeConfirmar||cajaBloqueada} onClick={()=>void confirmar(true)}>🖨 COBRAR + TICKET <kbd>F10</kbd></button>
          <button className="sigo-pos-action fiscal" disabled={cajaBloqueada || Boolean(productoPorMedida)} type="button" onClick={()=>{if(items.length>0)void confirmar(false,true);else if(ultimaVentaTicket)window.dispatchEvent(new CustomEvent("sigo:arca:venta",{detail:{empresaId,ventaId:ultimaVentaTicket}}));else setError("No hay una venta para facturar.");}}>▤ FACTURA FISCAL <kbd>F11</kbd></button>
          <button className="sigo-pos-action reprint" disabled={!ultimaVentaTicket || cajaBloqueada || Boolean(productoPorMedida)} onClick={()=>{if(!confirmacionEnCursoRef.current&&ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket).catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir el ticket."));}}>🖨 REIMPRIMIR <kbd>F12</kbd></button>
          <div className="sigo-pos-mini-actions"><button type="button" disabled={cajaBloqueada || !ultimaVentaTicket} onClick={()=>{const m=encodeURIComponent("Ticket SIGO · Total $ "+total.toLocaleString("es-AR"));window.open("https://wa.me/?text="+m,"_blank","noopener,noreferrer")}}>WhatsApp</button><button type="button" disabled={cajaBloqueada || !ultimaVentaTicket} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket,"a4").catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir A4."));}}>A4</button><button type="button" disabled={cajaBloqueada || !ultimaVentaTicket} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket).catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir el ticket."));}}>Ticket 58/80</button><button type="button" disabled={cajaBloqueada} onClick={()=>document.querySelector<HTMLElement>(".arca-launcher")?.click()}>ARCA</button></div>
        </aside>
      </div>
    </div>
  );
}
