import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { numeroCompra, resolverPrecioCompra, textoNumeroCompra, type ModoPrecioCompra } from "./compraIARevision";
import "./compraIARevision.css";
import BarcodeScanner from "./BarcodeScanner";
import type { BarcodeProduct } from "./barcode";
import { analizarFacturaCompraSigo, type FacturaCompraIA, type FacturaItemIA } from "./facturaIA";
import { guardarProductoSigo, listarProductosSigo, type ProductoSigo } from "./productos";
import {
  confirmarCompraSigo,
  guardarProveedorSigo,
  listarComprasSigo,
  listarProveedoresSigo,
  verificarCompraSigo,
  type CompraItemInput,
  type CompraSigo,
  type ProveedorSigo,
  type VerificacionCompraSigo,
} from "./compras";

type Linea = CompraItemInput & { key: string; margen_porcentaje?: number; precio_venta?: number };

type ItemPreparadoIA = {
  index: number;
  productoId: string | null;
  nuevo: boolean;
  nombre: string;
  codigoInterno: string | null;
  codigoBarras: string | null;
  cantidad: number;
  costoUnitario: number;
  margenPorcentaje: number;
  precioVenta: number;
};

type CompraPreparadaIA = {
  proveedorId: string | null;
  proveedorNombre: string;
  fecha: string | null;
  tipoComprobante: string | null;
  numeroComprobante: string | null;
  referenciaBorrador: string | null;
  items: ItemPreparadoIA[];
};

type PendienteFactura = { index: number; producto: string; motivos: string[] };

type UltimaConciliacion = {
  compraId: string;
  resultado: VerificacionCompraSigo;
};

function nuevaClave() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nuevaLinea(): Linea {
  return { key: nuevaClave(), producto_id: "", cantidad: 1, costo_unitario: 0, margen_porcentaje: 0, precio_venta: 0 };
}

function normalizar(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function digitos(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function encontrarProducto(item: FacturaItemIA, productos: ProductoSigo[]) {
  const codigos = [item.codigo_barras, item.codigo].filter(Boolean).map((x) => String(x).trim());
  for (const codigo of codigos) {
    const exacto = productos.find((p) => p.codigo_barras === codigo || p.codigo_interno === codigo);
    if (exacto) return exacto;
  }
  const nombre = normalizar(item.descripcion);
  if (!nombre) return undefined;
  return productos.find((p) => normalizar(p.nombre) === nombre);
}

export default function ComprasOperativas({ empresaId, vista = "todo" }: { empresaId: string; vista?: "todo" | "manual" | "ia" | "historial" }) {
  const [proveedores, setProveedores] = useState<ProveedorSigo[]>([]);
  const [compras, setCompras] = useState<CompraSigo[]>([]);
  const [productos, setProductos] = useState<ProductoSigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [proveedorId, setProveedorId] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState("Factura");
  const [numero, setNumero] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea()]);
  const [nuevoProveedor, setNuevoProveedor] = useState("");
  const [nuevoCuit, setNuevoCuit] = useState("");
  const [ultimaConciliacion, setUltimaConciliacion] = useState<UltimaConciliacion | null>(null);
  const [facturaIA, setFacturaIA] = useState<FacturaCompraIA | null>(null);
  const [facturaProcesando, setFacturaProcesando] = useState(false);
  const [facturaAplicando, setFacturaAplicando] = useState(false);
  const [facturaMensaje, setFacturaMensaje] = useState("");
  const [preciosVentaFactura, setPreciosVentaFactura] = useState<Record<number, string>>({});
  const [margenesFactura, setMargenesFactura] = useState<Record<number, string>>({});
  const [modosPrecioFactura, setModosPrecioFactura] = useState<Record<number, ModoPrecioCompra>>({});
  const [textoCompraIA, setTextoCompraIA] = useState("");
  const lecturaVersionRef = useRef(0);
  const [origenCompra, setOrigenCompra] = useState<"manual"|"ia">("manual");
  const [codigosBarrasFactura, setCodigosBarrasFactura] = useState<Record<number, string>>({});
  const [codigosInternosFactura, setCodigosInternosFactura] = useState<Record<number, string>>({});
  const [vinculosFactura, setVinculosFactura] = useState<Record<number, string>>({});
  const [compraPreparadaIA, setCompraPreparadaIA] = useState<CompraPreparadaIA | null>(null);
  const [revisionFacturaAbierta, setRevisionFacturaAbierta] = useState(false);
  const [busquedaManual, setBusquedaManual] = useState("");
  const [altaManualAbierta, setAltaManualAbierta] = useState(false);
  const [nuevoProductoManual, setNuevoProductoManual] = useState({ nombre:"", codigo:"", costo:"", margen:"", precio:"" });
  const [correccionFacturaAbierta, setCorreccionFacturaAbierta] = useState(false);
  const [filtroRevisionIA, setFiltroRevisionIA] = useState<"todos"|"pendientes"|"nuevos"|"vinculados">("todos");
  const [margenMasivoIA, setMargenMasivoIA] = useState("");
  const [busquedasVinculoIA, setBusquedasVinculoIA] = useState<Record<number,string>>({});
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const archivoRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef(nuevaClave());
  const empresaActivaRef = useRef(empresaId);
  const borradorCargadoRef = useRef(false);
  const borradorKey = `sigo:compra-ia:borrador:${empresaId}`;

  async function cargar(targetEmpresaId = empresaId) {
    setLoading(true);
    setError("");
    try {
      const [ps, cs, prods] = await Promise.all([
        listarProveedoresSigo(targetEmpresaId),
        listarComprasSigo(targetEmpresaId),
        listarProductosSigo(targetEmpresaId),
      ]);
      if (empresaActivaRef.current !== targetEmpresaId) return;
      setProveedores(ps);
      setCompras(cs);
      setProductos(prods);
      setProveedorId((actual) => actual && ps.some((p) => p.id === actual) ? actual : (ps[0]?.id ?? ""));
    } catch (err) {
      if (empresaActivaRef.current === targetEmpresaId) {
        setError(err instanceof Error ? err.message : "No se pudo cargar Compras");
      }
    } finally {
      if (empresaActivaRef.current === targetEmpresaId) setLoading(false);
    }
  }

  useEffect(() => {
    empresaActivaRef.current = empresaId;
    lecturaVersionRef.current += 1;
    setFacturaProcesando(false);
    setTextoCompraIA("");
    setModosPrecioFactura({});
    idempotencyKeyRef.current = nuevaClave();
    setProveedores([]);
    setCompras([]);
    setProductos([]);
    setProveedorId("");
    setFecha(new Date().toISOString().slice(0, 10));
    setTipo("Factura");
    setNumero("");
    setLineas([nuevaLinea()]);
    setNuevoProveedor("");
    setNuevoCuit("");
    setUltimaConciliacion(null);
    borradorCargadoRef.current = false;
    let restaurado = false;
    try {
      const raw = localStorage.getItem(`sigo:compra-ia:borrador:${empresaId}`);
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.facturaIA) {
          setFacturaIA(b.facturaIA); setFacturaMensaje("📄 Compra IA en preparación recuperada.");
          setPreciosVentaFactura(b.preciosVentaFactura ?? {}); setMargenesFactura(b.margenesFactura ?? {});
          setModosPrecioFactura(b.modosPrecioFactura ?? {});
          setCodigosBarrasFactura(b.codigosBarrasFactura ?? {}); setCodigosInternosFactura(b.codigosInternosFactura ?? {});
          setVinculosFactura(b.vinculosFactura ?? {}); setCompraPreparadaIA(b.compraPreparadaIA ?? null); setRevisionFacturaAbierta(true);
          restaurado = true;
        }
      }
    } catch { localStorage.removeItem(`sigo:compra-ia:borrador:${empresaId}`); }
    if (!restaurado) { setFacturaIA(null); setFacturaMensaje(""); setPreciosVentaFactura({}); setMargenesFactura({}); setCodigosBarrasFactura({}); setCodigosInternosFactura({}); setVinculosFactura({}); setCompraPreparadaIA(null); }
    borradorCargadoRef.current = true;
    setError("");
    void cargar(empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  useEffect(() => {
    if (!borradorCargadoRef.current || typeof localStorage === "undefined") return;
    if (!facturaIA) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(borradorKey, JSON.stringify({facturaIA,preciosVentaFactura,margenesFactura,modosPrecioFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA,guardadoEn:new Date().toISOString()}));
      } catch { setError("No se pudo guardar el borrador en este dispositivo. No cierres la pantalla; liberá espacio y volvé a guardar."); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [borradorKey,facturaIA,preciosVentaFactura,margenesFactura,modosPrecioFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA]);

  function guardarBorradorIA() {
    if (!facturaIA) return;
    try {
      localStorage.setItem(borradorKey, JSON.stringify({facturaIA,preciosVentaFactura,margenesFactura,modosPrecioFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA,guardadoEn:new Date().toISOString()}));
      setCorreccionFacturaAbierta(false);
      setFacturaMensaje("✓ Borrador guardado en este dispositivo. Podés volver a editarlo; todavía no se ingresó stock ni se cambiaron precios del catálogo.");
    } catch { setError("No se pudo guardar el borrador. No cierres la pantalla; liberá espacio y volvé a guardar."); }
  }

  const total = useMemo(
    () => lineas.reduce((sum, l) => sum + Number(l.cantidad || 0) * Number(l.costo_unitario || 0), 0),
    [lineas]
  );

  const proveedorMap = useMemo(() => new Map(proveedores.map((p) => [p.id, p.razon_social])), [proveedores]);
  const compraValida = useMemo(() => Boolean(
    proveedorId &&
    total > 0 &&
    lineas.length > 0 &&
    lineas.every((l) => Boolean(l.producto_id) && Number(l.cantidad) > 0 && Number(l.costo_unitario) > 0)
  ), [proveedorId, total, lineas]);
  const cambiosPrecio = useMemo(() => lineas.flatMap((l) => {
    const p = productos.find((x) => x.id === l.producto_id);
    if (!p) return [];
    const costoAnterior = Number(p.costo_actual ?? p.costo_ultima_compra ?? 0);
    const costoNuevo = Number(l.costo_unitario || 0);
    const precioAnterior = Number(p.precio_venta ?? 0);
    const margen = Number(p.margen_porcentaje ?? (costoAnterior > 0 && precioAnterior > 0 ? ((precioAnterior - costoAnterior) / costoAnterior) * 100 : 0));
    const precioNuevo = costoNuevo > costoAnterior && margen >= 0 ? Math.round(costoNuevo * (1 + margen / 100) * 100) / 100 : precioAnterior;
    return costoNuevo > costoAnterior ? [{ id:p.id, nombre:p.nombre, costoAnterior, costoNuevo, precioAnterior, precioNuevo, margen }] : [];
  }), [lineas, productos]);

  function itemFacturaEfectivo(item: FacturaItemIA, index: number): FacturaItemIA {
    return {
      ...item,
      codigo_barras: codigosBarrasFactura[index] ?? item.codigo_barras,
      codigo: codigosInternosFactura[index] ?? item.codigo,
    };
  }

  const productoFactura = (item: FacturaItemIA, index: number) => productos.find((p)=>p.id===vinculosFactura[index]) ?? encontrarProducto(itemFacturaEfectivo(item, index), productos);

  const pendientesFactura = useMemo<PendienteFactura[]>(() => {
    if (!facturaIA) return [];
    return facturaIA.items.flatMap((item, index) => {
      const motivos: string[] = [];
      const nombre = item.descripcion.trim();
      const cantidad = Number(item.cantidad);
      const costo = Number(item.costo_unitario);
      const existente = productos.find((p)=>p.id===vinculosFactura[index]) ?? encontrarProducto({
        ...item,
        codigo_barras: codigosBarrasFactura[index] ?? item.codigo_barras,
        codigo: codigosInternosFactura[index] ?? item.codigo,
      }, productos);
      if (!nombre) motivos.push("Falta el nombre del producto.");
      if (!Number.isFinite(cantidad) || cantidad <= 0) motivos.push("La cantidad debe ser mayor que cero.");
      if (!Number.isFinite(costo) || costo <= 0) motivos.push("El costo unitario debe ser mayor que cero.");
      const { precio, margen } = resolverPrecioCompra(costo, existente, margenesFactura[index], preciosVentaFactura[index], modosPrecioFactura[index]);
      if (!Number.isFinite(precio) || precio <= 0) motivos.push("Falta un precio al público válido.");
      if (!Number.isFinite(margen) || margen < 0) motivos.push("Falta un porcentaje sobre costo válido.");
      if (item.requiere_revision && !item.revisado) motivos.push("Confirmá que revisaste cantidad, costo y presentación de esta línea.");
      // Diferencias entre neto/impuestos se muestran como información de revisión, no bloquean Guardar.
      return motivos.length ? [{ index, producto: nombre || `Producto ${index + 1}`, motivos }] : [];
    });
  }, [facturaIA, productos, vinculosFactura, codigosBarrasFactura, codigosInternosFactura, preciosVentaFactura, margenesFactura, modosPrecioFactura]);

  const preciosFacturaPendientes = pendientesFactura.filter((p) => p.motivos.some((m) => m.includes("precio al público"))).length;

  function irAlPrimerPendiente() {
    const primero = pendientesFactura[0];
    if (!primero) return;
    setCorreccionFacturaAbierta(true);
    window.setTimeout(() => document.getElementById(`factura-item-${primero.index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

function descartarItemFactura(index: number) {
    setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.filter((_,i)=>i!==index)}) : actual);
    const compactar=(obj:Record<number,string>)=>Object.fromEntries(Object.entries(obj).flatMap(([k,v])=>{const n=Number(k);return n===index?[]:[[n>index?n-1:n,v]];}));
    setPreciosVentaFactura(compactar); setMargenesFactura(compactar); setModosPrecioFactura((actual)=>compactar(actual) as Record<number, ModoPrecioCompra>); setCodigosBarrasFactura(compactar); setCodigosInternosFactura(compactar); setVinculosFactura(compactar); setBusquedasVinculoIA(compactar); setCompraPreparadaIA(null);
  }

    function editarLinea(key: string, patch: Partial<Linea>) {
    setLineas((actual) => actual.map((l) => l.key === key ? { ...l, ...patch } : l));
  }

  const resultadosBusquedaManual = useMemo(() => {
    const q = normalizar(busquedaManual).trim();
    if (!q) return [];
    return productos.filter((p) => [p.nombre, p.codigo_interno, p.codigo_barras, p.marca, p.categoria]
      .filter(Boolean).some((v) => normalizar(String(v)).includes(q))).slice(0, 12);
  }, [busquedaManual, productos]);

  async function crearProductoManual() {
    const nombre=nuevoProductoManual.nombre.trim();
    if(!nombre) { setError("Ingresá el nombre del producto nuevo."); return; }
    const costo=Number(nuevoProductoManual.costo||0), margen=Number(nuevoProductoManual.margen||0);
    const precio=Number(nuevoProductoManual.precio||0) || Math.round(costo*(1+margen/100)*100)/100;
    setSaving(true); setError("");
    try {
      const id=await guardarProductoSigo({empresaId,nombre,codigoBarras:nuevoProductoManual.codigo.trim()||null,costoActual:costo,costoUltimaCompra:costo,precioVenta:precio,margenPorcentaje:margen,stockActual:0});
      await cargar();
      setLineas((actual)=>actual.length===1&&!actual[0].producto_id?[{...actual[0],producto_id:id,costo_unitario:costo,margen_porcentaje:margen,precio_venta:precio}]:[...actual,{key:nuevaClave(),producto_id:id,cantidad:1,costo_unitario:costo,margen_porcentaje:margen,precio_venta:precio}]);
      setNuevoProductoManual({nombre:"",codigo:"",costo:"",margen:"",precio:""}); setAltaManualAbierta(false); setBusquedaManual("");
    } catch(err){setError(err instanceof Error?err.message:"No se pudo crear el producto.");} finally {setSaving(false);}
  }

  function seleccionarBusquedaManual(producto: ProductoSigo) {
    agregarProductoEscaneado(producto as BarcodeProduct);
    setBusquedaManual("");
  }

  function agregarProductoEscaneado(producto: BarcodeProduct) {
    if (saving || loading) return;
    setError("");
    const maestro = productos.find((item) => item.id === producto.id);
    if (!maestro) {
      setError("El producto escaneado ya no está disponible en la empresa activa. Actualizá Compras y volvé a escanear.");
      return;
    }
    const costoBase = Number(maestro.costo_actual ?? maestro.costo_ultima_compra ?? 0);
    const costo = Number.isFinite(costoBase) && costoBase >= 0 ? costoBase : 0;

    setLineas((actual) => {
      const existente = actual.find((linea) => linea.producto_id === maestro.id);
      if (existente) {
        return actual.map((linea) => linea.key === existente.key
          ? { ...linea, cantidad: Number(linea.cantidad || 0) + 1 }
          : linea);
      }
      if (actual.length === 1 && !actual[0].producto_id) {
        return [{ ...actual[0], producto_id: maestro.id, cantidad: 1, costo_unitario: costo }];
      }
      return [...actual, { key: nuevaClave(), producto_id: maestro.id, cantidad: 1, costo_unitario: costo }];
    });
  }

  async function crearProveedor() {
    if (!nuevoProveedor.trim()) return;
    const empresaOperacion = empresaId;
    setSaving(true);
    setError("");
    try {
      const creado = await guardarProveedorSigo({ empresaId: empresaOperacion, razonSocial: nuevoProveedor, cuit: nuevoCuit });
      if (empresaActivaRef.current !== empresaOperacion) return;
      setProveedores((actual) => [...actual, creado].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
      setProveedorId(creado.id);
      setNuevoProveedor("");
      setNuevoCuit("");
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo crear el proveedor");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setSaving(false);
    }
  }

  async function leerFactura(file?: File | string | null) {
    if (!file || facturaProcesando || facturaAplicando) return;
    const empresaOperacion = empresaId;
    const versionLectura = ++lecturaVersionRef.current;
    setFacturaProcesando(true);
    setError("");
    // Do not erase the previous draft until a replacement has been successfully analyzed.
    try {
      const resultado = await analizarFacturaCompraSigo(empresaOperacion, file);
      if (empresaActivaRef.current !== empresaOperacion || lecturaVersionRef.current !== versionLectura) return;
      setPreciosVentaFactura({}); setMargenesFactura({}); setModosPrecioFactura({});
      setCodigosBarrasFactura({}); setCodigosInternosFactura({}); setVinculosFactura({});
      setCompraPreparadaIA(null); setBusquedasVinculoIA({}); setFiltroRevisionIA("todos");
      setFacturaIA({ ...resultado, referencia_borrador: `BORRADOR-${nuevaClave()}` });
      setRevisionFacturaAbierta(true);
      setCorreccionFacturaAbierta(true);
      setFacturaMensaje(`IA detectó ${resultado.items.length} ítem${resultado.items.length === 1 ? "" : "s"}. Revisá cantidades, costos y porcentajes. Guardar borrador no modifica stock ni precios del catálogo.`);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion && lecturaVersionRef.current === versionLectura) {
        setError(err instanceof Error ? err.message : "No se pudo analizar la factura.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion && lecturaVersionRef.current === versionLectura) {
        setFacturaProcesando(false);
        if (fotoRef.current) fotoRef.current.value = "";
        if (archivoRef.current) archivoRef.current.value = "";
      }
    }
  }

  function aplicarFacturaAnalizada() {
    if (!facturaIA || facturaAplicando || facturaProcesando) return;
    setRevisionFacturaAbierta(true);
    setError("");
    setCompraPreparadaIA(null);
    if (facturaIA.items.length === 0) { setError("Agregá al menos un producto. El borrador se conserva."); return; }
    if (!facturaIA.proveedor.razon_social?.trim() && !facturaIA.proveedor.cuit?.trim()) {
      setError("Completá o elegí el proveedor en la revisión antes de preparar. El borrador se conserva.");
      setCorreccionFacturaAbierta(true); return;
    }
    if (facturaIA.requiere_revision && !facturaIA.revision_confirmada) {
      setError("Confirmá la revisión del respaldo de lectura incierta antes de preparar."); return;
    }
    if (pendientesFactura.length > 0) {
      const detalle = pendientesFactura.map((pendiente) => `${pendiente.producto}: ${pendiente.motivos.join(" ")}`).join(" · ");
      setError(`NO SE PUEDE PREPARAR LA COMPRA. ${pendientesFactura.length} producto${pendientesFactura.length === 1 ? "" : "s"} pendiente${pendientesFactura.length === 1 ? "" : "s"}: ${detalle}`);
      irAlPrimerPendiente();
      return;
    }

    const cuitFactura = digitos(facturaIA.proveedor.cuit);
    const nombreProveedor = normalizar(facturaIA.proveedor.razon_social);
    const proveedor = (cuitFactura ? proveedores.find((p) => digitos(p.cuit) === cuitFactura) : undefined)
      ?? (nombreProveedor ? proveedores.find((p) => normalizar(p.razon_social) === nombreProveedor) : undefined);
    const items: ItemPreparadoIA[] = facturaIA.items.map((item, index) => {
      const existente = productoFactura(item, index);
      const costo = Number(item.costo_unitario);
      const precioRevisado = resolverPrecioCompra(costo, existente, margenesFactura[index], preciosVentaFactura[index], modosPrecioFactura[index]);
      return {
        index,
        productoId: existente?.id ?? null,
        nuevo: !existente,
        nombre: item.descripcion.trim(),
        codigoInterno: (codigosInternosFactura[index] ?? item.codigo ?? "").trim() || null,
        codigoBarras: (codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim() || null,
        cantidad: Number(item.cantidad),
        costoUnitario: costo,
        margenPorcentaje: precioRevisado.margen,
        precioVenta: precioRevisado.precio,
      };
    });
    const preparada: CompraPreparadaIA = {
      proveedorId: proveedor?.id ?? null,
      proveedorNombre: facturaIA.proveedor.razon_social?.trim() || "Proveedor pendiente de revisión",
      fecha: facturaIA.fecha,
      tipoComprobante: facturaIA.tipo_comprobante,
      numeroComprobante: facturaIA.numero_comprobante,
      referenciaBorrador: facturaIA.referencia_borrador ?? null,
      items,
    };
    setCompraPreparadaIA(preparada);
    if (proveedor) setProveedorId(proveedor.id);
    if (facturaIA.fecha && /^\d{4}-\d{2}-\d{2}$/.test(facturaIA.fecha)) setFecha(facturaIA.fecha);
    if (facturaIA.tipo_comprobante) setTipo(facturaIA.tipo_comprobante);
    setNumero(facturaIA.numero_comprobante ?? "");
    setOrigenCompra("ia");
    setFacturaMensaje(`✅ COMPRA PREPARADA / PENDIENTE DE CONFIRMACIÓN. ${items.filter((item) => !item.nuevo).length} producto${items.filter((item) => !item.nuevo).length === 1 ? "" : "s"} existente${items.filter((item) => !item.nuevo).length === 1 ? "" : "s"} y ${items.filter((item) => item.nuevo).length} producto${items.filter((item) => item.nuevo).length === 1 ? "" : "s"} nuevo${items.filter((item) => item.nuevo).length === 1 ? "" : "s"} pendiente${items.filter((item) => item.nuevo).length === 1 ? "" : "s"} de creación. No se modificó stock, costo, precio, productos ni compras.`);
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const empresaOperacion = empresaId;
    setSaving(true);
    setError("");
    setUltimaConciliacion(null);
    try {
      if (!proveedores.some((p) => p.id === proveedorId && p.empresa_id === empresaOperacion && p.activo)) {
        throw new Error("El proveedor seleccionado ya no está disponible en la empresa activa. Actualizá y volvé a seleccionar.");
      }
      const validas = lineas.filter((l) => l.producto_id && l.cantidad > 0 && l.costo_unitario >= 0);
      if (validas.length !== lineas.length) throw new Error("Completá correctamente todas las líneas de la compra.");
      const productoIds = validas.map((l) => l.producto_id);
      if (new Set(productoIds).size !== productoIds.length) {
        throw new Error("No repitas el mismo producto en una compra. Unificá la cantidad en una sola línea.");
      }

      const items = validas.map(({ producto_id, cantidad, costo_unitario }) => ({ producto_id, cantidad, costo_unitario }));
      const productosFrescos = await listarProductosSigo(empresaOperacion);
      if (empresaActivaRef.current !== empresaOperacion) return;
      const productosMap = new Map(productosFrescos.map((p) => [p.id, p]));
      for (const item of items) {
        if (!productosMap.has(item.producto_id)) {
          throw new Error("Uno de los productos ya no está disponible en la empresa activa. Actualizá la compra antes de confirmar.");
        }
      }
      const stockAntes = Object.fromEntries(
        items.map((item) => [item.producto_id, Number(productosMap.get(item.producto_id)?.stock_actual ?? 0)])
      );

      const compraId = await confirmarCompraSigo({
        empresaId: empresaOperacion,
        proveedorId,
        items,
        fecha,
        tipoComprobante: tipo,
        numeroComprobante: numero,
        idempotencyKey: idempotencyKeyRef.current,
        origen: origenCompra,
      });
      if (empresaActivaRef.current !== empresaOperacion) return;

      const resultado = await verificarCompraSigo({ empresaId: empresaOperacion, compraId, items, stockAntes });
      if (empresaActivaRef.current !== empresaOperacion) return;
      setUltimaConciliacion({ compraId, resultado });
      idempotencyKeyRef.current = nuevaClave();
      setLineas([nuevaLinea()]);
      setNumero("");
      setFacturaIA(null);
      setOrigenCompra("manual");
      setFacturaMensaje("");
      setPreciosVentaFactura({});
      await cargar(empresaOperacion);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo confirmar la compra");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setSaving(false);
    }
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Compras / Proveedores</h2>
          <p>Recepción tenant-safe: confirmar una compra actualiza stock y último costo en una sola transacción.</p>
        </div>
        <button className="admin-button" onClick={() => void cargar()} disabled={loading || saving || facturaProcesando || facturaAplicando}>Actualizar</button>
      </div>

      {error && <div className="panel"><p className="form-error" role="alert">{error}</p></div>}

      {ultimaConciliacion && (
        <div className="panel">
          <h3>Conciliación de la última compra</h3>
          <p><strong>Compra:</strong> {ultimaConciliacion.compraId}</p>
          <p><strong>Estado:</strong> {ultimaConciliacion.resultado.estado}</p>
          <p>{ultimaConciliacion.resultado.detalle}</p>
          <p style={{ marginBottom: 0 }}>
            {ultimaConciliacion.resultado.estado === "OK"
              ? "La recepción quedó verificada contra detalle, stock, último costo y preparación para venta."
              : "No repitas la compra: revisá el estado antes de volver a confirmar para evitar duplicados."}
          </p>
        </div>
      )}

      {(vista === "todo" || vista === "ia") && (<div className="panel compra-ia-review" style={{ border: "1px solid #bfdbfe", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="page-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>📷 Leer comprobante de compra con IA</h3>
            <p style={{ margin: 0 }}>Sacá una foto, elegí una imagen/PDF o pegá un mensaje. SIGO admite factura, ticket, remito, presupuesto, talonario X, nota manuscrita legible y mensajes del proveedor; lee proveedor, fecha, comprobante, productos, cantidades y costos. Revisás y elegís el porcentaje o precio de venta de cada producto, nuevo o existente; el stock se modifica recién cuando confirmás la compra.</p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>IA · revisión antes de stock</span>
          <p style={{ margin:"8px 0 0", fontWeight:800, color:"#92400e" }}>⚠️ Importante: cargá y revisá los comprobantes de a uno.</p>
        </div>
        <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <div className="form-actions" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="primary-button" disabled={facturaProcesando || facturaAplicando || saving} onClick={() => fotoRef.current?.click()}>{facturaProcesando ? "Analizando…" : "📸 Tomar foto de comprobante"}</button>
          <button type="button" className="admin-button" disabled={facturaProcesando || facturaAplicando || saving} onClick={() => archivoRef.current?.click()}>Elegir foto / PDF</button>
        </div>

        <div className="form-group" style={{ marginTop: 12 }}>
          <label htmlFor="texto-compra-ia">Pegar mensaje o detalle de compra</label>
          <textarea id="texto-compra-ia" rows={5} maxLength={30000} value={textoCompraIA} onChange={(e)=>setTextoCompraIA(e.target.value)} placeholder="Pegá el mensaje del proveedor con productos, cantidades y costos. También podés cargar una captura con Elegir foto / PDF." disabled={facturaProcesando || saving} />
          <button type="button" className="admin-button" disabled={!textoCompraIA.trim() || facturaProcesando || facturaAplicando || saving} onClick={()=>void leerFactura(textoCompraIA)}>LEER MENSAJE CON IA</button>
        </div>

        {facturaMensaje && <p style={{ fontWeight: 700, color: "#1e3a8a" }}>{facturaMensaje}</p>}

        <div className="form-actions" style={{justifyContent:"flex-start",marginTop:12,marginBottom:12}}>
          <button type="button" className="admin-button" disabled={!facturaIA || facturaProcesando} onClick={()=>setCorreccionFacturaAbierta(true)}>🔎 REVISAR / CORREGIR</button>
          <button type="button" className="primary-button" disabled={!facturaIA || facturaAplicando || facturaProcesando || saving} onClick={aplicarFacturaAnalizada}>🛒 PREPARAR COMPRA</button>
          <button type="button" className="admin-button danger-button" disabled={!facturaIA || facturaAplicando || facturaProcesando || saving} onClick={()=>{localStorage.removeItem(borradorKey);setFacturaIA(null);setRevisionFacturaAbierta(false);setCorreccionFacturaAbierta(false);setFacturaMensaje("");setPreciosVentaFactura({});setMargenesFactura({});setCodigosBarrasFactura({});setCodigosInternosFactura({});setVinculosFactura({});setCompraPreparadaIA(null);}}>❌ CANCELAR / DESCARTAR</button>
        </div>
        {facturaIA && (
          <div style={{ marginTop: 16 }}>
            <div className="form-grid">
              <div className="form-group"><label>Proveedor</label><input value={facturaIA.proveedor.razon_social ?? ""} placeholder="Completar proveedor" onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,proveedor:{...facturaIA.proveedor,razon_social:e.target.value || null}});}} /></div>
              <div className="form-group"><label>CUIT (opcional)</label><input value={facturaIA.proveedor.cuit ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,proveedor:{...facturaIA.proveedor,cuit:e.target.value || null}});}} /></div>
              <div className="form-group"><label>Tipo de respaldo</label><input value={facturaIA.tipo_comprobante ?? ""} placeholder="Factura, remito, presupuesto, mensaje…" onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,tipo_comprobante:e.target.value || null});}} /></div>
              <div className="form-group"><label>Número externo (si existe)</label><input value={facturaIA.numero_comprobante ?? ""} placeholder="Sin número: dejar vacío" onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,numero_comprobante:e.target.value.trim() || null});}} /><small>No inventes un número. La referencia del borrador no es un número de factura.</small></div>
              <div className="form-group"><label>Fecha del respaldo</label><input type="date" value={facturaIA.fecha ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,fecha:e.target.value || null});}} /></div>
              <div className="form-group"><label>Referencia del borrador</label><small>{facturaIA.referencia_borrador ?? "Borrador recuperado"}</small><small>Confianza de lectura: {Math.round(facturaIA.confianza_general * 100)}%</small></div>
            </div>
            {facturaIA.requiere_revision && <label className="compra-ia-check"><input type="checkbox" checked={Boolean(facturaIA.revision_confirmada)} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA({...facturaIA,revision_confirmada:e.target.checked});}} />Revisé el respaldo y los datos de lectura incierta.</label>}
            {facturaIA.advertencias.length > 0 && <div style={{marginTop:12}}>
              {facturaIA.advertencias.map((a,i)=><p key={i} style={{fontWeight:600}}>⚠️ {a}</p>)}
            </div>}
            <div className="form-actions" style={{justifyContent:"flex-start",marginTop:12}}><button type="button" className="admin-button" onClick={()=>setCorreccionFacturaAbierta((v)=>!v)}>🔎 {correccionFacturaAbierta ? "Cerrar corrección" : "REVISAR / CORREGIR"}</button><button type="button" className="primary-button" onClick={guardarBorradorIA}>💾 GUARDAR BORRADOR</button></div>
            {correccionFacturaAbierta && <div className="form-actions" style={{justifyContent:"flex-start",marginTop:10}}><button type="button" className="admin-button" onClick={()=>setFacturaIA((actual)=>actual?({...actual,items:[...actual.items,{descripcion:"Producto agregado manualmente",codigo:null,codigo_barras:null,cantidad:1,costo_unitario:0,total_linea:0,confianza:1}] as FacturaItemIA[]}):actual)}>➕ AGREGAR PRODUCTO FALTANTE</button></div>}
            <div className="panel" style={{marginTop:12}}>
              <strong>Centro de revisión</strong>
              <p style={{margin:"8px 0"}}>🟢 {facturaIA.items.length-pendientesFactura.length} listos · 🟡 {pendientesFactura.length} pendientes · 🔵 {facturaIA.items.filter((item,index)=>!productoFactura(item,index)).length} nuevos · 🔗 {facturaIA.items.filter((item,index)=>Boolean(vinculosFactura[index])).length} vinculados</p>
              <div className="form-actions" style={{justifyContent:"flex-start"}}>
                {(["todos","pendientes","nuevos","vinculados"] as const).map((f)=><button key={f} type="button" className={filtroRevisionIA===f?"primary-button":"admin-button"} onClick={()=>setFiltroRevisionIA(f)}>{f.toUpperCase()}</button>)}
              </div>
              <div className="form-actions" style={{justifyContent:"flex-start",marginTop:8}}>
                <label>Porcentaje sobre costo para todos<input type="text" inputMode="decimal" value={margenMasivoIA} onChange={e=>setMargenMasivoIA(e.target.value)} placeholder="Ej.: 60" aria-label="Porcentaje sobre costo para todos" /></label>
                <button type="button" className="admin-button" disabled={margenMasivoIA===""} onClick={()=>{const m=numeroCompra(margenMasivoIA);if(!Number.isFinite(m)||m<0)return;const precios={...preciosVentaFactura},margenes={...margenesFactura};facturaIA.items.forEach((item,index)=>{margenes[index]=String(m);precios[index]=String(Math.round(Number(item.costo_unitario||0)*(1+m/100)*100)/100);});setMargenesFactura(margenes);setPreciosVentaFactura(precios);setModosPrecioFactura(Object.fromEntries(facturaIA.items.map((_,index)=>[index,"margen" as const])));setCompraPreparadaIA(null);}}>APLICAR % A TODOS</button>
              </div>
            </div>
            {pendientesFactura.length > 0 && <div className="panel" role="alert" style={{marginTop:12,border:"1px solid #f59e0b",background:"#fffbeb"}}>
              <h4 style={{marginTop:0}}>⚠️ HAY PRODUCTOS PARA REVISAR ANTES DE PREPARAR</h4>
              <p>{pendientesFactura.length} producto{pendientesFactura.length === 1 ? "" : "s"} pendiente{pendientesFactura.length === 1 ? "" : "s"}:</p>
              {pendientesFactura.map((pendiente)=><p key={pendiente.index} style={{margin:"8px 0"}}><strong>{pendiente.producto}:</strong> {pendiente.motivos.join(" ")}</p>)}
              <button type="button" className="admin-button" onClick={irAlPrimerPendiente}>IR AL PRIMER PENDIENTE</button>
            </div>}
            <div className="table-wrapper compra-ia-table-wrapper" style={{ marginTop: 14 }}>
              <table className="products-table compra-ia-items">
                <thead><tr><th>Producto leído</th><th>Código</th><th>Cant.</th><th>Costo unit.</th><th>Precio venta</th><th>Confianza</th><th>Estado</th></tr></thead>
                <tbody>
                  {facturaIA.items.map((item, index) => {
                    const esPendiente = pendientesFactura.some((p)=>p.index===index);
                    const esNuevo = !productoFactura(item,index);
                    const esVinculado = Boolean(vinculosFactura[index]);
                    if ((filtroRevisionIA==="pendientes"&&!esPendiente)||(filtroRevisionIA==="nuevos"&&!esNuevo)||(filtroRevisionIA==="vinculados"&&!esVinculado)) return null;
                    const existente = productoFactura(item, index);
                    const precioExistente = Number(existente?.precio_venta ?? 0);
                    const costoAnterior = Number(existente?.costo_actual ?? existente?.costo_ultima_compra ?? 0);
                    const stockAnterior = Number(existente?.stock_actual ?? 0);
                    const precioRevisado = resolverPrecioCompra(item.costo_unitario, existente, margenesFactura[index], preciosVentaFactura[index], modosPrecioFactura[index]);
                    return (
                      <tr id={`factura-item-${index}`} key={index}>
                        <td>{correccionFacturaAbierta ? <input value={item.descripcion} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,descripcion:e.target.value}:x)}) : actual);}} aria-label={`Nombre para producto ${index + 1}`} /> : <strong>{item.descripcion}</strong>}<small style={{display:"block"}}>{existente ? `Stock: ${stockAnterior} → ${stockAnterior + item.cantidad}` : `Nuevo · ingresan ${item.cantidad} unidades`}</small></td>
                        <td>{existente ? (item.codigo_barras ?? item.codigo ?? "-") : <div style={{display:"grid",gap:6}}>
                          <strong style={{color:"#b45309"}}>⚠️ PRODUCTO NUEVO</strong>
                          <input value={busquedasVinculoIA[index] ?? ""} onChange={(e)=>setBusquedasVinculoIA(a=>({...a,[index]:e.target.value}))} placeholder="Buscar producto existente por nombre, código o EAN" />
                          {(busquedasVinculoIA[index] ?? "").trim() && <div style={{display:"grid",gap:4}}>{productos.filter((p)=>[p.nombre,p.codigo_interno,p.codigo_barras].filter(Boolean).some((v)=>normalizar(String(v)).includes(normalizar(busquedasVinculoIA[index])))).slice(0,8).map((p)=><button type="button" className="admin-button" key={p.id} onClick={()=>{setCompraPreparadaIA(null);setVinculosFactura(a=>({...a,[index]:p.id}));setBusquedasVinculoIA(a=>({...a,[index]:""}));}}>🔗 {p.nombre}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</button>)}</div>}
                          {vinculosFactura[index] && <small>✓ Vinculado a {productos.find((p)=>p.id===vinculosFactura[index])?.nombre}</small>}
                          <input value={codigosBarrasFactura[index] ?? item.codigo_barras ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setCodigosBarrasFactura(a=>({...a,[index]:e.target.value}));}} placeholder="Código de barras / EAN (recomendado)" aria-label={`Código de barras para ${item.descripcion}`} />
                          <input value={codigosInternosFactura[index] ?? item.codigo ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setCodigosInternosFactura(a=>({...a,[index]:e.target.value}));}} placeholder="Código interno (opcional)" aria-label={`Código interno para ${item.descripcion}`} />
                          {!((codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim()) && <small style={{color:"#b45309"}}>EAN opcional · podés continuar sin código de barras.</small>}
                        </div>}</td>
                        <td>{correccionFacturaAbierta ? <input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={(e)=>{const cantidad=Number(e.target.value);setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,cantidad,total_linea:cantidad*Number(x.costo_unitario)}:x)}) : actual);}} aria-label={`Cantidad para ${item.descripcion}`} /> : <strong>{item.cantidad}</strong>}<small style={{display:"block"}}>unidades vendibles</small></td>
                        <td><span style={{textDecoration:costoAnterior>0?"line-through":"none",opacity:.65}}>{costoAnterior>0?`$ ${costoAnterior.toLocaleString("es-AR",{minimumFractionDigits:2})}`:""}</span>{correccionFacturaAbierta ? <input type="number" min="0" step="0.01" value={item.costo_unitario} onChange={(e)=>{const costo=Number(e.target.value);setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,costo_unitario:costo,total_linea:Number(x.cantidad)*costo}:x)}) : actual);const calculo=resolverPrecioCompra(costo,existente,margenesFactura[index],preciosVentaFactura[index],modosPrecioFactura[index]);setMargenesFactura((actual)=>({...actual,[index]:textoNumeroCompra(calculo.margen)}));setPreciosVentaFactura((actual)=>({...actual,[index]:textoNumeroCompra(calculo.precio)}));}} aria-label={`Costo unitario para ${item.descripcion}`} /> : <strong style={{display:"block"}}>→ $ {item.costo_unitario.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>}<small style={{display:"block"}}>Total línea: $ {(item.total_linea ?? item.cantidad*item.costo_unitario).toLocaleString("es-AR",{minimumFractionDigits:2})}</small></td>
                        <td>
                          <div className="compra-ia-precio">
                            {existente && <small>Precio anterior: $ {precioExistente.toLocaleString("es-AR",{minimumFractionDigits:2})}</small>}
                            <label>Porcentaje sobre costo
                              <input type="text" inputMode="decimal" value={margenesFactura[index] ?? textoNumeroCompra(precioRevisado.margen)} onChange={(e)=>{const m=e.target.value;setCompraPreparadaIA(null);setModosPrecioFactura(a=>({...a,[index]:"margen"}));setMargenesFactura(a=>({...a,[index]:m}));const calculo=resolverPrecioCompra(item.costo_unitario,existente,m,undefined,"margen");setPreciosVentaFactura(a=>({...a,[index]:textoNumeroCompra(calculo.precio)}));}} placeholder="Ej.: 40" aria-label={`Margen para ${item.descripcion}`} />
                            </label>
                            <label>Precio de venta por unidad
                              <input type="text" inputMode="decimal" value={preciosVentaFactura[index] ?? textoNumeroCompra(precioRevisado.precio)} onChange={(e)=>{const precio=e.target.value;setCompraPreparadaIA(null);setModosPrecioFactura(a=>({...a,[index]:"precio"}));setPreciosVentaFactura(a=>({...a,[index]:precio}));const calculo=resolverPrecioCompra(item.costo_unitario,existente,undefined,precio,"precio");setMargenesFactura(a=>({...a,[index]:textoNumeroCompra(calculo.margen)}));}} placeholder="Precio al público" aria-label={`Precio de venta para ${item.descripcion}`} />
                            </label>
                            <small>{modosPrecioFactura[index] === "precio" ? "Precio manual: se mantiene si corregís el costo." : "Se recalcula con el porcentaje elegido si corregís el costo."}</small>
                          </div>
                        </td>
                        <td>{Math.round(item.confianza * 100)}%{item.requiere_revision && <label className="compra-ia-check"><input type="checkbox" checked={Boolean(item.revisado)} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA((actual)=>actual?({...actual,items:actual.items.map((x,i)=>i===index?{...x,revisado:e.target.checked}:x)}):actual);}} />Verifiqué cantidad, costo y presentación.</label>}</td>
                        <td>{existente ? `Existente: ${existente.nombre}` : "NUEVO · se creará recién al confirmar"}<button type="button" className="admin-button" onClick={()=>descartarItemFactura(index)}>Descartar esta línea</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preciosFacturaPendientes > 0 && (
              <p className="form-error" role="alert" style={{ marginTop: 10 }}>
                Falta definir precio de venta para {preciosFacturaPendientes} producto{preciosFacturaPendientes === 1 ? "" : "s"} nuevo{preciosFacturaPendientes === 1 ? "" : "s"}. SIGO no los creará sin precio.
              </p>
            )}
            {compraPreparadaIA && <div className="panel" style={{marginTop:12,border:"1px solid #16a34a",background:"#f0fdf4"}}>
              <h4 style={{marginTop:0}}>✅ COMPRA PREPARADA / PENDIENTE DE CONFIRMACIÓN</h4>
              <p><strong>Proveedor:</strong> {compraPreparadaIA.proveedorNombre}</p>
              <p><strong>Comprobante:</strong> {compraPreparadaIA.tipoComprobante ?? "Comprobante"} {compraPreparadaIA.numeroComprobante ?? ""}</p>
              <p><strong>Productos:</strong> {compraPreparadaIA.items.length} · Nuevos pendientes de creación: {compraPreparadaIA.items.filter((item)=>item.nuevo).length}</p>
              <p style={{marginBottom:0}}>No se modificó stock, costo, precio, productos ni compras. Los cambios definitivos quedan reservados para “Confirmar compra e ingresar stock”.</p>
            </div>}
            <div className="form-actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="primary-button" disabled={facturaAplicando || facturaProcesando || saving} onClick={aplicarFacturaAnalizada}>{facturaAplicando ? "Preparando compra…" : "🛒 PREPARAR COMPRA"}</button>
              <button type="button" className="admin-button" disabled={facturaAplicando || facturaProcesando || saving} onClick={() => { localStorage.removeItem(borradorKey); setFacturaIA(null); setRevisionFacturaAbierta(false); setFacturaMensaje(""); setPreciosVentaFactura({}); setMargenesFactura({}); setCodigosBarrasFactura({}); setCodigosInternosFactura({}); setVinculosFactura({}); setCompraPreparadaIA(null); }}>❌ CANCELAR / DESCARTAR</button>
            </div>
          </div>
        )}
      </div>
)}
      
      {(vista === "todo" || vista === "manual") && <><div className="panel">
        <h3>Alta rápida de proveedor</h3>
        <div className="form-grid">
          <div className="form-group"><label>Razón social</label><input value={nuevoProveedor} onChange={(e) => setNuevoProveedor(e.target.value)} placeholder="Proveedor" /></div>
          <div className="form-group"><label>CUIT</label><input value={nuevoCuit} onChange={(e) => setNuevoCuit(e.target.value)} placeholder="Opcional" /></div>
        </div>
        <div className="form-actions"><button type="button" className="admin-button" disabled={saving || !nuevoProveedor.trim()} onClick={() => void crearProveedor()}>Crear proveedor</button></div>
      </div>

      <form className="panel" onSubmit={(e) => void confirmar(e)}>
        <h3>Nueva compra</h3>
        <div className="form-grid">
          <div className="form-group"><label>Proveedor *</label><select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required><option value="">Seleccionar</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}</select></div>
          <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="form-group"><label>Tipo</label><input value={tipo} onChange={(e) => setTipo(e.target.value)} /></div>
          <div className="form-group"><label>Nº comprobante</label><input value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h4 style={{ marginBottom: 6 }}>Escanear mercadería</h4>
          <p style={{ marginTop: 0 }}>Pistola, ingreso manual o cámara: cada lectura agrega una unidad del producto a esta compra. Si ya estaba agregado, incrementa la cantidad.</p>
          <div style={{position:"relative"}}>
            <BarcodeScanner empresaId={empresaId} action="ingresar" onProduct={agregarProductoEscaneado} onQueryChange={setBusquedaManual} />
            {busquedaManual.trim() && resultadosBusquedaManual.length > 0 && (
              <div className="panel" style={{position:"absolute",zIndex:30,left:0,right:0,top:"100%",marginTop:4,maxHeight:320,overflowY:"auto",padding:6}}>
                {resultadosBusquedaManual.map((p) => (
                  <button key={p.id} type="button" className="admin-button" style={{display:"flex",width:"100%",justifyContent:"space-between",marginBottom:4,textAlign:"left"}} onMouseDown={(e)=>e.preventDefault()} onClick={()=>seleccionarBusquedaManual(p)}>
                    <strong>{p.nombre}</strong><span>{p.codigo_barras || p.codigo_interno || ""}</span>
                  </button>
                ))}
              </div>
            )}
            {busquedaManual.trim() && resultadosBusquedaManual.length === 0 && <div style={{marginTop:6}}><small>Sin coincidencias por nombre o código.</small> <button type="button" className="admin-button" onClick={()=>{setAltaManualAbierta(true);setNuevoProductoManual((v)=>({...v,nombre:busquedaManual}));}}>➕ CREAR PRODUCTO NUEVO</button></div>}
            {altaManualAbierta && <div className="panel" style={{marginTop:10}}><h4>Nuevo producto</h4><div className="form-grid"><div className="form-group"><label>Nombre</label><input value={nuevoProductoManual.nombre} onChange={e=>setNuevoProductoManual(v=>({...v,nombre:e.target.value}))}/></div><div className="form-group"><label>Código / EAN</label><input value={nuevoProductoManual.codigo} onChange={e=>setNuevoProductoManual(v=>({...v,codigo:e.target.value}))}/></div><div className="form-group"><label>Costo</label><input type="number" value={nuevoProductoManual.costo} onChange={e=>setNuevoProductoManual(v=>({...v,costo:e.target.value}))}/></div><div className="form-group"><label>% margen</label><input type="number" value={nuevoProductoManual.margen} onChange={e=>{const margen=e.target.value,costo=Number(nuevoProductoManual.costo||0);setNuevoProductoManual(v=>({...v,margen,precio:costo?String(Math.round(costo*(1+Number(margen)/100)*100)/100):v.precio}));}}/></div><div className="form-group"><label>Precio al público</label><input type="number" value={nuevoProductoManual.precio} onChange={e=>setNuevoProductoManual(v=>({...v,precio:e.target.value}))}/></div></div><div className="form-actions"><button type="button" className="primary-button" disabled={saving} onClick={crearProductoManual}>Crear y agregar</button><button type="button" className="admin-button" onClick={()=>setAltaManualAbierta(false)}>Cancelar</button></div></div>}
          </div>
        </div>

        <div className="table-wrapper" style={{ marginTop: 18 }}>
          <table className="products-table">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>% margen</th><th>Precio al público</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.key}>
                  <td><select value={l.producto_id} onChange={(e) => { const p = productos.find((x) => x.id === e.target.value); const costo = Number(p?.costo_actual ?? p?.costo_ultima_compra ?? 0); const precio = Number(p?.precio_venta ?? 0); const margen = Number(p?.margen_porcentaje ?? (costo > 0 && precio > 0 ? ((precio-costo)/costo)*100 : 0)); editarLinea(l.key, { producto_id: e.target.value, costo_unitario: costo, margen_porcentaje: margen, precio_venta: precio }); }} required><option value="">Seleccionar producto</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></td>
                  <td><input type="number" min="0.001" step="0.001" value={l.cantidad} onChange={(e) => editarLinea(l.key, { cantidad: Number(e.target.value) })} /></td>
                  <td><input type="number" min="0" step="0.01" value={l.costo_unitario || ""} onFocus={(e) => e.currentTarget.select()} onChange={(e) => editarLinea(l.key, { costo_unitario: e.target.value === "" ? 0 : Number(e.target.value) })} /></td>
                  <td><input type="number" step="0.01" value={l.margen_porcentaje ?? 0} onChange={(e) => { const margen=Number(e.target.value); editarLinea(l.key,{margen_porcentaje:margen,precio_venta:Math.round(l.costo_unitario*(1+margen/100)*100)/100}); }} /></td><td><input type="number" min="0" step="0.01" value={l.precio_venta || ""} onChange={(e) => { const precio=e.target.value===""?0:Number(e.target.value); editarLinea(l.key,{precio_venta:precio,margen_porcentaje:l.costo_unitario>0?((precio-l.costo_unitario)/l.costo_unitario)*100:0}); }} /></td><td>$ {(l.cantidad * l.costo_unitario).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                  <td><button type="button" className="admin-button danger-button" disabled={lineas.length === 1} onClick={() => setLineas((actual) => actual.filter((x) => x.key !== l.key))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="page-header" style={{ marginTop: 16 }}>
          <button type="button" className="admin-button" onClick={() => setLineas((actual) => [...actual, nuevaLinea()])}>+ Agregar producto</button>
          <div><strong>Total compra: $ {total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong></div>
        </div>
        {cambiosPrecio.length > 0 && <div className="panel" style={{marginTop:16}}>
          <h4>Precios que se actualizarán al confirmar</h4>
          {cambiosPrecio.map((x) => <p key={x.id} style={{margin:"8px 0"}}><strong>{x.nombre}</strong>: costo $ {x.costoAnterior.toLocaleString("es-AR")} → $ {x.costoNuevo.toLocaleString("es-AR")} · precio $ {x.precioAnterior.toLocaleString("es-AR")} → $ {x.precioNuevo.toLocaleString("es-AR")} · margen {x.margen.toFixed(2)}%</p>)}
        </div>}
        <div className="form-actions"><button type="submit" className="primary-button" disabled={saving || loading || facturaAplicando || !compraValida}>{saving ? "Confirmando…" : "Confirmar compra e ingresar stock"}</button></div>
      </form>

      </>}
      {(vista === "todo" || vista === "historial") && (<div className="panel">
        <h3>Últimas compras</h3>
        {loading ? <p>Cargando…</p> : compras.length === 0 ? <p>Sin compras confirmadas.</p> : (
          <div className="table-wrapper">
            <table className="products-table">
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Origen</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {compras.map((compra) => (
                  <tr key={compra.id}>
                    <td>{compra.fecha_compra}</td>
                    <td>{proveedorMap.get(compra.proveedor_id) ?? "Proveedor"}</td>
                    <td>{[compra.tipo_comprobante, compra.numero_comprobante].filter(Boolean).join(" ") || "-"}</td>
                    <td>$ {Number(compra.total ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                    <td>{compra.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>)}
      
    </div>
  );
}
