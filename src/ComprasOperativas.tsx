import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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

type Linea = CompraItemInput & { key: string };

type UltimaConciliacion = {
  compraId: string;
  resultado: VerificacionCompraSigo;
};

function nuevaClave() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nuevaLinea(): Linea {
  return { key: nuevaClave(), producto_id: "", cantidad: 1, costo_unitario: 0 };
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

export default function ComprasOperativas({ empresaId }: { empresaId: string }) {
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
  const [revisionFacturaAbierta, setRevisionFacturaAbierta] = useState(false);
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const archivoRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef(nuevaClave());
  const empresaActivaRef = useRef(empresaId);

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
    setFacturaIA(null);
    setFacturaMensaje("");
    setPreciosVentaFactura({});
    setError("");
    void cargar(empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

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

  const preciosFacturaPendientes = useMemo(() => {
    if (!facturaIA) return 0;
    return facturaIA.items.reduce((faltantes, item, index) => {
      if (encontrarProducto(item, productos)) return faltantes;
      const precio = Number(preciosVentaFactura[index]);
      return faltantes + (!Number.isFinite(precio) || precio <= 0 ? 1 : 0);
    }, 0);
  }, [facturaIA, productos, preciosVentaFactura]);

  function editarLinea(key: string, patch: Partial<Linea>) {
    setLineas((actual) => actual.map((l) => l.key === key ? { ...l, ...patch } : l));
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
    setFacturaMensaje("");
    setPreciosVentaFactura({});
    setError("");
    try {
      const resultado = await analizarFacturaCompraSigo(empresaOperacion, file);
      if (empresaActivaRef.current !== empresaOperacion) return;
      setFacturaIA(resultado);
      setRevisionFacturaAbierta(true);
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

  async function aplicarFacturaAnalizada() {
    if (!facturaIA || facturaAplicando || facturaProcesando) return;
    const empresaOperacion = empresaId;
    setFacturaAplicando(true);
    setRevisionFacturaAbierta(true);
    setError("");
    setFacturaMensaje("");
    try {
      const precioFaltanteInicial = facturaIA.items.findIndex((item, index) => {
        if (encontrarProducto(item, productos)) return false;
        const precio = Number(preciosVentaFactura[index]);
        return !Number.isFinite(precio) || precio <= 0;
      });
      if (precioFaltanteInicial >= 0) {
        throw new Error(`Definí un precio de venta mayor a cero para "${facturaIA.items[precioFaltanteInicial].descripcion}" antes de crear el producto.`);
      }

      let proveedoresActuales = [...proveedores];
      let proveedor = undefined as ProveedorSigo | undefined;
      const cuitFactura = digitos(facturaIA.proveedor.cuit);
      if (cuitFactura) proveedor = proveedoresActuales.find((p) => digitos(p.cuit) === cuitFactura);
      if (!proveedor && facturaIA.proveedor.razon_social) {
        const nombreProveedor = normalizar(facturaIA.proveedor.razon_social);
        proveedor = proveedoresActuales.find((p) => normalizar(p.razon_social) === nombreProveedor);
      }
      if (!proveedor) {
        if (!facturaIA.proveedor.razon_social) {
          throw new Error("La IA no pudo leer el proveedor. Crealo o seleccionalo manualmente antes de aplicar la factura.");
        }
        proveedor = await guardarProveedorSigo({
          empresaId: empresaOperacion,
          razonSocial: facturaIA.proveedor.razon_social,
          cuit: cuitFactura.length === 11 ? cuitFactura : undefined,
        });
        if (empresaActivaRef.current !== empresaOperacion) return;
        proveedoresActuales = [...proveedoresActuales, proveedor].sort((a, b) => a.razon_social.localeCompare(b.razon_social));
        setProveedores(proveedoresActuales);
      }
      setProveedorId(proveedor.id);

      let productosActuales = await listarProductosSigo(empresaOperacion);
      if (empresaActivaRef.current !== empresaOperacion) return;
      const nuevasLineas = new Map<string, Linea>();
      let creados = 0;
      let existentes = 0;

      for (const [index, item] of facturaIA.items.entries()) {
        let producto = encontrarProducto(item, productosActuales);
        if (!producto) {
          const precioVenta = Number(preciosVentaFactura[index]);
          if (!Number.isFinite(precioVenta) || precioVenta <= 0) {
            throw new Error(`Definí un precio de venta mayor a cero para "${item.descripcion}" antes de crear el producto.`);
          }
          const codigoBarras = item.codigo_barras?.trim() || null;
          const codigoInterno = item.codigo?.trim() && item.codigo?.trim() !== codigoBarras ? item.codigo.trim() : null;
          const id = await guardarProductoSigo({
            empresaId: empresaOperacion,
            nombre: item.descripcion,
            codigoBarras,
            codigoInterno,
            costoActual: item.costo_unitario,
            costoUltimaCompra: item.costo_unitario,
            precioVenta,
            stockActual: null,
            stockMinimo: null,
            stockMaximo: null,
          });
          if (empresaActivaRef.current !== empresaOperacion) return;
          producto = {
            id,
            empresa_id: empresaOperacion,
            codigo_interno: codigoInterno,
            codigo_barras: codigoBarras,
            nombre: item.descripcion,
            descripcion: null,
            categoria: null,
            marca: null,
            proveedor: facturaIA.proveedor.razon_social,
            costo_actual: item.costo_unitario,
            costo_ultima_compra: item.costo_unitario,
            precio_venta: precioVenta,
            margen_ganancia: precioVenta - item.costo_unitario,
            margen_porcentaje: item.costo_unitario > 0 ? ((precioVenta - item.costo_unitario) / item.costo_unitario) * 100 : null,
            stock_actual: 0,
            stock_minimo: null,
            stock_maximo: null,
          };
          productosActuales = [...productosActuales, producto];
          creados += 1;
        } else {
          existentes += 1;
        }

        const previa = nuevasLineas.get(producto.id);
        if (previa) {
          const cantidadTotal = previa.cantidad + item.cantidad;
          const costoPonderado = cantidadTotal > 0
            ? ((previa.cantidad * previa.costo_unitario) + (item.cantidad * item.costo_unitario)) / cantidadTotal
            : item.costo_unitario;
          nuevasLineas.set(producto.id, { ...previa, cantidad: cantidadTotal, costo_unitario: costoPonderado });
        } else {
          nuevasLineas.set(producto.id, {
            key: nuevaClave(),
            producto_id: producto.id,
            cantidad: item.cantidad,
            costo_unitario: item.costo_unitario,
          });
        }
      }

      if (nuevasLineas.size === 0) throw new Error("La factura no tiene líneas válidas para cargar.");
      setProductos(productosActuales.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setLineas([...nuevasLineas.values()]);
      if (facturaIA.fecha && /^\d{4}-\d{2}-\d{2}$/.test(facturaIA.fecha)) setFecha(facturaIA.fecha);
      if (facturaIA.tipo_comprobante) setTipo(facturaIA.tipo_comprobante);
      if (facturaIA.numero_comprobante) setNumero(facturaIA.numero_comprobante);
      idempotencyKeyRef.current = nuevaClave();
      setFacturaMensaje(`Factura preparada: ${existentes} producto${existentes === 1 ? "" : "s"} existente${existentes === 1 ? "" : "s"} y ${creados} nuevo${creados === 1 ? "" : "s"} con precio de venta definido. Revisá las líneas y confirmá para ingresar el stock.`);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo preparar la compra desde la factura.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setFacturaAplicando(false);
    }
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
      });
      if (empresaActivaRef.current !== empresaOperacion) return;

      const resultado = await verificarCompraSigo({ empresaId: empresaOperacion, compraId, items, stockAntes });
      if (empresaActivaRef.current !== empresaOperacion) return;
      setUltimaConciliacion({ compraId, resultado });
      idempotencyKeyRef.current = nuevaClave();
      setLineas([nuevaLinea()]);
      setNumero("");
      setFacturaIA(null);
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

      <div className="panel" style={{ border: "1px solid #bfdbfe", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="page-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>📷 Leer comprobante de compra con IA</h3>
            <p style={{ margin: 0 }}>Sacá una foto o elegí una imagen/PDF. SIGO admite factura, ticket, remito, nota de pedido, orden de compra, talonario X y otros comprobantes de compra/recepción; lee proveedor, fecha, comprobante, productos, cantidades y costos. Si un producto no existe, definís su precio de venta antes de crearlo; el stock se modifica recién cuando confirmás la compra.</p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>IA · revisión antes de stock</span>
        </div>
        <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" hidden onChange={(e) => void leerFactura(e.target.files?.[0])} />
        <div className="form-actions" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="primary-button" disabled={facturaProcesando || facturaAplicando || saving} onClick={() => fotoRef.current?.click()}>{facturaProcesando ? "Analizando…" : "📸 Tomar foto de factura"}</button>
          <button type="button" className="admin-button" disabled={facturaProcesando || facturaAplicando || saving} onClick={() => archivoRef.current?.click()}>Elegir foto / PDF</button>
        </div>

        {facturaMensaje && <p style={{ fontWeight: 700, color: "#1e3a8a" }}>{facturaMensaje}</p>}

        {facturaIA && (
          <div style={{ marginTop: 16 }}>
            <div className="form-grid">
              <div className="form-group"><label>Proveedor detectado</label><div><strong>{facturaIA.proveedor.razon_social ?? "No leído"}</strong>{facturaIA.proveedor.cuit ? ` · CUIT ${facturaIA.proveedor.cuit}` : ""}</div></div>
              <div className="form-group"><label>Comprobante</label><div>{facturaIA.tipo_comprobante ?? "Factura"} {facturaIA.numero_comprobante ?? ""}</div></div>
              <div className="form-group"><label>Fecha</label><div>{facturaIA.fecha ?? "No leída"}</div></div>
              <div className="form-group"><label>Confianza IA</label><div>{Math.round(facturaIA.confianza_general * 100)}%</div></div>
            </div>
            <div className="table-wrapper" style={{ marginTop: 14 }}>
              <table className="products-table">
                <thead><tr><th>Producto leído</th><th>Código</th><th>Cant.</th><th>Costo unit.</th><th>Precio venta</th><th>Confianza</th><th>Estado</th></tr></thead>
                <tbody>
                  {facturaIA.items.map((item, index) => {
                    const existente = encontrarProducto(item, productos);
                    const precioExistente = Number(existente?.precio_venta ?? 0);
                    const costoAnterior = Number(existente?.costo_actual ?? existente?.costo_ultima_compra ?? 0);
                    const stockAnterior = Number(existente?.stock_actual ?? 0);
                    const margen = Number(existente?.margen_porcentaje ?? (costoAnterior > 0 && precioExistente > 0 ? ((precioExistente-costoAnterior)/costoAnterior)*100 : 0));
                    const precioSugerido = margen >= 0 ? item.costo_unitario * (1 + margen/100) : precioExistente;
                    return (
                      <tr key={`${item.descripcion}-${index}`}>
                        <td><strong>{item.descripcion}</strong><small style={{display:"block"}}>{existente ? `Stock: ${stockAnterior} → ${stockAnterior + item.cantidad}` : `Nuevo · ingresan ${item.cantidad} unidades`}</small></td>
                        <td>{item.codigo_barras ?? item.codigo ?? "-"}</td>
                        <td><strong>{item.cantidad}</strong><small style={{display:"block"}}>unidades vendibles</small></td>
                        <td><span style={{textDecoration:costoAnterior>0?"line-through":"none",opacity:.65}}>{costoAnterior>0?`$ ${costoAnterior.toLocaleString("es-AR",{minimumFractionDigits:2})}`:""}</span><strong style={{display:"block"}}>→ $ {item.costo_unitario.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong></td>
                        <td>
                          {existente
                            ? <div><span style={{textDecoration:"line-through",opacity:.65}}>{precioExistente>0?`$ ${precioExistente.toLocaleString("es-AR",{minimumFractionDigits:2})}`:"Sin precio"}</span><strong style={{display:"block",color:"#15803d"}}>→ $ {precioSugerido.toLocaleString("es-AR",{minimumFractionDigits:2})}</strong><small>Margen {margen.toLocaleString("es-AR",{maximumFractionDigits:2})}%</small></div>
                            : <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={preciosVentaFactura[index] ?? ""}
                                onChange={(e) => setPreciosVentaFactura((actual) => ({ ...actual, [index]: e.target.value }))}
                                placeholder="Obligatorio"
                                aria-label={`Precio de venta para ${item.descripcion}`}
                              />}
                        </td>
                        <td>{Math.round(item.confianza * 100)}%</td>
                        <td>{existente ? `Existente: ${existente.nombre}` : "NUEVO · requiere precio"}</td>
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
            <div className="form-actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="primary-button" disabled={facturaAplicando || facturaProcesando || saving || preciosFacturaPendientes > 0} onClick={() => void aplicarFacturaAnalizada()}>{facturaAplicando ? "Preparando compra…" : "REVISADO · PREPARAR COMPRA"}</button>
              <button type="button" className="admin-button" disabled={facturaAplicando || facturaProcesando || saving} onClick={() => { setFacturaIA(null); setRevisionFacturaAbierta(false); setFacturaMensaje(""); setPreciosVentaFactura({}); }}>Descartar lectura</button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
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
          <BarcodeScanner empresaId={empresaId} action="ingresar" onProduct={agregarProductoEscaneado} />
        </div>

        <div className="table-wrapper" style={{ marginTop: 18 }}>
          <table className="products-table">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.key}>
                  <td><select value={l.producto_id} onChange={(e) => { const p = productos.find((x) => x.id === e.target.value); editarLinea(l.key, { producto_id: e.target.value, costo_unitario: Number(p?.costo_actual ?? p?.costo_ultima_compra ?? 0) }); }} required><option value="">Seleccionar producto</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></td>
                  <td><input type="number" min="0.001" step="0.001" value={l.cantidad} onChange={(e) => editarLinea(l.key, { cantidad: Number(e.target.value) })} /></td>
                  <td><input type="number" min="0" step="0.01" value={l.costo_unitario} onChange={(e) => editarLinea(l.key, { costo_unitario: Number(e.target.value) })} /></td>
                  <td>$ {(l.cantidad * l.costo_unitario).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
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

      <div className="panel">
        <h3>Últimas compras</h3>
        {loading ? <p>Cargando…</p> : compras.length === 0 ? <p>Sin compras confirmadas.</p> : (
          <div className="table-wrapper">
            <table className="products-table">
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Total</th><th>Estado</th></tr></thead>
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
      </div>
    </div>
  );
}
