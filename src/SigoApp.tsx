import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { EmpresaOperativa } from "./tenant";
import BarcodeScanner from "./BarcodeScanner";
import type { BarcodeAction, BarcodeProduct } from "./barcode";
import VentaRapidaOperativa from "./VentaRapidaOperativa";
import { can } from "./permissions";
import {
  eliminarProductoSigo,
  guardarProductoSigo,
  listarProductosSigo,
  type ProductoSigo,
} from "./productos";

type Section = "Inicio" | "Productos" | "Ventas" | "Clientes" | "Compras" | "Stock" | "Informes";

const sections: Section[] = ["Inicio", "Productos", "Ventas", "Clientes", "Compras", "Stock", "Informes"];

type ProductoForm = {
  nombre: string;
  codigoInterno: string;
  codigoBarras: string;
  categoria: string;
  marca: string;
  precioVenta: string;
  stockMinimo: string;
  stockMaximo: string;
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
};

function numeroOpcional(valor: string, etiqueta: string): number | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  const numero = Number(limpio);
  if (!Number.isFinite(numero) || numero < 0) throw new Error(`${etiqueta} debe ser un número igual o mayor a cero.`);
  return numero;
}

export default function SigoApp({ empresa }: { empresa: EmpresaOperativa }) {
  const [section, setSection] = useState<Section>("Inicio");
  const puedeEditarProductos = can(empresa.rol, "products.write");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div>
            <strong>SIGO</strong>
            <span>Gestión Operativa</span>
          </div>
        </div>
        <nav className="menu">
          {sections.map((item) => (
            <button key={item} className={section === item ? "menu-item active" : "menu-item"} onClick={() => setSection(item)}>
              <span className="menu-icon">{item.slice(0, 2).toUpperCase()}</span>
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">A</div>
            <div>
              <strong>{empresa.empresa_nombre}</strong>
              <span>Empresa activa</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{section}</h1>
            <p>{empresa.empresa_nombre} · SIGO</p>
          </div>
        </header>
        <section className="content">
          {section === "Inicio" && <Inicio empresa={empresa} onProductos={() => setSection("Productos")} onStock={() => setSection("Stock")} />}
          {section === "Productos" && <Productos empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} />}
          {section === "Stock" && <Stock empresaId={empresa.empresa_id} />}
          {section === "Ventas" && <VentaRapidaOperativa empresaId={empresa.empresa_id} puedeEditarProductos={puedeEditarProductos} />}
          {section !== "Inicio" && section !== "Productos" && section !== "Stock" && section !== "Ventas" && <Pendiente title={section} />}
        </section>
      </main>
    </div>
  );
}

function Inicio({ empresa, onProductos, onStock }: { empresa: EmpresaOperativa; onProductos: () => void; onStock: () => void }) {
  return (
    <div className="welcome">
      <div>
        <h2>SIGO · {empresa.empresa_nombre}</h2>
        <p>Operación protegida por empresa activa. Productos y stock trabajan con aislamiento por tenant.</p>
      </div>
      <div className="topbar-actions">
        <button className="admin-button" onClick={onStock}>Ver stock</button>
        <button className="primary-button" onClick={onProductos}>Abrir productos</button>
      </div>
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
  const [scanAction, setScanAction] = useState<BarcodeAction>("consultar");
  const [scanResult, setScanResult] = useState<BarcodeProduct | null>(null);

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
    });
    setFormError("");
    setFormOpen(true);
  }

  function cerrarForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setForm(productoVacio);
    setFormError("");
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
    try {
      precioVenta = numeroOpcional(form.precioVenta, "El precio de venta");
      stockMinimo = numeroOpcional(form.stockMinimo, "El stock mínimo");
      stockMaximo = numeroOpcional(form.stockMaximo, "El stock máximo");
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
        costoActual: null,
        costoUltimaCompra: null,
        precioVenta,
        margenGanancia: null,
        margenPorcentaje: null,
        stockActual: null,
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
          <p>Catálogo de la empresa activa. Lectura y cambios se validan en backend por tenant y permisos.</p>
        </div>
        <div className="topbar-actions product-actions">
          <button className="admin-button" onClick={() => void cargar()}>Actualizar</button>
          {puedeEditar ? <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button> : <span>Modo solo lectura</span>}
        </div>
      </div>

      <div className="panel">
        <h3>Buscar por código</h3>
        <p>Pistola USB/Bluetooth, ingreso manual o cámara del celular.</p>
        <BarcodeScanner
          empresaId={empresaId}
          action={puedeEditar ? scanAction : "consultar"}
          onActionChange={puedeEditar ? setScanAction : undefined}
          onProduct={handleScan}
        />
        {scanResult && (
          <p><strong>Encontrado:</strong> {scanResult.nombre} · Stock {scanResult.stock_actual ?? "restringido"} · Precio {scanResult.precio_venta == null ? "restringido" : `$ ${Number(scanResult.precio_venta).toLocaleString("es-AR")}`}</p>
        )}
      </div>

      <div className="product-tools product-search-emphasis">
        <label htmlFor="producto-busqueda-visible">Buscar producto o código de barras</label>
        <input
          id="producto-busqueda-visible"
          type="search"
          placeholder="Escribí el nombre del producto o el código de barras..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar producto o código de barras"
        />
      </div>

      {loading && <div className="panel"><p>Cargando productos…</p></div>}
      {!loading && error && <div className="panel"><h3>No se pudieron cargar los productos</h3><p>{error}</p></div>}
      {!loading && !error && (
        <div className="panel">
          <div className="table-wrapper">
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
                <h2 id="producto-form-title">{editing ? "Editar producto" : "Nuevo producto"}</h2>
                <p>{editing ? "Editá el maestro sin alterar el stock actual ni los costos de compras." : "Alta lista para vender. El stock se ingresa por Compras para conservar trazabilidad."}</p>
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
                <div className="form-group">
                  <label htmlFor="producto-stock-min">Stock mínimo</label>
                  <input id="producto-stock-min" type="number" min="0" step="0.001" inputMode="decimal" value={form.stockMinimo} onChange={(e) => setForm((actual) => ({ ...actual, stockMinimo: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="producto-stock-max">Stock máximo</label>
                  <input id="producto-stock-max" type="number" min="0" step="0.001" inputMode="decimal" value={form.stockMaximo} onChange={(e) => setForm((actual) => ({ ...actual, stockMaximo: e.target.value }))} />
                </div>
                <div className="form-group form-span-2">
                  <small>El stock actual no se edita acá: se incrementa desde Compras y se descuenta desde Ventas para no perder trazabilidad.</small>
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
  const filas = soloCriticos ? criticos : visibles;

  return (
    <div className="products-page">
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
        <h3>Consultar producto por código</h3>
        <BarcodeScanner empresaId={empresaId} action="consultar" onProduct={(producto) => setScanResult(producto)} />
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
            {filas.length === 0 && <div className="table-empty">No hay stock visible para mostrar.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Pendiente({ title }: { title: string }) {
  return <div className="panel"><h2>{title}</h2><p>Módulo en integración operativa. No se marca como aprobado hasta probar el circuito real.</p></div>;
}
