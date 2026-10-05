import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { EmpresaOperativa } from "./tenant";
import { supabase } from "./supabase";
import BarcodeScanner from "./BarcodeScanner";
import type { BarcodeAction, BarcodeProduct } from "./barcode";
import VentaRapidaOperativa from "./VentaRapidaOperativa";
import ComprasOperativas from "./ComprasOperativas";
import StockVsInventario from "./StockVsInventario";
import { cargarResumenOperativoSigo, type ResumenOperativoSigo } from "./informes";
import { can } from "./permissions";
import { listarModulosEmpresa } from "./modulosEmpresa";
import {
  eliminarProductoSigo,
  guardarProductoSigo,
  listarProductosSigo,
  type ProductoSigo,
} from "./productos";

type Section = "Inicio" | "Productos" | "Ventas" | "Clientes" | "Compras" | "Stock" | "Informes" | "Stock vs Inventario";

const sections: Section[] = ["Inicio", "Productos", "Ventas", "Stock", "Compras", "Informes"];

type ProductoForm = {
  nombre: string;
  codigoInterno: string;
  codigoBarras: string;
  categoria: string;
  marca: string;
  precioVenta: string;
  stockMinimo: string;
  stockMaximo: string;
  stockInicial: string;
  costoReferencia: string;
};

const productoVacio: ProductoForm = {
  nombre: "",
  codigoInterno: "",
  codigoBarras: "",
  categoria: "",
  marca: "",
  precioVenta: "",
  stockMinimo: "",
  stockMaximo: "",
  stockInicial: "",
  costoReferencia: "",
};

function numeroOpcional(valor: string, etiqueta: string): number | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  const numero = Number(limpio);
  if (!Number.isFinite(numero) || numero < 0) throw new Error(`${etiqueta} debe ser un número igual o mayor a cero.`);
  return numero;
}

export default function SigoApp({ empresa, initialSection = "Inicio", purchasesOnly = false }: { empresa: EmpresaOperativa; initialSection?: Section; purchasesOnly?: boolean }) {
  const [section, setSection] = useState<Section>(initialSection);
  const puedeEditarProductos = can(empresa.rol, "products.write");

  return (
    <div className={purchasesOnly ? "app purchases-hub-only" : "app"}>
      {!purchasesOnly && <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div>
            <strong>SIGO</strong>
            <span>Gestión Operativa</span>
          </div>
        </div>
        <div className="sidebar-scroll">
        <nav className="menu">
          {sections.map((item) => (
            <button key={item} className={section === item ? "menu-item active" : "menu-item"} onClick={() => setSection(item)}>
              <span className="menu-icon">{item.slice(0, 2).toUpperCase()}</span>
              <span>{item === "Compras" ? "Compras / Proveedores" : item}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={section === "Stock vs Inventario" ? "menu-item active" : "menu-item"} onClick={() => setSection("Stock vs Inventario")} style={{width:"100%",marginBottom:12}}>
            <span className="menu-icon">SI</span><span>Stock vs Inventario</span>
          </button>
          <div className="user-card">
            <div className="avatar">A</div>
            <div>
              <strong>{empresa.empresa_nombre}</strong>
              <span>Empresa activa</span>
            </div>
          </div>
        </div>
        </div>
      </aside>}

      <main className="main" style={purchasesOnly ? {width:"100%",maxWidth:"100%",margin:0} : undefined}>
        {section !== "Ventas" && <header className="topbar">
          <div>
            <h1>{section === "Compras" ? "Compras / Proveedores" : section}</h1>
            <p>{empresa.empresa_nombre} · SIGO</p>
          </div>
        </header>}
        <section className="content">
          {section === "Inicio" && <Inicio empresa={empresa} onProductos={() => setSection("Productos")} onStock={() => setSection("Stock")} onCaja={() => setSection("Ventas")} />}
          {section === "Productos" && <Productos empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} />}
          {section === "Stock" && <Stock empresaId={empresa.empresa_id} />}
          {section === "Stock vs Inventario" && <StockVsInventario empresaId={empresa.empresa_id} />}
          {section === "Ventas" && <VentaRapidaOperativa empresaId={empresa.empresa_id} puedeEditarProductos={puedeEditarProductos} />}
          {section === "Compras" && <ComprasHub empresaId={empresa.empresa_id} />}
          {section !== "Inicio" && section !== "Productos" && section !== "Stock" && section !== "Ventas" && section !== "Compras" && section !== "Stock vs Inventario" && <Pendiente title={section} />}
        </section>
      </main>
    </div>
  );
}

function ComprasHub({ empresaId }: { empresaId: string }) {
  const [modo, setModo] = useState<"menu" | "manual" | "ia" | "historial">("menu");
  if (modo !== "menu") {
    return <div>
      <button type="button" className="admin-button" style={{marginBottom:16}} onClick={()=>setModo("menu")}>← Volver a Compras / Proveedores</button>
      <ComprasOperativas empresaId={empresaId} vista={modo} onCambiarVista={setModo} />
    </div>;
  }
  return <div className="products-page products-page-fixed">
    <div className="panel">
      <h2>Compras / Proveedores</h2>
      <p>Elegí cómo querés trabajar. En celular cada opción abre una pantalla simple y separada.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginTop:18}}>
        <button type="button" className="primary-button" style={{minHeight:90,fontSize:18}} onClick={()=>setModo("manual")}>📦 Carga manual</button>
        <button type="button" className="primary-button" style={{minHeight:90,fontSize:18}} onClick={()=>setModo("ia")}>✨ Compra inteligente con IA</button>
        <button type="button" className="admin-button" style={{minHeight:90,fontSize:18}} onClick={()=>setModo("historial")}>📋 Historial de compras</button>
      </div>
    </div>
  </div>;
}

function Inicio({ empresa, onProductos, onStock, onCaja }: { empresa: EmpresaOperativa; onProductos: () => void; onStock: () => void; onCaja: () => void }) {
  const [resumen,setResumen]=useState<ResumenOperativoSigo|null>(null);
  const [trialDaysLeft,setTrialDaysLeft]=useState<number|null>(null);
  useEffect(()=>{ let activo=true; void supabase.auth.getUser().then(({data})=>{if(!activo)return; const user=data.user; if(!user){setTrialDaysLeft(null);return;} const metadata=user.user_metadata??{}; const startRaw=String(metadata.sigo_trial_started_at??user.created_at??""); const start=Date.parse(startRaw); if(!Number.isFinite(start)){setTrialDaysLeft(null);return;} const elapsed=Math.floor((Date.now()-start)/(24*60*60*1000)); setTrialDaysLeft(Math.max(0,30-elapsed));}); return()=>{activo=false}; },[]);
  useEffect(()=>{ let activo=true; void cargarResumenOperativoSigo(empresa.empresa_id).then(r=>{if(activo)setResumen(r)}).catch(()=>{if(activo)setResumen(null)}); return()=>{activo=false}; },[empresa.empresa_id]);
  const horas=(resumen?.ventasHoyPorHora||[]).filter(h=>h.hora>=7&&h.hora<=23);
  const max=Math.max(1,...horas.map(h=>h.cantidad));
  const dinero=(v:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(v);
  return (
    <div className="sigo-home">
      <div className="welcome sigo-home-hero">
        <div><span className="sigo-home-eyebrow">SIGO GESTIÓN</span><h2>¡Hola! · {empresa.empresa_nombre}</h2><p>Todo tu negocio, en un solo lugar.</p></div>
        <div className="sigo-home-badge"><strong>Empresa activa</strong><span>{empresa.empresa_nombre}</span></div>
      </div>
      {trialDaysLeft !== null && trialDaysLeft <= 10 && trialDaysLeft > 0 ? (
        <div className="panel" style={{marginBottom:16,display:"flex",gap:14,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
          <div><strong>Te quedan {trialDaysLeft} {trialDaysLeft === 1 ? "día" : "días"} gratis</strong><div>Continuá usando SIGO Gestión por $17.999/mes.</div></div>
          <button className="primary-button" type="button" onClick={()=>window.dispatchEvent(new CustomEvent("sigo:subscription"))}>SUSCRIBIRME</button>
        </div>
      ) : null}
      <div className="sigo-home-actions" aria-label="Accesos rápidos">
        <button className="sigo-home-action primary" onClick={onCaja}><span>▣</span><strong>CAJA</strong><small>Nueva venta</small></button>
        <button className="sigo-home-action" onClick={onProductos}><span>＋</span><strong>Nuevo / ver producto</strong><small>Administrar catálogo</small></button>
        <button className="sigo-home-action" onClick={onStock}><span>◇</span><strong>Ver stock</strong><small>Consultar inventario</small></button>
      </div>
      <div className="sigo-home-daily"><div className="sigo-home-kpis"><div className="sigo-home-kpi"><span>Total facturado hoy</span><strong>{dinero(resumen?.ventasHoyTotal||0)}</strong></div><div className="sigo-home-kpi"><span>Ventas realizadas</span><strong>{resumen?.ventasHoy||0}</strong></div></div><div className="sigo-home-peaks"><strong>Horas pico</strong><div className="sigo-home-peak-chart">{horas.map(h=><div className="sigo-home-peak-column" key={h.hora} title={`${h.hora}:00 · ${h.cantidad} ventas · ${dinero(h.total)}`}><div><span style={{height:`${Math.max(3,(h.cantidad/max)*58)}px`}} /></div><small>{h.hora}</small></div>)}</div><small className="sigo-home-peak-note">Ventas por hora de hoy · tocá una barra para ver el detalle</small></div></div>
    </div>
  );
}

function Productos({ empresaId, puedeEditar }: { empresaId: string; puedeEditar: boolean }) {
  const [productos, setProductos] = useState<ProductoSigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductoSigo | null>(null);
  const [form, setForm] = useState<ProductoForm>(productoVacio);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [ajusteStock, setAjusteStock] = useState(false);
  const [scanAction, setScanAction] = useState<BarcodeAction>("consultar");
  const [scanResult, setScanResult] = useState<BarcodeProduct | null>(null);
  const [eanHabilitado, setEanHabilitado] = useState(false);
  const [eanCodigo, setEanCodigo] = useState("");
  const [productoSugerido,setProductoSugerido]=useState(0);
  const productSearchRef = useRef<HTMLDivElement | null>(null);

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      setProductos(await listarProductosSigo(empresaId));
    } catch (err) {
      setProductos([]);
      setError(err instanceof Error ? err.message : "No se pudieron cargar los productos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
    let activo = true;
    void listarModulosEmpresa(empresaId)
      .then((mods) => { if (activo) { setEanHabilitado(Boolean(mods.find((m) => m.clave === "busqueda_ean")?.habilitado)); } })
      .catch(() => { if (activo) setEanHabilitado(false); });
    return () => { activo = false; };
  }, [empresaId]);

  useEffect(() => {
    if (!puedeEditar && scanAction !== "consultar") setScanAction("consultar");
  }, [puedeEditar, scanAction]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) => [p.nombre, p.codigo_interno, p.codigo_barras, p.marca, p.categoria]
      .filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [productos, search]);

  function abrirNuevo() {
    if (!puedeEditar) return;
    setEditing(null);
    setForm(productoVacio);
    setFormError("");
    setFormOpen(true);
  }

  function abrirEdicion(producto: ProductoSigo) {
    if (!puedeEditar) return;
    setEditing(producto);
    setForm({
      nombre: producto.nombre,
      codigoInterno: producto.codigo_interno ?? "",
      codigoBarras: producto.codigo_barras ?? "",
      categoria: producto.categoria ?? "",
      marca: producto.marca ?? "",
      precioVenta: producto.precio_venta == null ? "" : String(producto.precio_venta),
      stockMinimo: producto.stock_minimo == null ? "" : String(producto.stock_minimo),
      stockMaximo: producto.stock_maximo == null ? "" : String(producto.stock_maximo),
      stockInicial: "",
      costoReferencia: "",
    });
    setFormError("");
    setAjusteStock(false);
    setFormOpen(true);
  }

  function cerrarForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setForm(productoVacio);
    setFormError("");
    setAjusteStock(false);
  }

  function handleScan(producto: BarcodeProduct, action: BarcodeAction) {
    setScanResult(producto);
    setSearch(producto.codigo_barras || producto.codigo_interno || producto.nombre);
    if (action === "editar" && puedeEditar) {
      const original = productos.find((item) => item.id === producto.id);
      if (original) abrirEdicion(original);
    }
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!puedeEditar) {
      setFormError("Tu perfil tiene acceso de consulta, pero no puede modificar productos.");
      return;
    }
    if (!form.nombre.trim()) {
      setFormError("El nombre del producto es obligatorio.");
      return;
    }

    let precioVenta: number | null;
    let stockMinimo: number | null;
    let stockMaximo: number | null;
    let stockInicial: number | null;
    let costoReferencia: number | null;
    try {
      precioVenta = numeroOpcional(form.precioVenta, "El precio de venta");
      stockMinimo = numeroOpcional(form.stockMinimo, "El stock mínimo");
      stockMaximo = numeroOpcional(form.stockMaximo, "El stock máximo");
      stockInicial = numeroOpcional(form.stockInicial, "El stock inicial");
      costoReferencia = numeroOpcional(form.costoReferencia, "El costo de referencia");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Revisá los valores numéricos del producto.");
      return;
    }

    if (!editing && precioVenta == null) {
      setFormError("Ingresá el precio de venta para que el producto quede listo para vender.");
      return;
    }
    if (stockMinimo != null && stockMaximo != null && stockMaximo < stockMinimo) {
      setFormError("El stock máximo no puede ser menor que el stock mínimo.");
      return;
    }
    // Si se hace un conteo físico y supera el máximo anterior, el máximo no debe bloquear
    // la corrección del stock real. Lo elevamos al nuevo stock contado.
    if (editing && ajusteStock && stockInicial != null && stockMaximo != null && stockInicial > stockMaximo) {
      stockMaximo = stockInicial;
    }

    setSaving(true);
    setFormError("");
    try {
      await guardarProductoSigo({
        empresaId,
        productoId: editing?.id ?? null,
        nombre: form.nombre,
        codigoInterno: form.codigoInterno,
        codigoBarras: form.codigoBarras,
        categoria: form.categoria,
        marca: form.marca,
        descripcion: editing?.descripcion ?? null,
        proveedor: editing?.proveedor ?? null,
        costoActual: !editing && costoReferencia != null ? costoReferencia : null,
        costoUltimaCompra: !editing && costoReferencia != null ? costoReferencia : null,
        precioVenta,
        margenGanancia: null,
        margenPorcentaje: null,
        stockActual: (!editing || ajusteStock) && stockInicial != null ? stockInicial : null,
        stockMinimo,
        stockMaximo,
      });
      cerrarForm();
      await cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(producto: ProductoSigo) {
    if (!puedeEditar) return;
    if (!window.confirm(`¿Dar de baja ${producto.nombre}? No se borrarán ventas, compras ni históricos y sólo se permitirá si el stock está en cero.`)) return;
    setDeletingId(producto.id);
    try {
      await eliminarProductoSigo(empresaId, producto.id);
      await cargar();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo dar de baja el producto");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Productos</h2>
          <p>Administrá tus productos, precios y stock desde un solo lugar.</p>
        </div>
        <div className="topbar-actions product-actions">
          <button className="admin-button" onClick={() => void cargar()}>Actualizar</button>
          {puedeEditar ? <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button> : <span>Modo solo lectura</span>}
        </div>
      </div>

      {eanHabilitado && (
        <div className="panel" style={{ border: "2px solid #2563eb" }}>
          <div className="page-header">
            <div>
              <h3>🌐 Buscar producto por EAN</h3>
              <p>Módulo habilitado por Matriz. Ingresá o escaneá el EAN/GTIN para identificar un producto externo y facilitar su alta.</p>
            </div>
            <strong style={{ color: "#15803d" }}>EAN ACTIVO</strong>
          </div>
          <div className="form-actions" style={{ justifyContent: "flex-start" }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={eanCodigo}
              onChange={(e) => setEanCodigo(e.target.value.replace(/\D/g, "").slice(0, 14))}
              placeholder="Ej.: 7791234567890"
              aria-label="Código EAN o GTIN"
              style={{ minWidth: 280 }}
            />
            <button
              className="primary-button"
              type="button"
              disabled={eanCodigo.length < 8}
              onClick={() => setError("La búsqueda externa EAN está habilitada para esta empresa; falta configurar la fuente mundial de productos antes de consultar datos reales.")}
            >
              Buscar EAN
            </button>
          </div>
        </div>
      )}

      <div className="panel product-search-panel" ref={productSearchRef}>
        <h3>Buscar por código</h3>
        <p>Pistola USB/Bluetooth, ingreso manual o cámara del celular.</p>
        <BarcodeScanner
          empresaId={empresaId}
          action={puedeEditar ? scanAction : "consultar"}
          onActionChange={puedeEditar ? setScanAction : undefined}
          onProduct={handleScan}
          onQueryChange={setSearch}
          onManualQuery={(query) => {
            const q = query.trim().toLowerCase();
            if (!q) return false;
            const exactCode = productos.some((p) => p.codigo_barras?.toLowerCase() === q || p.codigo_interno?.toLowerCase() === q);
            if (exactCode) return false;
            return productos.some((p) => [p.nombre, p.marca, p.categoria].filter(Boolean).join(" ").toLowerCase().includes(q));
          }}
        />
        {search.trim() && (
          <div className="product-search-suggestions" role="listbox">
            {filtrados.slice(0,12).map((p,i)=><button type="button" key={p.id} className={i===productoSugerido?"active":""} onClick={()=>{setSearch(p.nombre);setScanResult(p);if(puedeEditar&&scanAction==="editar")abrirEdicion(p)}}><strong>{p.nombre}</strong><span>{p.codigo_interno||p.codigo_barras||"Sin código"} · $ {Number(p.precio_venta||0).toLocaleString("es-AR")} · Stock {p.stock_actual??0}</span></button>)}
            {filtrados.length===0&&<div className="table-empty">No se encontraron productos.</div>}
          </div>
        )}
        {scanResult && (
          <p><strong>Encontrado:</strong> {scanResult.nombre} · Stock {scanResult.stock_actual ?? "restringido"} · Precio {scanResult.precio_venta == null ? "restringido" : `$ ${Number(scanResult.precio_venta).toLocaleString("es-AR")}`}</p>
        )}
      </div>

      {loading && <div className="panel"><p>Cargando productos…</p></div>}
      {!loading && error && <div className="panel"><h3>No se pudieron cargar los productos</h3><p>{error}</p></div>}
      {!loading && !error && (
        <div className="panel products-list-panel">
          <div className="table-wrapper products-list-scroll">
            <table className="products-table">
              <thead><tr><th>Producto</th><th>Código</th><th>Código de barras</th><th>Precio</th><th>Stock</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.nombre}</strong>{p.marca && <small>{p.marca}</small>}</td>
                    <td>{p.codigo_interno ?? "-"}</td>
                    <td>{p.codigo_barras ?? "-"}</td>
                    <td>{p.precio_venta == null ? "Restringido" : `$ ${Number(p.precio_venta).toLocaleString("es-AR")}`}</td>
                    <td>{p.stock_actual == null ? "Restringido" : p.stock_actual}</td>
                    <td>
                      {puedeEditar ? (
                        <div className="row-actions">
                          <button className="admin-button" onClick={() => abrirEdicion(p)}>Editar</button>
                          <button className="admin-button" onClick={() => { abrirEdicion(p); setAjusteStock(true); setForm((actual) => ({ ...actual, stockInicial: String(p.stock_actual ?? 0) })); }}>Ajustar stock</button>
                          <button className="admin-button danger-button" disabled={deletingId === p.id} onClick={() => void eliminar(p)}>{deletingId === p.id ? "Dando de baja…" : "Dar de baja"}</button>
                        </div>
                      ) : "Solo lectura"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrados.length === 0 && <div className="table-empty">No hay productos para mostrar.</div>}
          </div>
        </div>
      )}

      {formOpen && puedeEditar && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrarForm(); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="producto-form-title">
            <div className="page-header modal-header">
              <div>
                <h2 id="producto-form-title">{editing ? (ajusteStock ? "Ajustar stock" : "Editar producto") : "Nuevo producto"}</h2>
                <p>{editing ? (ajusteStock ? "Corregí el stock real contado sin generar una compra ni inventar proveedor." : "Editá el maestro sin alterar el stock actual ni los costos de compras.") : "Alta lista para vender. Podés informar stock inicial si ya tenés mercadería."}</p>
              </div>
              <button type="button" className="admin-button" onClick={cerrarForm} disabled={saving}>Cerrar</button>
            </div>
            <form onSubmit={(e) => void guardar(e)}>
              <div className="form-grid">
                <div className="form-group form-span-2">
                  <label htmlFor="producto-nombre">Nombre *</label>
                  <input id="producto-nombre" value={form.nombre} onChange={(e) => setForm((actual) => ({ ...actual, nombre: e.target.value }))} autoFocus required />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-codigo">Código interno</label>
                  <input id="producto-codigo" value={form.codigoInterno} onChange={(e) => setForm((actual) => ({ ...actual, codigoInterno: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-barras">Código de barras</label>
                  <input id="producto-barras" inputMode="numeric" value={form.codigoBarras} onChange={(e) => setForm((actual) => ({ ...actual, codigoBarras: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-categoria">Categoría</label>
                  <input id="producto-categoria" value={form.categoria} onChange={(e) => setForm((actual) => ({ ...actual, categoria: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-marca">Marca</label>
                  <input id="producto-marca" value={form.marca} onChange={(e) => setForm((actual) => ({ ...actual, marca: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-precio">Precio de venta {editing ? "" : "*"}</label>
                  <input id="producto-precio" type="number" min="0" step="0.01" inputMode="decimal" value={form.precioVenta} onChange={(e) => setForm((actual) => ({ ...actual, precioVenta: e.target.value }))} required={!editing} />
                </div>
                {(!editing || ajusteStock) && (
                  <>
                    <div className="form-group">
                      <label htmlFor="producto-stock-inicial">{editing ? "Cantidad real que tengo" : "Cantidad que ya tengo"}</label>
                      <input id="producto-stock-inicial" type="number" min="0" step="0.001" inputMode="decimal" value={form.stockInicial} onChange={(e) => setForm((actual) => ({ ...actual, stockInicial: e.target.value }))} placeholder="Opcional · stock inicial" />
                      <small>{editing ? "Ingresá el total contado físicamente. No requiere proveedor ni factura." : "Usalo para mercadería que ya estaba en el negocio. No requiere proveedor ni factura."}</small>
                    </div>
                    <div className="form-group" style={{ display: editing ? "none" : undefined }}>
                      <label htmlFor="producto-costo-referencia">Costo de referencia</label>
                      <input id="producto-costo-referencia" type="number" min="0" step="0.01" inputMode="decimal" value={form.costoReferencia} onChange={(e) => setForm((actual) => ({ ...actual, costoReferencia: e.target.value }))} placeholder="Opcional" />
                      <small>Si no recordás el costo, dejalo vacío.</small>
                    </div>
                  </>
                )}
                <div className="form-group">
                  <label htmlFor="producto-stock-min">Stock mínimo</label>
                  <input id="producto-stock-min" type="number" min="0" step="0.001" inputMode="decimal" value={form.stockMinimo} onChange={(e) => setForm((actual) => ({ ...actual, stockMinimo: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-stock-max">Stock máximo</label>
                  <input id="producto-stock-max" type="number" min="0" step="0.001" inputMode="decimal" value={form.stockMaximo} onChange={(e) => setForm((actual) => ({ ...actual, stockMaximo: e.target.value }))} />
                </div>
                <div className="form-group form-span-2">
                  <small>{editing ? "El stock de productos existentes se modifica mediante movimientos operativos." : "Si ya tenés mercadería, podés cargarla como stock inicial sin inventar una compra ni un proveedor."}</small>
                </div>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="form-actions">
                <button type="button" className="admin-button" onClick={cerrarForm} disabled={saving}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear producto"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stock({ empresaId }: { empresaId: string }) {
  const [productos, setProductos] = useState<ProductoSigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [soloCriticos, setSoloCriticos] = useState(false);
  const [scanResult, setScanResult] = useState<BarcodeProduct | null>(null);

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      setProductos(await listarProductosSigo(empresaId));
    } catch (err) {
      setProductos([]);
      setError(err instanceof Error ? err.message : "No se pudo cargar el stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, [empresaId]);

  const visibles = productos.filter((p) => p.stock_actual != null);
  const criticos = visibles.filter((p) => p.stock_minimo != null && Number(p.stock_actual) <= Number(p.stock_minimo));
  const sinStock = visibles.filter((p) => Number(p.stock_actual) <= 0);
  const totalUnidades = visibles.reduce((total, p) => total + Number(p.stock_actual || 0), 0);
  const normalizarBusqueda = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR").trim();
  const termino = normalizarBusqueda(busqueda);
  const filas = (soloCriticos ? criticos : visibles).filter((p) =>
    !termino || [p.nombre, p.codigo_interno, p.codigo_barras, p.marca]
      .some((valor) => valor && normalizarBusqueda(valor).includes(termino))
  );

  return (
    <div className="products-page stock-page-compact">
      <div className="page-header">
        <div>
          <h2>Stock</h2>
          <p>Inventario operativo de la empresa activa. Los datos sensibles dependen de permisos.</p>
        </div>
        <button className="admin-button" onClick={() => void cargar()}>Actualizar</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>Productos con stock visible</span><strong>{visibles.length}</strong></div>
        <div className="stat-card"><span>Unidades totales</span><strong>{totalUnidades.toLocaleString("es-AR")}</strong></div>
        <div className="stat-card"><span>Stock crítico</span><strong>{criticos.length}</strong></div>
        <div className="stat-card"><span>Sin stock</span><strong>{sinStock.length}</strong></div>
      </div>

      <div className="panel">
        <h3>Buscar stock por nombre o código</h3>
        <BarcodeScanner
          empresaId={empresaId}
          action="consultar"
          onQueryChange={(query) => { setBusqueda(query); setScanResult(null); }}
          onManualQuery={(query) => {
            const valor = normalizarBusqueda(query);
            if (!valor) return false;
            // Los códigos exactos siguen consultándose en el servidor; los nombres
            // filtran el stock ya cargado, también al pulsar Buscar o Enter.
            if (productos.some((p) =>
              normalizarBusqueda(p.codigo_barras || "") === valor || normalizarBusqueda(p.codigo_interno || "") === valor
            )) return false;
            return productos.some((p) => normalizarBusqueda(p.nombre).includes(valor));
          }}
          onProduct={(producto) => { setScanResult(producto); setBusqueda(producto.codigo_barras || producto.codigo_interno || producto.nombre); }}
        />
        {scanResult && <p><strong>{scanResult.nombre}</strong> · Stock actual: {scanResult.stock_actual ?? "restringido"} · Mínimo: {scanResult.stock_minimo ?? "sin definir"}</p>}
      </div>

      <div className="panel">
        <div className="page-header">
          <div><h3>Detalle de stock</h3><p>Priorizá faltantes y productos bajo mínimo.</p></div>
          <button className={soloCriticos ? "primary-button" : "admin-button"} onClick={() => setSoloCriticos((actual) => !actual)}>{soloCriticos ? "Ver todo" : "Solo críticos"}</button>
        </div>
        {loading && <p>Cargando stock…</p>}
        {!loading && error && <p role="alert">{error}</p>}
        {!loading && !error && (
          <div className="table-wrapper">
            <table className="products-table">
              <thead><tr><th>Producto</th><th>Código</th><th>Stock actual</th><th>Mínimo</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map((p) => {
                  const critico = p.stock_minimo != null && Number(p.stock_actual) <= Number(p.stock_minimo);
                  return <tr key={p.id}><td><strong>{p.nombre}</strong></td><td>{p.codigo_barras || p.codigo_interno || "-"}</td><td>{p.stock_actual}</td><td>{p.stock_minimo ?? "-"}</td><td>{Number(p.stock_actual) <= 0 ? "SIN STOCK" : critico ? "CRÍTICO" : "OK"}</td></tr>;
                })}
              </tbody>
            </table>
            {filas.length === 0 && <div className="table-empty">{termino ? "No se encontraron productos con esa búsqueda." : "No hay stock visible para mostrar."}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Pendiente({ title }: { title: string }) {
  return <div className="panel"><h2>{title}</h2><p>Módulo en integración operativa. No se marca como aprobado hasta probar el circuito real.</p></div>;
}
