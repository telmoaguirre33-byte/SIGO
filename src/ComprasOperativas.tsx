import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import BarcodeScanner from "./BarcodeScanner";
import GuardarCompraIA from "./GuardarCompraIA";
import { supabase } from "./supabase";
/* compra-ia-guardar-atomico-v1 */
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

type BorradorCompraSigo = { id:string; empresa_id:string; documento:{facturaIA:FacturaCompraIA;preciosVentaFactura:Record<number,string>;margenesFactura:Record<number,string>;codigosBarrasFactura:Record<number,string>;codigosInternosFactura:Record<number,string>;vinculosFactura:Record<number,string>;idempotencyKey:string;imagenDataUrl?:string|null};estado:string;compra_id?:string|null;created_at:string };

export default function ComprasOperativas({ empresaId, vista = "todo", onCambiarVista }: { empresaId: string; vista?: "todo" | "manual" | "ia" | "historial"; onCambiarVista?:(vista:"menu"|"manual"|"ia"|"historial")=>void }) {
  const [proveedores, setProveedores] = useState<ProveedorSigo[]>([]);
  const [compras, setCompras] = useState<CompraSigo[]>([]);
  const [borradoresServidor,setBorradoresServidor]=useState<BorradorCompraSigo[]>([]);
  const [borradorServidorId,setBorradorServidorId]=useState<string|null>(null);
  const [guardandoBorradorServidor,setGuardandoBorradorServidor]=useState(false);
  const [detalleCompra,setDetalleCompra]=useState<{compra:CompraSigo;titulo:string;items:{productoId:string;nombre:string;codigo:string;cantidad:number;costo:number}[]}|null>(null);
  const [edicionCompra,setEdicionCompra]=useState<{proveedorId:string;fecha:string;tipo:string;numero:string;items:{productoId:string;cantidad:string;costo:string}[]}|null>(null);
  const [guardandoHistorial,setGuardandoHistorial]=useState(false);
  const [imagenHistorial,setImagenHistorial]=useState<string|null>(null);
  const [mensajeWhatsApp,setMensajeWhatsApp]=useState("");
  const [margenGeneral,setMargenGeneral]=useState("");
  const [precioGeneral,setPrecioGeneral]=useState("");
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
  const [imagenDataUrl,setImagenDataUrl]=useState<string|null>(null);
  const [facturaProcesando, setFacturaProcesando] = useState(false);
  const [facturaAplicando, setFacturaAplicando] = useState(false);
  const [guardadoPendienteIA, setGuardadoPendienteIA] = useState(false);
  const [facturaMensaje, setFacturaMensaje] = useState("");
  const [preciosVentaFactura, setPreciosVentaFactura] = useState<Record<number, string>>({});
  const [margenesFactura, setMargenesFactura] = useState<Record<number, string>>({});
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
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const archivoRef = useRef<HTMLInputElement | null>(null);
  const adjuntoRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef(nuevaClave());
  const empresaActivaRef = useRef(empresaId);
  const borradorCargadoRef = useRef(false);
  const borradorKey = `sigo:compra-ia:borrador:${empresaId}`;

  async function cargar(targetEmpresaId = empresaId) {
    setLoading(true);
    setError("");
    try {
      const [ps, cs, prods, borradores] = await Promise.all([
        listarProveedoresSigo(targetEmpresaId),
        listarComprasSigo(targetEmpresaId),
        listarProductosSigo(targetEmpresaId),
        supabase.from("compra_borradores_sigo").select("id,empresa_id,documento,estado,created_at").eq("empresa_id",targetEmpresaId).in("estado",["pendiente","confirmado"]).order("created_at",{ascending:false}).limit(50),
      ]);
      if(borradores.error)throw borradores.error;
      if (empresaActivaRef.current !== targetEmpresaId) return;
      setProveedores(ps);
      setCompras(cs);
      setBorradoresServidor((borradores.data??[]) as BorradorCompraSigo[]);
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
    idempotencyKeyRef.current = nuevaClave();
    setProveedores([]);
    setCompras([]);
    setBorradoresServidor([]);
    setBorradorServidorId(null);
    setProductos([]);
    setProveedorId("");
    setFecha(new Date().toISOString().slice(0, 10));
    setTipo("Factura");
    setNumero("");
    setLineas([nuevaLinea()]);
    setNuevoProveedor("");
    setNuevoCuit("");
    setUltimaConciliacion(null);
    setFacturaAplicando(false);
    setGuardadoPendienteIA(false);
    borradorCargadoRef.current = false;
    let restaurado = false;
    try {
      const raw = localStorage.getItem(`sigo:compra-ia:borrador:${empresaId}`);
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.facturaIA) {
          idempotencyKeyRef.current = typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey : nuevaClave();
          setFacturaIA(b.facturaIA);setImagenDataUrl(b.imagenDataUrl??null); setFacturaMensaje("📄 Compra IA en preparación recuperada.");
          setPreciosVentaFactura(b.preciosVentaFactura ?? {}); setMargenesFactura(b.margenesFactura ?? {});
          setCodigosBarrasFactura(b.codigosBarrasFactura ?? {}); setCodigosInternosFactura(b.codigosInternosFactura ?? {});
          setVinculosFactura(b.vinculosFactura ?? {}); setCompraPreparadaIA(b.compraPreparadaIA ?? null); setRevisionFacturaAbierta(true);
          restaurado = true;
        }
      }
    } catch { localStorage.removeItem(`sigo:compra-ia:borrador:${empresaId}`); }
    if (!restaurado) { setFacturaIA(null);setImagenDataUrl(null); setFacturaMensaje(""); setPreciosVentaFactura({}); setMargenesFactura({}); setCodigosBarrasFactura({}); setCodigosInternosFactura({}); setVinculosFactura({}); setCompraPreparadaIA(null); }
    borradorCargadoRef.current = true;
    setError("");
    void cargar(empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  useEffect(() => {
    if (!borradorCargadoRef.current || typeof localStorage === "undefined") return;
    if (!facturaIA) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(borradorKey, JSON.stringify({facturaIA,imagenDataUrl,preciosVentaFactura,margenesFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA,idempotencyKey:idempotencyKeyRef.current,guardadoEn:new Date().toISOString()}));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [borradorKey,facturaIA,imagenDataUrl,preciosVentaFactura,margenesFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA]);

  function guardarBorradorIA() {
    if (!facturaIA) return;
    localStorage.setItem(borradorKey, JSON.stringify({facturaIA,imagenDataUrl,preciosVentaFactura,margenesFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,compraPreparadaIA,idempotencyKey:idempotencyKeyRef.current,guardadoEn:new Date().toISOString()}));
    setFacturaMensaje("💾 Borrador guardado. Podés salir y continuar después sin perder la revisión.");
    setCorreccionFacturaAbierta(false);
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
      if (!existente) {
        const precio = Number(preciosVentaFactura[index]);
        const margen = Number(margenesFactura[index]);
        if (!Number.isFinite(precio) || precio <= 0) motivos.push("Falta un precio al público válido.");
        if (!Number.isFinite(margen) || margen < 0) motivos.push("Falta un margen de ganancia válido.");
      }
      if (item.total_linea != null && Number.isFinite(Number(item.total_linea)) && cantidad > 0 && costo > 0) {
        const calculado = cantidad * costo;
        const diferencia = Math.abs(Number(item.total_linea) - calculado);
        if (diferencia > Math.max(10, calculado * 0.15)) motivos.push("Cantidad × costo no coincide con el total de línea leído.");
      }
      return motivos.length ? [{ index, producto: nombre || `Producto ${index + 1}`, motivos }] : [];
    });
  }, [facturaIA, productos, vinculosFactura, codigosBarrasFactura, codigosInternosFactura, preciosVentaFactura, margenesFactura]);

  const preciosFacturaPendientes = pendientesFactura.filter((p) => p.motivos.some((m) => m.includes("precio al público"))).length;

  function irAlPrimerPendiente() {
    const primero = pendientesFactura[0];
    if (!primero) return;
    setCorreccionFacturaAbierta(true);
    window.setTimeout(() => document.getElementById(`factura-item-${primero.index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
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

  async function leerFactura(file?: File | null) {
    if (!file || facturaProcesando || facturaAplicando) return;
    const empresaOperacion = empresaId;
    setFacturaProcesando(true);
    setFacturaIA(null);
    setImagenDataUrl(null);
    setFacturaMensaje("");
    setPreciosVentaFactura({});
    setMargenesFactura({});
    setCodigosBarrasFactura({});
    setCodigosInternosFactura({});
    setVinculosFactura({});
    setCompraPreparadaIA(null);
    setError("");
    try {
      const resultado = await analizarFacturaCompraSigo(empresaOperacion, file);
      if (empresaActivaRef.current !== empresaOperacion) return;
      idempotencyKeyRef.current = nuevaClave();
      setBorradorServidorId(null);
      setFacturaIA(resultado);
      if(file.type.startsWith("image/") && file.size<600000){const reader=new FileReader();reader.onload=()=>setImagenDataUrl(String(reader.result));reader.readAsDataURL(file);}else setImagenDataUrl(null);
      setRevisionFacturaAbierta(true);
      setCorreccionFacturaAbierta(false);
      setFacturaMensaje(`IA detectó ${resultado.items.length} ítem${resultado.items.length === 1 ? "" : "s"}. Revisá y definí precio de venta para cada producto nuevo antes de aplicar la factura.`);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo analizar la factura.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setFacturaProcesando(false);
      if (fotoRef.current) fotoRef.current.value = "";
      if (archivoRef.current) archivoRef.current.value = "";
    }
  }

  async function leerMensaje() {
    if(!mensajeWhatsApp.trim()||facturaProcesando||guardadoPendienteIA)return;
    setFacturaProcesando(true);setError("");
    try{
      const resultado=await analizarFacturaCompraSigo(empresaId,mensajeWhatsApp.trim());
      idempotencyKeyRef.current=nuevaClave();setBorradorServidorId(null);setImagenDataUrl(null);setFacturaIA(resultado);setCompraPreparadaIA(null);
      setPreciosVentaFactura({});setMargenesFactura({});setCodigosBarrasFactura({});setCodigosInternosFactura({});setVinculosFactura({});
      setRevisionFacturaAbierta(true);setCorreccionFacturaAbierta(true);
      setFacturaMensaje("Mensaje analizado. Revisá artículos y precios; guardá la compra al final.");
    }catch(err){setError(err instanceof Error?err.message:"No se pudo analizar el mensaje.");}
    finally{setFacturaProcesando(false);}
  }

  async function abrirCompra(compra:CompraSigo,accion?:"modificar"|"anular"){
    setError("");
    const {data,error:detalleError}=await supabase.from("compra_items_sigo")
      .select("producto_id,cantidad,costo_unitario,productos(nombre,codigo_interno,codigo_barras)")
      .eq("empresa_id",empresaId).eq("compra_id",compra.id);
    if(detalleError){setError(detalleError.message);return;}
    setEdicionCompra(accion==="modificar"?{proveedorId:compra.proveedor_id,fecha:compra.fecha_compra,tipo:compra.tipo_comprobante??"",numero:compra.numero_comprobante??"",
      items:(data??[]).map(fila=>({productoId:fila.producto_id,cantidad:String(fila.cantidad),costo:String(fila.costo_unitario)}))}:null);
    setDetalleCompra({compra,titulo:`${compra.tipo_comprobante??"Compra"} ${compra.numero_comprobante??""}`,
      items:(data??[]).map(fila=>{const p=Array.isArray(fila.productos)?fila.productos[0]:fila.productos;
        return {productoId:fila.producto_id,nombre:p?.nombre??"Producto",codigo:p?.codigo_interno||p?.codigo_barras||"—",cantidad:Number(fila.cantidad),costo:Number(fila.costo_unitario)};})});

  }

  function iniciarEdicionCompra(){
    if(!detalleCompra || detalleCompra.compra.estado!=="confirmada")return;
    const c=detalleCompra.compra;
    setEdicionCompra({proveedorId:c.proveedor_id,fecha:c.fecha_compra,tipo:c.tipo_comprobante??"",numero:c.numero_comprobante??"",
      items:detalleCompra.items.map(x=>({productoId:x.productoId,cantidad:String(x.cantidad),costo:String(x.costo)}))});
  }

  async function cambiarCompraHistorial(accion:"modificar"|"anular"){
    if(!detalleCompra || guardandoHistorial)return;
    if(accion==="anular" && !window.confirm("¿Anular esta compra? SIGO descontará del stock las unidades ingresadas por ella y conservará el comprobante como anulado en el historial."))return;
    if(accion==="modificar" && !edicionCompra)return;
    setGuardandoHistorial(true);setError("");
    try{
      const items=accion==="modificar"?edicionCompra!.items.map(x=>({producto_id:x.productoId,cantidad:Number(x.cantidad),costo_unitario:Number(x.costo)})):null;
      if(items && (items.length===0 || items.some(x=>!x.producto_id || !Number.isFinite(x.cantidad) || x.cantidad<=0 || !Number.isFinite(x.costo_unitario) || x.costo_unitario<0)))throw new Error("Revisá productos, cantidades y costos de la compra.");
      const {error:rpcError}=await supabase.rpc("cambiar_compra_sigo",{p_empresa_id:empresaId,p_compra_id:detalleCompra.compra.id,p_accion:accion,
        p_proveedor_id:accion==="modificar"?edicionCompra!.proveedorId:null,p_fecha:accion==="modificar"?edicionCompra!.fecha:null,
        p_tipo:accion==="modificar"?edicionCompra!.tipo:null,p_numero:accion==="modificar"?edicionCompra!.numero:null,p_items:items});
      if(rpcError)throw new Error(rpcError.message.includes("STOCK_INSUFFICIENT_TO_REVERSE")?"No se puede descontar el stock de esta compra: parte de la mercadería ya se vendió. Revisá el inventario antes de anularla.":rpcError.message);
      setDetalleCompra(null);setEdicionCompra(null);await cargar();
    }catch(err){setError(err instanceof Error?err.message:"No se pudo actualizar la compra.");}
    finally{setGuardandoHistorial(false);}
  }

  async function guardarEnHistorialPendiente(){
    if(!facturaIA || guardandoBorradorServidor)return;
    setGuardandoBorradorServidor(true);setError("");
    try{
      const documento={facturaIA,imagenDataUrl,preciosVentaFactura,margenesFactura,codigosBarrasFactura,codigosInternosFactura,vinculosFactura,idempotencyKey:idempotencyKeyRef.current};
      const valores={empresa_id:empresaId,documento,estado:"pendiente"};
      const q=borradorServidorId
        ?supabase.from("compra_borradores_sigo").update({documento,updated_at:new Date().toISOString()}).eq("id",borradorServidorId).eq("empresa_id",empresaId).select("id").single()
        :supabase.from("compra_borradores_sigo").insert({...valores,created_by:(await supabase.auth.getUser()).data.user?.id}).select("id").single();
      const {data,error:saveError}=await q;
      if(saveError || !data?.id)throw saveError??new Error("No se pudo registrar el borrador.");
      setBorradorServidorId(data.id);setFacturaMensaje("📋 Comprobante registrado como pendiente en el historial. No se ingresó stock.");
      await cargar();
    }catch(err){setError(err instanceof Error?err.message:"No se pudo guardar pendiente.");}
    finally{setGuardandoBorradorServidor(false);}
  }

  function abrirBorradorServidor(b:BorradorCompraSigo){
    const d=b.documento;
    idempotencyKeyRef.current=d.idempotencyKey||nuevaClave();
    setFacturaIA(d.facturaIA);setImagenDataUrl(d.imagenDataUrl??null);setPreciosVentaFactura(d.preciosVentaFactura??{});setMargenesFactura(d.margenesFactura??{});
    setCodigosBarrasFactura(d.codigosBarrasFactura??{});setCodigosInternosFactura(d.codigosInternosFactura??{});
    setVinculosFactura(d.vinculosFactura??{});setCompraPreparadaIA(null);setBorradorServidorId(b.id);
    setRevisionFacturaAbierta(true);setCorreccionFacturaAbierta(true);setFacturaMensaje("📋 Compra pendiente recuperada del historial. Corregila y guardá cuando corresponda.");
    onCambiarVista?.("ia");
  }

  async function descartarBorradorServidor(b:BorradorCompraSigo){
    if(!window.confirm("¿Eliminar este borrador pendiente? No ingresó stock y quedará marcado como descartado."))return;
    const {error:discardError}=await supabase.from("compra_borradores_sigo").update({estado:"descartado",updated_at:new Date().toISOString()}).eq("empresa_id",empresaId).eq("id",b.id);
    if(discardError)setError(discardError.message);else{if(borradorServidorId===b.id)setBorradorServidorId(null);await cargar();}
  }

  function aplicarFacturaAnalizada() {
    if (!facturaIA || facturaAplicando || facturaProcesando) return;
    setRevisionFacturaAbierta(true);
    setError("");
    setCompraPreparadaIA(null);
    if (!facturaIA.proveedor.razon_social?.trim() || /^(proveedor sin identificar|proveedor pendiente de revisión|no le[ií]do)$/i.test(facturaIA.proveedor.razon_social.trim())) {
      setError("Completá el nombre real del proveedor en Revisar / Corregir antes de preparar esta compra.");
      setCorreccionFacturaAbierta(true);
      return;
    }
    if (!facturaIA.fecha) {
      setError("Completá la fecha del comprobante en Revisar / Corregir antes de preparar esta compra.");
      setCorreccionFacturaAbierta(true);
      return;
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
      const precioExistente = Number(existente?.precio_venta ?? 0);
      const margenExistente = Number(existente?.margen_porcentaje ?? (costo > 0 && precioExistente > 0 ? ((precioExistente - costo) / costo) * 100 : 0));
      return {
        index,
        productoId: existente?.id ?? null,
        nuevo: !existente,
        nombre: item.descripcion.trim(),
        codigoInterno: existente?.codigo_interno ?? ((codigosInternosFactura[index] ?? item.codigo ?? "").trim() || null),
        codigoBarras: existente?.codigo_barras ?? ((codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim() || null),
        cantidad: Number(item.cantidad),
        costoUnitario: costo,
        margenPorcentaje: existente && !preciosVentaFactura[index] ? margenExistente : Number(margenesFactura[index]),
        precioVenta: existente && !preciosVentaFactura[index] ? precioExistente : Number(preciosVentaFactura[index]),
      };
    });
    const preparada: CompraPreparadaIA = {
      proveedorId: proveedor?.id ?? null,
      proveedorNombre: facturaIA.proveedor.razon_social?.trim() || "Proveedor pendiente de revisión",
      fecha: facturaIA.fecha,
      tipoComprobante: facturaIA.tipo_comprobante,
      numeroComprobante: facturaIA.numero_comprobante,
      items,
    };
    setCompraPreparadaIA(preparada);
    if (proveedor) setProveedorId(proveedor.id);
    if (facturaIA.fecha && /^\d{4}-\d{2}-\d{2}$/.test(facturaIA.fecha)) setFecha(facturaIA.fecha);
    if (facturaIA.tipo_comprobante) setTipo(facturaIA.tipo_comprobante);
    if (facturaIA.numero_comprobante) setNumero(facturaIA.numero_comprobante);
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

      {(vista === "todo" || vista === "ia") && (<div className="panel" style={{ border: "1px solid #bfdbfe", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="page-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>📷 Leer comprobante de compra con IA</h3>
            <p style={{ margin: 0 }}>Sacá una foto o elegí una imagen/PDF. SIGO admite factura, ticket, remito, nota de pedido, orden de compra, talonario X y otros comprobantes de compra/recepción; lee proveedor, fecha, comprobante, productos, cantidades y costos. Si un producto no existe, definís su precio de venta antes de crearlo; el stock se modifica recién cuando confirmás la compra.</p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>IA · revisión antes de stock</span>
          <p style={{ margin:"8px 0 0", fontWeight:800, color:"#92400e" }}>⚠️ Importante: cargá y revisá los comprobantes de a uno.</p>
        </div>
        <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <div className="form-actions" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="primary-button" disabled={facturaProcesando || facturaAplicando || saving || guardadoPendienteIA} onClick={() => fotoRef.current?.click()}>{facturaProcesando ? "Analizando…" : "📸 Tomar foto de comprobante"}</button>
          <button type="button" className="admin-button" disabled={facturaProcesando || facturaAplicando || saving || guardadoPendienteIA} onClick={() => archivoRef.current?.click()}>Elegir foto / PDF</button>
        </div>

        <div className="form-group"><label>Mensaje de WhatsApp o texto de compra</label><textarea rows={4} value={mensajeWhatsApp} onChange={e=>setMensajeWhatsApp(e.target.value)} placeholder="Pegá productos, cantidades y costos"/><button type="button" className="admin-button" disabled={facturaProcesando||guardadoPendienteIA||!mensajeWhatsApp.trim()} onClick={()=>void leerMensaje()}>Analizar mensaje</button></div>

        {facturaMensaje && <p style={{ fontWeight: 700, color: "#1e3a8a" }}>{facturaMensaje}</p>}

        <div className="form-actions" style={{justifyContent:"flex-start",marginTop:12,marginBottom:12}}>
          <button type="button" className="admin-button" disabled={!facturaIA || facturaProcesando || facturaAplicando || guardadoPendienteIA} onClick={()=>setCorreccionFacturaAbierta(true)}>🔎 REVISAR / CORREGIR</button>
          <button type="button" className="primary-button" disabled={!facturaIA || facturaAplicando || facturaProcesando || saving || guardadoPendienteIA} onClick={aplicarFacturaAnalizada}>🛒 PREPARAR COMPRA</button>
          <button type="button" className="admin-button danger-button" disabled={!facturaIA || facturaAplicando || facturaProcesando || saving || guardadoPendienteIA} onClick={()=>{localStorage.removeItem(borradorKey);setBorradorServidorId(null);setFacturaIA(null);setRevisionFacturaAbierta(false);setCorreccionFacturaAbierta(false);setFacturaMensaje("");setPreciosVentaFactura({});setMargenesFactura({});setCodigosBarrasFactura({});setCodigosInternosFactura({});setVinculosFactura({});setCompraPreparadaIA(null);}}>❌ CANCELAR / DESCARTAR</button>
        </div>
        {facturaIA && (
          <div style={{ marginTop: 16 }}>
            <div className="form-actions"><label className="admin-button" style={{cursor:"pointer"}}>Adjuntar foto del comprobante para verla en historial<input ref={adjuntoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>600000){setError("La imagen para el historial supera 600 KB. Usá una foto más liviana.");return;}const reader=new FileReader();reader.onload=()=>setImagenDataUrl(String(reader.result));reader.readAsDataURL(file);}}/></label>{imagenDataUrl&&<small>Foto adjunta al borrador.</small>}</div>
            <fieldset disabled={facturaAplicando || guardadoPendienteIA || saving} style={{border:0,padding:0,minWidth:0}}>
            <div className="form-actions" style={{justifyContent:"flex-start"}}>
              <label>Margen para todos <input type="number" step="0.01" value={margenGeneral} onChange={e=>setMargenGeneral(e.target.value)} placeholder="%"/></label>
              <button type="button" className="admin-button" onClick={()=>{if(margenGeneral==="")return;const m:Record<number,string>={},p:Record<number,string>={};facturaIA.items.forEach((item,i)=>{{m[i]=margenGeneral;p[i]=String(Math.round(item.costo_unitario*(1+Number(margenGeneral)/100)*100)/100);}});setMargenesFactura(v=>({...v,...m}));setPreciosVentaFactura(v=>({...v,...p}));setCompraPreparadaIA(null);}}>Aplicar margen</button>
              <label>Precio para todos <input type="number" step="0.01" value={precioGeneral} onChange={e=>setPrecioGeneral(e.target.value)} placeholder="$"/></label>
              <button type="button" className="admin-button" onClick={()=>{if(precioGeneral==="")return;const m:Record<number,string>={},p:Record<number,string>={};facturaIA.items.forEach((item,i)=>{{p[i]=precioGeneral;if(item.costo_unitario>0)m[i]=String((Number(precioGeneral)/item.costo_unitario-1)*100);}});setMargenesFactura(v=>({...v,...m}));setPreciosVentaFactura(v=>({...v,...p}));setCompraPreparadaIA(null);}}>Aplicar precio</button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Proveedor detectado</label>{correccionFacturaAbierta ? <><input aria-label="Nombre del proveedor" value={facturaIA.proveedor.razon_social ?? ""} onChange={e=>{setCompraPreparadaIA(null);setFacturaIA(a=>a?({...a,proveedor:{...a.proveedor,razon_social:e.target.value}}):a);}}/><input aria-label="CUIT del proveedor (opcional)" placeholder="CUIT (opcional)" value={facturaIA.proveedor.cuit ?? ""} onChange={e=>{setCompraPreparadaIA(null);setFacturaIA(a=>a?({...a,proveedor:{...a.proveedor,cuit:e.target.value}}):a);}}/></> : <div><strong>{facturaIA.proveedor.razon_social ?? "No leído"}</strong>{facturaIA.proveedor.cuit ? ` · CUIT ${facturaIA.proveedor.cuit}` : ""}</div>}</div>
              <div className="form-group"><label>Comprobante</label>{correccionFacturaAbierta ? <><input aria-label="Tipo de comprobante" value={facturaIA.tipo_comprobante ?? ""} onChange={e=>{setCompraPreparadaIA(null);setFacturaIA(a=>a?({...a,tipo_comprobante:e.target.value}):a);}}/><input aria-label="Número de comprobante" placeholder="Número (si figura)" value={facturaIA.numero_comprobante ?? ""} onChange={e=>{setCompraPreparadaIA(null);setFacturaIA(a=>a?({...a,numero_comprobante:e.target.value}):a);}}/></> : <div>{facturaIA.tipo_comprobante ?? "Comprobante"} {facturaIA.numero_comprobante ?? ""}</div>}</div>
              <div className="form-group"><label>Fecha</label>{correccionFacturaAbierta ? <input aria-label="Fecha del comprobante" type="date" value={facturaIA.fecha ?? ""} onChange={e=>{setCompraPreparadaIA(null);setFacturaIA(a=>a?({...a,fecha:e.target.value}):a);}}/> : <div>{facturaIA.fecha ?? "No leída"}</div>}</div>
              <div className="form-group"><label>Confianza IA</label><div>{Math.round(facturaIA.confianza_general * 100)}%</div></div>
            </div>
            {facturaIA.advertencias.some((a)=>!a.startsWith("CRÍTICO")) && <div style={{marginTop:12}}>
              {facturaIA.advertencias.filter((a)=>!a.startsWith("CRÍTICO")).map((a,i)=><p key={i} style={{fontWeight:600}}>⚠️ {a}</p>)}
            </div>}
            <div className="form-actions" style={{justifyContent:"flex-start",marginTop:12}}><button type="button" className="admin-button" onClick={()=>setCorreccionFacturaAbierta((v)=>!v)}>🔎 {correccionFacturaAbierta ? "Cerrar corrección" : "REVISAR / CORREGIR"}</button>{correccionFacturaAbierta && <button type="button" className="primary-button" onClick={guardarBorradorIA}>💾 GUARDAR CAMBIOS</button>}</div>
            {correccionFacturaAbierta && <div className="form-actions" style={{justifyContent:"flex-start",marginTop:10}}><button type="button" className="admin-button" onClick={()=>setFacturaIA((actual)=>actual?({...actual,items:[...actual.items,{descripcion:"Producto agregado manualmente",codigo:null,codigo_barras:null,cantidad:1,costo_unitario:0,total_linea:0,confianza:1}] as FacturaItemIA[]}):actual)}>➕ AGREGAR PRODUCTO FALTANTE</button></div>}
            {pendientesFactura.length > 0 && <div className="panel" role="alert" style={{marginTop:12,border:"1px solid #f59e0b",background:"#fffbeb"}}>
              <h4 style={{marginTop:0}}>⚠️ NO SE PUEDE PREPARAR LA COMPRA</h4>
              <p>{pendientesFactura.length} producto{pendientesFactura.length === 1 ? "" : "s"} pendiente{pendientesFactura.length === 1 ? "" : "s"}:</p>
              {pendientesFactura.map((pendiente)=><p key={pendiente.index} style={{margin:"8px 0"}}><strong>{pendiente.producto}:</strong> {pendiente.motivos.join(" ")}</p>)}
              <button type="button" className="admin-button" onClick={irAlPrimerPendiente}>IR AL PRIMER PENDIENTE</button>
            </div>}
            <div className="table-wrapper" style={{ marginTop: 14 }}>
              <table className="products-table">
                <thead><tr><th>Producto leído</th><th>Código</th><th>Cant.</th><th>Costo unit.</th><th>Precio venta</th><th>Confianza</th><th>Estado</th></tr></thead>
                <tbody>
                  {facturaIA.items.map((item, index) => {
                    const existente = productoFactura(item, index);
                    const precioExistente = Number(existente?.precio_venta ?? 0);
                    const costoAnterior = Number(existente?.costo_actual ?? existente?.costo_ultima_compra ?? 0);
                    const stockAnterior = Number(existente?.stock_actual ?? 0);
                    return (
                      <tr id={`factura-item-${index}`} key={`${item.descripcion}-${index}`}>
                        <td>{correccionFacturaAbierta ? <input value={item.descripcion} onChange={(e)=>{setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,descripcion:e.target.value}:x)}) : actual);}} aria-label={`Nombre para producto ${index + 1}`} /> : <strong>{item.descripcion}</strong>}<small style={{display:"block"}}>{existente ? `Stock: ${stockAnterior} → ${stockAnterior + item.cantidad}` : `Nuevo · ingresan ${item.cantidad} unidades`}</small></td>
                        <td>{existente ? (existente.codigo_interno ?? existente.codigo_barras ?? "Código interno automático") : <div style={{display:"grid",gap:6}}>
                          <strong style={{color:"#b45309"}}>⚠️ PRODUCTO NUEVO</strong>
                          <select value={vinculosFactura[index] ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setVinculosFactura(a=>({...a,[index]:e.target.value}));}}>
                            <option value="">Crear como producto nuevo</option>
                            {productos.map((p)=><option key={p.id} value={p.id}>Vincular existente: {p.nombre}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</option>)}
                          </select>
                          <input value={codigosBarrasFactura[index] ?? item.codigo_barras ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setCodigosBarrasFactura(a=>({...a,[index]:e.target.value}));}} placeholder="Código de barras (opcional)" aria-label={`Código de barras para ${item.descripcion}`} />
                          <input value={codigosInternosFactura[index] ?? item.codigo ?? ""} onChange={(e)=>{setCompraPreparadaIA(null);setCodigosInternosFactura(a=>({...a,[index]:e.target.value}));}} placeholder="Código interno (opcional)" aria-label={`Código interno para ${item.descripcion}`} />
                          {!((codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim()) && <small style={{color:"#b45309"}}>El código de barras es opcional. SIGO usará el código interno o generará uno al guardar.</small>}
                        </div>}</td>
                        <td>{correccionFacturaAbierta ? <input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={(e)=>{const cantidad=Number(e.target.value);setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,cantidad,total_linea:cantidad*Number(x.costo_unitario)}:x)}) : actual);}} aria-label={`Cantidad para ${item.descripcion}`} /> : <strong>{item.cantidad}</strong>}<small style={{display:"block"}}>unidades vendibles</small></td>
                        <td><span style={{textDecoration:costoAnterior>0?"line-through":"none",opacity:.65}}>{costoAnterior>0?`$ ${costoAnterior.toLocaleString("es-AR",{minimumFractionDigits:2})}`:""}</span>{correccionFacturaAbierta ? <input type="number" min="0" step="0.01" value={item.costo_unitario} onChange={(e)=>{const costo=Number(e.target.value);setCompraPreparadaIA(null);setFacturaIA((actual)=>actual ? ({...actual,items:actual.items.map((x,i)=>i===index?{...x,costo_unitario:costo,total_linea:Number(x.cantidad)*costo}:x)}) : actual);const margen=Number(margenesFactura[index]);if(!existente&&costo>0&&Number.isFinite(margen))setPreciosVentaFactura((actual)=>({...actual,[index]:String(Math.round(costo*(1+margen/100)*100)/100)}));}} aria-label={`Costo unitario para ${item.descripcion}`} /> : <strong style={{display:"block"}}>→ $ {item.costo_unitario.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>}<small style={{display:"block"}}>Total línea: $ {(item.total_linea ?? item.cantidad*item.costo_unitario).toLocaleString("es-AR",{minimumFractionDigits:2})}</small></td>
                        <td>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                            <input type="number" step="0.01" value={margenesFactura[index] ?? ""} onChange={(e)=>{const m=e.target.value;setCompraPreparadaIA(null);setMargenesFactura(a=>({...a,[index]:m}));const costo=Number(item.costo_unitario||0);setPreciosVentaFactura(a=>({...a,[index]:costo>0&&m!==""?String(Math.round(costo*(1+Number(m)/100)*100)/100):""}));}} placeholder="% margen" aria-label={`Margen para ${item.descripcion}`}/>
                            <input type="number" min="0.01" step="0.01" value={preciosVentaFactura[index] ?? ""} onChange={(e)=>{const precio=e.target.value;setCompraPreparadaIA(null);setPreciosVentaFactura(a=>({...a,[index]:precio}));const costo=Number(item.costo_unitario||0);setMargenesFactura(a=>({...a,[index]:costo>0&&precio!==""?String(((Number(precio)-costo)/costo)*100):""}));}} placeholder="Precio público" aria-label={`Precio de venta para ${item.descripcion}`}/>
                          </div>
                          {existente && <small>Precio actual: {precioExistente>0?`$ ${precioExistente.toLocaleString("es-AR",{minimumFractionDigits:2})}`:"sin precio"}. Dejá vacío para conservarlo.</small>}
                        </td>
                        <td>{Math.round(item.confianza * 100)}%</td>
                        <td>{existente ? `Existente: ${existente.nombre}` : "NUEVO · se creará recién al confirmar"}</td>
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
            </fieldset>
            {compraPreparadaIA && <div className="panel" style={{marginTop:12,border:"1px solid #16a34a",background:"#f0fdf4"}}>
              <h4 style={{marginTop:0}}>✅ COMPRA PREPARADA / PENDIENTE DE CONFIRMACIÓN</h4>
              <p><strong>Proveedor:</strong> {compraPreparadaIA.proveedorNombre}</p>
              <p><strong>Comprobante:</strong> {compraPreparadaIA.tipoComprobante ?? "Comprobante"} {compraPreparadaIA.numeroComprobante ?? ""}</p>
              <p><strong>Productos:</strong> {compraPreparadaIA.items.length} · Nuevos pendientes de creación: {compraPreparadaIA.items.filter((item)=>item.nuevo).length}</p>
              <p style={{marginBottom:0}}>Guardá el comprobante y tus correcciones en el historial. Cuando esté completo, podés confirmar el ingreso de stock sin exigir código de barras.</p>
            </div>}
            <div className="form-actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="primary-button" disabled={guardandoBorradorServidor || facturaAplicando} onClick={()=>void guardarEnHistorialPendiente()}>{guardandoBorradorServidor?"Guardando…":"💾 GUARDAR COMPRA"}</button>
              <small>Guarda siempre el comprobante y los cambios en el historial como pendiente, aunque falten datos. No ingresa stock.</small>
              <GuardarCompraIA empresaId={empresaId} idempotencyKey={idempotencyKeyRef.current}
                factura={facturaIA} productos={productos} vinculos={vinculosFactura} barras={codigosBarrasFactura}
                codigos={codigosInternosFactura} precios={preciosVentaFactura} margenes={margenesFactura}
                disabled={facturaProcesando || saving} onAntesGuardar={guardarBorradorIA}
                onEstado={setFacturaAplicando} onPendiente={setGuardadoPendienteIA} onError={setError}
                onGuardada={(compraId, resultado) => {
                  localStorage.removeItem(borradorKey);
                  if(borradorServidorId)void supabase.from("compra_borradores_sigo").update({estado:"confirmado",compra_id:compraId,updated_at:new Date().toISOString()}).eq("id",borradorServidorId).eq("empresa_id",empresaId);
                  setBorradorServidorId(null);
                  setUltimaConciliacion({compraId,resultado});
                  setFacturaIA(null);setImagenDataUrl(null);setCompraPreparadaIA(null);setRevisionFacturaAbierta(false);setCorreccionFacturaAbierta(false);
                  setPreciosVentaFactura({});setMargenesFactura({});setCodigosBarrasFactura({});setCodigosInternosFactura({});setVinculosFactura({});
                  setLineas([nuevaLinea()]);setNumero("");setOrigenCompra("manual");setFacturaAplicando(false);setGuardadoPendienteIA(false);
                  idempotencyKeyRef.current=nuevaClave();
                  setFacturaMensaje("✅ COMPRA GUARDADA. Se registraron la compra y el ingreso de stock.");
                  void cargar(empresaId);
                }} />
              <button type="button" className="admin-button" disabled={facturaAplicando || facturaProcesando || saving || guardadoPendienteIA} onClick={() => { localStorage.removeItem(borradorKey); setBorradorServidorId(null); setFacturaIA(null); setRevisionFacturaAbierta(false); setFacturaMensaje(""); setPreciosVentaFactura({}); setMargenesFactura({}); setCodigosBarrasFactura({}); setCodigosInternosFactura({}); setVinculosFactura({}); setCompraPreparadaIA(null); }}>❌ CANCELAR / DESCARTAR</button>
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
        <h3>Historial de compras</h3>
        {borradoresServidor.some(b=>b.estado==="pendiente")&&<div className="panel" style={{marginBottom:16,border:"1px solid #f59e0b"}}><h4>Comprobantes pendientes · sin ingreso de stock</h4><div className="table-wrapper"><table className="products-table"><thead><tr><th>Fecha de carga</th><th>Comprobante</th><th>Proveedor</th><th>Artículos</th><th>Acciones</th></tr></thead><tbody>{borradoresServidor.filter(b=>b.estado==="pendiente").map(b=><tr key={b.id}><td>{new Date(b.created_at).toLocaleDateString("es-AR")}</td><td>{b.documento.facturaIA.tipo_comprobante??"Comprobante"} {b.documento.facturaIA.numero_comprobante??"sin número"}</td><td>{b.documento.facturaIA.proveedor.razon_social??"Sin identificar"}</td><td>{b.documento.facturaIA.items.length}</td><td><div className="form-actions"><button type="button" className="admin-button" onClick={()=>abrirBorradorServidor(b)}>Abrir / modificar</button>{b.documento.imagenDataUrl&&<button type="button" className="admin-button" onClick={()=>setImagenHistorial(b.documento.imagenDataUrl??null)}>Ver foto</button>}<button type="button" className="admin-button danger-button" onClick={()=>void descartarBorradorServidor(b)}>Eliminar pendiente</button></div></td></tr>)}</tbody></table></div></div>}
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
                    <td>{compra.origen}</td>
                    <td>$ {Number(compra.total ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                    <td>{compra.estado}</td>
                    <td><div className="form-actions" style={{justifyContent:"flex-start"}}><button type="button" className="admin-button" onClick={()=>void abrirCompra(compra)}>Abrir compra</button>{borradoresServidor.find(b=>b.compra_id===compra.id)?.documento.imagenDataUrl&&<button type="button" className="admin-button" onClick={()=>setImagenHistorial(borradoresServidor.find(b=>b.compra_id===compra.id)?.documento.imagenDataUrl??null)}>Ver foto</button>}{compra.estado==="confirmada"&&<><button type="button" className="admin-button" onClick={()=>void abrirCompra(compra,"modificar")}>Modificar</button><button type="button" className="admin-button danger-button" onClick={()=>void abrirCompra(compra,"anular")}>Eliminar / anular</button></>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {imagenHistorial&&<div className="panel"><div className="page-header"><h4>Foto del comprobante</h4><button type="button" className="admin-button" onClick={()=>setImagenHistorial(null)}>Cerrar foto</button></div><img src={imagenHistorial} alt="Foto del comprobante de compra" style={{maxWidth:"100%",maxHeight:"75vh",objectFit:"contain"}}/></div>}
        {detalleCompra&&<div className="panel" style={{marginTop:16}}><div className="page-header"><h4>{detalleCompra.titulo} · {detalleCompra.compra.estado}</h4><button type="button" className="admin-button" onClick={()=>{setDetalleCompra(null);setEdicionCompra(null);}}>Cerrar</button></div>
          {edicionCompra ? <div><div className="form-grid">
            <div className="form-group"><label>Proveedor</label><select value={edicionCompra.proveedorId} onChange={e=>setEdicionCompra(a=>a?({...a,proveedorId:e.target.value}):a)}>{proveedores.map(p=><option key={p.id} value={p.id}>{p.razon_social}</option>)}</select></div>
            <div className="form-group"><label>Fecha</label><input type="date" value={edicionCompra.fecha} onChange={e=>setEdicionCompra(a=>a?({...a,fecha:e.target.value}):a)}/></div>
            <div className="form-group"><label>Tipo de comprobante</label><input value={edicionCompra.tipo} onChange={e=>setEdicionCompra(a=>a?({...a,tipo:e.target.value}):a)}/></div>
            <div className="form-group"><label>Número de comprobante</label><input value={edicionCompra.numero} onChange={e=>setEdicionCompra(a=>a?({...a,numero:e.target.value}):a)}/></div></div>
            <div className="table-wrapper"><table className="products-table"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Costo unitario</th><th>Subtotal</th><th></th></tr></thead><tbody>{edicionCompra.items.map((item,i)=><tr key={i}><td><select value={item.productoId} onChange={e=>setEdicionCompra(a=>a?({...a,items:a.items.map((x,j)=>j===i?{...x,productoId:e.target.value}:x)}):a)}><option value="">Seleccionar producto</option>{productos.map(p=><option key={p.id} value={p.id}>{p.nombre} · {p.codigo_interno??p.codigo_barras??"sin código"}</option>)}</select></td><td><input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={e=>setEdicionCompra(a=>a?({...a,items:a.items.map((x,j)=>j===i?{...x,cantidad:e.target.value}:x)}):a)}/></td><td><input type="number" min="0" step="0.01" value={item.costo} onChange={e=>setEdicionCompra(a=>a?({...a,items:a.items.map((x,j)=>j===i?{...x,costo:e.target.value}:x)}):a)}/></td><td>$ {(Number(item.cantidad)*Number(item.costo)).toLocaleString("es-AR")}</td><td><button type="button" className="admin-button danger-button" onClick={()=>setEdicionCompra(a=>a?({...a,items:a.items.filter((_,j)=>j!==i)}):a)}>Quitar</button></td></tr>)}</tbody></table></div>
            <div className="form-actions"><button type="button" className="admin-button" onClick={()=>setEdicionCompra(a=>a?({...a,items:[...a.items,{productoId:"",cantidad:"1",costo:"0"}]}):a)}>+ Agregar artículo</button><button type="button" className="primary-button" disabled={guardandoHistorial} onClick={()=>void cambiarCompraHistorial("modificar")}>{guardandoHistorial?"Guardando…":"Guardar cambios"}</button><button type="button" className="admin-button" onClick={()=>setEdicionCompra(null)}>Cancelar</button></div>
          </div> : <><div className="table-wrapper"><table className="products-table"><thead><tr><th>Artículo</th><th>Código</th><th>Cantidad</th><th>Costo unitario</th><th>Subtotal</th></tr></thead><tbody>{detalleCompra.items.map((item,i)=><tr key={i}><td>{item.nombre}</td><td>{item.codigo}</td><td>{item.cantidad}</td><td>$ {item.costo.toLocaleString("es-AR")}</td><td>$ {(item.cantidad*item.costo).toLocaleString("es-AR")}</td></tr>)}</tbody></table></div>{detalleCompra.compra.estado==="confirmada"&&<div className="form-actions"><button type="button" className="admin-button" onClick={iniciarEdicionCompra}>Modificar</button><button type="button" className="admin-button danger-button" disabled={guardandoHistorial} onClick={()=>void cambiarCompraHistorial("anular")}>Eliminar / anular</button></div>}</>}
        </div>}
      </div>)}
      
    </div>
  );
}
