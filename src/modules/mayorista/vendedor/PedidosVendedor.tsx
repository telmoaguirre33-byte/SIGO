import { useEffect, useMemo, useState } from "react";
import { PedidosIndexedDB } from "../offline/pedidos-indexeddb";
import { leerCatalogo } from "../offline/catalogo-indexeddb";
import type { SnapshotCatalogo } from "../offline/catalogo-indexeddb";
import type { LineaPedido, PedidoLocal } from "../offline/pedidos-locales";

/** Pantalla aislada: no se importa desde el App principal de SIGO. */
export function PedidosVendedor({ empresaId, vendedorId }: { empresaId: string; vendedorId: string }) {
  const cola = useMemo(() => new PedidosIndexedDB(empresaId, vendedorId), [empresaId, vendedorId]);
  const [catalogo, setCatalogo] = useState<SnapshotCatalogo | null>(null);
  const [pedidos, setPedidos] = useState<PedidoLocal[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    let vigente = true;
    setCatalogo(null);
    setPedidos([]);
    setClienteId("");
    setProductoId("");
    setLineas([]);
    Promise.all([leerCatalogo(empresaId, vendedorId), cola.listar()])
      .then(([c, p]) => { if (vigente) { setCatalogo(c); setPedidos(p); } })
      .catch(e => { if (vigente) setMensaje(String(e)); });
    const conectado = () => setOnline(true);
    const desconectado = () => setOnline(false);
    window.addEventListener("online", conectado);
    window.addEventListener("offline", desconectado);
    return () => {
      vigente = false;
      window.removeEventListener("online", conectado);
      window.removeEventListener("offline", desconectado);
    };
  }, [empresaId, vendedorId, cola]);

  const producto = catalogo?.productos.find(p => p.id === productoId);
  const precios = catalogo?.precios.filter(p => p.productoId === productoId && p.unidadesBase > 0 && p.precio >= 0) ?? [];
  const [precioId, setPrecioId] = useState("");
  const precio = precios.find(p => p.id === precioId) ?? precios[0];

  function agregar() {
    const unidades = Number(cantidad);
    if (!producto || !producto.activo || !precio || !Number.isSafeInteger(unidades) || unidades <= 0) {
      setMensaje("Seleccioná producto, presentación y cantidad válida");
      return;
    }
    setLineas(prev => [...prev, { productoId: producto.id, cantidad: unidades * precio.unidadesBase, precioUnitario: precio.precio / precio.unidadesBase }]);
    setMensaje("");
  }
  async function guardar() {
    if (!catalogo || !clienteId || !lineas.length || ocupado) return;
    setOcupado(true);
    try {
      await cola.crear(clienteId, lineas);
      setPedidos(await cola.listar());
      setLineas([]);
      setMensaje("Pedido guardado en este dispositivo. Pendiente de sincronización.");
    } catch (e) { setMensaje("No se guardó el pedido: " + String(e)); }
    finally { setOcupado(false); }
  }

  return <main style={{maxWidth: 760, margin: "auto", padding: 16, fontFamily: "system-ui"}}>
    <h1>SIGO Mayorista — Vendedor</h1>
    <p role="status">{online ? "Con conexión" : "Sin internet: pedidos locales habilitados"}</p>
    {!catalogo ? <p>No hay catálogo descargado para este vendedor. Conectarse y descargar antes de salir a ruta.</p> : <>
      <p>Catálogo: {new Date(catalogo.descargadoEn).toLocaleString("es-AR")} — versión {catalogo.version}</p>
      <label style={{display:"block", marginBottom: 12}}>Cliente
        <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={{display:"block",width:"100%",padding:10}}>
          <option value="">Seleccionar comercio</option>
          {catalogo.clientes.filter(c => c.habilitado).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      <label style={{display:"block", marginBottom: 12}}>Producto
        <select value={productoId} onChange={e => {setProductoId(e.target.value);setPrecioId("");}} style={{display:"block",width:"100%",padding:10}}>
          <option value="">Seleccionar producto</option>
          {catalogo.productos.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      <label style={{display:"block", marginBottom: 12}}>Presentación
        <select value={precio?.id ?? ""} onChange={e => setPrecioId(e.target.value)} style={{display:"block",width:"100%",padding:10}}>
          {precios.map(p => <option key={p.id} value={p.id}>{p.presentacion} — $ {p.precio.toLocaleString("es-AR")}</option>)}
        </select>
      </label>
      <label style={{display:"block", marginBottom: 12}}>Cantidad de presentaciones
        <input type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)} style={{display:"block",width:"100%",padding:10}}/>
      </label>
      <button type="button" onClick={agregar} disabled={!clienteId}>Agregar al pedido</button>
      <h2>Pedido actual ({lineas.length} renglones)</h2>
      <ul>{lineas.map((l,i) => <li key={i}>{catalogo.productos.find(p => p.id === l.productoId)?.nombre ?? l.productoId} — {l.cantidad} unidades base — $ {(l.cantidad*l.precioUnitario).toLocaleString("es-AR")}</li>)}</ul>
      <button type="button" disabled={!clienteId || !lineas.length || ocupado} onClick={guardar}>Guardar pedido sin internet</button>
    </>}
    {mensaje && <p role="alert">{mensaje}</p>}
    <h2>Pedidos en este celular</h2>
    <ul>{pedidos.map(p => <li key={p.id}>{p.id.slice(0,8)} — {p.estado} — {p.lineas.length} renglones</li>)}</ul>
    <p><small>Versión piloto: no factura, no descuenta stock y no envía pedidos al servidor.</small></p>
  </main>;
}
